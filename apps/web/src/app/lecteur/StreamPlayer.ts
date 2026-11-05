/**
 * Lecture d’un flux Onde (Icecast, MP3) avec repérage exact des changements de titre.
 *
 * Le flux est lu par fetch avec les métadonnées ICY : chaque changement de titre arrive
 * dans le flux, à sa place. Le son passe par MediaSource, ce qui permet de :
 *  - savoir quelques secondes à l’avance quand le titre suivant commence (marge de lecture) ;
 *  - mettre le flux en pause le temps des spots de la boutique, puis reprendre au début
 *    du titre suivant (léger différé, rattrapé plus tard en sautant un titre entier) ;
 *  - baisser ou couper le son avec des fondus propres.
 */

export interface Boundary {
  /** Position dans la lecture locale (secondes) où commence le titre. */
  time: number;
  title: string;
  artist: string;
  /** Titre déjà en cours à la connexion : pas un vrai changement. */
  initial: boolean;
}

type Item = Uint8Array | { title: string; artist: string };

/** Les métadonnées ICY arrivent au plus tard une seconde (16 000 octets à 128 kb/s) après le changement. */
const META_GRANULARITY = 1;

export const streamSupported = () =>
  typeof window !== 'undefined' && 'MediaSource' in window && MediaSource.isTypeSupported('audio/mpeg') && typeof ReadableStream !== 'undefined';

/** Titre ICY : UTF-8 si valide, sinon Latin-1 (ancien émetteur, ou Icecast réglé par défaut). */
function decodeMeta(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function parseTitle(meta: string): { title: string; artist: string } {
  const m = meta.match(/StreamTitle='(.*?)';/s);
  const full = (m?.[1] ?? '').trim();
  const i = full.indexOf(' - ');
  return i > 0 ? { artist: full.slice(0, i).trim(), title: full.slice(i + 3).trim() } : { artist: '', title: full };
}

export class StreamPlayer {
  readonly el = new Audio();
  private ms = new MediaSource();
  private sb: SourceBuffer | null = null;
  private queue: Item[] = [];
  private abort = new AbortController();
  private gainNode: GainNode;
  private objectUrl: string;
  private cleaner: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  boundaries: Boundary[] = [];
  /** Données reçues : le flux est vivant. */
  lastData = 0;
  connected = false;
  failed = false;

  constructor(
    readonly url: string,
    private ctx: AudioContext,
    destination: AudioNode,
    private hooks: { onBoundary?: (b: Boundary) => void; onFail?: (why: string) => void } = {}
  ) {
    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = 0.0001;
    this.objectUrl = URL.createObjectURL(this.ms);
    this.el.src = this.objectUrl;
    this.el.preload = 'auto';
    ctx.createMediaElementSource(this.el).connect(this.gainNode).connect(destination);
    this.ms.addEventListener('sourceopen', () => {
      this.sb = this.ms.addSourceBuffer('audio/mpeg');
      this.sb.mode = 'sequence';
      this.sb.addEventListener('updateend', () => this.pump());
      void this.read();
    });
    // On garde 30 s derrière la tête de lecture : la mémoire reste stable sur toute une journée.
    this.cleaner = setInterval(() => this.trim(), 10_000);
  }

  // ───────────── Réception ─────────────
  private async read() {
    try {
      const res = await fetch(this.url, { headers: { 'Icy-MetaData': '1' }, cache: 'no-store', signal: this.abort.signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      this.connected = true;
      const metaint = Number(res.headers.get('icy-metaint') ?? 0);
      const reader = res.body.getReader();
      let audioLeft = metaint || Infinity;
      let metaLeft = -1; // -1 : on attend l’octet de longueur
      let meta: number[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) throw new Error('Flux interrompu');
        this.lastData = Date.now();
        let i = 0;
        while (i < value.length) {
          if (audioLeft > 0) {
            const n = Math.min(audioLeft, value.length - i);
            this.queue.push(value.subarray(i, i + n));
            audioLeft -= n;
            i += n;
          } else if (metaLeft < 0) {
            metaLeft = value[i++] * 16;
            meta = [];
            if (metaLeft === 0) {
              metaLeft = -1;
              audioLeft = metaint;
            }
          } else {
            const n = Math.min(metaLeft, value.length - i);
            for (let k = 0; k < n; k++) meta.push(value[i + k]);
            metaLeft -= n;
            i += n;
            if (metaLeft === 0) {
              this.queue.push(parseTitle(decodeMeta(new Uint8Array(meta)).replace(/\0+$/, '')));
              metaLeft = -1;
              audioLeft = metaint;
            }
          }
        }
        this.pump();
      }
    } catch (e) {
      if (this.stopped) return;
      this.failed = true;
      this.hooks.onFail?.((e as Error).message);
    }
  }

  private bufferedEnd() {
    const b = this.sb?.buffered;
    return b && b.length ? b.end(b.length - 1) : 0;
  }

  private pump() {
    const sb = this.sb;
    if (!sb || sb.updating || this.stopped) return;
    // Métadonnées en tête de file : elles se placent après tout le son déjà ajouté.
    while (this.queue.length && !(this.queue[0] instanceof Uint8Array)) {
      const m = this.queue.shift() as { title: string; artist: string };
      const initial = this.boundaries.length === 0;
      const b: Boundary = { time: initial ? 0 : Math.max(0, this.bufferedEnd() - META_GRANULARITY / 2), title: m.title, artist: m.artist, initial };
      this.boundaries.push(b);
      if (this.boundaries.length > 50) this.boundaries.shift();
      this.hooks.onBoundary?.(b);
    }
    // Le son jusqu’aux prochaines métadonnées, en un seul ajout.
    const parts: Uint8Array[] = [];
    while (this.queue.length && this.queue[0] instanceof Uint8Array) parts.push(this.queue.shift() as Uint8Array);
    if (!parts.length) return;
    const size = parts.reduce((a, p) => a + p.length, 0);
    const data = new Uint8Array(size);
    let o = 0;
    for (const p of parts) {
      data.set(p, o);
      o += p.length;
    }
    try {
      sb.appendBuffer(data);
    } catch (e) {
      if ((e as DOMException).name === 'QuotaExceededError') {
        this.queue.unshift(data);
        this.trim(5);
      } else {
        this.failed = true;
        this.hooks.onFail?.('Lecture impossible');
      }
    }
  }

  private trim(keep = 30) {
    const sb = this.sb;
    if (!sb || sb.updating || !sb.buffered.length) return;
    const start = sb.buffered.start(0);
    const until = this.el.currentTime - keep;
    if (until > start + 1) {
      try {
        sb.remove(start, until);
      } catch {
        /* on réessaiera */
      }
    }
  }

  // ───────────── Lecture ─────────────
  /** Secondes de flux reçues d’avance (marge pour voir venir le titre suivant). */
  ahead() {
    return Math.max(0, this.bufferedEnd() - this.el.currentTime);
  }

  /** Prêt à jouer avec au moins `lead` secondes d’avance. */
  ready(lead: number) {
    return this.bufferedEnd() >= lead || (this.connected && this.bufferedEnd() > 0 && Date.now() - this.lastData > 3000);
  }

  get gain() {
    return this.gainNode.gain;
  }

  async play(from?: number, fadeSec = 1.5) {
    if (from != null) this.el.currentTime = Math.max(this.sb?.buffered.length ? this.sb.buffered.start(0) : 0, from);
    await this.el.play();
    this.fade(1, fadeSec);
  }

  fade(level: number, sec: number) {
    const g = this.gainNode.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(Math.max(0.0001, level), now + Math.max(0.02, sec));
  }

  pause() {
    this.el.pause();
  }

  /** Changement de titre à venir (dans la marge reçue), ou null. */
  nextBoundary(): Boundary | null {
    const t = this.el.currentTime;
    return this.boundaries.find((b) => !b.initial && b.time > t + 0.05) ?? null;
  }

  /** Titre en cours à l’endroit où l’on écoute. */
  current(): Boundary | null {
    const t = this.el.currentTime;
    let cur: Boundary | null = null;
    for (const b of this.boundaries) if (b.time <= t + 0.05) cur = b;
    return cur;
  }

  /**
   * Différé par rapport au direct (spots joués en pause) : on rattrape en sautant au début d’un titre
   * plus récent. Seulement juste après un changement de titre, pour ne jamais couper un morceau.
   */
  catchUp(maxLagSec: number, lead: number): Boundary | null {
    const end = this.bufferedEnd();
    if (end - this.el.currentTime <= maxLagSec) return null;
    const cur = this.current();
    if (!cur || cur.initial || this.el.currentTime - cur.time > 1.5) return null;
    const target = [...this.boundaries].reverse().find((b) => !b.initial && b.time > this.el.currentTime + 1 && b.time < end - lead);
    if (!target) return null;
    this.el.currentTime = target.time;
    return target;
  }

  stop() {
    this.stopped = true;
    this.abort.abort();
    if (this.cleaner) clearInterval(this.cleaner);
    try {
      this.el.pause();
      this.gainNode.disconnect();
      if (this.ms.readyState === 'open') this.ms.endOfStream();
    } catch {
      /* déjà arrêté */
    }
    URL.revokeObjectURL(this.objectUrl);
  }
}

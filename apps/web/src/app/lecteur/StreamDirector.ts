/**
 * Antenne d’une boutique branchée sur le flux de son enseigne.
 *
 * - Écoute le flux avec 8 s de marge : chaque changement de titre est connu avant d’être entendu.
 * - Écran de spots dû : le titre en cours finit, le flux se met en pause, les spots de la boutique
 *   passent, puis le flux reprend au début du titre suivant (sans le chevauchement de l’ancien).
 * - Le léger différé accumulé est rattrapé en sautant au début d’un titre plus récent, jamais en coupant.
 * - Flux coupé : le signale (le lecteur passe sur la musique en cache), et se reconnecte seul.
 */
import { StreamPlayer, type Boundary } from './StreamPlayer';

export interface OndePlay {
  id: string;
  track_id: string | null;
  playlist_id: string | null;
  title: string;
  artist: string;
  isrc: string | null;
  is_jingle: boolean;
  duration_sec: number;
  cross_sec: number;
  started_at: string | null;
}

export interface StreamTrack {
  title: string;
  artist: string;
  play: OndePlay | null;
}

/** Marge d’avance : temps pendant lequel on connaît le prochain changement de titre avant de l’entendre. */
const LEAD = 8;
/** Différé toléré avant de rattraper le direct en sautant un titre. */
const MAX_LAG = 90;
/** Sans son pendant ce délai, le flux est considéré coupé. */
const DOWN_AFTER_MS = 10_000;

/**
 * Clé de rapprochement entre le titre lu dans le flux et l’historique de l’émetteur :
 * sans accents, casse ni ponctuation (les métadonnées du flux peuvent perdre des caractères en route).
 */
export function trackKey(artist: string, title: string): string {
  const raw = `${artist} ${title}`.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const loose = raw.replace(/[^\p{L}\p{N}]+/gu, '');
  return loose || raw.trim();
}

export class StreamDirector {
  private ctx = new AudioContext();
  private master = this.ctx.createGain();
  private player: StreamPlayer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retryAt = 0;
  private lastSound = Date.now();
  private armed = new Set<number>();
  private passed = new Set<number>();
  private plays: OndePlay[] = [];
  private base = 0.8;
  private duckLevel = 1;
  private down = false;
  /** active : on doit entendre le flux ; sinon il se met en mémoire en attendant de reprendre l’antenne. */
  private active = true;
  holding = false;
  blocked = false;

  constructor(
    private url: string,
    private hooks: {
      breakDue: (remainingSec: number) => boolean;
      runBreak: () => Promise<void>;
      isBusy: () => boolean;
      onTrackStart: (t: StreamTrack) => void;
      onDown: (down: boolean) => void;
      onBlocked?: (blocked: boolean) => void;
    }
  ) {
    this.master.connect(this.ctx.destination);
    this.master.gain.value = this.base;
  }

  get state(): 'idle' | 'playing' | 'holding' {
    if (this.holding) return 'holding';
    return this.active && this.player && !this.player.el.paused ? 'playing' : 'idle';
  }

  get isActive() {
    return this.active;
  }

  /** Le flux arrive normalement et la marge est remplie : prêt à reprendre l’antenne. */
  get healthy() {
    const p = this.player;
    return Boolean(p && !p.failed && p.connected && !this.starting && Date.now() - p.lastData < 3000 && p.ready(LEAD));
  }

  async start() {
    await this.ctx.resume().catch(() => undefined);
    this.connect();
    this.timer ??= setInterval(() => this.tick(), 100);
  }

  async resume() {
    await this.ctx.resume().catch(() => undefined);
    this.setBlocked(false);
    if (this.active && this.player?.el.paused && !this.holding) await this.player.play(undefined, 1).catch(() => this.setBlocked(true));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.player?.stop();
    this.player = null;
    void this.ctx.close();
  }

  setUrl(url: string) {
    if (url === this.url) return;
    this.url = url;
    // Nouvelle adresse (émetteur déplacé) : on bascule tout de suite si le flux actuel est coupé, sinon au prochain titre.
    if (this.down || !this.player) this.connect();
    else this.pendingUrl = true;
  }
  private pendingUrl = false;

  setPlays(plays: OndePlay[]) {
    this.plays = plays;
  }

  setBaseVolume(v: number) {
    this.base = Math.max(0, Math.min(1, v));
    this.master.gain.setTargetAtTime(this.base * this.duckLevel, this.ctx.currentTime, 0.1);
  }

  async duck(level: number, ms = 800) {
    this.duckLevel = level;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(Math.max(0.0001, level * this.base), now + ms / 1000);
    await new Promise((r) => setTimeout(r, ms));
  }

  /** Le lecteur joue la musique en cache : le flux se met en mémoire sans être entendu. */
  standby() {
    this.active = false;
    this.player?.fade(0, 0.5);
    setTimeout(() => !this.active && this.player?.pause(), 600);
  }

  /** Reprend l’antenne : au début du titre le plus récent reçu, sinon avec la marge habituelle. */
  async activate() {
    this.active = true;
    const p = this.player;
    if (!p) return;
    const end = p.el.buffered.length ? p.el.buffered.end(p.el.buffered.length - 1) : 0;
    const recent = [...p.boundaries].reverse().find((b) => !b.initial && b.time < end - 2 && b.time > end - 60);
    await p.play(recent ? recent.time : Math.max(0, end - LEAD), 2).catch(() => this.setBlocked(true));
  }

  /** Secondes avant le prochain changement de titre entendu ici ; null si inconnu. */
  remaining(): number | null {
    const p = this.player;
    if (!p || !this.active) return null;
    if (this.holding) return 0;
    const nb = p.nextBoundary();
    if (nb) return Math.max(0, nb.time - p.el.currentTime);
    // Pas encore dans la marge : horloge de l’émetteur + notre différé.
    const cur = this.currentPlay();
    if (cur?.started_at) {
      const server = (Date.parse(cur.started_at) + (cur.duration_sec - cur.cross_sec) * 1000 - Date.now()) / 1000;
      return Math.max(LEAD, server + p.ahead() + 1);
    }
    return null;
  }

  nowPlaying(): { title: string; artist: string; position: number; length: number } | null {
    const p = this.player;
    const cur = p?.current();
    if (!p || !cur || !this.active) return null;
    const play = this.match(cur);
    return { title: cur.title, artist: cur.artist, position: cur.initial ? 0 : Math.max(0, p.el.currentTime - cur.time), length: cur.initial ? 0 : play?.duration_sec ?? 0 };
  }

  private match(b: { title: string; artist: string }): OndePlay | null {
    const key = trackKey(b.artist, b.title);
    const same = this.plays.filter((x) => trackKey(x.artist, x.title) === key);
    // Le même titre peut figurer deux fois (émetteur relancé) : on préfère celui réellement lancé, le plus récent.
    return same.find((x) => x.started_at) ?? same[0] ?? null;
  }

  private currentPlay(): OndePlay | null {
    const cur = this.player?.current();
    return cur ? this.match(cur) : null;
  }

  private setBlocked(v: boolean) {
    if (this.blocked === v) return;
    this.blocked = v;
    this.hooks.onBlocked?.(v);
  }

  private setDown(v: boolean) {
    if (this.down === v) return;
    this.down = v;
    this.hooks.onDown(v);
  }

  private connect() {
    this.player?.stop();
    this.armed.clear();
    this.passed.clear();
    this.pendingUrl = false;
    const p = new StreamPlayer(this.url, this.ctx, this.master, {
      onFail: () => {
        if (this.player === p) this.retryAt = Date.now() + 3000;
      }
    });
    this.player = p;
    this.starting = true;
  }
  private starting = false;

  private tick() {
    const p = this.player;
    const now = Date.now();
    if (!p || p.failed) {
      if (now >= this.retryAt) this.connect();
    } else if (this.starting && p.ready(LEAD) && !this.hooks.isBusy()) {
      // Première écoute (ou reconnexion) : on démarre avec la marge d’avance.
      this.starting = false;
      if (this.active) void p.play(0, 2).catch(() => this.setBlocked(true));
    }
    if (p && !p.el.paused && p.ahead() > 0.5) this.lastSound = now;
    // En attente (la bibliothèque joue) : on reste près du direct pour que la mémoire ne grossisse pas.
    if (p && !this.active && p.el.paused && p.el.buffered.length) {
      const end = p.el.buffered.end(p.el.buffered.length - 1);
      if (end - p.el.currentTime > 20) p.el.currentTime = end - LEAD;
    }
    if (p && !this.active && p.connected && now - p.lastData < 3000) this.lastSound = now;
    if (this.holding) this.lastSound = now;
    this.setDown(now - this.lastSound > DOWN_AFTER_MS);
    if (!p || !this.active || this.holding || p.el.paused) return;

    // Contexte audio suspendu par le système : on le relance, sinon on demande un geste.
    if (this.ctx.state !== 'running') {
      void this.ctx.resume().catch(() => undefined);
      return;
    }

    // Titre qui commence ici : historique de la boutique.
    const cur = p.current();
    if (cur && !cur.initial && !this.passed.has(cur.time)) {
      this.passed.add(cur.time);
      this.hooks.onTrackStart({ title: cur.title, artist: cur.artist, play: this.match(cur) });
    }

    // Prochain changement de titre dans la marge : on le prépare à la milliseconde.
    const nb = p.nextBoundary();
    if (nb && !this.armed.has(nb.time)) {
      const wait = nb.time - p.el.currentTime;
      if (wait <= 1.2) {
        this.armed.add(nb.time);
        void this.atBoundary(p, nb, wait);
      }
    }
  }

  private async atBoundary(p: StreamPlayer, nb: Boundary, wait: number) {
    const ending = this.currentPlay();
    if (this.hooks.breakDue(wait) || this.hooks.isBusy()) {
      // Le titre finit (fondu sur la dernière seconde), pause, spots, puis reprise au début du suivant.
      this.holding = true;
      try {
        p.fade(0, Math.max(0.3, wait));
        await new Promise((r) => setTimeout(r, Math.max(0, wait * 1000)));
        p.pause();
        await this.hooks.runBreak();
        if (this.player !== p) return;
        // On saute le chevauchement de l’ancien titre : le suivant reprend net.
        const skip = Math.min(6, Math.max(0.5, ending?.cross_sec ?? 1));
        await p.play(nb.time + skip, 1.2).catch(() => this.setBlocked(true));
      } finally {
        this.holding = false;
      }
      return;
    }
    // Pas de spots : si le différé est trop grand, on rattrape en sautant au début d’un titre plus récent.
    const end = p.el.buffered.length ? p.el.buffered.end(p.el.buffered.length - 1) : 0;
    if (end - nb.time > MAX_LAG || this.pendingUrl) {
      if (this.pendingUrl) {
        await new Promise((r) => setTimeout(r, Math.max(0, wait * 1000)));
        this.connect();
        return;
      }
      const target = [...p.boundaries].reverse().find((b) => !b.initial && b.time > nb.time && b.time < end - LEAD);
      if (target) {
        await new Promise((r) => setTimeout(r, Math.max(0, wait * 1000)));
        if (this.player === p) p.el.currentTime = target.time;
      }
    }
  }
}

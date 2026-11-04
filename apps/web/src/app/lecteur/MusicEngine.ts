/**
 * Moteur musical du lecteur boutique (Web Audio), équivalent de l’AutoDJ d’AzuraCast sans le direct.
 *
 * - Choisit chaque titre avec le moteur de programmation (@onde/rules) : journée type,
 *   listes, poids, ordres, horaires, espacements titre et artiste.
 * - Applique le gain de normalisation de chaque titre (cible LUFS de l’ambiance, plafond −1 dBFS).
 * - Démarre au point d’entrée, lance le titre suivant au point d’enchaînement avec fondus,
 *   coupe au point de sortie : les mêmes points de mix que la régie.
 * - Garde les fichiers en cache (Cache Storage) : la musique continue sans connexion.
 * - Laisse passer les écrans de spots entre deux titres, sans aucun chevauchement.
 */
import { effectiveMix, gainFor, type CrossfadeMode } from '@onde/audio';
import { ambienceAt, emptyRotation, localTimeIn, nextTrack, type Daypart, type PlayedTrack, type Playlist, type RotationState } from '@onde/rules';

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  isrc: string | null;
  duration_sec: number;
  cue_in: number;
  cue_out: number;
  cross_start: number;
  fade_in: number;
  fade_out: number;
  integrated_lufs: number | null;
  peak_dbfs: number | null;
  url: string | null;
}
export interface MusicAmbience {
  id: string;
  name: string;
  crossfade_mode: CrossfadeMode;
  crossfade_sec: number;
  target_lufs: number;
  title_separation_min: number;
  artist_separation_min: number;
}
export interface MusicSchedule {
  default_ambience_id: string;
  ambiences: MusicAmbience[];
  dayparts: Daypart[];
  playlists: (Playlist & { ambienceId: string })[];
  tracks: MusicTrack[];
}
export interface TrackStart {
  track: MusicTrack;
  playlistId: string;
  isJingle: boolean;
  ambience: string;
  daypart: string | null;
  /** Niveau envoyé, après normalisation (LUFS). */
  outputLufs: number | null;
}

interface Deck {
  track: MusicTrack;
  playlistId: string;
  isJingle: boolean;
  ambience: string;
  daypart: string | null;
  el: HTMLAudioElement;
  gain: GainNode;
  gainDb: number;
  level: number;
  mix: { cueIn: number; cueOut: number; crossStart: number; fadeIn: number; fadeOut: number };
  mixed: boolean;
  started: boolean;
  url: string;
  /** Surveillance d’un titre bloqué (réseau, fichier abîmé). */
  lastPos: number;
  lastMove: number;
}

const CACHE = 'onde-music-v1';
const cacheKey = (id: string) => `${location.origin}/__onde_music/${id}`;
const HISTORY = 'onde.music.history';
const STATE = 'onde.music.state';
/** Le titre suivant est choisi peu avant l’enchaînement, pour suivre l’heure au plus près. */
const PREPARE_AHEAD_SEC = 15;
/** Un titre dont la lecture n’avance plus depuis ce délai est abandonné au profit du suivant. */
const STALL_MS = 8000;

const load = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* plein : on continue en mémoire */
  }
};

export class MusicEngine {
  private ctx = new AudioContext();
  private master = this.ctx.createGain();
  private current: Deck | null = null;
  private outgoing = new Set<Deck>();
  private upcoming: Promise<Deck | null> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private schedule: MusicSchedule | null = null;
  private timeZone: string | null = null;
  private base = 0.8;
  private duckLevel = 1;
  private cachedSeconds = 0;
  private prefetching = false;
  private waitUntil = 0;
  private holding = false;
  private heldEndsAt = 0;
  /** Titre qui finit pendant qu’un écran de spots attend : reste affiché jusqu’au point de sortie. */
  private ending: Deck | null = null;
  private ticking = false;
  private failures = 0;
  /** Le navigateur refuse de lancer le son (il faut un geste sur l’écran). */
  blocked = false;

  constructor(
    private hooks: {
      onTrackStart: (t: TrackStart) => void;
      /** Un écran entre deux titres est-il dû à la fin de ce titre (secondes restantes) ? */
      breakDue: (remainingSec: number) => boolean;
      /** Joue l’écran de spots (la musique est arrêtée), puis rend la main. */
      runBreak: () => Promise<void>;
      /** Une annonce occupe l’antenne : ne pas lancer de titre. */
      isBusy: () => boolean;
      /** Le son est bloqué par le navigateur, ou débloqué. */
      onBlocked?: (blocked: boolean) => void;
    }
  ) {
    this.master.connect(this.ctx.destination);
    this.master.gain.value = this.base;
  }

  get playable() {
    return Boolean(this.schedule?.tracks.some((t) => t.url));
  }

  setSchedule(s: MusicSchedule | null, timeZone: string | null) {
    this.schedule = s;
    this.timeZone = timeZone;
    void this.prefetch();
  }

  setBaseVolume(v: number) {
    this.base = Math.max(0, Math.min(1, v));
    this.master.gain.setTargetAtTime(this.base * this.duckLevel, this.ctx.currentTime, 0.1);
  }

  async start() {
    await this.ctx.resume().catch(() => undefined);
    this.timer ??= setInterval(() => void this.tick(), 100);
  }

  /** Après un geste sur l’écran : relance le son si le navigateur l’avait bloqué. */
  async resume() {
    await this.ctx.resume().catch(() => undefined);
    this.setBlocked(false);
    this.waitUntil = 0;
    if (this.current?.el.paused && this.current.started) await this.current.el.play().catch(() => undefined);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.dispose(this.current);
    for (const d of this.outgoing) this.dispose(d);
    this.outgoing.clear();
    this.dropUpcoming();
    this.current = null;
    void this.ctx.close();
  }

  private setBlocked(v: boolean) {
    if (this.blocked === v) return;
    this.blocked = v;
    this.hooks.onBlocked?.(v);
  }

  /** Abandonne le titre préparé d’avance et libère son lecteur. */
  private dropUpcoming() {
    const u = this.upcoming;
    this.upcoming = null;
    void u?.then((d) => d && d !== this.current && this.dispose(d)).catch(() => undefined);
  }

  /** Baisse (0 à 1) ou remonte toute la musique : spots synchronisés, urgence. */
  async duck(to: number, ms = 800) {
    this.duckLevel = to;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(Math.max(0.0001, to * this.base), now + ms / 1000);
    await new Promise((r) => setTimeout(r, ms));
  }

  /** idle : rien à l’antenne ; playing : un titre ; holding : fin de titre puis écran de spots. */
  get state(): 'idle' | 'playing' | 'holding' {
    return this.holding ? 'holding' : this.current?.started ? 'playing' : 'idle';
  }

  /** Secondes avant le point de sortie du titre en cours ; null sans titre. */
  remaining(): number | null {
    if (this.holding) return Math.max(0, (this.heldEndsAt - Date.now()) / 1000);
    const c = this.current;
    if (!c || !c.started) return null;
    return Math.max(0, c.mix.cueOut - c.el.currentTime);
  }

  nowPlaying() {
    const c = this.current ?? (this.holding && Date.now() < this.heldEndsAt ? this.ending : null);
    if (!c?.started) return null;
    return {
      title: c.track.title,
      artist: c.track.artist,
      ambience: c.ambience,
      daypart: c.daypart,
      position: Math.max(0, c.el.currentTime - c.mix.cueIn),
      length: Math.max(0, c.mix.cueOut - c.mix.cueIn),
      jingle: c.isJingle
    };
  }

  cacheSeconds() {
    return Math.round(this.cachedSeconds);
  }

  // ───────────── Choix du titre ─────────────
  private choose() {
    const s = this.schedule;
    if (!s?.ambiences.length) return null;
    const local = localTimeIn(new Date(), this.timeZone);
    const { ambienceId, daypart } = ambienceAt(s.dayparts, local, s.default_ambience_id);
    const playable = s.tracks.filter((t) => t.url);
    const metas = new Map(playable.map((t) => [t.id, { id: t.id, title: t.title, artist: t.artist }]));
    const history = load<PlayedTrack[]>(HISTORY, []);
    // Ambiance du créneau d’abord ; si elle n’a rien de jouable, l’ambiance de la boutique, puis les autres :
    // une boutique ne doit jamais rester en silence.
    const order = [ambienceId, s.default_ambience_id, ...s.ambiences.map((a) => a.id)].filter((id, i, a): id is string => !!id && a.indexOf(id) === i);
    for (const id of order) {
      const amb = s.ambiences.find((a) => a.id === id);
      if (!amb) continue;
      const c = nextTrack({
        now: Date.now(),
        local,
        playlists: s.playlists.filter((p) => p.ambienceId === amb.id),
        tracks: metas,
        history,
        state: load<RotationState>(STATE, emptyRotation()),
        rules: { titleSeparationMin: amb.title_separation_min, artistSeparationMin: amb.artist_separation_min }
      });
      if (!c) continue;
      save(STATE, c.state);
      const track = playable.find((t) => t.id === c.track.id)!;
      return { track, playlist: c.playlist, amb, daypart: id === ambienceId ? (daypart?.name ?? null) : null };
    }
    return null;
  }

  // ───────────── Fichiers et cache ─────────────
  private async blobUrl(t: MusicTrack): Promise<string> {
    try {
      const cache = await caches.open(CACHE);
      let res = await cache.match(cacheKey(t.id));
      if (!res && t.url) {
        const fetched = await fetch(t.url);
        if (!fetched.ok) throw new Error(`HTTP ${fetched.status}`);
        await cache.put(cacheKey(t.id), fetched.clone());
        res = fetched;
      }
      if (res) return URL.createObjectURL(await res.blob());
    } catch {
      /* Cache Storage indisponible : lecture directe */
    }
    if (!t.url) throw new Error('Titre indisponible hors connexion');
    return t.url;
  }

  /** Télécharge à l’avance tous les titres programmés et retire ceux qui ne le sont plus. */
  private async prefetch() {
    if (this.prefetching || !this.schedule || typeof caches === 'undefined') return;
    this.prefetching = true;
    try {
      const cache = await caches.open(CACHE);
      const wanted = new Set(this.schedule.tracks.map((t) => cacheKey(t.id)));
      for (const req of await cache.keys()) if (!wanted.has(req.url)) await cache.delete(req);
      let secs = 0;
      for (const t of this.schedule.tracks) {
        if (!(await cache.match(cacheKey(t.id))) && t.url) {
          try {
            const r = await fetch(t.url);
            if (r.ok) await cache.put(cacheKey(t.id), r);
          } catch {
            continue;
          }
        }
        if (await cache.match(cacheKey(t.id))) secs += t.cue_out - t.cue_in;
        this.cachedSeconds = secs;
      }
    } catch {
      /* pas de cache : lecture en direct depuis le stockage */
    } finally {
      this.prefetching = false;
    }
  }

  private async prepare(): Promise<Deck | null> {
    const c = this.choose();
    if (!c) return null;
    const url = await this.blobUrl(c.track);
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.src = url;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0001;
    this.ctx.createMediaElementSource(el).connect(gain).connect(this.master);
    const fail = (e: unknown) => {
      this.dispose({ el, gain, url } as Deck);
      throw e;
    };
    const t = c.track;
    const gainDb = t.integrated_lufs == null ? 0 : gainFor(t.integrated_lufs, t.peak_dbfs ?? -1, c.amb.target_lufs);
    const mix = effectiveMix(
      { cueIn: t.cue_in, cueOut: t.cue_out, crossStart: t.cross_start, fadeIn: t.fade_in, fadeOut: t.fade_out },
      c.amb.crossfade_mode,
      c.amb.crossfade_sec
    );
    await new Promise<void>((resolve, reject) => {
      if (el.readyState >= 1) return resolve();
      el.addEventListener('loadedmetadata', () => resolve(), { once: true });
      el.addEventListener('error', () => reject(new Error('Fichier illisible')), { once: true });
      setTimeout(() => reject(new Error('Fichier trop long à charger')), 15000);
    }).catch(fail);
    return {
      track: t,
      playlistId: c.playlist.id,
      isJingle: Boolean(c.playlist.isJingle),
      ambience: c.amb.name,
      daypart: c.daypart,
      el,
      gain,
      gainDb,
      level: Math.pow(10, gainDb / 20),
      mix,
      mixed: false,
      started: false,
      url,
      lastPos: -1,
      lastMove: Date.now()
    };
  }

  private async begin(d: Deck): Promise<boolean> {
    d.el.currentTime = d.mix.cueIn;
    const now = this.ctx.currentTime;
    d.gain.gain.cancelScheduledValues(now);
    d.gain.gain.setValueAtTime(d.mix.fadeIn > 0 ? 0.0001 : d.level, now);
    if (d.mix.fadeIn > 0) d.gain.gain.linearRampToValueAtTime(d.level, now + d.mix.fadeIn);
    try {
      await d.el.play();
    } catch (e) {
      if ((e as DOMException)?.name === 'NotAllowedError') {
        // Son bloqué par le navigateur : on garde ce titre pour le geste qui débloquera.
        this.upcoming = Promise.resolve(d);
        this.setBlocked(true);
        return false;
      }
      this.dispose(d);
      throw e;
    }
    d.started = true;
    d.lastMove = Date.now();
    this.current = d;
    this.failures = 0;
    this.hooks.onTrackStart({
      track: d.track,
      playlistId: d.playlistId,
      isJingle: d.isJingle,
      ambience: d.ambience,
      daypart: d.daypart,
      outputLufs: d.track.integrated_lufs == null ? null : Math.round((d.track.integrated_lufs + d.gainDb) * 10) / 10
    });
    const hist = load<PlayedTrack[]>(HISTORY, []);
    hist.push({ trackId: d.track.id, playlistId: d.playlistId, at: Date.now(), title: d.track.title, artist: d.track.artist, isJingle: d.isJingle });
    save(HISTORY, hist.slice(-300));
    return true;
  }

  /** Fondu de sortie du point d’enchaînement jusqu’au point de sortie, puis libération. */
  private release(d: Deck) {
    const now = this.ctx.currentTime;
    const len = Math.max(0.05, d.mix.cueOut - d.el.currentTime);
    d.gain.gain.cancelScheduledValues(now);
    d.gain.gain.setValueAtTime(d.level, now);
    d.gain.gain.linearRampToValueAtTime(0.0001, now + len);
    this.outgoing.add(d);
    setTimeout(() => {
      this.outgoing.delete(d);
      this.dispose(d);
    }, len * 1000 + 250);
  }

  private dispose(d: Deck | null) {
    if (!d) return;
    try {
      d.el.pause();
      d.gain.disconnect();
    } catch {
      /* déjà libéré */
    }
    if (d.url.startsWith('blob:')) URL.revokeObjectURL(d.url);
  }

  private async startNext(): Promise<boolean> {
    const ready = this.upcoming;
    this.upcoming = null;
    let n = ready ? await ready : null;
    // Pas de titre prêt, ou fichier illisible : on en choisit un autre tout de suite (3 essais).
    for (let i = 0; !n && i < 3; i++) {
      try {
        n = await this.prepare();
        if (!n) break; // rien de jouable
      } catch {
        /* fichier illisible : essai suivant */
      }
    }
    if (!n) {
      this.waitUntil = Date.now() + 5000; // rien de jouable : on réessaie dans 5 s
      return false;
    }
    if (this.hooks.isBusy()) {
      this.upcoming = Promise.resolve(n); // une annonce a pris l’antenne entre-temps
      return false;
    }
    return this.begin(n);
  }

  private async tick() {
    if (this.ticking || this.holding || this.blocked || Date.now() < this.waitUntil) return;
    this.ticking = true;
    try {
      // Contexte audio suspendu par le système (veille, changement de sortie) : on le relance.
      if (this.ctx.state !== 'running') {
        await this.ctx.resume().catch(() => undefined);
        if ((this.ctx.state as AudioContextState) !== 'running') {
          this.setBlocked(true);
          return;
        }
      }
      const c = this.current;
      if (!c) {
        if (!this.hooks.isBusy()) await this.startNext();
        return;
      }
      const t = c.el.currentTime;
      // Lecture interrompue par le système (casque, touches multimédia) : on relance.
      if (c.el.paused && !c.el.ended) await c.el.play().catch(() => undefined);
      // Titre bloqué (réseau, fichier abîmé) : on passe au suivant.
      if (t !== c.lastPos) {
        c.lastPos = t;
        c.lastMove = Date.now();
      } else if (Date.now() - c.lastMove > STALL_MS) {
        throw new Error('Lecture bloquée');
      }
      if (!this.upcoming && t >= Math.max(c.mix.cueIn + 1, c.mix.crossStart - PREPARE_AHEAD_SEC)) {
        this.upcoming = this.prepare().catch(() => null);
      }

      // Point d’enchaînement : le titre suivant démarre pendant le fondu de sortie…
      if (!c.mixed && t >= c.mix.crossStart) {
        c.mixed = true;
        const rem = Math.max(0, c.mix.cueOut - t);
        if (this.hooks.breakDue(rem) || this.hooks.isBusy()) {
          // …sauf si un écran de spots est dû : le titre finit seul, puis les spots, puis la musique.
          this.holding = true;
          this.heldEndsAt = Date.now() + rem * 1000;
          this.ending = c;
          this.release(c);
          this.current = null;
          await new Promise((r) => setTimeout(r, rem * 1000));
          await this.hooks.runBreak();
          this.holding = false;
          this.ending = null;
          if (!this.hooks.isBusy()) await this.startNext();
          return;
        }
        this.release(c);
        this.current = null;
        await this.startNext();
        return;
      }
      // Fin de fichier atteinte avant le point prévu (fichier plus court, erreur) : on enchaîne.
      if (c.el.ended || c.el.error) {
        this.dispose(c);
        this.current = null;
      }
    } catch {
      // Titre illisible ou bloqué : on passe au suivant, en espaçant les essais si les échecs se répètent.
      this.dispose(this.current);
      this.current = null;
      this.dropUpcoming();
      this.holding = false;
      this.ending = null;
      this.failures += 1;
      this.waitUntil = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(this.failures - 1, 5));
    } finally {
      this.ticking = false;
    }
  }
}

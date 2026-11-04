/**
 * Programmation musicale d’Onde (équivalent de l’AutoDJ d’AzuraCast, sans le direct).
 *
 * Exécuté par le lecteur avant chaque titre, et par la régie pour l’aperçu.
 * Pur et testé : l’heure locale et le hasard sont passés en entrée.
 *
 * Ordre de décision, comme AzuraCast :
 *  1. listes « une fois par heure » arrivées à leur minute ;
 *  2. listes « toutes les X minutes » dont le délai est écoulé ;
 *  3. listes « une fois tous les X titres » dont le compte est atteint ;
 *  4. sinon, rotation standard : tirage pondéré (poids 1 à 25) entre les listes actives.
 * Dans la liste choisie, le titre suit l’ordre de la liste (mélangé, aléatoire, séquentiel)
 * en évitant les doublons (même titre, même artiste) sur les fenêtres de l’ambiance.
 */

export type PlaylistType = 'standard' | 'once_per_songs' | 'once_per_minutes' | 'once_per_hour';
export type PlaylistOrder = 'shuffle' | 'random' | 'sequential';

export interface PlaylistSchedule {
  /** Minutes depuis minuit (début inclus, fin exclue). Fin < début : passe minuit. */
  startMin?: number | null;
  endMin?: number | null;
  /** 1 = lundi … 7 = dimanche. Vide = tous les jours. */
  days?: number[] | null;
  startDate?: string | null; // AAAA-MM-JJ
  endDate?: string | null;
}

export interface Playlist {
  id: string;
  name: string;
  type: PlaylistType;
  weight: number;
  order: PlaylistOrder;
  everySongs?: number | null;
  everyMinutes?: number | null;
  minuteOfHour?: number | null;
  schedule?: PlaylistSchedule | null;
  avoidDuplicates: boolean;
  /** Jingle : ne compte pas comme un titre (ni pour les espacements, ni pour « tous les X titres »). */
  isJingle?: boolean;
  enabled?: boolean;
  trackIds: string[];
}

export interface TrackMeta {
  id: string;
  title: string;
  artist: string;
}

export interface PlayedTrack {
  trackId: string;
  playlistId: string | null;
  at: number; // ms epoch, début de lecture
  title: string;
  artist: string;
  isJingle?: boolean;
}

export interface MusicRules {
  /** Même titre pas avant N minutes (AzuraCast : « duplicate prevention »). */
  titleSeparationMin: number;
  /** Même artiste pas avant N minutes. */
  artistSeparationMin: number;
}

export const DEFAULT_MUSIC_RULES: MusicRules = { titleSeparationMin: 240, artistSeparationMin: 90 };

export interface LocalTime {
  /** Minutes depuis minuit, heure de la boutique. */
  minuteOfDay: number;
  /** 1 = lundi … 7 = dimanche. */
  dayOfWeek: number;
  date: string; // AAAA-MM-JJ
}

export interface RotationState {
  shuffle: Record<string, string[]>;
  pointer: Record<string, number>;
}

export const emptyRotation = (): RotationState => ({ shuffle: {}, pointer: {} });

export interface NextInput {
  now: number;
  local: LocalTime;
  playlists: Playlist[];
  tracks: Map<string, TrackMeta>;
  /** Historique, du plus ancien au plus récent. */
  history: PlayedTrack[];
  rules?: MusicRules;
  state?: RotationState;
  rng?: () => number;
}

export interface NextChoice {
  track: TrackMeta;
  playlist: Playlist;
  reason: 'once_per_hour' | 'once_per_minutes' | 'once_per_songs' | 'rotation';
  /** Vrai si les règles d’espacement ont dû être assouplies (bibliothèque trop petite). */
  relaxed: boolean;
  state: RotationState;
}

const MIN = 60_000;

export function scheduleActive(s: PlaylistSchedule | null | undefined, t: LocalTime): boolean {
  if (!s) return true;
  if (s.startDate && t.date < s.startDate) return false;
  if (s.endDate && t.date > s.endDate) return false;
  if (s.days && s.days.length && !s.days.includes(t.dayOfWeek)) return false;
  const a = s.startMin, b = s.endMin;
  if (a == null || b == null || a === b) return true;
  return a < b ? t.minuteOfDay >= a && t.minuteOfDay < b : t.minuteOfDay >= a || t.minuteOfDay < b;
}

const key = (s: string) => s.trim().toLowerCase();

function lastPlayOf(history: PlayedTrack[], playlistId: string): PlayedTrack | undefined {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].playlistId === playlistId) return history[i];
  return undefined;
}

function songsSince(history: PlayedTrack[], playlistId: string): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].playlistId === playlistId) return n;
    if (!history[i].isJingle) n++;
  }
  return Number.POSITIVE_INFINITY;
}

/** Listes « hors rotation » arrivées à échéance, par ordre de priorité. */
export function duePlaylists(input: Pick<NextInput, 'now' | 'local' | 'playlists' | 'history'>): { playlist: Playlist; reason: NextChoice['reason'] }[] {
  const { now, local, history } = input;
  const active = input.playlists.filter((p) => p.enabled !== false && p.trackIds.length && scheduleActive(p.schedule, local));
  const out: { playlist: Playlist; reason: NextChoice['reason']; last: number }[] = [];
  const hourStart = now - (local.minuteOfDay % 60) * MIN - (now % MIN);
  for (const p of active) {
    const last = lastPlayOf(history, p.id)?.at ?? -Infinity;
    if (p.type === 'once_per_hour' && p.minuteOfHour != null) {
      const slot = hourStart + p.minuteOfHour * MIN;
      if (now >= slot && last < slot) out.push({ playlist: p, reason: 'once_per_hour', last });
    } else if (p.type === 'once_per_minutes' && p.everyMinutes) {
      if (now - last >= p.everyMinutes * MIN) out.push({ playlist: p, reason: 'once_per_minutes', last });
    } else if (p.type === 'once_per_songs' && p.everySongs) {
      // Comme AzuraCast : la première fois, on attend aussi X titres.
      const since = songsSince(history, p.id);
      const count = Number.isFinite(since) ? since : history.filter((h) => !h.isJingle).length;
      if (count >= p.everySongs) out.push({ playlist: p, reason: 'once_per_songs', last });
    }
  }
  const rank = { once_per_hour: 0, once_per_minutes: 1, once_per_songs: 2, rotation: 3 };
  return out.sort((a, b) => rank[a.reason] - rank[b.reason] || a.last - b.last).map(({ playlist, reason }) => ({ playlist, reason }));
}

export function weightedPick<T extends { weight: number }>(items: T[], rng: () => number): T | undefined {
  const total = items.reduce((a, i) => a + Math.max(1, Math.min(25, i.weight)), 0);
  let r = rng() * total;
  for (const i of items) {
    r -= Math.max(1, Math.min(25, i.weight));
    if (r < 0) return i;
  }
  return items[items.length - 1];
}

function shuffled(ids: string[], rng: () => number): string[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Choisit un titre dans une liste en respectant son ordre et les espacements. */
export function pickTrack(
  playlist: Playlist,
  input: Required<Pick<NextInput, 'now' | 'tracks' | 'history' | 'rules' | 'state' | 'rng'>>
): { track: TrackMeta; relaxed: boolean; state: RotationState } | null {
  const { now, tracks, history, rules, rng } = input;
  const state: RotationState = { shuffle: { ...input.state.shuffle }, pointer: { ...input.state.pointer } };
  const ids = playlist.trackIds.filter((id) => tracks.has(id));
  if (!ids.length) return null;

  const recentTitles = new Set<string>();
  const recentArtists = new Set<string>();
  const lastPlayed = new Map<string, number>();
  for (const h of history) {
    if (h.isJingle) continue;
    lastPlayed.set(h.trackId, h.at);
    if (now - h.at < rules.titleSeparationMin * MIN) recentTitles.add(`${key(h.artist)}|${key(h.title)}`);
    if (now - h.at < rules.artistSeparationMin * MIN && h.artist) recentArtists.add(key(h.artist));
  }
  const ok = (id: string) => {
    if (!playlist.avoidDuplicates || playlist.isJingle) return true;
    const t = tracks.get(id)!;
    return !recentTitles.has(`${key(t.artist)}|${key(t.title)}`) && !(t.artist && recentArtists.has(key(t.artist)));
  };

  let chosen: string | undefined;
  if (playlist.order === 'random') {
    const c = ids.filter(ok);
    if (c.length) chosen = c[Math.floor(rng() * c.length)];
  } else if (playlist.order === 'sequential') {
    const start = (state.pointer[playlist.id] ?? 0) % ids.length;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[(start + k) % ids.length];
      if (ok(id)) {
        chosen = id;
        state.pointer[playlist.id] = (start + k + 1) % ids.length;
        break;
      }
    }
  } else {
    // Mélangé : on épuise la liste avant de la remélanger (pas de répétition avant d’avoir tout joué).
    let queue = (state.shuffle[playlist.id] ?? []).filter((id) => ids.includes(id));
    if (!queue.length) queue = shuffled(ids, rng);
    let idx = queue.findIndex(ok);
    if (idx === -1) {
      // Rien d’autorisé dans ce qui reste du tour : on regarde dans un nouveau tour complet.
      const fresh = shuffled(ids, rng);
      const j = fresh.findIndex(ok);
      if (j !== -1) { queue = fresh; idx = j; }
    }
    if (idx !== -1) {
      chosen = queue[idx];
      queue.splice(idx, 1);
    }
    state.shuffle[playlist.id] = queue;
  }

  if (chosen) return { track: tracks.get(chosen)!, relaxed: false, state };
  // Bibliothèque trop petite pour les espacements : le titre joué il y a le plus longtemps.
  const fallback = [...ids].sort((a, b) => (lastPlayed.get(a) ?? -Infinity) - (lastPlayed.get(b) ?? -Infinity))[0];
  return { track: tracks.get(fallback)!, relaxed: true, state };
}

export function nextTrack(input: NextInput): NextChoice | null {
  const rules = input.rules ?? DEFAULT_MUSIC_RULES;
  const rng = input.rng ?? Math.random;
  let state = input.state ?? emptyRotation();
  const ctx = { now: input.now, tracks: input.tracks, history: input.history, rules, rng };

  for (const d of duePlaylists(input)) {
    const r = pickTrack(d.playlist, { ...ctx, state });
    if (r) return { track: r.track, playlist: d.playlist, reason: d.reason, relaxed: r.relaxed, state: r.state };
  }

  let pool = input.playlists.filter(
    (p) => p.enabled !== false && p.type === 'standard' && p.trackIds.some((id) => input.tracks.has(id)) && scheduleActive(p.schedule, input.local)
  );
  while (pool.length) {
    const p = weightedPick(pool, rng)!;
    const r = pickTrack(p, { ...ctx, state });
    if (r) {
      state = r.state;
      return { track: r.track, playlist: p, reason: 'rotation', relaxed: r.relaxed, state };
    }
    pool = pool.filter((x) => x !== p);
  }
  return null;
}

// ───────────────────────── Journée type : ambiance selon l’heure ─────────────────────────
export interface Daypart {
  id: string;
  name: string;
  ambienceId: string;
  startMin: number;
  endMin: number;
  days?: number[] | null;
}

export function ambienceAt(dayparts: Daypart[], t: LocalTime, fallback: string | null = null): { ambienceId: string | null; daypart: Daypart | null } {
  const d = dayparts.find((p) => scheduleActive({ startMin: p.startMin, endMin: p.endMin, days: p.days }, t));
  return d ? { ambienceId: d.ambienceId, daypart: d } : { ambienceId: fallback, daypart: null };
}

export function localTime(date: Date): LocalTime {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    minuteOfDay: date.getHours() * 60 + date.getMinutes(),
    dayOfWeek: ((date.getDay() + 6) % 7) + 1,
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  };
}

/** Générateur pseudo-aléatoire reproductible (tests, aperçu de la régie). */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simule N titres à la suite (aperçu « les prochains titres » dans la régie). */
export function previewQueue(input: Omit<NextInput, 'now' | 'local'> & { start: Date; count: number; avgTrackSec?: number }): { at: number; choice: NextChoice }[] {
  const out: { at: number; choice: NextChoice }[] = [];
  let history = [...input.history];
  let state = input.state ?? emptyRotation();
  let t = input.start.getTime();
  for (let i = 0; i < input.count; i++) {
    const c = nextTrack({ ...input, now: t, local: localTime(new Date(t)), history, state });
    if (!c) break;
    out.push({ at: t, choice: c });
    history = [...history, { trackId: c.track.id, playlistId: c.playlist.id, at: t, title: c.track.title, artist: c.track.artist, isJingle: c.playlist.isJingle }];
    state = c.state;
    t += (c.playlist.isJingle ? 10 : input.avgTrackSec ?? 210) * 1000;
  }
  return out;
}

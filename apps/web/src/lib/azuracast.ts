import 'server-only';

/**
 * Client AzuraCast côté serveur. La clé API ne quitte jamais le serveur.
 * Docs : https://www.azuracast.com/docs/developers/apis/
 */
const base = (process.env.AZURACAST_URL ?? '').replace(/\/$/, '');
const apiKey = process.env.AZURACAST_API_KEY ?? '';

export const azuracastConfigured = Boolean(base && apiKey);

async function call<T>(path: string, init?: RequestInit & { revalidate?: number }): Promise<T> {
  if (!azuracastConfigured) throw new Error('AzuraCast non configuré');
  const res = await fetch(`${base}/api${path}`, {
    ...init,
    headers: { 'X-API-Key': apiKey, Accept: 'application/json', ...(init?.headers ?? {}) },
    next: { revalidate: init?.revalidate ?? 10 }
  });
  if (!res.ok) throw new Error(`AzuraCast ${res.status} sur ${path}`);
  return res.json() as Promise<T>;
}

export interface NowPlaying {
  station: { id: number; shortcode: string; name: string; listen_url: string };
  listeners: { current: number };
  now_playing: {
    elapsed: number;
    duration: number;
    song: { title: string; artist: string; art: string };
  } | null;
}

/** État de toutes les stations (un flux par ambiance). */
export function nowPlayingAll() {
  return call<NowPlaying[]>('/nowplaying', { revalidate: 10 });
}

export interface StationFile {
  id: number;
  path: string;
  length: number;
  title: string | null;
  artist: string | null;
}

/** Fichiers d’une station (la bibliothèque commune est partagée entre stations). */
export function listFiles(station: string) {
  return call<StationFile[]>(`/station/${encodeURIComponent(station)}/files`, { revalidate: 60 });
}

/** Envoi d’un fichier dans la bibliothèque (base64, comme l’attend l’API). */
export async function uploadFile(station: string, path: string, data: ArrayBuffer) {
  const file = Buffer.from(data).toString('base64');
  return call<StationFile>(`/station/${encodeURIComponent(station)}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, file }),
    revalidate: 0
  });
}

export interface StationNowPlaying {
  title: string;
  artist: string;
  elapsed: number;
  duration: number;
  remaining: number;
}

/** Titre en cours d’une station, avec le temps restant (pour placer les spots entre deux titres). */
export async function nowPlaying(station: string): Promise<StationNowPlaying | null> {
  const np = await call<NowPlaying>(`/nowplaying/${encodeURIComponent(station)}`, { revalidate: 0 });
  if (!np.now_playing) return null;
  const { elapsed, duration, song } = np.now_playing;
  return { title: song.title, artist: song.artist, elapsed, duration, remaining: Math.max(0, duration - elapsed) };
}

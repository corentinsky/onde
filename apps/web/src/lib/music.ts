import 'server-only';
import { isConfigured, supabaseServer } from './supabase/server';

export interface Track {
  id: string;
  storage_path: string;
  file_name: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  isrc: string | null;
  year: number | null;
  duration_sec: number;
  integrated_lufs: number | null;
  loudness_range_lu: number | null;
  peak_dbfs: number | null;
  cue_in: number;
  cue_out: number;
  cross_start: number;
  fade_in: number;
  fade_out: number;
  manual_cues: boolean;
  waveform: number[];
  warnings: string[];
  enabled: boolean;
  created_at: string;
}

export interface Ambience {
  id: string;
  name: string;
  crossfade_mode: 'smart' | 'normal' | 'none';
  crossfade_sec: number;
  target_lufs: number;
  title_separation_min: number;
  artist_separation_min: number;
}

export interface PlaylistRow {
  id: string;
  org_id: string;
  ambience_id: string;
  name: string;
  type: 'standard' | 'once_per_songs' | 'once_per_minutes' | 'once_per_hour';
  weight: number;
  play_order: 'shuffle' | 'random' | 'sequential';
  every_songs: number | null;
  every_minutes: number | null;
  minute_of_hour: number | null;
  start_time: string | null;
  end_time: string | null;
  days: number[] | null;
  start_date: string | null;
  end_date: string | null;
  avoid_duplicates: boolean;
  is_jingle: boolean;
  enabled: boolean;
  track_ids: string[];
}

export interface DaypartRow {
  id: string;
  name: string;
  ambience_id: string;
  start_time: string;
  end_time: string;
  days: number[] | null;
  position: number;
}

const TRACK_COLS =
  'id,storage_path,file_name,title,artist,album,genre,isrc,year,duration_sec,integrated_lufs,loudness_range_lu,peak_dbfs,cue_in,cue_out,cross_start,fade_in,fade_out,manual_cues,warnings,enabled,created_at';
const num = <T extends object>(r: T): T => {
  const o = { ...r } as Record<string, unknown>;
  for (const k of ['duration_sec', 'integrated_lufs', 'loudness_range_lu', 'peak_dbfs', 'cue_in', 'cue_out', 'cross_start', 'fade_in', 'fade_out', 'crossfade_sec', 'target_lufs'])
    if (o[k] != null) o[k] = Number(o[k]);
  return o as T;
};

export async function listTracks(search = ''): Promise<Track[]> {
  if (!isConfigured) return [];
  const sb = await supabaseServer();
  let q = sb.from('tracks').select(TRACK_COLS).order('artist').order('title').limit(500);
  if (search) q = q.or(`title.ilike.%${search.replace(/[%,]/g, '')}%,artist.ilike.%${search.replace(/[%,]/g, '')}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((t) => num({ ...t, waveform: [] })) as Track[];
}

export async function getTrack(id: string): Promise<{ track: Track; url: string | null } | null> {
  if (!isConfigured) return null;
  const sb = await supabaseServer();
  const { data, error } = await sb.from('tracks').select(`${TRACK_COLS},waveform`).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: signed } = await sb.storage.from('music').createSignedUrl(data.storage_path as string, 60 * 60);
  return { track: num(data) as Track, url: signed?.signedUrl ?? null };
}

export async function listAmbiences(orgId: string): Promise<Ambience[]> {
  if (!isConfigured) return [];
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('ambiences')
    .select('id,name,crossfade_mode,crossfade_sec,target_lufs,title_separation_min,artist_separation_min')
    .eq('org_id', orgId)
    .order('name');
  if (error) throw error;
  return (data ?? []).map(num) as Ambience[];
}

export async function listPlaylists(orgId: string): Promise<PlaylistRow[]> {
  if (!isConfigured) return [];
  const sb = await supabaseServer();
  const { data, error } = await sb.from('playlists').select('*, playlist_tracks(track_id, position)').eq('org_id', orgId).order('name');
  if (error) throw error;
  return (data ?? []).map((p) => {
    const items = ((p.playlist_tracks ?? []) as { track_id: string; position: number }[]).sort((a, b) => a.position - b.position);
    const { playlist_tracks: _omit, ...rest } = p as Record<string, unknown>;
    void _omit;
    return { ...rest, track_ids: items.map((i) => i.track_id) } as PlaylistRow;
  });
}

export async function listDayparts(orgId: string): Promise<DaypartRow[]> {
  if (!isConfigured) return [];
  const sb = await supabaseServer();
  const { data, error } = await sb.from('dayparts').select('id,name,ambience_id,start_time,end_time,days,position').eq('org_id', orgId).order('start_time');
  if (error) throw error;
  return (data ?? []) as DaypartRow[];
}

export interface TrackPlayRow {
  id: number;
  title: string;
  artist: string;
  isrc: string | null;
  played_at: string;
  duration_sec: number | null;
  playlist: string | null;
}

/** Historique des titres joués dans une boutique (relevés de diffusion). */
export async function listTrackPlays(storeId: string, limit = 50): Promise<TrackPlayRow[]> {
  if (!isConfigured) return [];
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('track_plays')
    .select('id,title,artist,isrc,played_at,duration_sec,playlists(name)')
    .eq('store_id', storeId)
    .order('played_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as number,
    title: r.title as string,
    artist: r.artist as string,
    isrc: r.isrc as string | null,
    played_at: r.played_at as string,
    duration_sec: r.duration_sec == null ? null : Number(r.duration_sec),
    playlist: (r.playlists as unknown as { name: string } | null)?.name ?? null
  }));
}

export const toMin = (t: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

export const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export function mmss(sec: number | null | undefined, decimals = 1): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0')}`;
}

export const typeLabel: Record<PlaylistRow['type'], string> = {
  standard: 'Rotation standard',
  once_per_songs: 'Une fois tous les X titres',
  once_per_minutes: 'Toutes les X minutes',
  once_per_hour: 'Une fois par heure'
};
export const orderLabel: Record<PlaylistRow['play_order'], string> = { shuffle: 'Mélangé', random: 'Aléatoire', sequential: 'Séquentiel' };
export const warningLabel: Record<string, string> = {
  silent: 'Fichier silencieux',
  too_quiet: 'Très faible',
  clipping: 'Saturation',
  long_intro_silence: 'Long silence au début',
  long_outro_silence: 'Long silence à la fin',
  very_short: 'Très court'
};

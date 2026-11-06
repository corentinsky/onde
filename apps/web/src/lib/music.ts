import 'server-only';
import { allRows, chunks, inChunks } from './batch';
import { trackUrl } from './library';
import { isConfigured, supabaseServer } from './supabase/server';

export interface Track {
  id: string;
  storage_path: string;
  location: string;
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
  'id,storage_path,location,file_name,title,artist,album,genre,isrc,year,duration_sec,integrated_lufs,loudness_range_lu,peak_dbfs,cue_in,cue_out,cross_start,fade_in,fade_out,manual_cues,warnings,enabled,created_at';
const num = <T extends object>(r: T): T => {
  const o = { ...r } as Record<string, unknown>;
  for (const k of ['duration_sec', 'integrated_lufs', 'loudness_range_lu', 'peak_dbfs', 'cue_in', 'cue_out', 'cross_start', 'fade_in', 'fade_out', 'crossfade_sec', 'target_lufs'])
    if (o[k] != null) o[k] = Number(o[k]);
  return o as T;
};

/** Texte de recherche sûr pour un filtre « or » de PostgREST (valeur entre guillemets). */
const searchValue = (q: string) => q.replace(/["\\%*]/g, '').trim().slice(0, 100);

export const PAGE_SIZE = 200;

/** Une page de la bibliothèque (recherche titre, artiste, album ; « à vérifier »). */
export async function listTracks(opts: { q?: string; warningsOnly?: boolean; page?: number; size?: number } = {}): Promise<{ rows: Track[]; total: number }> {
  if (!isConfigured) return { rows: [], total: 0 };
  const size = opts.size ?? PAGE_SIZE;
  const page = Math.max(0, opts.page ?? 0);
  const sb = await supabaseServer();
  let q = sb.from('tracks').select(TRACK_COLS, { count: 'exact' }).order('artist').order('title').order('id');
  const s = searchValue(opts.q ?? '');
  if (s) q = q.or(`title.ilike."%${s}%",artist.ilike."%${s}%",album.ilike."%${s}%"`);
  if (opts.warningsOnly) q = q.neq('warnings', '{}');
  const { data, error, count } = await q.range(page * size, page * size + size - 1);
  if (error) throw error;
  return { rows: (data ?? []).map((t) => num({ ...t, waveform: [] })) as Track[], total: count ?? 0 };
}

/** Titres par identifiants, dans l’ordre demandé (listes de lecture). */
export async function getTracksByIds(ids: string[]): Promise<Track[]> {
  if (!isConfigured || !ids.length) return [];
  const sb = await supabaseServer();
  const rows = await inChunks([...new Set(ids)], (c) => sb.from('tracks').select(TRACK_COLS).in('id', c));
  const byId = new Map(rows.map((t) => [t.id as string, num({ ...t, waveform: [] }) as Track]));
  return ids.map((id) => byId.get(id)).filter((t): t is Track => !!t);
}

/** Chiffres de toute la bibliothèque, quelle que soit la page affichée. */
export async function libraryStats(): Promise<{ count: number; usefulSec: number; toCheck: number }> {
  if (!isConfigured) return { count: 0, usefulSec: 0, toCheck: 0 };
  const sb = await supabaseServer();
  const rows = await allRows<{ cue_in: number; cue_out: number; warnings: string[] }>((from, to) =>
    sb.from('tracks').select('cue_in,cue_out,warnings').order('id').range(from, to)
  );
  return {
    count: rows.length,
    usefulSec: rows.reduce((a, r) => a + Number(r.cue_out) - Number(r.cue_in), 0),
    toCheck: rows.filter((r) => r.warnings?.length).length
  };
}

export async function getTrack(id: string): Promise<{ track: Track; url: string | null } | null> {
  if (!isConfigured) return null;
  const sb = await supabaseServer();
  const { data, error } = await sb.from('tracks').select(`${TRACK_COLS},waveform`).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const url = await trackUrl(sb, { storage_path: data.storage_path as string, location: data.location as string }, 60 * 60);
  return { track: num(data) as Track, url };
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
  const { data, error } = await sb.from('playlists').select('*').eq('org_id', orgId).order('name');
  if (error) throw error;
  // Titres des listes, page par page : une liste peut dépasser le plafond de 1 000 lignes.
  const items = (
    await Promise.all(
      chunks((data ?? []).map((p) => p.id as string), 50).map((ids) =>
        allRows<{ playlist_id: string; track_id: string }>((from, to) =>
          sb.from('playlist_tracks').select('playlist_id, track_id').in('playlist_id', ids).order('playlist_id').order('position').order('track_id').range(from, to)
        )
      )
    )
  ).flat();
  const byList = new Map<string, string[]>();
  for (const it of items) {
    const l = byList.get(it.playlist_id);
    if (l) l.push(it.track_id);
    else byList.set(it.playlist_id, [it.track_id]);
  }
  return (data ?? []).map((p) => ({ ...p, track_ids: byList.get(p.id as string) ?? [] }) as PlaylistRow);
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

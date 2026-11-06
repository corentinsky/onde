'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { removeTrackFile } from '@/lib/library';
import { rotatePlaylist } from '@/lib/rotation';
import { isConfigured, supabaseServer } from '@/lib/supabase/server';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const numOr = (f: FormData, k: string, d: number | null) => {
  const v = str(f, k);
  if (v === '') return d;
  const n = Number(v.replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`Valeur invalide : ${k}`);
  return n;
};
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

async function db() {
  if (!isConfigured) throw new Error('Supabase n’est pas configuré');
  return supabaseServer();
}
function done(path: string): never {
  revalidatePath('/regie', 'layout');
  redirect(path);
}

// ───────────── Titres ─────────────
export async function updateTrack(form: FormData) {
  const id = str(form, 'id');
  const duration = Number(str(form, 'duration_sec'));
  const cueIn = clamp(numOr(form, 'cue_in', 0)!, 0, duration);
  const cueOut = clamp(numOr(form, 'cue_out', duration)!, 0, duration);
  const crossStart = clamp(numOr(form, 'cross_start', cueOut)!, cueIn, cueOut);
  if (cueIn >= cueOut) throw new Error('Le début doit précéder la fin.');
  const sb = await db();
  const { error } = await sb
    .from('tracks')
    .update({
      title: str(form, 'title'),
      artist: str(form, 'artist'),
      album: str(form, 'album'),
      genre: str(form, 'genre'),
      isrc: str(form, 'isrc') || null,
      cue_in: Math.round(cueIn * 100) / 100,
      cue_out: Math.round(cueOut * 100) / 100,
      cross_start: Math.round(crossStart * 100) / 100,
      fade_in: clamp(numOr(form, 'fade_in', 0.1)!, 0, 15),
      fade_out: clamp(numOr(form, 'fade_out', cueOut - crossStart)!, 0, 30),
      // « keep » : seules les étiquettes ont changé, on ne marque pas les points comme manuels.
      ...(['true', 'false'].includes(str(form, 'manual')) ? { manual_cues: str(form, 'manual') === 'true' } : {}),
      enabled: form.get('enabled') === 'on'
    })
    .eq('id', id);
  if (error) throw error;
  done(`/regie/bibliotheque/${id}?enregistre=1`);
}

export async function deleteTrack(form: FormData) {
  const id = str(form, 'id');
  const sb = await db();
  const { data } = await sb.from('tracks').select('storage_path, location').eq('id', id).single();
  const { error } = await sb.from('tracks').delete().eq('id', id);
  if (error) throw error;
  if (data?.storage_path) await removeTrackFile(sb, data as { storage_path: string; location: string });
  done('/regie/bibliotheque');
}

// ───────────── Ambiances ─────────────
export async function saveAmbience(form: FormData) {
  const sb = await db();
  const mode = str(form, 'crossfade_mode');
  const { error } = await sb
    .from('ambiences')
    .update({
      crossfade_mode: ['smart', 'normal', 'none'].includes(mode) ? mode : 'smart',
      crossfade_sec: clamp(numOr(form, 'crossfade_sec', 2)!, 0, 15),
      target_lufs: clamp(numOr(form, 'target_lufs', -18)!, -30, -10),
      title_separation_min: clamp(Math.round(numOr(form, 'title_separation_min', 240)!), 0, 1440),
      artist_separation_min: clamp(Math.round(numOr(form, 'artist_separation_min', 90)!), 0, 1440)
    })
    .eq('id', str(form, 'id'));
  if (error) throw error;
  done('/regie/ambiances?enregistre=1');
}

// ───────────── Listes ─────────────
export async function createPlaylist(form: FormData) {
  const sb = await db();
  const type = str(form, 'type') || 'standard';
  const { data, error } = await sb
    .from('playlists')
    .insert({
      org_id: str(form, 'org_id'),
      ambience_id: str(form, 'ambience_id'),
      name: str(form, 'name') || 'Nouvelle liste',
      type,
      every_songs: type === 'once_per_songs' ? 4 : null,
      every_minutes: type === 'once_per_minutes' ? 30 : null,
      minute_of_hour: type === 'once_per_hour' ? 0 : null
    })
    .select('id')
    .single();
  if (error) throw error;
  done(`/regie/ambiances/listes/${data.id}`);
}

export async function savePlaylist(form: FormData) {
  const id = str(form, 'id');
  const type = str(form, 'type');
  const days = form.getAll('days').map(Number).filter((d) => d >= 1 && d <= 7);
  const sb = await db();
  const { error } = await sb
    .from('playlists')
    .update({
      name: str(form, 'name'),
      type,
      weight: clamp(Math.round(numOr(form, 'weight', 5)!), 1, 25),
      play_order: str(form, 'play_order'),
      every_songs: type === 'once_per_songs' ? clamp(Math.round(numOr(form, 'every_songs', 4)!), 1, 100) : null,
      every_minutes: type === 'once_per_minutes' ? clamp(Math.round(numOr(form, 'every_minutes', 30)!), 1, 1440) : null,
      minute_of_hour: type === 'once_per_hour' ? clamp(Math.round(numOr(form, 'minute_of_hour', 0)!), 0, 59) : null,
      start_time: str(form, 'start_time') || null,
      end_time: str(form, 'end_time') || null,
      days: days.length && days.length < 7 ? days : null,
      start_date: str(form, 'start_date') || null,
      end_date: str(form, 'end_date') || null,
      avoid_duplicates: form.get('avoid_duplicates') === 'on',
      is_jingle: form.get('is_jingle') === 'on',
      enabled: form.get('enabled') === 'on',
      rotation_days: str(form, 'rotation_days') ? clamp(Math.round(numOr(form, 'rotation_days', 15)!), 1, 365) : null,
      rotation_share: clamp(Math.round(numOr(form, 'rotation_share', 20)!), 5, 60),
      rotation_rest_days: clamp(Math.round(numOr(form, 'rotation_rest_days', 30)!), 1, 365)
    })
    .eq('id', id);
  if (error) throw error;
  done(`/regie/ambiances/listes/${id}?enregistre=1`);
}

/** Renouvelle la liste tout de suite, sans attendre l’échéance. */
export async function rotateNow(form: FormData) {
  const id = str(form, 'id');
  const sb = await db();
  await rotatePlaylist(sb, id, 'manual');
  done(`/regie/ambiances/listes/${id}?renouvele=1`);
}

export async function deletePlaylist(form: FormData) {
  const sb = await db();
  const { error } = await sb.from('playlists').delete().eq('id', str(form, 'id'));
  if (error) throw error;
  done('/regie/ambiances');
}

export async function addToPlaylist(form: FormData) {
  const playlistId = str(form, 'playlist_id');
  const ids = form.getAll('track_id').map(String).filter(Boolean);
  if (!ids.length) done(`/regie/ambiances/listes/${playlistId}`);
  const sb = await db();
  const { data: last } = await sb.from('playlist_tracks').select('position').eq('playlist_id', playlistId).order('position', { ascending: false }).limit(1).maybeSingle();
  let pos = (last?.position ?? 0) + 1;
  const { error } = await sb.from('playlist_tracks').upsert(ids.map((track_id) => ({ playlist_id: playlistId, track_id, position: pos++ })), { onConflict: 'playlist_id,track_id', ignoreDuplicates: true });
  if (error) throw error;
  done(`/regie/ambiances/listes/${playlistId}`);
}

export async function removeFromPlaylist(form: FormData) {
  const playlistId = str(form, 'playlist_id');
  const sb = await db();
  const { error } = await sb.from('playlist_tracks').delete().eq('playlist_id', playlistId).eq('track_id', str(form, 'track_id'));
  if (error) throw error;
  done(`/regie/ambiances/listes/${playlistId}`);
}

// ───────────── Journée type ─────────────
export async function saveDaypart(form: FormData) {
  const sb = await db();
  const days = form.getAll('days').map(Number).filter((d) => d >= 1 && d <= 7);
  const row = {
    name: str(form, 'name') || 'Créneau',
    ambience_id: str(form, 'ambience_id'),
    start_time: str(form, 'start_time'),
    end_time: str(form, 'end_time'),
    days: days.length && days.length < 7 ? days : null
  };
  if (!row.start_time || !row.end_time) throw new Error('Heures obligatoires');
  const id = str(form, 'id');
  const { error } = id ? await sb.from('dayparts').update(row).eq('id', id) : await sb.from('dayparts').insert({ ...row, org_id: str(form, 'org_id') });
  if (error) throw error;
  done('/regie/programmation?enregistre=1');
}

export async function deleteDaypart(form: FormData) {
  const sb = await db();
  const { error } = await sb.from('dayparts').delete().eq('id', str(form, 'id'));
  if (error) throw error;
  done('/regie/programmation');
}

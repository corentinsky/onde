import 'server-only';
import { effectiveMix, gainFor, type CrossfadeMode } from '@onde/audio';
import { ambienceAt, emptyRotation, localTimeIn, nextTrack, type Playlist, type PlayedTrack, type RotationState } from '@onde/rules';
import { allRows, chunks, inChunks } from './batch';
import type { supabaseService } from './supabase/server';

type SB = ReturnType<typeof supabaseService>;

/** Un émetteur vu dans les 3 dernières minutes est considéré en service. */
export const EMITTER_ONLINE_MS = 3 * 60_000;

export const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'flux';

export interface StreamRow {
  org_id: string;
  mount: string;
  enabled: boolean;
  default_ambience_id: string | null;
  rotation_state: RotationState | Record<string, never>;
}

/** Une enseigne = un flux. Crée les flux manquants et renvoie ceux à diffuser (enseignes avec au moins une ambiance). */
export async function ensureStreams(sb: SB): Promise<{ org_id: string; mount: string; name: string }[]> {
  const [{ data: orgs, error: e1 }, { data: streams, error: e2 }, { data: ambs, error: e3 }] = await Promise.all([
    sb.from('organizations').select('id, name').order('name'),
    sb.from('streams').select('org_id, mount, enabled'),
    sb.from('ambiences').select('org_id')
  ]);
  if (e1 || e2 || e3) throw e1 ?? e2 ?? e3;
  const byOrg = new Map((streams ?? []).map((s) => [s.org_id as string, s]));
  const taken = new Set((streams ?? []).map((s) => s.mount as string));
  for (const o of orgs ?? []) {
    if (byOrg.has(o.id)) continue;
    let mount = slug(o.name);
    if (taken.has(mount)) mount = `${mount}-${(o.id as string).slice(0, 4)}`;
    const { data, error } = await sb.from('streams').insert({ org_id: o.id, mount }).select('org_id, mount, enabled').single();
    if (error) throw error;
    taken.add(mount);
    byOrg.set(o.id, data);
  }
  const withAmb = new Set((ambs ?? []).map((a) => a.org_id as string));
  return (orgs ?? [])
    .filter((o) => withAmb.has(o.id) && byOrg.get(o.id)?.enabled)
    .map((o) => ({ org_id: o.id as string, mount: byOrg.get(o.id)!.mount as string, name: o.name as string }));
}

const clean = (s: string) => s.replace(/["\\\n\r]/g, ' ').trim();
const n2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

/**
 * Prochain titre du flux d’une enseigne, au format d’une requête annotée Liquidsoap :
 * points d’entrée et de sortie, durée de l’enchaînement, fondus, gain de normalisation.
 * Le titre est inscrit dans l’historique du flux dès qu’il est choisi.
 */
export async function nextForStream(sb: SB, orgId: string): Promise<string | null> {
  const [{ data: stream }, { data: ambiences }, { data: dayparts }, { data: playlists }, { data: store }, { data: last }] = await Promise.all([
    sb.from('streams').select('org_id, mount, enabled, default_ambience_id, rotation_state').eq('org_id', orgId).maybeSingle(),
    sb.from('ambiences').select('id, name, crossfade_mode, crossfade_sec, target_lufs, title_separation_min, artist_separation_min').eq('org_id', orgId).order('name'),
    sb.from('dayparts').select('id, name, ambience_id, start_time, end_time, days, position').eq('org_id', orgId).order('position').order('start_time'),
    sb.from('playlists').select('*').eq('org_id', orgId).eq('enabled', true),
    sb.from('stores').select('timezone').eq('org_id', orgId).order('name').limit(1).maybeSingle(),
    sb.from('stream_plays').select('queued_at, started_at, duration_sec, cross_sec').eq('org_id', orgId).order('queued_at', { ascending: false }).limit(1).maybeSingle()
  ]);
  if (!stream?.enabled || !ambiences?.length) return null;

  // Heure à laquelle ce titre démarrera : à l’enchaînement du titre en cours.
  const now = Date.now();
  let startAt = now;
  if (last) {
    const until = (Number(last.duration_sec ?? 0) - Number(last.cross_sec ?? 0)) * 1000;
    const from = last.started_at ? Date.parse(last.started_at) : now;
    startAt = Math.min(now + 15 * 60_000, Math.max(now, from + until));
  }
  const local = localTimeIn(new Date(startAt), (store?.timezone as string | null) ?? 'Europe/Paris');

  // Titres des listes (toutes tailles) et leurs réglages.
  const listIds = (playlists ?? []).map((p) => p.id as string);
  const items = (
    await Promise.all(
      chunks(listIds, 50).map((ids) =>
        allRows<{ playlist_id: string; track_id: string }>((from, to) =>
          sb.from('playlist_tracks').select('playlist_id, track_id').in('playlist_id', ids).order('playlist_id').order('position').order('track_id').range(from, to)
        )
      )
    )
  ).flat();
  const rows = await inChunks([...new Set(items.map((i) => i.track_id))], (ids) =>
    sb
      .from('tracks')
      .select('id, storage_path, title, artist, isrc, cue_in, cue_out, cross_start, fade_in, fade_out, integrated_lufs, peak_dbfs')
      .in('id', ids)
      .eq('enabled', true)
  );
  const trackById = new Map(rows.map((t) => [t.id as string, t]));
  const byList = new Map<string, string[]>();
  for (const it of items) {
    if (!trackById.has(it.track_id)) continue;
    const l = byList.get(it.playlist_id);
    if (l) l.push(it.track_id);
    else byList.set(it.playlist_id, [it.track_id]);
  }
  const toMin = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
  const lists = (playlists ?? []).map((p) => ({
    id: p.id as string,
    ambienceId: p.ambience_id as string,
    name: p.name as string,
    type: p.type,
    weight: p.weight as number,
    order: p.play_order,
    everySongs: p.every_songs,
    everyMinutes: p.every_minutes,
    minuteOfHour: p.minute_of_hour,
    schedule: { startMin: toMin(p.start_time), endMin: toMin(p.end_time), days: p.days, startDate: p.start_date, endDate: p.end_date },
    avoidDuplicates: p.avoid_duplicates as boolean,
    isJingle: p.is_jingle as boolean,
    enabled: true,
    trackIds: byList.get(p.id as string) ?? []
  })) as (Playlist & { ambienceId: string })[];
  const metas = new Map(rows.map((t) => [t.id as string, { id: t.id as string, title: t.title as string, artist: t.artist as string }]));

  const { data: hist } = await sb
    .from('stream_plays')
    .select('track_id, playlist_id, title, artist, is_jingle, queued_at, started_at')
    .eq('org_id', orgId)
    .order('queued_at', { ascending: false })
    .limit(300);
  const history: PlayedTrack[] = (hist ?? [])
    .reverse()
    .map((h) => ({ trackId: (h.track_id as string) ?? '', playlistId: h.playlist_id as string | null, at: Date.parse((h.started_at ?? h.queued_at) as string), title: h.title as string, artist: h.artist as string, isJingle: h.is_jingle as boolean }));

  // Journée type : ambiance du créneau, sinon celle du flux, sinon les autres. Le flux ne s’arrête jamais.
  const parts = (dayparts ?? []).map((d) => ({ id: d.id, name: d.name, ambienceId: d.ambience_id, startMin: toMin(d.start_time)!, endMin: toMin(d.end_time)!, days: d.days }));
  const fallback = (stream.default_ambience_id as string | null) ?? (ambiences[0].id as string);
  const { ambienceId } = ambienceAt(parts, local, fallback);
  const order = [ambienceId, fallback, ...ambiences.map((a) => a.id as string)].filter((id, i, a): id is string => !!id && a.indexOf(id) === i);
  let state = (stream.rotation_state && 'shuffle' in stream.rotation_state ? stream.rotation_state : emptyRotation()) as RotationState;

  for (const id of order) {
    const amb = ambiences.find((a) => a.id === id);
    if (!amb) continue;
    const choice = nextTrack({
      now: startAt,
      local,
      playlists: lists.filter((p) => p.ambienceId === id),
      tracks: metas,
      history,
      state,
      rules: { titleSeparationMin: amb.title_separation_min as number, artistSeparationMin: amb.artist_separation_min as number }
    });
    if (!choice) continue;
    state = choice.state;
    const t = trackById.get(choice.track.id)!;
    const mix = effectiveMix(
      { cueIn: Number(t.cue_in), cueOut: Number(t.cue_out), crossStart: Number(t.cross_start), fadeIn: Number(t.fade_in), fadeOut: Number(t.fade_out) },
      amb.crossfade_mode as CrossfadeMode,
      Number(amb.crossfade_sec)
    );
    const cross = Math.max(0, Math.min(30, mix.cueOut - mix.crossStart));
    const gain = t.integrated_lufs == null ? 0 : gainFor(Number(t.integrated_lufs), Number(t.peak_dbfs ?? -1), Number(amb.target_lufs));

    const [{ data: play, error }, { data: signed }] = await Promise.all([
      sb
        .from('stream_plays')
        .insert({
          org_id: orgId,
          ambience_id: id,
          track_id: t.id,
          playlist_id: choice.playlist.id,
          title: t.title,
          artist: t.artist,
          isrc: t.isrc,
          is_jingle: Boolean(choice.playlist.isJingle),
          duration_sec: Math.round((mix.cueOut - mix.cueIn) * 100) / 100,
          cross_sec: Math.round(cross * 100) / 100
        })
        .select('id')
        .single(),
      sb.storage.from('music').createSignedUrl(t.storage_path as string, 60 * 60 * 3)
    ]);
    if (error) throw error;
    if (!signed?.signedUrl) return null;
    await sb.from('streams').update({ rotation_state: state }).eq('org_id', orgId);

    const meta: [string, string][] = [
      ['title', clean(t.title as string)],
      ['artist', clean(t.artist as string)],
      ['onde_play', play.id as string],
      ['liq_cue_in', n2(mix.cueIn)],
      ['liq_cue_out', n2(mix.cueOut)],
      ['liq_cross_duration', n2(cross)],
      ['liq_fade_in', n2(Math.max(0.01, mix.fadeIn))],
      ['liq_fade_out', n2(Math.max(0.01, cross))],
      ['liq_amplify', `${n2(gain)} dB`]
    ];
    // « onde:<extension>| » : l’émetteur télécharge le fichier avec la bonne extension (le lien signé ne la donne pas).
    const ext = ((t.storage_path as string).split('.').pop() ?? 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
    return `annotate:${meta.map(([k, v]) => `${k}="${v}"`).join(',')}:onde:${ext}|${signed.signedUrl}`;
  }
  return null;
}

/** Titres récents et à venir d’un flux, pour les lecteurs (repérage et historique par boutique). */
export async function streamPlays(sb: SB, orgId: string, limit = 8) {
  const { data } = await sb
    .from('stream_plays')
    .select('id, track_id, playlist_id, title, artist, isrc, is_jingle, duration_sec, cross_sec, queued_at, started_at')
    .eq('org_id', orgId)
    .order('queued_at', { ascending: false })
    .limit(limit);
  return (data ?? []).map((p) => ({ ...p, duration_sec: Number(p.duration_sec ?? 0), cross_sec: Number(p.cross_sec ?? 0) }));
}

/** Adresse du flux de l’enseigne si un émetteur est en service. */
export async function ondeStreamUrl(sb: SB, orgId: string): Promise<{ name: string; url: string } | null> {
  const [{ data: stream }, { data: emitter }, { data: org }] = await Promise.all([
    sb.from('streams').select('mount, enabled').eq('org_id', orgId).maybeSingle(),
    sb.from('emitters').select('public_url, last_seen_at').not('public_url', 'is', null).order('last_seen_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    sb.from('organizations').select('name').eq('id', orgId).single()
  ]);
  if (!stream?.enabled || !emitter?.public_url || !emitter.last_seen_at) return null;
  if (Date.now() - Date.parse(emitter.last_seen_at as string) > EMITTER_ONLINE_MS) return null;
  return { name: (org?.name as string) ?? 'Flux', url: `${(emitter.public_url as string).replace(/\/+$/, '')}/${stream.mount}` };
}

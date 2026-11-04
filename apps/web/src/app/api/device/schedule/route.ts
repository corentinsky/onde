import { NextResponse, type NextRequest } from 'next/server';
import { authDevice, storeStream } from '@/lib/device';
import { supabaseService } from '@/lib/supabase/server';

/** Tout ce dont le lecteur a besoin pour jouer seul, même hors connexion : règles, spots, flux. */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await authDevice(req);
  if (ctx instanceof NextResponse) return ctx;
  const sb = supabaseService();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: rules }, { data: org }, { data: store }, { data: targets }, { data: zones }] = await Promise.all([
    sb.from('broadcast_rules').select('*').eq('org_id', ctx.orgId).single(),
    sb.from('organizations').select('hq_spots_enabled, emergency').eq('id', ctx.orgId).single(),
    sb.from('stores').select('id, name, timezone, opening_hours, max_volume').eq('id', ctx.storeId).single(),
    sb
      .from('spot_targets')
      .select('scope, region_id, store_id, spots!inner(id, org_id, origin, title, script, audio_path, duration_sec, mode, status, starts_on, ends_on, daily_start, daily_end, every_min, fixed_times, window_min)')
      .eq('spots.org_id', ctx.orgId)
      .eq('spots.status', 'approved'),
    sb.from('zones').select('id, name, volume, messages_enabled, jingles_enabled, ambiences(name, stream_url)').eq('store_id', ctx.storeId)
  ]);

  type S = { id: string; origin: string; starts_on: string | null; ends_on: string | null; audio_path: string | null };
  const seen = new Set<string>();
  const spots = (targets ?? [])
    .filter((t) => t.scope === 'all' || (t.scope === 'region' && t.region_id === ctx.regionId) || (t.scope === 'store' && t.store_id === ctx.storeId))
    .map((t) => t.spots as unknown as S)
    .filter((s) => (!s.starts_on || s.starts_on <= today) && (!s.ends_on || s.ends_on >= today))
    .filter((s) => (org?.hq_spots_enabled === false ? s.origin === 'store' || s.origin === 'emergency' : true))
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));

  // Liens audio signés 24 h : le lecteur télécharge les fichiers et peut les rejouer hors connexion.
  const withAudio = await Promise.all(
    spots.map(async (s) => {
      if (!s.audio_path) return { ...s, audio_url: null };
      const { data } = await sb.storage.from('spots').createSignedUrl(s.audio_path, 60 * 60 * 24);
      return { ...s, audio_url: data?.signedUrl ?? null };
    })
  );
  const [stream, music] = await Promise.all([storeStream(sb, ctx.orgId, ctx.storeId), musicFor(sb, ctx.orgId, ctx.storeId)]);

  return NextResponse.json({ generated_at: new Date().toISOString(), store, rules, org, stream, spots: withAudio, zones: zones ?? [], music });
}

const minutes = (t: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

/**
 * Programmation musicale de la boutique : ambiances, journée type, listes et titres
 * avec leurs points de mix et un lien signé 24 h. Le lecteur choisit lui-même chaque titre.
 */
async function musicFor(sb: ReturnType<typeof supabaseService>, orgId: string, storeId: string) {
  const [{ data: ambiences }, { data: dayparts }, { data: playlists }, { data: zone }] = await Promise.all([
    sb.from('ambiences').select('id, name, crossfade_mode, crossfade_sec, target_lufs, title_separation_min, artist_separation_min').eq('org_id', orgId).order('name'),
    sb.from('dayparts').select('id, name, ambience_id, start_time, end_time, days, position').eq('org_id', orgId).order('position').order('start_time'),
    sb.from('playlists').select('*, playlist_tracks(track_id, position)').eq('org_id', orgId).eq('enabled', true),
    sb.from('zones').select('ambience_id').eq('store_id', storeId).not('ambience_id', 'is', null).limit(1).maybeSingle()
  ]);
  if (!ambiences?.length) return null;

  const lists = (playlists ?? []).map((p) => {
    const items = ((p.playlist_tracks ?? []) as { track_id: string; position: number }[]).sort((a, b) => a.position - b.position);
    return {
      id: p.id as string,
      ambienceId: p.ambience_id as string,
      name: p.name as string,
      type: p.type,
      weight: p.weight as number,
      order: p.play_order,
      everySongs: p.every_songs,
      everyMinutes: p.every_minutes,
      minuteOfHour: p.minute_of_hour,
      schedule: { startMin: minutes(p.start_time), endMin: minutes(p.end_time), days: p.days, startDate: p.start_date, endDate: p.end_date },
      avoidDuplicates: p.avoid_duplicates as boolean,
      isJingle: p.is_jingle as boolean,
      enabled: true,
      trackIds: items.map((i) => i.track_id)
    };
  });

  const ids = [...new Set(lists.flatMap((l) => l.trackIds))];
  const { data: rows } = ids.length
    ? await sb
        .from('tracks')
        .select('id, storage_path, title, artist, isrc, duration_sec, cue_in, cue_out, cross_start, fade_in, fade_out, integrated_lufs, peak_dbfs')
        .in('id', ids)
        .eq('enabled', true)
    : { data: [] as never[] };
  const paths = (rows ?? []).map((r) => r.storage_path as string);
  const { data: signed } = paths.length ? await sb.storage.from('music').createSignedUrls(paths, 60 * 60 * 24) : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const n = (v: unknown) => (v == null ? null : Number(v));
  const tracks = (rows ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    isrc: r.isrc,
    duration_sec: Number(r.duration_sec),
    cue_in: Number(r.cue_in),
    cue_out: Number(r.cue_out),
    cross_start: Number(r.cross_start),
    fade_in: Number(r.fade_in),
    fade_out: Number(r.fade_out),
    integrated_lufs: n(r.integrated_lufs),
    peak_dbfs: n(r.peak_dbfs),
    url: urlOf.get(r.storage_path as string) ?? null
  }));
  const enabledIds = new Set(tracks.map((t) => t.id));

  return {
    default_ambience_id: (zone?.ambience_id as string | undefined) ?? ambiences[0].id,
    ambiences: ambiences.map((a) => ({ ...a, crossfade_sec: Number(a.crossfade_sec), target_lufs: Number(a.target_lufs) })),
    dayparts: (dayparts ?? []).map((d) => ({ id: d.id, name: d.name, ambienceId: d.ambience_id, startMin: minutes(d.start_time)!, endMin: minutes(d.end_time)!, days: d.days })),
    playlists: lists.map((l) => ({ ...l, trackIds: l.trackIds.filter((id) => enabledIds.has(id)) })),
    tracks
  };
}

import { NextResponse, type NextRequest } from 'next/server';
import { localTimeIn } from '@onde/rules';
import { allRows, chunks, inChunks } from '@/lib/batch';
import { authDevice, storeStream } from '@/lib/device';
import { trackUrls } from '@/lib/library';
import { playableIds } from '@/lib/rotation';
import { ondeStreamUrl } from '@/lib/stream';
import { supabaseService } from '@/lib/supabase/server';

/** Tout ce dont le lecteur a besoin pour jouer seul, même hors connexion : règles, spots, flux. */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await authDevice(req);
  if (ctx instanceof NextResponse) return ctx;
  const sb = supabaseService();

  const [{ data: rules }, { data: org }, { data: store }, { data: targets }, { data: zones }] = await Promise.all([
    sb.from('broadcast_rules').select('*').eq('org_id', ctx.orgId).single(),
    sb.from('organizations').select('name, logo, hq_spots_enabled, emergency').eq('id', ctx.orgId).single(),
    sb.from('stores').select('id, name, timezone, opening_hours, max_volume').eq('id', ctx.storeId).single(),
    sb
      .from('spot_targets')
      .select('scope, region_id, store_id, spots!inner(id, org_id, origin, title, script, audio_path, duration_sec, mode, status, starts_on, ends_on, daily_start, daily_end, every_min, fixed_times, window_min)')
      .eq('spots.org_id', ctx.orgId)
      .eq('spots.status', 'approved'),
    sb.from('zones').select('id, name, volume, messages_enabled, jingles_enabled, ambiences(name, stream_url)').eq('store_id', ctx.storeId)
  ]);

  // Le jour de la boutique (fuseau de la boutique), pas celui du serveur en UTC.
  const today = localTimeIn(new Date(), (store?.timezone as string | null) ?? 'Europe/Paris').date;
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
  // Flux de l’enseigne (émetteur Onde) en priorité, sinon un flux externe ; la bibliothèque sert de secours.
  const [onde, external, music] = await Promise.all([ondeStreamUrl(sb, ctx.orgId), storeStream(sb, ctx.orgId, ctx.storeId), musicFor(sb, ctx.orgId, ctx.storeId)]);
  const stream = onde ? { ...onde, kind: 'onde' as const } : external?.url ? { name: external.name, url: external.url, kind: 'external' as const } : null;

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
    sb.from('playlists').select('*').eq('org_id', orgId).eq('enabled', true),
    sb.from('zones').select('ambience_id').eq('store_id', storeId).not('ambience_id', 'is', null).limit(1).maybeSingle()
  ]);
  if (!ambiences?.length) return null;

  // Titres des listes, page par page : une liste peut contenir des milliers de titres.
  const listIds = (playlists ?? []).map((p) => p.id as string);
  const items = (
    await Promise.all(
      chunks(listIds, 50).map((ids) =>
        allRows<{ playlist_id: string; track_id: string; position: number; rested_until: string | null }>((from, to) =>
          sb.from('playlist_tracks').select('playlist_id, track_id, position, rested_until').in('playlist_id', ids).order('playlist_id').order('position').order('track_id').range(from, to)
        )
      )
    )
  ).flat();
  // Titres au repos (rotation automatique) écartés.
  const grouped = new Map<string, typeof items>();
  for (const it of items) {
    const l = grouped.get(it.playlist_id);
    if (l) l.push(it);
    else grouped.set(it.playlist_id, [it]);
  }
  const byList = new Map([...grouped].map(([id, l]) => [id, playableIds(l)]));

  const lists = (playlists ?? []).map((p) => {
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
      trackIds: byList.get(p.id as string) ?? []
    };
  });

  const ids = [...new Set(lists.flatMap((l) => l.trackIds))];
  const rows = await inChunks(ids, (c) =>
    sb
      .from('tracks')
      .select('id, storage_path, location, title, artist, isrc, duration_sec, cue_in, cue_out, cross_start, fade_in, fade_out, integrated_lufs, peak_dbfs')
      .in('id', c)
      .eq('enabled', true)
  );
  const urlOf = await trackUrls(sb, rows as { storage_path: string; location: string }[], 60 * 60 * 24);
  const n = (v: unknown) => (v == null ? null : Number(v));
  const tracks = rows.map((r) => ({
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

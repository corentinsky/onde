import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isResting, planRotation, rotationDue, type RotationTrack } from '@onde/rules';
import { allRows, inChunks } from './batch';
import { todayParis } from './format';

/**
 * Rotation automatique des listes (règles : packages/rules/src/rotation.ts).
 * Lancée chaque matin par la tâche planifiée de Vercel (/api/cron/rotation) pour les listes dont
 * l’échéance est arrivée, ou à la main depuis la régie.
 */

const DAY = 86_400_000;
const parisDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso));

export interface RotationResult {
  playlistId: string;
  name: string;
  rested: number;
  returned: number;
  active: number;
  total: number;
}

/** Diffusions par titre depuis une date : le flux de l’enseigne, sinon les boutiques (dédoublonnées). */
async function playsSince(sb: SupabaseClient, orgId: string, trackIds: string[], since: string) {
  const out = new Map<string, { plays: number; last: number }>();
  const add = (id: string | null, at: string) => {
    if (!id) return;
    const t = Date.parse(at);
    const cur = out.get(id);
    if (cur) {
      cur.plays += 1;
      cur.last = Math.max(cur.last, t);
    } else out.set(id, { plays: 1, last: t });
  };
  const stream = await inChunks(trackIds, (ids) =>
    sb.from('stream_plays').select('track_id, started_at').eq('org_id', orgId).in('track_id', ids).gte('started_at', since).not('started_at', 'is', null).limit(10_000)
  );
  for (const r of stream as { track_id: string | null; started_at: string }[]) add(r.track_id, r.started_at);
  if (stream.length) return out;
  // Sans flux : les boutiques jouent chacune leur musique ; un même passage à la même heure ne compte qu’une fois.
  const stores = await inChunks(trackIds, (ids) =>
    sb.from('track_plays').select('track_id, played_at').eq('org_id', orgId).in('track_id', ids).gte('played_at', since).limit(20_000)
  );
  const seen = new Set<string>();
  for (const r of stores as { track_id: string | null; played_at: string }[]) {
    const key = `${r.track_id}|${Math.round(Date.parse(r.played_at) / (10 * 60_000))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    add(r.track_id, r.played_at);
  }
  return out;
}

export async function rotatePlaylist(sb: SupabaseClient, playlistId: string, trigger: 'auto' | 'manual'): Promise<RotationResult> {
  const { data: p, error } = await sb
    .from('playlists')
    .select('id, org_id, name, rotation_days, rotation_share, rotation_rest_days, rotated_at')
    .eq('id', playlistId)
    .single();
  if (error || !p) throw new Error('Liste introuvable');
  const items = await allRows<{ track_id: string; added_at: string; rested_until: string | null }>((from, to) =>
    sb.from('playlist_tracks').select('track_id, added_at, rested_until').eq('playlist_id', playlistId).order('track_id').range(from, to)
  );
  const ids = items.map((i) => i.track_id);
  const meta = await inChunks(ids, (c) => sb.from('tracks').select('id, title, artist').in('id', c));
  const info = new Map((meta as { id: string; title: string; artist: string }[]).map((t) => [t.id, t]));

  const lastRotated = p.rotated_at ? Date.parse(p.rotated_at as string) : null;
  const since = new Date(lastRotated ?? Date.now() - (Number(p.rotation_days) || 15) * DAY).toISOString();
  const plays = await playsSince(sb, p.org_id as string, ids, since);
  const today = todayParis();
  const tracks: RotationTrack[] = items.map((i) => ({
    trackId: i.track_id,
    artist: info.get(i.track_id)?.artist ?? '',
    addedAt: Date.parse(i.added_at),
    restedUntil: i.rested_until,
    plays: plays.get(i.track_id)?.plays ?? 0,
    lastPlayedAt: plays.get(i.track_id)?.last ?? null
  }));
  const plan = planRotation(tracks, { sharePct: Number(p.rotation_share) || 20, restDays: Number(p.rotation_rest_days) || 30 }, today, lastRotated);

  if (plan.back.length) {
    const { error: e } = await sb.from('playlist_tracks').update({ rested_until: null }).eq('playlist_id', playlistId).in('track_id', plan.back);
    if (e) throw e;
  }
  if (plan.rest.length) {
    const { error: e } = await sb.from('playlist_tracks').update({ rested_until: plan.rest[0].until }).eq('playlist_id', playlistId).in('track_id', plan.rest.map((r) => r.trackId));
    if (e) throw e;
  }
  const label = (id: string) => ({ track_id: id, title: info.get(id)?.title ?? '', artist: info.get(id)?.artist ?? '' });
  const { error: logError } = await sb.from('playlist_rotations').insert({
    org_id: p.org_id,
    playlist_id: playlistId,
    trigger,
    rested: plan.rest.map((r) => ({ ...label(r.trackId), plays: plays.get(r.trackId)?.plays ?? 0, until: r.until })),
    returned: plan.back.map(label),
    active_count: plan.activeAfter,
    total_count: plan.total
  });
  if (logError) throw logError;
  await sb.from('playlists').update({ rotated_at: new Date().toISOString() }).eq('id', playlistId);
  return { playlistId, name: p.name as string, rested: plan.rest.length, returned: plan.back.length, active: plan.activeAfter, total: plan.total };
}

/** Toutes les listes dont la rotation est due aujourd’hui (heure de Paris). */
export async function runDueRotations(sb: SupabaseClient): Promise<RotationResult[]> {
  const { data, error } = await sb.from('playlists').select('id, rotation_days, rotated_at').eq('enabled', true).not('rotation_days', 'is', null);
  if (error) throw error;
  const today = todayParis();
  const out: RotationResult[] = [];
  for (const p of data ?? []) {
    if (!rotationDue(p.rotation_days as number, p.rotated_at ? parisDate(p.rotated_at as string) : null, today)) continue;
    out.push(await rotatePlaylist(sb, p.id as string, 'auto'));
  }
  return out;
}

/** Titres au repos aujourd’hui, à écarter de la diffusion (une liste entièrement au repos reste jouée). */
export function playableIds(items: { track_id: string; rested_until?: string | null }[]): string[] {
  const today = todayParis();
  const live = items.filter((i) => !isResting(i.rested_until, today)).map((i) => i.track_id);
  return live.length ? live : items.map((i) => i.track_id);
}

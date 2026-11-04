import { NextResponse, type NextRequest } from 'next/server';
import { inChunks } from '@/lib/batch';
import { authDevice, deny } from '@/lib/device';
import { supabaseService } from '@/lib/supabase/server';

type TrackEntry = { track_id: string; playlist_id?: string | null; title?: string; artist?: string; isrc?: string | null; played_at: string; duration_sec?: number };
type Entry = { spot_id: string; scheduled_for?: string; played_at?: string; status: 'played' | 'partial' | 'missed' | 'skipped'; reason?: string };
const STATUSES = new Set(['played', 'partial', 'missed', 'skipped']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const iso = (t: number) => new Date(t).toISOString();

/**
 * Preuves de diffusion et titres joués, envoyés par lots (le lecteur garde sa file hors connexion).
 * Un lot renvoyé deux fois (réponse perdue en route) n’est pas compté deux fois.
 */
export async function POST(req: NextRequest) {
  const ctx = await authDevice(req);
  if (ctx instanceof NextResponse) return ctx;
  const b = (await req.json().catch(() => ({}))) as { entries?: Entry[]; tracks?: TrackEntry[] };
  const sb = supabaseService();

  try {
    // ───── Titres joués (relevés de diffusion, droits) ─────
    let tracks = (b.tracks ?? []).slice(0, 1000).filter((t) => t && typeof t.track_id === 'string' && UUID.test(t.track_id) && Number.isFinite(ms(t.played_at)));
    if (tracks.length) {
      const times = tracks.map((t) => ms(t.played_at));
      const { data: already, error } = await sb
        .from('track_plays')
        .select('played_at, title')
        .eq('device_id', ctx.deviceId)
        .gte('played_at', iso(Math.min(...times)))
        .lte('played_at', iso(Math.max(...times)));
      if (error) throw error;
      const seen = new Set((already ?? []).map((r) => `${ms(r.played_at as string)}|${r.title}`));
      tracks = tracks.filter((t) => !seen.has(`${ms(t.played_at)}|${String(t.title ?? '').slice(0, 300)}`));
    }
    if (tracks.length) {
      // Un titre ou une liste supprimés entre-temps : on garde la ligne, sans le lien.
      const listIds = [...new Set(tracks.map((t) => t.playlist_id).filter((x): x is string => !!x && UUID.test(x)))];
      const [known, lists] = await Promise.all([
        inChunks([...new Set(tracks.map((t) => t.track_id))], (ids) => sb.from('tracks').select('id').in('id', ids)),
        inChunks(listIds, (ids) => sb.from('playlists').select('id').eq('org_id', ctx.orgId).in('id', ids))
      ]);
      const okTrack = new Set(known.map((r) => r.id as string));
      const okList = new Set(lists.map((r) => r.id as string));
      const { error } = await sb.from('track_plays').insert(
        tracks.map((t) => ({
          org_id: ctx.orgId,
          store_id: ctx.storeId,
          device_id: ctx.deviceId,
          track_id: okTrack.has(t.track_id) ? t.track_id : null,
          playlist_id: t.playlist_id && okList.has(t.playlist_id) ? t.playlist_id : null,
          title: String(t.title ?? '').slice(0, 300),
          artist: String(t.artist ?? '').slice(0, 300),
          isrc: t.isrc ? String(t.isrc).slice(0, 20) : null,
          played_at: iso(ms(t.played_at)),
          duration_sec: Number.isFinite(t.duration_sec) ? t.duration_sec : null
        }))
      );
      if (error) throw error;
    }

    // ───── Preuves des spots ─────
    let entries = (b.entries ?? []).slice(0, 500).filter((e) => e && typeof e.spot_id === 'string' && UUID.test(e.spot_id) && STATUSES.has(e.status));
    if (entries.length) {
      // Seulement les spots de l’enseigne qui existent encore : un spot supprimé ne bloque plus la file.
      const spots = await inChunks([...new Set(entries.map((e) => e.spot_id))], (ids) => sb.from('spots').select('id').eq('org_id', ctx.orgId).in('id', ids));
      const okSpot = new Set(spots.map((s) => s.id as string));
      entries = entries.filter((e) => okSpot.has(e.spot_id));
    }
    const dated = entries.map((e) => ms(e.scheduled_for)).filter(Number.isFinite);
    if (dated.length) {
      const { data: already, error } = await sb
        .from('play_logs')
        .select('spot_id, scheduled_for, status')
        .eq('device_id', ctx.deviceId)
        .gte('scheduled_for', iso(Math.min(...dated)))
        .lte('scheduled_for', iso(Math.max(...dated)));
      if (error) throw error;
      const seen = new Set((already ?? []).map((r) => `${r.spot_id}|${ms(r.scheduled_for as string)}|${r.status}`));
      entries = entries.filter((e) => !Number.isFinite(ms(e.scheduled_for)) || !seen.has(`${e.spot_id}|${ms(e.scheduled_for)}|${e.status}`));
    }
    // Rien de nouveau : on répond OK pour que le lecteur vide sa file au lieu de la renvoyer sans fin.
    if (!entries.length) return NextResponse.json({ ok: true, saved: 0, tracks: tracks.length });
    const rows = entries.map((e) => ({
      org_id: ctx.orgId,
      store_id: ctx.storeId,
      device_id: ctx.deviceId,
      spot_id: e.spot_id,
      scheduled_for: Number.isFinite(ms(e.scheduled_for)) ? iso(ms(e.scheduled_for)) : null,
      played_at: Number.isFinite(ms(e.played_at)) ? iso(ms(e.played_at)) : null,
      status: e.status,
      reason: e.reason?.slice(0, 200) ?? null
    }));
    const { error } = await sb.from('play_logs').insert(rows);
    if (error) throw error;
    const missed = rows.filter((r) => r.status === 'missed');
    if (missed.length) {
      await sb.from('incidents').insert(missed.map((m) => ({ org_id: ctx.orgId, store_id: ctx.storeId, device_id: ctx.deviceId, kind: 'spot_missed', details: `Spot non diffusé (${m.reason ?? 'raison inconnue'})` })));
    }
    return NextResponse.json({ ok: true, saved: rows.length, tracks: tracks.length });
  } catch {
    return deny(500, 'Erreur serveur');
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import { authDevice, deny } from '@/lib/device';
import { supabaseService } from '@/lib/supabase/server';

type TrackEntry = { track_id: string; playlist_id?: string | null; title?: string; artist?: string; isrc?: string | null; played_at: string; duration_sec?: number };
type Entry = { spot_id: string; scheduled_for?: string; played_at?: string; status: 'played' | 'partial' | 'missed' | 'skipped'; reason?: string };
const STATUSES = new Set(['played', 'partial', 'missed', 'skipped']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Preuves de diffusion, envoyées par lots (le lecteur garde la file s’il est hors connexion). */
export async function POST(req: NextRequest) {
  const ctx = await authDevice(req);
  if (ctx instanceof NextResponse) return ctx;
  const b = (await req.json().catch(() => ({}))) as { entries?: Entry[]; tracks?: TrackEntry[] };
  const entries = (b.entries ?? []).slice(0, 500).filter((e) => e && typeof e.spot_id === 'string' && UUID.test(e.spot_id) && STATUSES.has(e.status));
  const sb = supabaseService();

  // Historique des titres joués (relevés de diffusion, droits).
  const tracks = (b.tracks ?? [])
    .slice(0, 1000)
    .filter((t) => t && typeof t.track_id === 'string' && UUID.test(t.track_id) && !Number.isNaN(Date.parse(t.played_at)));
  if (tracks.length) {
    // Un titre ou une liste supprimés entre-temps : on garde la ligne, sans le lien.
    const [{ data: known }, { data: lists }] = await Promise.all([
      sb.from('tracks').select('id').in('id', [...new Set(tracks.map((t) => t.track_id))]),
      sb.from('playlists').select('id').eq('org_id', ctx.orgId).in('id', [...new Set(tracks.map((t) => t.playlist_id).filter((x): x is string => !!x && UUID.test(x)))])
    ]);
    const okTrack = new Set((known ?? []).map((r) => r.id as string));
    const okList = new Set((lists ?? []).map((r) => r.id as string));
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
        played_at: t.played_at,
        duration_sec: Number.isFinite(t.duration_sec) ? t.duration_sec : null
      }))
    );
    if (error) return deny(500, 'Erreur serveur');
  }

  // Rien de valide : on répond OK pour que le lecteur vide sa file au lieu de la renvoyer sans fin.
  if (!entries.length) return NextResponse.json({ ok: true, saved: 0, tracks: tracks.length });
  const rows = entries.map((e) => ({
    org_id: ctx.orgId,
    store_id: ctx.storeId,
    device_id: ctx.deviceId,
    spot_id: e.spot_id,
    scheduled_for: e.scheduled_for ?? null,
    played_at: e.played_at ?? null,
    status: e.status,
    reason: e.reason?.slice(0, 200) ?? null
  }));
  const { error } = await sb.from('play_logs').insert(rows);
  if (error) return deny(500, 'Erreur serveur');
  const missed = rows.filter((r) => r.status === 'missed');
  if (missed.length) {
    await sb.from('incidents').insert(missed.map((m) => ({ org_id: ctx.orgId, store_id: ctx.storeId, device_id: ctx.deviceId, kind: 'spot_missed', details: `Spot non diffusé (${m.reason ?? 'raison inconnue'})` })));
  }
  return NextResponse.json({ ok: true, saved: rows.length, tracks: tracks.length });
}

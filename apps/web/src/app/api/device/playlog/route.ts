import { NextResponse, type NextRequest } from 'next/server';
import { authDevice, deny } from '@/lib/device';
import { supabaseService } from '@/lib/supabase/server';

type Entry = { spot_id: string; scheduled_for?: string; played_at?: string; status: 'played' | 'partial' | 'missed' | 'skipped'; reason?: string };
const STATUSES = new Set(['played', 'partial', 'missed', 'skipped']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Preuves de diffusion, envoyées par lots (le lecteur garde la file s’il est hors connexion). */
export async function POST(req: NextRequest) {
  const ctx = await authDevice(req);
  if (ctx instanceof NextResponse) return ctx;
  const b = (await req.json().catch(() => ({}))) as { entries?: Entry[] };
  const entries = (b.entries ?? []).slice(0, 500).filter((e) => e && typeof e.spot_id === 'string' && UUID.test(e.spot_id) && STATUSES.has(e.status));
  // Rien de valide : on répond OK pour que le lecteur vide sa file au lieu de la renvoyer sans fin.
  if (!entries.length) return NextResponse.json({ ok: true, saved: 0 });
  const sb = supabaseService();
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
  return NextResponse.json({ ok: true, saved: rows.length });
}

import { NextResponse, type NextRequest } from 'next/server';
import { authDevice, deny } from '@/lib/device';
import { supabaseService } from '@/lib/supabase/server';

type Entry = { spot_id: string; scheduled_for?: string; played_at?: string; status: 'played' | 'partial' | 'missed' | 'skipped'; reason?: string };
const STATUSES = new Set(['played', 'partial', 'missed', 'skipped']);

/** Preuves de diffusion, envoyées par lots (le lecteur garde la file s’il est hors connexion). */
export async function POST(req: NextRequest) {
  const ctx = await authDevice(req);
  if (ctx instanceof NextResponse) return ctx;
  const b = (await req.json().catch(() => ({}))) as { entries?: Entry[] };
  const entries = (b.entries ?? []).slice(0, 500).filter((e) => e && typeof e.spot_id === 'string' && STATUSES.has(e.status));
  if (!entries.length) return deny(400, 'Aucune entrée valide');
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

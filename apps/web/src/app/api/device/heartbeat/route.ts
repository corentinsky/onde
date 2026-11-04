import { NextResponse, type NextRequest } from 'next/server';
import { authDevice } from '@/lib/device';
import { supabaseService } from '@/lib/supabase/server';

/** Signal de vie, toutes les 30 s : titre en cours, musique en avance, niveau de sortie. */
export async function POST(req: NextRequest) {
  const ctx = await authDevice(req);
  if (ctx instanceof NextResponse) return ctx;
  const b = (await req.json().catch(() => ({}))) as {
    now_playing?: { title?: string; artist?: string; ends_at?: string };
    cache_seconds?: number;
    output_lufs?: number;
    app_version?: string;
  };
  const sb = supabaseService();
  const now = new Date().toISOString();
  await sb
    .from('devices')
    .update({
      last_seen_at: now,
      now_playing: b.now_playing ?? null,
      cache_seconds: Number.isFinite(b.cache_seconds) ? b.cache_seconds : null,
      output_lufs: Number.isFinite(b.output_lufs) ? b.output_lufs : null,
      app_version: b.app_version ?? null
    })
    .eq('id', ctx.deviceId);
  // Le lecteur revient : on clôt l’alerte « hors ligne » éventuelle.
  await sb.from('incidents').update({ resolved_at: now }).eq('device_id', ctx.deviceId).eq('kind', 'offline').is('resolved_at', null);
  const { data: org } = await sb.from('organizations').select('hq_spots_enabled, emergency').eq('id', ctx.orgId).single();
  return NextResponse.json({ ok: true, hq_spots_enabled: org?.hq_spots_enabled ?? true, emergency: org?.emergency ?? null });
}

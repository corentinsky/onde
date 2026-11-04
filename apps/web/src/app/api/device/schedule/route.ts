import { NextResponse, type NextRequest } from 'next/server';
import { authDevice } from '@/lib/device';
import { supabaseService } from '@/lib/supabase/server';

/** Tout ce dont le lecteur a besoin pour jouer seul, même hors connexion : règles, spots, flux. */
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

  type S = { id: string; origin: string; starts_on: string | null; ends_on: string | null };
  const seen = new Set<string>();
  const spots = (targets ?? [])
    .filter((t) => t.scope === 'all' || (t.scope === 'region' && t.region_id === ctx.regionId) || (t.scope === 'store' && t.store_id === ctx.storeId))
    .map((t) => t.spots as unknown as S)
    .filter((s) => (!s.starts_on || s.starts_on <= today) && (!s.ends_on || s.ends_on >= today))
    .filter((s) => (org?.hq_spots_enabled === false ? s.origin === 'store' || s.origin === 'emergency' : true))
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));

  return NextResponse.json({ generated_at: new Date().toISOString(), store, rules, org, spots, zones: zones ?? [] });
}

import 'server-only';
import { cookies } from 'next/headers';
import { isConfigured, supabaseServer } from './supabase/server';
import * as demo from './demo';

export type Origin = 'emergency' | 'national' | 'regional' | 'store';
export type StoreState = 'online' | 'offline' | 'silent' | 'no_device';

export interface Org {
  id: string;
  name: string;
  slug: string;
  hq_spots_enabled: boolean;
  emergency?: { id: string; kind: string; text: string; started_at: string } | null;
}

export interface Device {
  id: string;
  name: string;
  pairing_code: string | null;
  last_seen_at: string | null;
  app_version: string | null;
}

export interface Session {
  mode: 'demo' | 'live';
  userName: string;
  userEmail: string;
  isPlatformAdmin: boolean;
  orgs: Org[];
  org: Org | null;
}

export interface StoreRow {
  store_id: string;
  name: string;
  city: string;
  region: string | null;
  status: StoreState;
  last_seen_at: string | null;
  now_playing: { title?: string; artist?: string } | null;
  cache_seconds: number | null;
  output_lufs: number | null;
  app_version: string | null;
  open_incidents: number;
}

export interface Incident {
  id: string;
  store_id: string;
  store_name: string;
  kind: 'offline' | 'silence' | 'volume' | 'stuck' | 'cache_low' | 'spot_missed';
  details: string;
  started_at: string;
}

export interface Spot {
  id: string;
  origin: Origin;
  title: string;
  script: string;
  duration_sec: number;
  mode: 'next_break' | 'sync';
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'paused' | 'archived';
  starts_on: string | null;
  ends_on: string | null;
  daily_start: string;
  daily_end: string;
  every_min: number | null;
  fixed_times: string[] | null;
  target: string;
  created_at: string;
}

export interface PlayLog {
  id: number;
  spot_title: string;
  origin: Origin | null;
  status: 'played' | 'partial' | 'missed' | 'skipped';
  at: string;
  reason: string | null;
}

export interface RulesRow {
  priority: Exclude<Origin, 'emergency'>[];
  max_per_break: number;
  max_seconds_per_hour: number;
  min_gap_same_spot_min: number;
  window_min: number;
  never_cut_track: boolean;
  duck_music: boolean;
  alert_on_miss: boolean;
}

export const ORG_COOKIE = 'onde_org';

export async function getSession(): Promise<Session> {
  const jar = await cookies();
  const wanted = jar.get(ORG_COOKIE)?.value;
  if (!isConfigured) {
    const org = demo.orgs.find((o) => o.id === wanted) ?? demo.orgs[0];
    return { mode: 'demo', userName: 'Corentin', userEmail: 'demo@onde.local', isPlatformAdmin: true, orgs: demo.orgs, org };
  }
  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  if (!user) return { mode: 'live', userName: '', userEmail: '', isPlatformAdmin: false, orgs: [], org: null };
  const [{ data: profile }, { data: orgs }] = await Promise.all([
    sb.from('profiles').select('full_name,is_platform_admin').eq('id', user.id).maybeSingle(),
    sb.from('organizations').select('id,name,slug,hq_spots_enabled,emergency').order('name')
  ]);
  const list = (orgs ?? []) as Org[];
  return {
    mode: 'live',
    userName: profile?.full_name || user.email?.split('@')[0] || '',
    userEmail: user.email ?? '',
    isPlatformAdmin: Boolean(profile?.is_platform_admin),
    orgs: list,
    org: list.find((o) => o.id === wanted) ?? list[0] ?? null
  };
}

export async function listStoreStatus(orgId: string): Promise<StoreRow[]> {
  if (!isConfigured) return demo.stores;
  const sb = await supabaseServer();
  const [{ data: rows, error }, { data: regions }] = await Promise.all([
    sb.from('store_status').select('*').eq('org_id', orgId).order('name'),
    sb.from('regions').select('id,name').eq('org_id', orgId)
  ]);
  if (error) throw error;
  const regionName = new Map((regions ?? []).map((r) => [r.id as string, r.name as string]));
  return (rows ?? []).map((r) => ({ ...r, region: r.region_id ? regionName.get(r.region_id) ?? null : null })) as StoreRow[];
}

export async function getStore(storeId: string): Promise<StoreRow | null> {
  if (!isConfigured) return demo.stores.find((s) => s.store_id === storeId) ?? null;
  const sb = await supabaseServer();
  const { data } = await sb.from('store_status').select('*').eq('store_id', storeId).maybeSingle();
  if (!data) return null;
  let region: string | null = null;
  if (data.region_id) {
    const { data: r } = await sb.from('regions').select('name').eq('id', data.region_id).maybeSingle();
    region = (r?.name as string) ?? null;
  }
  return { ...data, region } as StoreRow;
}

export async function listIncidents(orgId: string, storeId?: string): Promise<Incident[]> {
  if (!isConfigured) return demo.incidents.filter((i) => !storeId || i.store_id === storeId);
  const sb = await supabaseServer();
  let q = sb
    .from('incidents')
    .select('id,store_id,kind,details,started_at,stores(name)')
    .eq('org_id', orgId)
    .is('resolved_at', null)
    .order('started_at', { ascending: false });
  if (storeId) q = q.eq('store_id', storeId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((i) => ({ ...i, store_name: (i.stores as unknown as { name: string } | null)?.name ?? '' })) as Incident[];
}

type TargetRow = { scope: 'all' | 'region' | 'store'; stores: { name: string } | null; regions: { name: string } | null };
const describeTargets = (t: TargetRow[] | null) => {
  if (!t?.length) return 'Aucune boutique';
  if (t.some((x) => x.scope === 'all')) return 'Tout le réseau';
  return t.map((x) => x.stores?.name ?? x.regions?.name ?? '').filter(Boolean).join(', ');
};

export async function listSpots(orgId: string, opts: { pendingOnly?: boolean } = {}): Promise<Spot[]> {
  if (!isConfigured) return demo.spots.filter((s) => (opts.pendingOnly ? s.status === 'pending_review' : s.status !== 'archived'));
  const sb = await supabaseServer();
  let q = sb
    .from('spots')
    .select('*, spot_targets(scope, stores(name), regions(name))')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  q = opts.pendingOnly ? q.eq('status', 'pending_review') : q.neq('status', 'archived');
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((s) => ({ ...s, target: describeTargets(s.spot_targets as unknown as TargetRow[]) })) as Spot[];
}

export async function getRules(orgId: string): Promise<RulesRow> {
  if (!isConfigured) return demo.rules;
  const sb = await supabaseServer();
  const { data, error } = await sb.from('broadcast_rules').select('*').eq('org_id', orgId).maybeSingle();
  if (error) throw error;
  return (data as RulesRow | null) ?? demo.rules;
}

export async function listPlayLogs(storeId: string): Promise<PlayLog[]> {
  if (!isConfigured) return demo.playLogs;
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('play_logs')
    .select('id,status,played_at,scheduled_for,reason,spots(title,origin)')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((p) => {
    const spot = p.spots as unknown as { title: string; origin: Origin } | null;
    return {
      id: p.id as number,
      spot_title: spot?.title ?? 'Spot supprimé',
      origin: spot?.origin ?? null,
      status: p.status,
      at: (p.played_at ?? p.scheduled_for) as string,
      reason: p.reason as string | null
    };
  });
}

export async function listDevices(storeId: string): Promise<Device[]> {
  if (!isConfigured) return [{ id: 'd2', name: 'Onde Box', pairing_code: null, last_seen_at: new Date(Date.now() - 12_000).toISOString(), app_version: '0.1.0' }];
  const sb = await supabaseServer();
  const { data, error } = await sb.from('devices').select('id,name,pairing_code,last_seen_at,app_version').eq('store_id', storeId).order('created_at');
  if (error) throw error;
  return (data ?? []) as Device[];
}

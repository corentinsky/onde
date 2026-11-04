'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ORG_COOKIE } from '@/lib/data';
import { isConfigured, supabaseServer } from '@/lib/supabase/server';

const DEMO = '?demo=1';

function back(path: string): never {
  revalidatePath('/regie', 'layout');
  redirect(isConfigured ? path : `${path}${DEMO}`);
}

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const num = (f: FormData, k: string, min: number, max: number) => {
  const n = Number(f.get(k));
  if (!Number.isFinite(n)) throw new Error(`Valeur invalide : ${k}`);
  return Math.min(max, Math.max(min, Math.round(n)));
};

export async function selectOrg(form: FormData) {
  const id = str(form, 'org');
  (await cookies()).set(ORG_COOKIE, id, { path: '/', sameSite: 'lax', httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  back(str(form, 'from') || '/regie');
}

export async function createSpot(form: FormData) {
  const orgId = str(form, 'org_id');
  const title = str(form, 'title');
  if (!title) throw new Error('Le titre est obligatoire');
  const mode = str(form, 'mode') === 'sync' ? 'sync' : 'next_break';
  const freq = str(form, 'frequency');
  const fixed = str(form, 'fixed_time');
  const spot = {
    org_id: orgId,
    origin: 'national' as const,
    title,
    script: str(form, 'script'),
    duration_sec: num(form, 'duration_sec', 1, 600),
    mode,
    status: 'approved' as const,
    starts_on: str(form, 'starts_on') || null,
    ends_on: str(form, 'ends_on') || null,
    daily_start: str(form, 'daily_start') || '10:00',
    daily_end: str(form, 'daily_end') || '19:00',
    every_min: freq === 'fixed' ? null : Number(freq) || 120,
    fixed_times: freq === 'fixed' ? [fixed || '10:00'] : null
  };
  if (isConfigured) {
    const sb = await supabaseServer();
    const { data, error } = await sb.from('spots').insert(spot).select('id').single();
    if (error) throw error;
    const { error: e2 } = await sb.from('spot_targets').insert({ spot_id: data.id, scope: 'all' });
    if (e2) throw e2;
  }
  back('/regie/spots');
}

export async function setSpotStatus(form: FormData) {
  const id = str(form, 'id');
  const status = str(form, 'status');
  if (!['approved', 'paused', 'archived'].includes(status)) throw new Error('Statut invalide');
  if (isConfigured) {
    const sb = await supabaseServer();
    const { error } = await sb.from('spots').update({ status }).eq('id', id);
    if (error) throw error;
  }
  back('/regie/spots');
}

export async function reviewSpot(form: FormData) {
  const id = str(form, 'id');
  const approve = str(form, 'decision') === 'approve';
  if (isConfigured) {
    const sb = await supabaseServer();
    const { error } = await sb.rpc('review_spot', { p_spot: id, p_approve: approve });
    if (error) throw error;
  }
  back('/regie/messages');
}

export async function toggleHqSpots(form: FormData) {
  const orgId = str(form, 'org_id');
  const enabled = str(form, 'enabled') === 'true';
  if (isConfigured) {
    const sb = await supabaseServer();
    const { error } = await sb.from('organizations').update({ hq_spots_enabled: enabled }).eq('id', orgId);
    if (error) throw error;
  }
  back('/regie/spots');
}

export async function saveRules(form: FormData) {
  const orgId = str(form, 'org_id');
  const priority = str(form, 'priority').split(',').filter((p) => ['national', 'regional', 'store'].includes(p));
  if (priority.length !== 3) throw new Error('Ordre de priorité invalide');
  const rules = {
    priority,
    max_per_break: num(form, 'max_per_break', 1, 10),
    max_seconds_per_hour: num(form, 'max_minutes_per_hour', 0, 60) * 60,
    min_gap_same_spot_min: num(form, 'min_gap_same_spot_min', 0, 240),
    window_min: num(form, 'window_min', 1, 120),
    never_cut_track: form.get('never_cut_track') === 'on',
    duck_music: form.get('duck_music') === 'on',
    alert_on_miss: form.get('alert_on_miss') === 'on',
    updated_at: new Date().toISOString()
  };
  if (isConfigured) {
    const sb = await supabaseServer();
    const {
      data: { user }
    } = await sb.auth.getUser();
    const { error } = await sb.from('broadcast_rules').update({ ...rules, updated_by: user?.id }).eq('org_id', orgId);
    if (error) throw error;
  }
  back('/regie/regles');
}

export async function resolveIncident(form: FormData) {
  const id = str(form, 'id');
  if (isConfigured) {
    const sb = await supabaseServer();
    const { error } = await sb.from('incidents').update({ resolved_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }
  back(str(form, 'from') || '/regie/supervision');
}

export async function signOut() {
  if (isConfigured) {
    const sb = await supabaseServer();
    await sb.auth.signOut();
  }
  redirect('/login');
}

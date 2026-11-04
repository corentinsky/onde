'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { newToken, sha256 } from '@/lib/device';
import { isConfigured, supabaseServer } from '@/lib/supabase/server';

/** Crée une clé d’émetteur. Elle n’est affichée qu’une fois : seul son condensé est gardé. */
export async function createEmitterKey(_prev: { key?: string; error?: string } | null, form: FormData): Promise<{ key?: string; error?: string }> {
  if (!isConfigured) return { error: 'Supabase n’est pas configuré.' };
  const sb = await supabaseServer();
  const {
    data: { user }
  } = await sb.auth.getUser();
  const key = newToken();
  const name = String(form.get('name') ?? '').trim().slice(0, 80) || 'Émetteur';
  const { error } = await sb.from('emitters').insert({ name, token_hash: sha256(key), created_by: user?.id ?? null });
  if (error) return { error: 'Création refusée : réservée à la régie.' };
  revalidatePath('/regie/emetteur');
  return { key };
}

export async function revokeEmitter(form: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.from('emitters').delete().eq('id', String(form.get('id')));
  if (error) throw error;
  revalidatePath('/regie/emetteur');
  redirect('/regie/emetteur');
}

export async function saveStream(form: FormData) {
  const sb = await supabaseServer();
  const amb = String(form.get('default_ambience_id') ?? '');
  const { error } = await sb
    .from('streams')
    .update({ enabled: form.get('enabled') === 'on', default_ambience_id: amb || null })
    .eq('org_id', String(form.get('org_id')));
  if (error) throw error;
  revalidatePath('/regie/emetteur');
  redirect('/regie/emetteur?enregistre=1');
}

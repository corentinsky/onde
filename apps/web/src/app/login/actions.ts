'use server';

import { createServerClient } from '@supabase/ssr';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase/server';

export async function sendLink(form: FormData) {
  const email = String(form.get('email') ?? '').trim();
  const next = String(form.get('next') ?? '/regie');
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/regie';
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  // Flux « implicit » : le lien porte la session, il marche aussi s’il est ouvert
  // sur un autre appareil (téléphone) que celui qui l’a demandé.
  const sb = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: { getAll: () => [], setAll: () => undefined },
    auth: { flowType: 'implicit', persistSession: false }
  });
  // Pas de création de compte depuis l’écran de connexion : la régie invite les utilisateurs.
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(safeNext)}` }
  });
  if (error) redirect(`/login?error=${encodeURIComponent('Adresse inconnue ou envoi impossible. Demandez une invitation à la régie.')}`);
  redirect('/login?sent=1');
}

'use server';

import { createClient } from '@supabase/supabase-js';
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
  // (Client supabase-js direct : le client @supabase/ssr impose le flux PKCE.)
  const sb = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  // Pas de création de compte depuis l’écran de connexion : la régie invite les utilisateurs.
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(safeNext)}` }
  });
  if (error) {
    const message =
      error.code === 'over_email_send_rate_limit' || error.status === 429
        ? 'Trop de liens demandés récemment. Réessayez dans une heure.'
        : 'Adresse inconnue ou envoi impossible. Demandez une invitation à la régie.';
    redirect(`/login?error=${encodeURIComponent(message)}`);
  }
  redirect('/login?sent=1');
}

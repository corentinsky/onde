import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Sans configuration Supabase, l’application tourne en mode démo. */
export const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/** Client lié à l’utilisateur connecté : la sécurité par ligne s’applique. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Appel depuis un composant serveur : le middleware rafraîchit la session.
        }
      }
    }
  });
}

/** Client de service, réservé aux routes serveur des lecteurs. Contourne la sécurité par ligne. */
export function supabaseService() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquant');
  return createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

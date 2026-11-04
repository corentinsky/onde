'use client';

import { createBrowserClient } from '@supabase/ssr';

export const browserConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

let client: ReturnType<typeof createBrowserClient> | null = null;
/** Client navigateur, avec la session de l’utilisateur (la sécurité par ligne s’applique). */
export function browserClient() {
  client ??= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return client;
}

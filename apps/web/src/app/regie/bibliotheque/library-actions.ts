'use server';

import { hostUrl, libraryHost, LIBRARY_NAME } from '@/lib/library';
import { isConfigured, supabaseServer } from '@/lib/supabase/server';

export type UploadTarget = { kind: 'emitter'; path: string; url: string } | { kind: 'supabase'; path: string };

async function admin() {
  if (!isConfigured) throw new Error('Supabase n’est pas configuré');
  const sb = await supabaseServer();
  const { data: ok } = await sb.rpc('is_platform_admin');
  if (!ok) throw new Error('Réservé à la régie');
  return sb;
}

/**
 * Où déposer un titre : sur le serveur de l’émetteur s’il garde la bibliothèque et répond,
 * sinon dans le stockage Supabase. Le lien de dépôt est signé et valable 30 minutes.
 */
export async function prepareUpload(ext: string): Promise<UploadTarget> {
  const sb = await admin();
  const clean = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
  const path = `${crypto.randomUUID()}.${clean}`;
  const host = await libraryHost(sb);
  if (host?.online && LIBRARY_NAME.test(path)) return { kind: 'emitter', path, url: hostUrl(host, 'PUT', path, 30 * 60) };
  return { kind: 'supabase', path };
}

/** Retire un fichier déposé sur le serveur dont le titre n’a pas pu être enregistré. */
export async function discardUpload(path: string): Promise<void> {
  const sb = await admin();
  const host = await libraryHost(sb);
  if (!host || !LIBRARY_NAME.test(path)) return;
  await fetch(hostUrl(host, 'DELETE', path, 300), { method: 'DELETE', signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}

import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EMITTER_ONLINE_MS, playableAddress } from './stream';

/**
 * Bibliothèque musicale : les titres sont rangés soit dans le stockage Supabase (historique),
 * soit sur le disque du serveur de l’émetteur (« emitter » : place et trafic illimités).
 * Sur l’émetteur, chaque accès passe par un lien signé qui expire : nginx vérifie
 * md5(<expiration><méthode><chemin> <secret>), le secret étant l’empreinte de la clé de l’émetteur,
 * connue des deux côtés sans jamais circuler.
 */
export type TrackLocation = 'supabase' | 'emitter';
export interface LocatedTrack {
  storage_path: string;
  location?: string | null;
}
export interface LibraryHost {
  id: string;
  base: string;
  secret: string;
  online: boolean;
}

/** Nom de fichier accepté sur le serveur : identifiant + extension audio. */
export const LIBRARY_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp3|m4a|aac|wav|flac|ogg|opus|aif|aiff)$/;

/** L’émetteur qui garde la bibliothèque : le plus récemment vu, joignable en HTTPS. */
export async function libraryHost(sb: SupabaseClient): Promise<LibraryHost | null> {
  const { data } = await sb
    .from('emitters')
    .select('id, public_url, last_seen_at, token_hash')
    .eq('serves_library', true)
    .not('public_url', 'is', null)
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .limit(5);
  const e = (data ?? []).find((x) => playableAddress(x.public_url as string));
  if (!e) return null;
  return {
    id: e.id as string,
    base: (e.public_url as string).replace(/\/+$/, ''),
    secret: e.token_hash as string,
    online: Boolean(e.last_seen_at) && Date.now() - Date.parse(e.last_seen_at as string) < EMITTER_ONLINE_MS
  };
}

/** Lien signé vers un fichier de la bibliothèque du serveur. */
export function hostUrl(host: LibraryHost, method: 'GET' | 'PUT' | 'DELETE', name: string, ttlSec: number): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSec;
  const uri = `/titres/${name}`;
  const sig = createHash('md5').update(`${expires}${method}${uri} ${host.secret}`).digest('base64url');
  return `${host.base}${uri}?s=${sig}&e=${expires}`;
}

/** Liens de lecture des titres, par chemin de fichier (absents si le fichier est injoignable). */
export async function trackUrls(sb: SupabaseClient, tracks: LocatedTrack[], ttlSec: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const onSupabase = tracks.filter((t) => t.location !== 'emitter').map((t) => t.storage_path);
  const onHost = tracks.filter((t) => t.location === 'emitter').map((t) => t.storage_path);
  for (let i = 0; i < onSupabase.length; i += 500) {
    const { data } = await sb.storage.from('music').createSignedUrls(onSupabase.slice(i, i + 500), ttlSec);
    for (const s of data ?? []) if (s.path && s.signedUrl) out.set(s.path, s.signedUrl);
  }
  if (onHost.length) {
    const host = await libraryHost(sb);
    if (host) for (const p of onHost) out.set(p, hostUrl(host, 'GET', p, ttlSec));
  }
  return out;
}

/** Lien de lecture d’un titre. */
export async function trackUrl(sb: SupabaseClient, t: LocatedTrack, ttlSec: number): Promise<string | null> {
  return (await trackUrls(sb, [t], ttlSec)).get(t.storage_path) ?? null;
}

/** Efface le fichier d’un titre, où qu’il soit. Une erreur n’empêche pas la suppression du titre. */
export async function removeTrackFile(sb: SupabaseClient, t: LocatedTrack): Promise<void> {
  if (t.location === 'emitter') {
    const host = await libraryHost(sb);
    if (host && LIBRARY_NAME.test(t.storage_path)) {
      await fetch(hostUrl(host, 'DELETE', t.storage_path, 300), { method: 'DELETE', signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    }
    return;
  }
  await sb.storage.from('music').remove([t.storage_path]);
}

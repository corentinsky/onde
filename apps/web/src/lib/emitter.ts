import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { deny, sha256 } from './device';
import { isConfigured, supabaseService } from './supabase/server';

/** Authentifie l’émetteur par sa clé (Authorization: Bearer …) et note son passage. */
export async function authEmitter(req: NextRequest): Promise<{ id: string } | NextResponse> {
  if (!isConfigured || !process.env.SUPABASE_SERVICE_ROLE_KEY) return deny(503, 'Serveur non configuré');
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return deny(401, 'Clé manquante');
  const sb = supabaseService();
  const { data, error } = await sb.from('emitters').select('id').eq('token_hash', sha256(token)).maybeSingle();
  if (error) return deny(500, 'Erreur serveur');
  if (!data) return deny(401, 'Émetteur inconnu');
  await sb.from('emitters').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id);
  return { id: data.id as string };
}

export const text = (body: string, status = 200) => new NextResponse(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

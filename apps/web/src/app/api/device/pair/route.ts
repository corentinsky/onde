import { NextResponse, type NextRequest } from 'next/server';
import { deny, newToken, sha256 } from '@/lib/device';
import { isConfigured, supabaseService } from '@/lib/supabase/server';

/** Appairage : le lecteur envoie le code affiché à l’installation et reçoit son jeton (une seule fois). */
export async function POST(req: NextRequest) {
  if (!isConfigured) return deny(503, 'Serveur non configuré');
  const body = (await req.json().catch(() => ({}))) as { code?: string; app_version?: string };
  const code = String(body.code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6,10}$/.test(code)) return deny(400, 'Code invalide');
  const sb = supabaseService();
  const token = newToken();
  const { data, error } = await sb
    .from('devices')
    .update({ token_hash: sha256(token), pairing_code: null, app_version: body.app_version ?? null, last_seen_at: new Date().toISOString() })
    .eq('pairing_code', code)
    .select('id, store_id')
    .maybeSingle();
  if (error) return deny(500, 'Erreur serveur');
  if (!data) return deny(404, 'Code inconnu ou déjà utilisé');
  return NextResponse.json({ token, device_id: data.id, store_id: data.store_id });
}

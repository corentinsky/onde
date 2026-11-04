import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { isConfigured, supabaseService } from './supabase/server';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export interface DeviceCtx {
  deviceId: string;
  storeId: string;
  orgId: string;
  regionId: string | null;
}

export function deny(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

/** Authentifie un lecteur par son jeton (en-tête Authorization: Bearer …). */
export async function authDevice(req: NextRequest): Promise<DeviceCtx | NextResponse> {
  if (!isConfigured || !process.env.SUPABASE_SERVICE_ROLE_KEY) return deny(503, 'Serveur non configuré');
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return deny(401, 'Jeton manquant');
  const sb = supabaseService();
  const { data, error } = await sb
    .from('devices')
    .select('id, store_id, stores(org_id, region_id)')
    .eq('token_hash', sha256(token))
    .maybeSingle();
  if (error) return deny(500, 'Erreur serveur');
  if (!data) return deny(401, 'Lecteur inconnu');
  const store = data.stores as unknown as { org_id: string; region_id: string | null };
  return { deviceId: data.id, storeId: data.store_id, orgId: store.org_id, regionId: store.region_id };
}

type SB = ReturnType<typeof supabaseService>;

/** Flux de la boutique : ambiance de la première zone, sinon première ambiance de l’enseigne. */
export async function storeStream(sb: SB, orgId: string, storeId: string): Promise<{ name: string; station: string | null; url: string | null } | null> {
  const { data: zone } = await sb.from('zones').select('ambiences(name, azuracast_station, stream_url)').eq('store_id', storeId).not('ambience_id', 'is', null).limit(1).maybeSingle();
  const fromZone = zone?.ambiences as unknown as { name: string; azuracast_station: string | null; stream_url: string | null } | null;
  if (fromZone) return { name: fromZone.name, station: fromZone.azuracast_station, url: fromZone.stream_url };
  const { data: amb } = await sb.from('ambiences').select('name, azuracast_station, stream_url').eq('org_id', orgId).order('name').limit(1).maybeSingle();
  return amb ? { name: amb.name, station: amb.azuracast_station, url: amb.stream_url } : null;
}

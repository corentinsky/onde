import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { authEmitter, text } from '@/lib/emitter';
import { ensureStreams } from '@/lib/stream';
import { supabaseService } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Flux à diffuser, une ligne par enseigne : « <enseigne> <point de montage> <nom> ».
 * Première ligne : « version <empreinte> » ; l’émetteur redémarre quand elle change.
 * Appelé toutes les minutes : sert aussi de signal de vie et donne l’adresse publique des flux.
 */
export async function GET(req: NextRequest) {
  const auth = await authEmitter(req);
  if (auth instanceof NextResponse) return auth;
  const sb = supabaseService();
  const publicUrl = req.nextUrl.searchParams.get('public_url');
  if (publicUrl && /^https?:\/\/[^\s]+$/.test(publicUrl)) await sb.from('emitters').update({ public_url: publicUrl.slice(0, 300) }).eq('id', auth.id);
  try {
    const streams = await ensureStreams(sb);
    const lines = streams.map((s) => `${s.org_id} ${s.mount} ${s.name.replace(/\s+/g, ' ')}`);
    const version = createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 12);
    return text([`version ${version}`, ...lines].join('\n') + '\n');
  } catch {
    return text('', 500);
  }
}

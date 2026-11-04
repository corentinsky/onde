import { NextResponse, type NextRequest } from 'next/server';
import { authEmitter, text } from '@/lib/emitter';
import { nextForStream } from '@/lib/stream';
import { supabaseService } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Titre suivant du flux d’une enseigne, en requête annotée Liquidsoap (204 si rien à jouer). */
export async function GET(req: NextRequest) {
  const auth = await authEmitter(req);
  if (auth instanceof NextResponse) return auth;
  const org = req.nextUrl.searchParams.get('org') ?? '';
  if (!UUID.test(org)) return text('', 400);
  try {
    const line = await nextForStream(supabaseService(), org);
    return line ? text(line) : text('', 204);
  } catch {
    return text('', 500);
  }
}

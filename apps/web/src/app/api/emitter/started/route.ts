import { NextResponse, type NextRequest } from 'next/server';
import { authEmitter, text } from '@/lib/emitter';
import { supabaseService } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** L’émetteur vient de lancer ce titre : heure réelle de début (titre en cours, historique). */
export async function POST(req: NextRequest) {
  const auth = await authEmitter(req);
  if (auth instanceof NextResponse) return auth;
  const play = req.nextUrl.searchParams.get('play') ?? '';
  if (!UUID.test(play)) return text('', 400);
  const { error } = await supabaseService().from('stream_plays').update({ started_at: new Date().toISOString() }).eq('id', play).is('started_at', null);
  return text(error ? '' : 'ok', error ? 500 : 200);
}

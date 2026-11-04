import { NextResponse, type NextRequest } from 'next/server';
import { azuracastConfigured, nowPlaying } from '@/lib/azuracast';
import { authDevice, storeStream } from '@/lib/device';
import { supabaseService } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Titre en cours sur le flux de la boutique et temps restant. */
export async function GET(req: NextRequest) {
  const ctx = await authDevice(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!azuracastConfigured) return NextResponse.json({ now_playing: null, reason: 'azuracast_not_configured' });
  const stream = await storeStream(supabaseService(), ctx.orgId, ctx.storeId);
  if (!stream?.station) return NextResponse.json({ now_playing: null, reason: 'no_station' });
  try {
    return NextResponse.json({ now_playing: await nowPlaying(stream.station) });
  } catch {
    return NextResponse.json({ now_playing: null, reason: 'azuracast_unreachable' });
  }
}

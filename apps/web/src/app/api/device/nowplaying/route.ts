import { NextResponse, type NextRequest } from 'next/server';
import { azuracastConfigured, nowPlaying } from '@/lib/azuracast';
import { authDevice, storeStream } from '@/lib/device';
import { ondeStreamUrl, streamPlays } from '@/lib/stream';
import { supabaseService } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Titre en cours sur le flux de la boutique et temps avant l’enchaînement suivant (horloge de l’émetteur).
 * Flux Onde : aussi les titres récents et à venir, pour repérer chaque changement de titre.
 */
export async function GET(req: NextRequest) {
  const ctx = await authDevice(req);
  if (ctx instanceof NextResponse) return ctx;
  const sb = supabaseService();
  if (await ondeStreamUrl(sb, ctx.orgId)) {
    const plays = await streamPlays(sb, ctx.orgId, 8);
    const cur = plays.find((p) => p.started_at);
    const now_playing = cur
      ? {
          title: cur.title,
          artist: cur.artist,
          remaining: Math.max(0, (Date.parse(cur.started_at as string) + (cur.duration_sec - cur.cross_sec) * 1000 - Date.now()) / 1000)
        }
      : null;
    return NextResponse.json({ source: 'onde', now_playing, plays });
  }
  if (!azuracastConfigured) return NextResponse.json({ now_playing: null, reason: 'azuracast_not_configured' });
  const stream = await storeStream(sb, ctx.orgId, ctx.storeId);
  if (!stream?.station) return NextResponse.json({ now_playing: null, reason: 'no_station' });
  try {
    return NextResponse.json({ source: 'azuracast', now_playing: await nowPlaying(stream.station) });
  } catch {
    return NextResponse.json({ now_playing: null, reason: 'azuracast_unreachable' });
  }
}

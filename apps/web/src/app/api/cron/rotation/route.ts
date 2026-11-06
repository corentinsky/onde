import { NextResponse, type NextRequest } from 'next/server';
import { runDueRotations } from '@/lib/rotation';
import { isConfigured, supabaseService } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Tâche planifiée (vercel.json, chaque matin) : renouvelle les listes dont la rotation est due.
 * Sans effet si rien n’est dû ; avec CRON_SECRET défini, seul Vercel peut la lancer.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  if (!isConfigured || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Serveur non configuré' }, { status: 503 });
  try {
    const done = await runDueRotations(supabaseService());
    return NextResponse.json({ ok: true, rotations: done });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 });
  }
}

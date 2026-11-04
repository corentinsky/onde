import type { Metadata, Viewport } from 'next';
import { isConfigured } from '@/lib/supabase/server';
import { Player } from './Player';

export const metadata: Metadata = {
  title: 'Lecteur',
  manifest: '/lecteur.webmanifest',
  appleWebApp: { capable: true, title: 'Onde', statusBarStyle: 'black-translucent' }
};
export const viewport: Viewport = { themeColor: '#000000', width: 'device-width', initialScale: 1, viewportFit: 'cover' };
export const dynamic = 'force-dynamic';

export default async function LecteurPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  return <Player demo={!isConfigured || demo === '1'} />;
}

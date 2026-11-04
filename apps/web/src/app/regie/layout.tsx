import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { getSession, listSpots } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function RegieLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session.mode === 'live' && !session.userEmail) redirect('/login');

  const pending = session.org ? (await listSpots(session.org.id, { pendingOnly: true })).length : 0;
  const role = session.isPlatformAdmin ? 'Régie · administrateur' : 'Siège';

  return (
    <>
      {session.mode === 'demo' && (
        <div className="banner" role="status">
          Mode démo : Supabase n’est pas encore branché, les données sont fictives et rien n’est enregistré.
        </div>
      )}
      <div className="app">
        <Sidebar orgs={session.orgs} orgId={session.org?.id ?? null} pending={pending} userName={session.userName} role={role} />
        <main className="main">
          {session.org ? (
            children
          ) : (
            <div className="card empty">
              <h2>Aucune enseigne</h2>
              <p className="sub">Votre compte n’est rattaché à aucune enseigne. Demandez à la régie de vous ajouter.</p>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

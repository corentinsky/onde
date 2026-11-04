import { redirect } from 'next/navigation';
import { isConfigured } from '@/lib/supabase/server';
import { sendLink } from './actions';

export const metadata = { title: 'Connexion' };
export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string; next?: string }> }) {
  if (!isConfigured) redirect('/regie');
  const { sent, error, next } = await searchParams;
  return (
    <div className="auth">
      <div className="card">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M3 12h2M7 8v8M11 4v16M15 8v8M19 10v4" /></svg>
          </div>
          <div className="brand-name">Onde</div>
        </div>
        <h1 style={{ fontSize: 28, marginTop: 24 }}>Connexion</h1>
        {sent ? (
          <p className="lead">Un lien de connexion vient de partir. Ouvrez-le depuis cet appareil.</p>
        ) : (
          <form action={sendLink} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 20 }}>
            <input type="hidden" name="next" value={next ?? '/regie'} />
            <label className="field">
              <span>Adresse e-mail professionnelle</span>
              <input className="input" type="email" name="email" required autoComplete="email" />
            </label>
            {error && <div className="notice" role="alert">{error}</div>}
            <button className="btn btn-primary" type="submit">Recevoir un lien</button>
          </form>
        )}
      </div>
    </div>
  );
}

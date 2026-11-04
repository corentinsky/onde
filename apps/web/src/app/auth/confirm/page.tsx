'use client';

/**
 * Arrivée depuis le lien de connexion reçu par e-mail.
 * Le lien porte la session dans l’adresse (#access_token…) : ça marche même si
 * l’e-mail est ouvert sur un autre appareil que celui qui a demandé le lien.
 */
import { createBrowserClient } from '@supabase/ssr';
import { useEffect, useState } from 'react';

export default function Confirm() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const next = query.get('next') ?? '/regie';
    const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/regie';

    const err = hash.get('error_description') ?? query.get('error_description');
    if (err) {
      setError(hash.get('error_code') === 'otp_expired' ? 'Ce lien a expiré ou a déjà servi. Demandez-en un nouveau.' : err);
      return;
    }
    const access_token = hash.get('access_token');
    const refresh_token = hash.get('refresh_token');
    if (!access_token || !refresh_token) {
      setError(query.get('code') ? 'Ce lien a été émis par une ancienne version. Demandez-en un nouveau.' : 'Lien incomplet. Demandez-en un nouveau.');
      return;
    }
    // On retire les jetons de l’adresse avant tout (historique, et pour que le client ne tente pas de les relire).
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    sb.auth.setSession({ access_token, refresh_token }).then(({ error: e }) => {
      if (e) setError('Connexion impossible. Demandez un nouveau lien.');
      else window.location.replace(safeNext);
    });
  }, []);

  return (
    <div className="auth">
      <div className="card">
        <h1 style={{ fontSize: 26 }}>{error ? 'Connexion impossible' : 'Connexion…'}</h1>
        {error ? (
          <>
            <p className="lead">{error}</p>
            <a className="btn btn-primary" href="/login" style={{ marginTop: 18 }}>Recevoir un nouveau lien</a>
          </>
        ) : (
          <p className="lead">Ouverture de votre session.</p>
        )}
      </div>
    </div>
  );
}

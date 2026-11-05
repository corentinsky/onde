'use client';

import { useActionState, useState } from 'react';
import { createEmitterKey } from '../emetteur-actions';

/** Création d’une clé : affichée une seule fois, avec la commande d’installation prête à coller. */
export function CreateKey({ base }: { base: string }) {
  const [state, action, pending] = useActionState(createEmitterKey, null);
  const [copied, setCopied] = useState(false);
  const command = state?.key ? `curl -fsSL ${base}/emetteur/install.sh | ONDE_URL=${base} ONDE_CLE=${state.key} sh` : '';

  if (state?.key) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="notice">Clé créée. Copiez la commande maintenant : la clé ne sera plus affichée.</div>
        <pre className="code" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, padding: 14, borderRadius: 12, background: '#1d1d1f', color: '#f5f5f7', fontSize: 13 }}>{command}</pre>
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={async () => {
              await navigator.clipboard.writeText(command);
              setCopied(true);
            }}
          >
            {copied ? 'Copiée' : 'Copier la commande'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="actions" style={{ alignItems: 'end' }}>
      <label className="field" style={{ minWidth: 240 }}>
        <span>Nom de l’émetteur</span>
        <input className="input" name="name" placeholder="Serveur principal" />
      </label>
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Création…' : 'Créer une clé'}</button>
      {state?.error && <span className="small" style={{ color: 'var(--danger)' }}>{state.error}</span>}
    </form>
  );
}

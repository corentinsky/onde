'use client';

import { useEffect, useState } from 'react';
import { addTracksToList } from '../musique-actions';

const BOXES = 'input[form="selection"][name="track_id"]';

/**
 * Barre de sélection de la bibliothèque : les cases des titres (attribut form="selection") sont envoyées
 * avec la liste choisie. « Tous les résultats » couvre aussi les pages suivantes de la recherche.
 */
export function SelectionBar({ lists, shown, total, q, filtre }: { lists: { id: string; label: string }[]; shown: number; total: number; q: string; filtre: string }) {
  const [count, setCount] = useState(0);
  const [all, setAll] = useState(false);

  useEffect(() => {
    const update = () => {
      const n = document.querySelectorAll(`${BOXES}:checked`).length;
      setCount(n);
      if (n < shown) setAll(false);
    };
    document.addEventListener('change', update);
    update();
    return () => document.removeEventListener('change', update);
  }, [shown]);

  const toggleAll = (on: boolean) => {
    document.querySelectorAll<HTMLInputElement>(BOXES).forEach((c) => (c.checked = on));
    setCount(on ? shown : 0);
    if (!on) setAll(false);
  };
  const selected = all ? total : count;

  return (
    <form id="selection" action={addTracksToList} className="actions" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 12, margin: '4px 0 12px' }}>
      <input type="hidden" name="q" value={q} />
      <input type="hidden" name="filtre" value={filtre} />
      <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={shown > 0 && count === shown} onChange={(e) => toggleAll(e.target.checked)} disabled={shown === 0} />
        Tout cocher sur la page
      </label>
      {shown > 0 && count === shown && total > shown && (
        <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" name="all" value="1" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Les {total} résultats
        </label>
      )}
      <span className="small muted">{selected ? `${selected} titre${selected > 1 ? 's' : ''} sélectionné${selected > 1 ? 's' : ''}` : 'Cochez des titres'}</span>
      <select className="select" name="playlist_id" required defaultValue="" style={{ width: 'auto', minWidth: 220 }} aria-label="Liste de destination">
        <option value="" disabled>Choisir une liste…</option>
        {lists.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
      <button className="btn btn-primary btn-small" type="submit" disabled={!selected || lists.length === 0}>Ajouter à la liste</button>
    </form>
  );
}

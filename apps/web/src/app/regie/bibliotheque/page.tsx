import Link from 'next/link';
import { plural } from '@/lib/format';
import { gainFor } from '@onde/audio';
import { getSession } from '@/lib/data';
import { PAGE_SIZE, libraryStats, listAmbiences, listPlaylists, listTracks, mmss, warningLabel } from '@/lib/music';
import { isConfigured } from '@/lib/supabase/server';
import { SelectionBar } from './SelectionBar';
import { Uploader } from './Uploader';

export const metadata = { title: 'Bibliothèque' };

export default async function Bibliotheque({ searchParams }: { searchParams: Promise<{ q?: string; filtre?: string; page?: string; ajoutes?: string; liste?: string }> }) {
  const { q = '', filtre, page: pageParam, ajoutes, liste } = await searchParams;
  const { org } = await getSession();
  if (!org) return null;
  const page = Math.max(0, (Number(pageParam) || 1) - 1);
  const [{ rows: shown, total }, stats, ambiences, playlists] = await Promise.all([
    listTracks({ q, warningsOnly: filtre === 'verifier', page }),
    libraryStats(),
    listAmbiences(org.id),
    listPlaylists(org.id)
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (n: number) => `/regie/bibliotheque?${new URLSearchParams({ ...(q ? { q } : {}), ...(filtre ? { filtre } : {}), page: String(n) })}`;
  const ambName = new Map(ambiences.map((a) => [a.id, a.name]));
  const inPlaylists = new Map<string, string[]>();
  for (const p of playlists) for (const t of p.track_ids) inPlaylists.set(t, [...(inPlaylists.get(t) ?? []), `${ambName.get(p.ambience_id) ?? ''} · ${p.name}`]);
  const totalMin = Math.round(stats.usefulSec / 60);
  const listOptions = playlists.map((p) => ({ id: p.id, label: `${ambName.get(p.ambience_id) ?? ''} · ${p.name}` }));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Commune à toutes les enseignes · {plural(stats.count, 'titre')} · {Math.floor(totalMin / 60)} h {String(totalMin % 60).padStart(2, '0')}</div>
          <h1>Bibliothèque</h1>
          <p className="lead">Déposez vos fichiers. Onde mesure le volume, repère le début et la fin de chaque titre et prépare les enchaînements. Vous ne corrigez que les exceptions.</p>
        </div>
      </div>

      {!isConfigured && <div className="notice">Mode démo : les morceaux sont analysés mais pas enregistrés.</div>}
      <Uploader playlists={listOptions} />

      <section className="card">
        <div className="page-head" style={{ alignItems: 'center' }}>
          <h2>Titres</h2>
          <div className="actions" style={{ alignItems: 'center' }}>
            <form>
              {filtre && <input type="hidden" name="filtre" value={filtre} />}
              <input className="input" name="q" defaultValue={q} placeholder="Rechercher un titre ou un artiste" style={{ width: 260 }} aria-label="Rechercher" />
            </form>
            <div className="segmented" role="group" aria-label="Filtre">
              <Link href="/regie/bibliotheque" aria-current={filtre !== 'verifier' ? 'true' : undefined}>Tous ({stats.count})</Link>
              <Link href="/regie/bibliotheque?filtre=verifier" aria-current={filtre === 'verifier' ? 'true' : undefined}>À vérifier ({stats.toCheck})</Link>
            </div>
          </div>
        </div>
        {ajoutes && (
          <p className="tag" role="status" style={{ marginBottom: 12 }}>
            {Number(ajoutes) > 1 ? `${ajoutes} titres ajoutés` : '1 titre ajouté'}{liste ? ` à « ${liste} »` : ''} (déjà présents : ignorés)
          </p>
        )}
        <SelectionBar lists={listOptions} shown={shown.length} total={total} q={q} filtre={filtre ?? ''} />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th style={{ width: 32 }}><span className="visually-hidden">Choisir</span></th><th>Titre</th><th>Durée utile</th><th>Volume</th><th>Gain</th><th>Points de mix</th><th>Listes</th><th>État</th></tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={8} className="empty">{q ? 'Aucun titre ne correspond.' : filtre === 'verifier' ? 'Rien à vérifier.' : 'Aucun titre pour l’instant. Déposez vos premiers morceaux ci-dessus.'}</td></tr>}
              {shown.map((t) => (
                <tr key={t.id}>
                  <td><input type="checkbox" form="selection" name="track_id" value={t.id} aria-label={`Choisir ${t.title || t.file_name}`} /></td>
                  <td>
                    <Link href={`/regie/bibliotheque/${t.id}`} style={{ fontWeight: 500 }}>{t.title || t.file_name}</Link>
                    <div className="small muted">{t.artist || 'Artiste inconnu'}{t.album ? ` · ${t.album}` : ''}</div>
                  </td>
                  <td className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>{mmss(t.cue_out - t.cue_in, 0)}</td>
                  <td className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>{t.integrated_lufs ?? '—'} LUFS</td>
                  <td className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>{t.integrated_lufs != null ? `${gainFor(t.integrated_lufs, t.peak_dbfs ?? 0) > 0 ? '+' : ''}${gainFor(t.integrated_lufs, t.peak_dbfs ?? 0)} dB` : '—'}</td>
                  <td className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>{t.cue_in.toFixed(1)} → {t.cross_start.toFixed(1)} → {t.cue_out.toFixed(1)} s{t.manual_cues ? ' · manuel' : ''}</td>
                  <td className="small muted">{(inPlaylists.get(t.id) ?? ['Aucune']).join(', ')}</td>
                  <td>
                    {t.warnings.length ? (
                      <span className="status" style={{ color: 'var(--warn-text)' }}><span className="dot" style={{ background: 'var(--warn)' }} />{t.warnings.map((w) => warningLabel[w] ?? w).join(', ')}</span>
                    ) : (
                      <span className="status"><span className="dot" style={{ background: 'var(--ok)' }} />Analysé</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
            <span className="small muted">{q ? `${total} résultats · ` : ''}Page {page + 1} sur {pages}</span>
            <div className="actions">
              {page > 0 && <Link className="btn btn-secondary btn-small" href={link(page)}>Précédents</Link>}
              {page + 1 < pages && <Link className="btn btn-secondary btn-small" href={link(page + 2)}>Suivants</Link>}
            </div>
          </div>
        )}
      </section>
    </>
  );
}

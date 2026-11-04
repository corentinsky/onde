import Link from 'next/link';
import { gainFor } from '@onde/audio';
import { getSession } from '@/lib/data';
import { listAmbiences, listPlaylists, listTracks, mmss, warningLabel } from '@/lib/music';
import { isConfigured } from '@/lib/supabase/server';
import { Uploader } from './Uploader';

export const metadata = { title: 'Bibliothèque' };

export default async function Bibliotheque({ searchParams }: { searchParams: Promise<{ q?: string; filtre?: string }> }) {
  const { q = '', filtre } = await searchParams;
  const { org } = await getSession();
  if (!org) return null;
  const [tracks, ambiences, playlists] = await Promise.all([listTracks(q), listAmbiences(org.id), listPlaylists(org.id)]);
  const ambName = new Map(ambiences.map((a) => [a.id, a.name]));
  const inPlaylists = new Map<string, string[]>();
  for (const p of playlists) for (const t of p.track_ids) inPlaylists.set(t, [...(inPlaylists.get(t) ?? []), `${ambName.get(p.ambience_id) ?? ''} · ${p.name}`]);
  const toCheck = tracks.filter((t) => t.warnings.length > 0);
  const shown = filtre === 'verifier' ? toCheck : tracks;
  const totalMin = Math.round(tracks.reduce((a, t) => a + (t.cue_out - t.cue_in), 0) / 60);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Commune à toutes les enseignes · {tracks.length} titres · {Math.floor(totalMin / 60)} h {String(totalMin % 60).padStart(2, '0')}</div>
          <h1>Bibliothèque</h1>
          <p className="lead">Déposez vos fichiers. Onde mesure le volume, repère le début et la fin de chaque titre et prépare les enchaînements. Vous ne corrigez que les exceptions.</p>
        </div>
      </div>

      {!isConfigured && <div className="notice">Mode démo : les morceaux sont analysés mais pas enregistrés.</div>}
      <Uploader playlists={playlists.map((p) => ({ id: p.id, label: `${ambName.get(p.ambience_id) ?? ''} · ${p.name}` }))} />

      <section className="card">
        <div className="page-head" style={{ alignItems: 'center' }}>
          <h2>Titres</h2>
          <div className="actions" style={{ alignItems: 'center' }}>
            <form>
              <input className="input" name="q" defaultValue={q} placeholder="Rechercher un titre ou un artiste" style={{ width: 260 }} aria-label="Rechercher" />
            </form>
            <div className="segmented" role="group" aria-label="Filtre">
              <Link href="/regie/bibliotheque" aria-current={filtre !== 'verifier' ? 'true' : undefined}>Tous ({tracks.length})</Link>
              <Link href="/regie/bibliotheque?filtre=verifier" aria-current={filtre === 'verifier' ? 'true' : undefined}>À vérifier ({toCheck.length})</Link>
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Titre</th><th>Durée utile</th><th>Volume</th><th>Gain</th><th>Points de mix</th><th>Listes</th><th>État</th></tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={7} className="empty">{q ? 'Aucun titre ne correspond.' : 'Aucun titre pour l’instant. Déposez vos premiers morceaux ci-dessus.'}</td></tr>}
              {shown.map((t) => (
                <tr key={t.id}>
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
      </section>
    </>
  );
}

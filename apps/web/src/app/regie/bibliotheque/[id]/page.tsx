import Link from 'next/link';
import { notFound } from 'next/navigation';
import { gainFor } from '@onde/audio';
import { getTrack, mmss, warningLabel } from '@/lib/music';
import { deleteTrack, updateTrack } from '../../musique-actions';
import { CueEditor } from './CueEditor';

export const metadata = { title: 'Points de mix' };

export default async function TrackPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ enregistre?: string }> }) {
  const { id } = await params;
  const { enregistre } = await searchParams;
  const res = await getTrack(id);
  if (!res) notFound();
  const { track: t, url } = res;
  const gain = t.integrated_lufs != null ? gainFor(t.integrated_lufs, t.peak_dbfs ?? 0) : 0;

  return (
    <>
      <Link href="/regie/bibliotheque" className="small">← Bibliothèque</Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t.artist || 'Artiste inconnu'}{t.album ? ` · ${t.album}` : ''} · {t.file_name}</div>
          <h1>{t.title || t.file_name}</h1>
        </div>
        {enregistre && <span className="tag" role="status">Enregistré</span>}
      </div>

      <div className="kpis">
        <div className="kpi"><div className="kpi-label">Durée du fichier</div><div className="kpi-value" style={{ fontSize: 24 }}>{mmss(t.duration_sec)}</div><div className="small muted">Utile : {mmss(t.cue_out - t.cue_in)}</div></div>
        <div className="kpi"><div className="kpi-label">Volume intégré</div><div className="kpi-value" style={{ fontSize: 24 }}>{t.integrated_lufs ?? '—'} <small>LUFS</small></div><div className="small muted">Plage {t.loudness_range_lu ?? '—'} LU</div></div>
        <div className="kpi"><div className="kpi-label">Crête</div><div className="kpi-value" style={{ fontSize: 24 }}>{t.peak_dbfs ?? '—'} <small>dBFS</small></div><div className="small muted">Plafond appliqué : −1 dBFS</div></div>
        <div className="kpi"><div className="kpi-label">Gain en boutique</div><div className="kpi-value" style={{ fontSize: 24 }}>{gain > 0 ? '+' : ''}{gain} <small>dB</small></div><div className="small muted">Cible −18 LUFS</div></div>
      </div>

      {t.warnings.length > 0 && (
        <div className="notice">À vérifier : {t.warnings.map((w) => warningLabel[w] ?? w).join(', ')}.</div>
      )}

      <form action={updateTrack} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <input type="hidden" name="id" value={t.id} />
        <input type="hidden" name="duration_sec" value={t.duration_sec} />
        <section className="card">
          <h2>Points de mix</h2>
          <p className="sub">Faites glisser les repères, ou saisissez les valeurs au centième. Un réglage manuel n’est jamais écrasé par une nouvelle analyse.</p>
          <div style={{ marginTop: 16 }}>
            <CueEditor
              duration={t.duration_sec}
              waveform={t.waveform}
              initial={{ cueIn: t.cue_in, crossStart: t.cross_start, cueOut: t.cue_out, fadeIn: t.fade_in, fadeOut: t.fade_out }}
              integratedLufs={t.integrated_lufs}
              peakDbfs={t.peak_dbfs}
              audioUrl={url}
              targetLufs={-18}
            />
          </div>
        </section>

        <section className="card">
          <h2>Informations</h2>
          <div className="form-grid" style={{ marginTop: 14 }}>
            <label className="field"><span>Titre</span><input className="input" name="title" defaultValue={t.title} /></label>
            <label className="field"><span>Artiste</span><input className="input" name="artist" defaultValue={t.artist} /></label>
            <label className="field"><span>Album</span><input className="input" name="album" defaultValue={t.album} /></label>
            <label className="field"><span>Genre</span><input className="input" name="genre" defaultValue={t.genre} /></label>
            <label className="field"><span>ISRC (rapport de droits)</span><input className="input" name="isrc" defaultValue={t.isrc ?? ''} /></label>
          </div>
          <div className="switch-row" style={{ marginTop: 14 }}>
            <div><div>Titre actif</div><div className="small muted">Désactivé, il reste dans la bibliothèque mais ne passe plus.</div></div>
            <label className="switch"><input type="checkbox" name="enabled" defaultChecked={t.enabled} aria-label="Titre actif" /><span /></label>
          </div>
          <div className="actions" style={{ marginTop: 18 }}>
            <button className="btn btn-primary" type="submit">Enregistrer</button>
          </div>
        </section>
      </form>

      <form action={deleteTrack}>
        <input type="hidden" name="id" value={t.id} />
        <button className="btn btn-secondary btn-small" type="submit">Supprimer le titre de la bibliothèque</button>
      </form>
    </>
  );
}

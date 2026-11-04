import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession, getStore, listIncidents, listPlayLogs } from '@/lib/data';
import { ago, clock, hours, incidentLabel, originLabel, stateLabel } from '@/lib/format';
import { resolveIncident } from '../../actions';

export default async function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org } = await getSession();
  if (!org) return null;
  const store = await getStore(id);
  if (!store) notFound();
  const [logs, incidents] = await Promise.all([listPlayLogs(id), listIncidents(org.id, id)]);
  const played = logs.filter((l) => l.status === 'played').length;
  const missed = logs.length - played;

  return (
    <>
      <Link href="/regie/supervision" className="small">← Supervision</Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">{store.region ?? store.city} · {org.name}</div>
          <h1>{store.name}</h1>
          <div className="status" style={{ marginTop: 10, color: store.status === 'online' ? 'var(--ok-text)' : 'var(--muted)' }}>
            <span className="dot" style={{ background: stateLabel[store.status].color }} />
            {stateLabel[store.status].label} · dernier signal {ago(store.last_seen_at)}
          </div>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="kpi-label">Lecteur</div><div className="kpi-value" style={{ fontSize: 22 }}>Onde Box</div><div className="small muted">Version {store.app_version ?? '—'}</div></div>
        <div className="kpi"><div className="kpi-label">Musique en avance</div><div className="kpi-value" style={{ fontSize: 22 }}>{hours(store.cache_seconds)}</div><div className="small muted">Tient une coupure internet</div></div>
        <div className="kpi"><div className="kpi-label">Spots récents</div><div className="kpi-value" style={{ fontSize: 22 }}>{played} / {logs.length}</div><div className="small" style={{ color: missed ? 'var(--warn-text)' : 'var(--muted)' }}>{missed ? `${missed} non diffusé${missed > 1 ? 's' : ''}` : 'Tous diffusés'}</div></div>
        <div className="kpi"><div className="kpi-label">Sortie audio</div><div className="kpi-value" style={{ fontSize: 22 }}>{store.output_lufs == null ? '—' : `${store.output_lufs} LUFS`}</div><div className="small muted">Cible −18 LUFS</div></div>
      </div>

      <div className="row">
        <section className="card card-dark">
          <div className="sub">En ce moment</div>
          <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 8 }}>{store.now_playing?.title ?? 'Rien en lecture'}</div>
          <div className="muted" style={{ marginTop: 2 }}>{store.now_playing?.artist ?? ''}</div>
        </section>

        <section className="card">
          <h2>Incidents ouverts</h2>
          <div className="list">
            {incidents.length === 0 && <div className="empty">Aucun incident.</div>}
            {incidents.map((i) => (
              <div className="list-item" key={i.id}>
                <div>
                  <div style={{ fontWeight: 500 }}>{incidentLabel[i.kind]}</div>
                  <div className="small muted">{i.details} · {ago(i.started_at)}</div>
                </div>
                <form action={resolveIncident}>
                  <input type="hidden" name="id" value={i.id} />
                  <input type="hidden" name="from" value={`/regie/boutiques/${id}`} />
                  <button className="btn btn-secondary btn-small" type="submit">Résolu</button>
                </form>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <h2>Preuves de diffusion</h2>
        <p className="sub">Chaque spot joué, ou manqué, est enregistré par le lecteur.</p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Heure</th><th>Spot</th><th>Origine</th><th>Résultat</th></tr></thead>
            <tbody>
              {logs.length === 0 && <tr><td colSpan={4} className="empty">Aucune diffusion enregistrée.</td></tr>}
              {logs.map((l) => (
                <tr key={l.id}>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{clock(l.at)}</td>
                  <td>{l.spot_title}</td>
                  <td>{l.origin && <span className={`badge badge-${l.origin}`}>{originLabel[l.origin]}</span>}</td>
                  <td>
                    <span className="status" style={{ color: l.status === 'played' ? 'var(--text)' : 'var(--warn-text)' }}>
                      <span className="dot" style={{ background: l.status === 'played' ? 'var(--ok)' : 'var(--warn)' }} />
                      {l.status === 'played' ? 'Joué en entier' : l.reason === 'window' ? 'Hors fenêtre' : 'Non diffusé'}
                    </span>
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

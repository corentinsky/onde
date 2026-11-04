import Link from 'next/link';
import { getSession, listIncidents, listStoreStatus } from '@/lib/data';
import { ago, incidentLabel, stateLabel } from '@/lib/format';
import { resolveIncident } from '../actions';

export const metadata = { title: 'Supervision' };

const meterWidth = (lufs: number | null) => (lufs == null ? 0 : Math.max(0, Math.min(100, Math.round(((lufs + 40) / 35) * 100))));

export default async function Supervision() {
  const { org } = await getSession();
  if (!org) return null;
  const [stores, incidents] = await Promise.all([listStoreStatus(org.id), listIncidents(org.id)]);
  const online = stores.filter((s) => s.status === 'online').length;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{org.name}</div>
          <h1>Supervision</h1>
          <p className="lead">Chaque lecteur donne de ses nouvelles toutes les 30 secondes. Une boutique silencieuse ou injoignable apparaît ici.</p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="kpi-label">En ligne</div><div className="kpi-value">{online}<small> / {stores.length}</small></div></div>
        <div className="kpi"><div className="kpi-label">Alertes ouvertes</div><div className="kpi-value">{incidents.length}</div></div>
        <div className="kpi"><div className="kpi-label">Niveau cible</div><div className="kpi-value">−18<small> LUFS</small></div></div>
      </div>

      <section className="card">
        <h2>Alertes</h2>
        <div className="list">
          {incidents.length === 0 && <div className="empty">Aucune alerte. Tout le réseau joue normalement.</div>}
          {incidents.map((i) => (
            <div className="list-item" key={i.id} style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="status">
                  <span className="dot" style={{ background: i.kind === 'offline' ? 'var(--store)' : 'var(--warn)' }} />
                  <strong>{i.store_name}</strong>
                  <span className="small muted">{ago(i.started_at)}</span>
                </div>
                <div style={{ marginTop: 4 }}>{incidentLabel[i.kind]}</div>
                <div className="small muted">{i.details}</div>
              </div>
              <div className="actions">
                <Link className="btn btn-secondary btn-small" href={`/regie/boutiques/${i.store_id}`}>Fiche boutique</Link>
                <form action={resolveIncident}>
                  <input type="hidden" name="id" value={i.id} />
                  <input type="hidden" name="from" value="/regie/supervision" />
                  <button className="btn btn-primary btn-small" type="submit">Marquer résolu</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Boutiques</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Boutique</th><th>État</th><th>En cours</th><th style={{ width: '22%' }}>Niveau</th><th>Dernier signal</th></tr>
            </thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.store_id}>
                  <td>
                    <Link href={`/regie/boutiques/${s.store_id}`} style={{ fontWeight: 500 }}>{s.name}</Link>
                    <div className="small muted">{s.region ?? s.city}</div>
                  </td>
                  <td><span className="status"><span className="dot" style={{ background: stateLabel[s.status].color }} />{stateLabel[s.status].label}</span></td>
                  <td className="small">{s.now_playing?.title ? `${s.now_playing.title} · ${s.now_playing.artist ?? ''}` : '—'}</td>
                  <td>
                    <div className="meter" aria-label={s.output_lufs == null ? 'Pas de mesure' : `${s.output_lufs} LUFS`}>
                      <span style={{ width: `${meterWidth(s.output_lufs)}%`, background: (s.output_lufs ?? -99) > -12 ? 'var(--warn)' : s.status === 'online' ? 'var(--accent)' : 'var(--store)' }} />
                    </div>
                  </td>
                  <td className="small muted">{ago(s.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

import Link from 'next/link';
import { azuracastConfigured, nowPlayingAll, type NowPlaying } from '@/lib/azuracast';
import { getSession, listIncidents, listSpots, listStoreStatus } from '@/lib/data';
import { ago, incidentLabel } from '@/lib/format';

export const metadata = { title: 'Vue d’ensemble' };

async function streams(): Promise<{ ok: true; list: NowPlaying[] } | { ok: false; reason: string }> {
  if (!azuracastConfigured) return { ok: false, reason: 'AzuraCast n’est pas encore branché. Ajoutez AZURACAST_URL et AZURACAST_API_KEY.' };
  try {
    return { ok: true, list: await nowPlayingAll() };
  } catch (e) {
    return { ok: false, reason: `AzuraCast ne répond pas (${(e as Error).message}).` };
  }
}

export default async function Overview() {
  const { org } = await getSession();
  if (!org) return null;
  const [stores, incidents, pending, spots, az] = await Promise.all([
    listStoreStatus(org.id),
    listIncidents(org.id),
    listSpots(org.id, { pendingOnly: true }),
    listSpots(org.id),
    streams()
  ]);
  const online = stores.filter((s) => s.status === 'online').length;
  const active = spots.filter((s) => s.status === 'approved' && s.origin !== 'store').length;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{org.name} · {stores.length} boutiques</div>
          <h1>Vue d’ensemble</h1>
        </div>
        <Link className="btn btn-primary" href="/regie/spots#nouveau">Nouveau spot national</Link>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="kpi-label">Boutiques en ligne</div><div className="kpi-value">{online}<small> / {stores.length}</small></div></div>
        <div className="kpi"><div className="kpi-label">Alertes ouvertes</div><div className="kpi-value">{incidents.length}</div></div>
        <div className="kpi"><div className="kpi-label">Messages à valider</div><div className="kpi-value">{pending.length}</div></div>
        <div className="kpi"><div className="kpi-label">Spots nationaux actifs</div><div className="kpi-value">{active}</div></div>
      </div>

      <section className="card card-dark" aria-label="Flux à l’antenne">
        <div className="sub">À l’antenne</div>
        {az.ok ? (
          <div className="list">
            {az.list.map((s) => (
              <div className="list-item" key={s.station.id} style={{ borderColor: '#3a3a3c' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.station.name}</div>
                  <div className="small muted">
                    {s.now_playing ? `${s.now_playing.song.title} · ${s.now_playing.song.artist}` : 'Silence'}
                  </div>
                </div>
                <div className="small muted">{s.listeners.current} boutiques à l’écoute</div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: '10px 0 0', fontSize: 15 }}>{az.reason}</p>
        )}
      </section>

      <div className="row">
        <section className="card">
          <div className="page-head" style={{ alignItems: 'baseline' }}>
            <h2>Alertes</h2>
            <Link href="/regie/supervision" className="small">Supervision</Link>
          </div>
          <div className="list">
            {incidents.length === 0 && <div className="empty">Tout va bien.</div>}
            {incidents.slice(0, 4).map((i) => (
              <div className="list-item" key={i.id}>
                <div>
                  <div style={{ fontWeight: 600 }}>{i.store_name}</div>
                  <div className="small muted">{incidentLabel[i.kind]} · {ago(i.started_at)}</div>
                </div>
                <Link className="btn btn-secondary btn-small" href={`/regie/boutiques/${i.store_id}`}>Voir</Link>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="page-head" style={{ alignItems: 'baseline' }}>
            <h2>Messages à valider</h2>
            <Link href="/regie/messages" className="small">Tout voir</Link>
          </div>
          <div className="list">
            {pending.length === 0 && <div className="empty">Aucun message en attente.</div>}
            {pending.slice(0, 4).map((m) => (
              <div className="list-item" key={m.id}>
                <div>
                  <div style={{ fontWeight: 600 }}>{m.title}</div>
                  <div className="small muted">{m.target} · {ago(m.created_at)}</div>
                </div>
                <span className="tag">{m.duration_sec} s</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

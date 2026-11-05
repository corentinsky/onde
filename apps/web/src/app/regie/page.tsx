import Link from 'next/link';
import { getSession, listIncidents, listSpots, listStoreStatus } from '@/lib/data';
import { ago, incidentLabel, spotState, plural } from '@/lib/format';
import { EMITTER_ONLINE_MS } from '@/lib/stream';
import { isConfigured, supabaseService } from '@/lib/supabase/server';

export const metadata = { title: 'Vue d’ensemble' };

/** Flux de l’enseigne : émetteur en service, titre en cours. */
async function antenne(orgId: string) {
  if (!isConfigured || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { live: false, installed: false, current: null, next: null };
  const sb = supabaseService();
  const [{ data: emitters }, { data: stream }, { data: plays }] = await Promise.all([
    sb.from('emitters').select('last_seen_at, public_url'),
    sb.from('streams').select('enabled').eq('org_id', orgId).maybeSingle(),
    sb.from('stream_plays').select('title, artist, started_at, queued_at').eq('org_id', orgId).order('queued_at', { ascending: false }).limit(3)
  ]);
  const live = (emitters ?? []).some((e) => e.last_seen_at && Date.now() - Date.parse(e.last_seen_at) < EMITTER_ONLINE_MS) && stream?.enabled !== false;
  return {
    live,
    installed: (emitters ?? []).length > 0,
    current: (plays ?? []).find((p) => p.started_at) ?? null,
    next: (plays ?? []).find((p) => !p.started_at) ?? null
  };
}

export default async function Overview() {
  const { org } = await getSession();
  if (!org) return null;
  const [stores, incidents, pending, spots, air] = await Promise.all([
    listStoreStatus(org.id),
    listIncidents(org.id),
    listSpots(org.id, { pendingOnly: true }),
    listSpots(org.id),
    antenne(org.id)
  ]);
  const online = stores.filter((s) => s.status === 'online').length;
  const active = spots.filter((s) => spotState(s).live && s.origin !== 'store').length;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{org.name} · {plural(stores.length, 'boutique')}</div>
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
        <div className="page-head" style={{ alignItems: 'center' }}>
          <div>
            <div className="status sub">
              <span className="dot" style={{ background: air.live ? 'var(--ok)' : 'var(--warn)' }} />
              {air.live ? `Flux ${org.name} en direct` : air.installed ? 'Émetteur hors service' : 'Émetteur pas encore installé'}
            </div>
            {air.live && air.current ? (
              <>
                <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 6 }}>{air.current.title}</div>
                <div className="small muted" style={{ marginTop: 4 }}>
                  {air.current.artist}
                  {air.next ? ` · ensuite : ${air.next.title}` : ''}
                </div>
              </>
            ) : (
              <div className="small muted" style={{ marginTop: 6 }}>
                {air.live ? 'Le premier titre arrive.' : `Les boutiques jouent la musique de la bibliothèque gardée en mémoire, avec les mêmes règles et leurs propres spots. ${online} lecteur${online > 1 ? 's' : ''} en ligne.`}
              </div>
            )}
          </div>
          <Link className="btn btn-secondary btn-small" href="/regie/emetteur">{air.installed ? 'Émetteur' : 'Installer l’émetteur'}</Link>
        </div>
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

import { getSession, listSpots } from '@/lib/data';
import { ago } from '@/lib/format';
import { reviewSpot } from '../actions';

export const metadata = { title: 'Messages boutiques' };

export default async function Messages() {
  const { org } = await getSession();
  if (!org) return null;
  const pending = await listSpots(org.id, { pendingOnly: true });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{org.name}</div>
          <h1>Messages boutiques</h1>
          <p className="lead">Les boutiques proposent, la régie valide. Un message validé passe au prochain écran de la boutique concernée.</p>
        </div>
      </div>

      <section className="card">
        <h2>À valider</h2>
        <div className="list">
          {pending.length === 0 && <div className="empty">Aucun message en attente.</div>}
          {pending.map((m) => (
            <div className="list-item" key={m.id} style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div className="status"><span className="badge badge-store">Boutique</span><strong>{m.target}</strong><span className="small muted">{ago(m.created_at)}</span></div>
                <div style={{ fontWeight: 600, marginTop: 8 }}>{m.title}</div>
                <p style={{ margin: '6px 0 0', padding: '12px 14px', borderRadius: 12, background: 'var(--bg)' }}>{m.script || '—'}</p>
                <div className="small muted" style={{ marginTop: 6 }}>{m.duration_sec} s</div>
              </div>
              <div className="actions" style={{ flex: '0 0 auto' }}>
                <form action={reviewSpot}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="decision" value="reject" />
                  <button className="btn btn-secondary btn-small" type="submit">Refuser</button>
                </form>
                <form action={reviewSpot}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button className="btn btn-primary btn-small" type="submit">Valider</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

import { headers } from 'next/headers';
import { getSession } from '@/lib/data';
import { EMITTER_ONLINE_MS } from '@/lib/stream';
import { isConfigured, supabaseServer } from '@/lib/supabase/server';
import { revokeEmitter, saveStream } from '../emetteur-actions';
import { CreateKey } from './CreateKey';

export const metadata = { title: 'Émetteur' };

const ago = (iso: string | null) => {
  if (!iso) return 'jamais';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Paris' });

export default async function Emetteur({ searchParams }: { searchParams: Promise<{ enregistre?: string }> }) {
  const { enregistre } = await searchParams;
  const { org, isPlatformAdmin } = await getSession();
  if (!org) return null;
  if (!isConfigured || !isPlatformAdmin) {
    return <div className="card empty">Réservé à la régie.</div>;
  }
  const sb = await supabaseServer();
  const h = await headers();
  const base = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  const [{ data: emitters }, { data: streams }, { data: orgs }, { data: ambiences }] = await Promise.all([
    sb.from('emitters').select('id, name, public_url, last_seen_at, created_at').order('created_at', { ascending: false }),
    sb.from('streams').select('org_id, mount, enabled, default_ambience_id'),
    sb.from('organizations').select('id, name').order('name'),
    sb.from('ambiences').select('id, org_id, name').order('name')
  ]);
  const online = (emitters ?? []).filter((e) => e.last_seen_at && Date.now() - Date.parse(e.last_seen_at) < EMITTER_ONLINE_MS);
  const live = online.find((e) => e.public_url) ?? null;
  const byOrg = new Map((streams ?? []).map((s) => [s.org_id as string, s]));
  const plays = await Promise.all(
    (orgs ?? []).map(async (o) => {
      const { data } = await sb.from('stream_plays').select('title, artist, started_at, queued_at, is_jingle').eq('org_id', o.id).order('queued_at', { ascending: false }).limit(6);
      return [o.id as string, data ?? []] as const;
    })
  );
  const playsByOrg = new Map(plays);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Toutes les enseignes</div>
          <h1>Émetteur</h1>
          <p className="lead">Un flux par enseigne, fabriqué par l’émetteur selon la journée type, les listes et les points de mix. Chaque boutique l’écoute et place ses propres spots entre deux titres.</p>
        </div>
        {enregistre && <span className="tag" role="status">Enregistré</span>}
      </div>

      <section className="card">
        <div className="page-head" style={{ alignItems: 'center' }}>
          <h2>État</h2>
          <span className="status">
            <span className="dot" style={{ background: live ? 'var(--ok)' : 'var(--warn)' }} />
            {live ? `En service · signal ${ago(live.last_seen_at)}` : (emitters ?? []).length ? 'Hors service : les boutiques jouent la musique en cache' : 'Aucun émetteur installé'}
          </span>
        </div>
        {live && <p className="sub">Adresse des flux : <strong>{live.public_url}</strong></p>}
      </section>

      <section className="card">
        <h2>Flux des enseignes</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Enseigne</th><th>Flux</th><th>En cours</th><th>Réglages</th></tr></thead>
            <tbody>
              {(orgs ?? []).map((o) => {
                const s = byOrg.get(o.id as string);
                const recent = playsByOrg.get(o.id as string) ?? [];
                const cur = recent.find((p) => p.started_at);
                const url = live && s ? `${(live.public_url as string).replace(/\/+$/, '')}/${s.mount}` : null;
                return (
                  <tr key={o.id}>
                    <td style={{ fontWeight: 600 }}>{o.name}</td>
                    <td className="small">
                      {s ? <code>/{s.mount}</code> : <span className="muted">créé au démarrage de l’émetteur</span>}
                      {url && s?.enabled && (
                        <div style={{ marginTop: 8 }}>
                          <audio controls preload="none" src={url} style={{ height: 32, maxWidth: 240 }} aria-label={`Écouter le flux ${o.name}`} />
                        </div>
                      )}
                    </td>
                    <td className="small">
                      {cur ? (
                        <>
                          <div style={{ fontWeight: 500 }}>{cur.title}</div>
                          <div className="muted">{cur.artist} · depuis {clock(cur.started_at as string)}</div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                      {recent.length > 1 && (
                        <details style={{ marginTop: 6 }}>
                          <summary className="muted">Derniers titres</summary>
                          {recent.map((p, i) => (
                            <div key={i} className="muted">{clock((p.started_at ?? p.queued_at) as string)} · {p.title}{p.started_at ? '' : ' (à venir)'}</div>
                          ))}
                        </details>
                      )}
                    </td>
                    <td>
                      {s && (
                        <form action={saveStream} className="actions" style={{ alignItems: 'center' }}>
                          <input type="hidden" name="org_id" value={o.id} />
                          <label className="switch" title="Flux actif"><input type="checkbox" name="enabled" defaultChecked={s.enabled} aria-label="Flux actif" /><span /></label>
                          <select className="select" name="default_ambience_id" defaultValue={s.default_ambience_id ?? ''} aria-label="Ambiance hors créneau" style={{ width: 'auto' }}>
                            <option value="">Hors créneau : première ambiance</option>
                            {(ambiences ?? []).filter((a) => a.org_id === o.id).map((a) => <option key={a.id} value={a.id}>Hors créneau : {a.name}</option>)}
                          </select>
                          <button className="btn btn-secondary btn-small" type="submit">Enregistrer</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Installer l’émetteur</h2>
        <p className="sub">Pour tester sur un Mac : l’émetteur tourne tant que le Mac est allumé, et les flux s’écoutent sur ce Mac.</p>
        <ol className="small" style={{ lineHeight: 1.8, paddingLeft: 18, margin: '12px 0 18px' }}>
          <li>Installez <a href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noreferrer">Docker Desktop</a>, ouvrez-le et attendez qu’il soit prêt.</li>
          <li>Créez une clé ci-dessous et copiez la commande.</li>
          <li>Collez-la dans le Terminal. L’émetteur apparaît « en service » d’ici une minute.</li>
        </ol>
        <CreateKey base={base} />
      </section>

      {(emitters ?? []).length > 0 && (
        <section className="card">
          <h2>Clés</h2>
          <div className="list">
            {(emitters ?? []).map((e) => (
              <div key={e.id} className="list-item" style={{ padding: '10px 0' }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{e.name}</div>
                  <div className="small muted">Créée le {new Date(e.created_at).toLocaleDateString('fr-FR')} · signal {ago(e.last_seen_at)}{e.public_url ? ` · ${e.public_url}` : ''}</div>
                </div>
                <form action={revokeEmitter}>
                  <input type="hidden" name="id" value={e.id} />
                  <button className="btn btn-secondary btn-small" type="submit">Révoquer</button>
                </form>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

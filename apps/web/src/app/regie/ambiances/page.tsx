import Link from 'next/link';
import { getSession } from '@/lib/data';
import { DAYS, listAmbiences, listPlaylists, orderLabel, typeLabel, type PlaylistRow } from '@/lib/music';
import { createPlaylist, saveAmbience } from '../musique-actions';

export const metadata = { title: 'Ambiances et listes' };

function rule(p: PlaylistRow) {
  if (p.type === 'once_per_songs') return `1 titre tous les ${p.every_songs}`;
  if (p.type === 'once_per_minutes') return `Toutes les ${p.every_minutes} min`;
  if (p.type === 'once_per_hour') return `Chaque heure à :${String(p.minute_of_hour ?? 0).padStart(2, '0')}`;
  return `Poids ${p.weight}`;
}
function when(p: PlaylistRow) {
  const parts: string[] = [];
  if (p.start_time && p.end_time) parts.push(`${p.start_time.slice(0, 5)}–${p.end_time.slice(0, 5)}`);
  if (p.days?.length) parts.push(p.days.map((d) => DAYS[d - 1]).join(' '));
  if (p.start_date || p.end_date) parts.push(`${p.start_date ?? '…'} → ${p.end_date ?? '…'}`);
  return parts.join(' · ') || 'Toujours';
}

export default async function Ambiances() {
  const { org } = await getSession();
  if (!org) return null;
  const [ambiences, playlists] = await Promise.all([listAmbiences(org.id), listPlaylists(org.id)]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{org.name} · {ambiences.length} ambiances</div>
          <h1>Ambiances et listes</h1>
          <p className="lead">Une ambiance est une radio : ses listes de lecture, son enchaînement et son volume. La journée type décide quelle ambiance passe à quelle heure.</p>
        </div>
        <Link className="btn btn-secondary" href="/regie/programmation">Journée type</Link>
      </div>

      {ambiences.length === 0 && <div className="card empty">Aucune ambiance pour cette enseigne.</div>}
      {ambiences.map((a) => {
        const own = playlists.filter((p) => p.ambience_id === a.id);
        return (
          <section className="card" key={a.id}>
            <div className="page-head" style={{ alignItems: 'baseline' }}>
              <h2 style={{ fontSize: 24 }}>{a.name}</h2>
              <span className="small muted">{own.reduce((n, p) => n + p.track_ids.length, 0)} titres dans {own.length} liste{own.length > 1 ? 's' : ''}</span>
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Liste</th><th>Type</th><th>Règle</th><th>Ordre</th><th>Quand</th><th>Titres</th><th>État</th></tr></thead>
                <tbody>
                  {own.length === 0 && <tr><td colSpan={7} className="empty">Aucune liste. Créez-en une ci-dessous.</td></tr>}
                  {own.map((p) => (
                    <tr key={p.id}>
                      <td><Link href={`/regie/ambiances/listes/${p.id}`} style={{ fontWeight: 500 }}>{p.name}</Link>{p.is_jingle && <span className="tag" style={{ marginLeft: 8 }}>Jingle</span>}</td>
                      <td className="small">{typeLabel[p.type]}</td>
                      <td className="small">{rule(p)}</td>
                      <td className="small">{orderLabel[p.play_order]}</td>
                      <td className="small muted">{when(p)}</td>
                      <td className="small">{p.track_ids.length}</td>
                      <td><span className="status small"><span className="dot" style={{ background: p.enabled ? 'var(--ok)' : 'var(--store)' }} />{p.enabled ? 'Active' : 'Désactivée'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ marginTop: 20 }}>
              <form action={saveAmbience} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input type="hidden" name="id" value={a.id} />
                <div style={{ fontWeight: 600 }}>Son et enchaînements</div>
                <div className="form-grid">
                  <label className="field"><span>Enchaînement</span>
                    <select className="select" name="crossfade_mode" defaultValue={a.crossfade_mode}>
                      <option value="smart">Intelligent (point de chevauchement)</option>
                      <option value="normal">Fondu fixe</option>
                      <option value="none">Sans fondu</option>
                    </select>
                  </label>
                  <label className="field"><span>Durée du fondu (s)</span><input className="input" type="number" step="0.5" min={0} max={15} name="crossfade_sec" defaultValue={a.crossfade_sec} /></label>
                  <label className="field"><span>Volume cible (LUFS)</span><input className="input" type="number" step="0.5" min={-30} max={-10} name="target_lufs" defaultValue={a.target_lufs} /></label>
                  <label className="field"><span>Même titre, pas avant (min)</span><input className="input" type="number" min={0} max={1440} name="title_separation_min" defaultValue={a.title_separation_min} /></label>
                  <label className="field"><span>Même artiste, pas avant (min)</span><input className="input" type="number" min={0} max={1440} name="artist_separation_min" defaultValue={a.artist_separation_min} /></label>
                </div>
                <button className="btn btn-secondary btn-small" type="submit" style={{ alignSelf: 'flex-start' }}>Enregistrer les réglages</button>
              </form>

              <form action={createPlaylist} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input type="hidden" name="org_id" value={org.id} />
                <input type="hidden" name="ambience_id" value={a.id} />
                <div style={{ fontWeight: 600 }}>Nouvelle liste</div>
                <div className="form-grid">
                  <label className="field"><span>Nom</span><input className="input" name="name" placeholder="Noël, Jingles, Nouveautés…" required /></label>
                  <label className="field"><span>Type</span>
                    <select className="select" name="type" defaultValue="standard">
                      {Object.entries(typeLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                </div>
                <button className="btn btn-primary btn-small" type="submit" style={{ alignSelf: 'flex-start' }}>Créer la liste</button>
              </form>
            </div>
          </section>
        );
      })}
    </>
  );
}

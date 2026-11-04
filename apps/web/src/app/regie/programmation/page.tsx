import { getSession } from '@/lib/data';
import { DAYS, listAmbiences, listDayparts, toMin } from '@/lib/music';
import { deleteDaypart, saveDaypart } from '../musique-actions';

export const metadata = { title: 'Journée type' };

const PALETTE = ['#0071e3', '#5e5ce6', '#34c759', '#ff9f0a', '#bf5af2', '#64d2ff'];

export default async function Programmation() {
  const { org } = await getSession();
  if (!org) return null;
  const [ambiences, dayparts] = await Promise.all([listAmbiences(org.id), listDayparts(org.id)]);
  const color = new Map(ambiences.map((a, i) => [a.id, PALETTE[i % PALETTE.length]]));
  const name = new Map(ambiences.map((a) => [a.id, a.name]));
  const fallback = ambiences[0]?.name ?? '—';
  const pct = (m: number) => `${(m / 1440) * 100}%`;

  const Row = ({ d }: { d?: (typeof dayparts)[number] }) => (
    <form action={saveDaypart} className="form-grid" style={{ alignItems: 'end', padding: '14px 0', borderTop: '1px solid var(--line)', gridTemplateColumns: 'minmax(140px,1.3fr) minmax(140px,1fr) 110px 110px minmax(260px,2fr) auto' }}>
      <input type="hidden" name="org_id" value={org.id} />
      {d && <input type="hidden" name="id" value={d.id} />}
      <label className="field"><span>Créneau</span><input className="input" name="name" defaultValue={d?.name ?? ''} placeholder="Déjeuner" required /></label>
      <label className="field"><span>Ambiance</span>
        <select className="select" name="ambience_id" defaultValue={d?.ambience_id ?? ambiences[0]?.id}>
          {ambiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label className="field"><span>De</span><input className="input" type="time" name="start_time" defaultValue={d?.start_time.slice(0, 5) ?? ''} required /></label>
      <label className="field"><span>À</span><input className="input" type="time" name="end_time" defaultValue={d?.end_time.slice(0, 5) ?? ''} required /></label>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <span>Jours (aucun = tous)</span>
        <div className="choice">
          {DAYS.map((x, i) => <label key={x}><input type="checkbox" name="days" value={i + 1} defaultChecked={d?.days?.includes(i + 1) ?? false} /><span>{x}</span></label>)}
        </div>
      </fieldset>
      <div className="actions">
        <button className="btn btn-primary btn-small" type="submit">{d ? 'Enregistrer' : 'Ajouter'}</button>
        {d && <button className="btn btn-secondary btn-small" type="submit" formAction={deleteDaypart}>Supprimer</button>}
      </div>
    </form>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{org.name}</div>
          <h1>Journée type</h1>
          <p className="lead">Quelle ambiance passe à quelle heure, dans toutes les boutiques de l’enseigne. Hors créneau : {fallback}.</p>
        </div>
      </div>

      <section className="card">
        <h2>Aperçu</h2>
        <div style={{ position: 'relative', height: 54, marginTop: 18, borderRadius: 12, background: 'var(--bg)', overflow: 'hidden' }} role="img" aria-label="Frise de la journée">
          {dayparts.map((d) => {
            const a = toMin(d.start_time)!, b = toMin(d.end_time)!;
            const segs = a < b ? [[a, b]] : [[a, 1440], [0, b]];
            return segs.map(([s, e], k) => (
              <div key={`${d.id}-${k}`} title={`${d.name} · ${name.get(d.ambience_id)}`} style={{ position: 'absolute', left: pct(s), width: pct(e - s), top: 0, bottom: 0, background: color.get(d.ambience_id), color: '#fff', fontSize: 12, padding: '8px 8px', overflow: 'hidden', whiteSpace: 'nowrap', borderRight: '2px solid #fff' }}>
                <div style={{ fontWeight: 600 }}>{d.name}</div>
                <div style={{ opacity: 0.85 }}>{name.get(d.ambience_id)}</div>
              </div>
            ));
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => <span key={h}>{h} h</span>)}
        </div>
      </section>

      <section className="card">
        <h2>Créneaux</h2>
        {dayparts.map((d) => <Row key={d.id} d={d} />)}
        <Row />
      </section>
    </>
  );
}

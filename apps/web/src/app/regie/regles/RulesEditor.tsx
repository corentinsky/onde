'use client';

import { useMemo, useState } from 'react';
import { planBreaks, type Rules, type SpotRequest } from '@onde/rules';
import type { RulesRow } from '@/lib/data';
import { originLabel } from '@/lib/format';
import { saveRules } from '../actions';

type Prio = RulesRow['priority'][number];
const desc: Record<Prio, string> = {
  national: 'Spots envoyés par le siège.',
  regional: 'Spots d’une direction régionale.',
  store: 'Messages des boutiques, validés par la régie.'
};

const T0 = Date.UTC(2026, 11, 3, 13, 0);
const sample: SpotRequest[] = [
  { id: 'a', spotId: 'noel', title: 'Carte cadeau de Noël', origin: 'national', durationSec: 14, requestedAt: T0, mode: 'next_break' },
  { id: 'b', spotId: 'dim', title: 'Ouverture dimanche, région lyonnaise', origin: 'regional', durationSec: 15, requestedAt: T0, mode: 'next_break' },
  { id: 'c', spotId: 'ret', title: 'Retouches en cabine', origin: 'store', durationSec: 12, requestedAt: T0, mode: 'next_break' },
  { id: 'd', spotId: 'fid', title: 'Carte de fidélité', origin: 'store', durationSec: 10, requestedAt: T0, mode: 'next_break' }
];
const hhmm = (t: number) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(t);

function Stepper(props: { label: string; help: string; name: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  const { label, help, name, value, min, max, step, unit = '', onChange } = props;
  return (
    <div className="switch-row">
      <div>
        <div>{label}</div>
        <div className="small muted">{help}</div>
      </div>
      <div className="stepper">
        <button type="button" aria-label={`Diminuer : ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>−</button>
        <output aria-live="polite">{value}{unit}</output>
        <button type="button" aria-label={`Augmenter : ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>+</button>
        <input type="hidden" name={name} value={value} />
      </div>
    </div>
  );
}

export function RulesEditor({ orgId, initial }: { orgId: string; initial: RulesRow }) {
  const [order, setOrder] = useState<Prio[]>(initial.priority);
  const [perBreak, setPerBreak] = useState(initial.max_per_break);
  const [perHourMin, setPerHourMin] = useState(Math.round(initial.max_seconds_per_hour / 60));
  const [gap, setGap] = useState(initial.min_gap_same_spot_min);
  const [win, setWin] = useState(initial.window_min);
  const [noCut, setNoCut] = useState(initial.never_cut_track);

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const n = [...order];
    [n[i], n[j]] = [n[j], n[i]];
    setOrder(n);
  };

  const plan = useMemo(() => {
    const rules: Rules = { priority: order, maxPerBreak: perBreak, maxSecondsPerHour: perHourMin * 60, minGapSameSpotMin: gap, windowMin: win, neverCutTrack: noCut };
    return planBreaks({ now: T0, currentTrackEndsAt: T0 + 2 * 60_000, upcomingTrackSec: [240, 240, 240], requests: sample, rules });
  }, [order, perBreak, perHourMin, gap, win, noCut]);

  return (
    <form action={saveRules} className="row">
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="priority" value={order.join(',')} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <section className="card">
          <h2>Ordre de priorité</h2>
          <p className="sub">Le premier passe en premier quand plusieurs spots se chevauchent.</p>
          <ol style={{ listStyle: 'none', padding: 0, margin: '16px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li className="list-item" style={{ borderTop: 0, padding: '12px 14px', borderRadius: 14, background: '#fff1f0' }}>
              <div className="status"><span className="badge badge-emergency">1</span><div><strong>Urgence</strong><div className="small muted">Coupe le titre et passe tout de suite. Toujours en premier.</div></div></div>
            </li>
            {order.map((p, i) => (
              <li key={p} className="list-item" style={{ borderTop: 0, padding: '12px 14px', borderRadius: 14, background: 'var(--bg)' }}>
                <div className="status"><span className={`badge badge-${p}`}>{i + 2}</span><div><strong>{originLabel[p]}</strong><div className="small muted">{desc[p]}</div></div></div>
                <div className="stepper">
                  <button type="button" aria-label={`Monter ${originLabel[p]}`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button type="button" aria-label={`Descendre ${originLabel[p]}`} disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</button>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="card">
          <h2>Écrans entre deux titres</h2>
          <p className="sub">Les spots attendent la fin du titre et passent groupés.</p>
          <div style={{ marginTop: 10 }}>
            <Stepper label="Spots maximum par écran" help="Au-delà, le reste passe à l’écran suivant." name="max_per_break" value={perBreak} min={1} max={6} step={1} onChange={setPerBreak} />
            <Stepper label="Durée de spots par heure" help="Durée cumulée maximale, tous spots confondus." name="max_minutes_per_hour" value={perHourMin} min={1} max={15} step={1} unit=" min" onChange={setPerHourMin} />
            <Stepper label="Écart entre deux passages du même spot" help="Évite d’entendre le même message en boucle." name="min_gap_same_spot_min" value={gap} min={0} max={120} step={5} unit=" min" onChange={setGap} />
            <Stepper label="Fenêtre de tolérance" help="Délai accordé à un spot pour trouver sa place." name="window_min" value={win} min={5} max={60} step={5} unit=" min" onChange={setWin} />
            {[
              ['never_cut_track', 'Ne jamais couper un titre', 'Sauf urgence.', noCut, setNoCut],
              ['duck_music', 'Fondu de la musique autour des spots', 'La musique baisse doucement, puis revient.', initial.duck_music, null],
              ['alert_on_miss', 'Alerter si un spot n’a pas pu passer', 'La régie est prévenue à la fin de la fenêtre.', initial.alert_on_miss, null]
            ].map(([name, label, help, checked, set]) => (
              <div className="switch-row" key={name as string}>
                <div><div>{label as string}</div><div className="small muted">{help as string}</div></div>
                <label className="switch">
                  <input
                    type="checkbox"
                    name={name as string}
                    defaultChecked={checked as boolean}
                    aria-label={label as string}
                    onChange={set ? (e) => (set as (v: boolean) => void)(e.currentTarget.checked) : undefined}
                  />
                  <span />
                </label>
              </div>
            ))}
          </div>
          <button className="btn btn-primary" type="submit" style={{ marginTop: 18 }}>Enregistrer les règles</button>
        </section>
      </div>

      <section className="card" aria-live="polite">
        <div className="small muted">Simulation · même moteur que les lecteurs</div>
        <h2 style={{ fontSize: 24, marginTop: 4 }}>Quatre spots demandés à 14:00</h2>
        <p className="sub">Le titre en cours finit à 14:02, les suivants durent 4 minutes.</p>
        {plan.breaks.map((b, i) => (
          <div key={b.at} style={{ marginTop: 18 }}>
            <div className="page-head" style={{ alignItems: 'baseline' }}>
              <strong>Écran {i + 1} · {hhmm(b.at)}</strong>
              <span className="small muted">{b.items.reduce((a, x) => a + x.request.durationSec, 0)} s</span>
            </div>
            <div className="list" style={{ marginTop: 8, gap: 6 }}>
              {b.items.map((it) => (
                <div key={it.request.id} className="list-item" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '11px 14px' }}>
                  <span className="status"><span className={`badge badge-${it.request.origin}`}>{originLabel[it.request.origin]}</span>{it.request.title}</span>
                  <span className="small muted">{hhmm(it.startsAt)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {plan.missed.length > 0 && (
          <div className="notice" style={{ marginTop: 18 }}>
            {plan.missed.length} spot{plan.missed.length > 1 ? 's' : ''} hors fenêtre : {plan.missed.map((m) => m.request.title).join(', ')}. La régie serait alertée.
          </div>
        )}
        {plan.pending.length > 0 && <p className="small muted" style={{ marginTop: 14 }}>{plan.pending.length} en attente au-delà de 14:14.</p>}
      </section>
    </form>
  );
}

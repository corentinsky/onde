import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, expandDay, planBreaks, type Rules, type SpotRequest } from '../src/index';

const MIN = 60_000;
const T0 = Date.UTC(2026, 11, 3, 13, 0); // 14:00 à Paris
const req = (p: Partial<SpotRequest> & Pick<SpotRequest, 'id' | 'origin'>): SpotRequest => ({
  spotId: p.id,
  title: p.id,
  durationSec: 15,
  requestedAt: T0,
  mode: 'next_break',
  ...p
});

const four = [
  req({ id: 'loc-fid', origin: 'store', durationSec: 10 }),
  req({ id: 'reg-dim', origin: 'regional', durationSec: 15 }),
  req({ id: 'nat-noel', origin: 'national', durationSec: 14 }),
  req({ id: 'loc-ret', origin: 'store', durationSec: 12 })
];

describe('planBreaks', () => {
  it('attend la fin du titre et respecte l’ordre national > régional > boutique', () => {
    const plan = planBreaks({
      now: T0,
      currentTrackEndsAt: T0 + 2 * MIN,
      upcomingTrackSec: [240, 240],
      requests: four,
      rules: DEFAULT_RULES
    });
    expect(plan.breaks[0].at).toBe(T0 + 2 * MIN);
    expect(plan.breaks[0].items.map((i) => i.request.id)).toEqual(['nat-noel', 'reg-dim', 'loc-fid']);
    expect(plan.breaks[1].items.map((i) => i.request.id)).toEqual(['loc-ret']);
    expect(plan.missed).toEqual([]);
  });

  it('enchaîne les spots d’un même écran sans chevauchement', () => {
    const plan = planBreaks({ now: T0, currentTrackEndsAt: T0, upcomingTrackSec: [], requests: four.slice(0, 3), rules: DEFAULT_RULES });
    const [a, b, c] = plan.breaks[0].items;
    expect(b.startsAt).toBe(a.startsAt + a.request.durationSec * 1000);
    expect(c.startsAt).toBe(b.startsAt + b.request.durationSec * 1000);
  });

  it('suit un ordre de priorité personnalisé', () => {
    const rules: Rules = { ...DEFAULT_RULES, priority: ['national', 'store', 'regional'] };
    const plan = planBreaks({ now: T0, currentTrackEndsAt: T0, upcomingTrackSec: [200], requests: four, rules });
    expect(plan.breaks[0].items.map((i) => i.request.origin)).toEqual(['national', 'store', 'store']);
  });

  it('marque hors fenêtre ce qui ne trouve pas de place à temps', () => {
    const rules: Rules = { ...DEFAULT_RULES, maxPerBreak: 2, windowMin: 5 };
    const plan = planBreaks({ now: T0, currentTrackEndsAt: T0 + 2 * MIN, upcomingTrackSec: [240, 240], requests: four, rules });
    expect(plan.breaks).toHaveLength(1);
    expect(plan.missed.map((m) => [m.request.id, m.reason])).toEqual([
      ['loc-fid', 'window'],
      ['loc-ret', 'window']
    ]);
  });

  it('coupe le titre seulement si la règle l’autorise', () => {
    const plan = planBreaks({
      now: T0,
      currentTrackEndsAt: T0 + 3 * MIN,
      upcomingTrackSec: [],
      requests: [four[2]],
      rules: { ...DEFAULT_RULES, neverCutTrack: false }
    });
    expect(plan.breaks[0].at).toBe(T0);
  });

  it('fait passer l’urgence immédiatement, avant tout', () => {
    const plan = planBreaks({
      now: T0,
      currentTrackEndsAt: T0 + 3 * MIN,
      upcomingTrackSec: [200],
      requests: [...four, req({ id: 'evac', origin: 'emergency', durationSec: 30 })],
      rules: DEFAULT_RULES
    });
    expect(plan.breaks[0]).toMatchObject({ at: T0, kind: 'interrupt' });
    expect(plan.breaks[0].items[0].request.id).toBe('evac');
  });

  it('joue un spot synchronisé à la seconde, les autres attendent', () => {
    const at = T0 + 90_000;
    const plan = planBreaks({
      now: T0,
      currentTrackEndsAt: T0 + 2 * MIN,
      upcomingTrackSec: [240],
      requests: [req({ id: 'soldes', origin: 'national', mode: 'sync', requestedAt: at, durationSec: 20 }), four[3]],
      rules: DEFAULT_RULES
    });
    expect(plan.breaks[0]).toMatchObject({ at, kind: 'sync' });
    expect(plan.breaks[1].kind).toBe('between_tracks');
  });

  it('respecte le plafond horaire', () => {
    const rules: Rules = { ...DEFAULT_RULES, maxSecondsPerHour: 30, windowMin: 60 };
    const plan = planBreaks({ now: T0, currentTrackEndsAt: T0, upcomingTrackSec: [240, 240], requests: four, rules });
    const total = plan.breaks.flatMap((b) => b.items).reduce((a, i) => a + i.request.durationSec, 0);
    expect(total).toBeLessThanOrEqual(30);
    expect(plan.missed.length + plan.pending.length).toBeGreaterThan(0);
  });

  it('espace deux passages du même spot', () => {
    const plan = planBreaks({
      now: T0,
      currentTrackEndsAt: T0,
      upcomingTrackSec: [180],
      requests: [req({ id: 'n1', spotId: 'noel', origin: 'national' })],
      rules: DEFAULT_RULES,
      history: [{ spotId: 'noel', at: T0 - 5 * MIN, durationSec: 15 }]
    });
    expect(plan.breaks).toHaveLength(0);
    expect(plan.missed[0]?.reason ?? 'pending').not.toBe('window');
  });

  it('laisse en attente ce qui est demandé plus tard', () => {
    const plan = planBreaks({
      now: T0,
      currentTrackEndsAt: T0,
      upcomingTrackSec: [180],
      requests: [req({ id: 'later', origin: 'store', requestedAt: T0 + 60 * MIN })],
      rules: DEFAULT_RULES
    });
    expect(plan.pending.map((r) => r.id)).toEqual(['later']);
  });
});

describe('expandDay', () => {
  it('déplie un spot toutes les 90 min entre 11:00 et 19:00', () => {
    const r = expandDay(
      { spotId: 'noel', title: 'Carte cadeau', origin: 'national', durationSec: 14, mode: 'next_break', dailyStartMin: 660, dailyEndMin: 1140, everyMin: 90 },
      Date.UTC(2026, 11, 3, -1)
    );
    expect(r).toHaveLength(6);
    expect(r[0].id).toBe('noel@660');
  });

  it('accepte des heures fixes', () => {
    const r = expandDay(
      { spotId: 's', title: 'Soldes', origin: 'national', durationSec: 20, mode: 'sync', dailyStartMin: 0, dailyEndMin: 1439, fixedTimesMin: [600] },
      0
    );
    expect(r.map((x) => x.requestedAt)).toEqual([600 * MIN]);
  });
});

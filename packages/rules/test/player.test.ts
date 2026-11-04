import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, type SpotRequest } from '../src/index';
import { buildRequests, decide, toRules, type ScheduleSpot } from '../src/player';

const MIN = 60_000;
const DAY = Date.UTC(2026, 11, 3, -1); // minuit à Paris
const at = (h: number, m = 0) => DAY + (h * 60 + m) * MIN;

const spot = (p: Partial<ScheduleSpot>): ScheduleSpot => ({
  id: 'noel',
  origin: 'national',
  title: 'Carte cadeau',
  duration_sec: 14,
  mode: 'next_break',
  daily_start: '11:00:00',
  daily_end: '19:00:00',
  every_min: 90,
  fixed_times: null,
  window_min: null,
  ...p
});

describe('buildRequests', () => {
  it('déplie les spots de la base en passages datés et uniques par jour', () => {
    const r = buildRequests([spot({}), spot({ id: 'soldes', mode: 'sync', every_min: null, fixed_times: ['10:00:00'], daily_start: '00:00:00', daily_end: '23:59:00' })], DAY);
    expect(r.filter((x) => x.spotId === 'noel')).toHaveLength(6);
    expect(r.find((x) => x.spotId === 'soldes')?.requestedAt).toBe(at(10));
    expect(new Set(r.map((x) => x.id)).size).toBe(r.length);
  });
});

describe('toRules', () => {
  it('convertit la ligne de la base et tombe sur les valeurs par défaut sinon', () => {
    expect(toRules(null)).toEqual(DEFAULT_RULES);
    expect(toRules({ max_per_break: 2, priority: ['store', 'national', 'regional'] }).maxPerBreak).toBe(2);
  });
});

describe('decide', () => {
  const reqs = buildRequests([spot({})], DAY);
  const base = { requests: reqs, rules: DEFAULT_RULES, history: [], handled: new Set<string>() };

  it('attend la fin du titre', () => {
    const d = decide({ ...base, now: at(11, 1), trackRemainingSec: 60 });
    expect(d.play).toEqual([]);
    expect(d.next?.at).toBe(at(11, 2));
  });

  it('joue quand le titre se termine', () => {
    const d = decide({ ...base, now: at(11, 2), trackRemainingSec: 0.5 });
    expect(d.play.map((p) => p.request.spotId)).toEqual(['noel']);
    expect(d.kind).toBe('between_tracks');
  });

  it('ne rejoue pas un passage déjà traité', () => {
    const handled = new Set([reqs[0].id]);
    const d = decide({ ...base, handled, now: at(11, 2), trackRemainingSec: 0 });
    expect(d.play).toEqual([]);
  });

  it('joue dès que c’est dû si le titre en cours est inconnu', () => {
    const d = decide({ ...base, now: at(11, 0), trackRemainingSec: null });
    expect(d.play).toHaveLength(1);
  });

  it('ne déclare manqué qu’après la fin réelle de la fenêtre', () => {
    const early = decide({ ...base, now: at(11, 5), trackRemainingSec: 600 });
    expect(early.missed).toEqual([]);
    const late = decide({ ...base, now: at(11, 25), trackRemainingSec: 600 });
    expect(late.missed.map((m) => m.request.spotId)).toEqual(['noel']);
  });

  it('joue un spot synchronisé à la seconde, même en plein titre', () => {
    const sync: SpotRequest[] = buildRequests([spot({ id: 'soldes', mode: 'sync', every_min: null, fixed_times: ['10:00:00'], daily_start: '00:00:00', daily_end: '23:59:00' })], DAY);
    const d = decide({ ...base, requests: sync, now: at(10), trackRemainingSec: 120 });
    expect(d.kind).toBe('sync');
    expect(d.play).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isResting, planRotation, rotationDue, type RotationTrack } from '../src/rotation';

const T = Date.parse('2026-11-06T12:00:00Z');
const DAY = 86_400_000;
const track = (i: number, p: Partial<RotationTrack> = {}): RotationTrack => ({
  trackId: `t${String(i).padStart(3, '0')}`,
  artist: `Artiste ${i}`,
  addedAt: T - 60 * DAY,
  restedUntil: null,
  plays: 0,
  lastPlayedAt: null,
  ...p
});

describe('dates', () => {
  it('ajoute des jours et compte les jours, changements de mois compris', () => {
    expect(addDays('2026-11-25', 15)).toBe('2026-12-10');
    expect(addDays('2026-12-25', 30)).toBe('2027-01-24');
    expect(daysBetween('2026-11-06', '2026-11-21')).toBe(15);
  });

  it('un titre est au repos jusqu’à sa date de retour exclue', () => {
    expect(isResting('2026-11-21', '2026-11-20')).toBe(true);
    expect(isResting('2026-11-21', '2026-11-21')).toBe(false);
    expect(isResting(null, '2026-11-21')).toBe(false);
  });

  it('la rotation tombe tous les N jours, et tout de suite la première fois', () => {
    expect(rotationDue(15, null, '2026-11-06')).toBe(true);
    expect(rotationDue(15, '2026-11-06', '2026-11-20')).toBe(false);
    expect(rotationDue(15, '2026-11-06', '2026-11-21')).toBe(true);
    expect(rotationDue(null, null, '2026-11-06')).toBe(false);
  });
});

describe('planRotation', () => {
  it('met au repos les titres les plus diffusés, à hauteur de la part demandée', () => {
    const tracks = Array.from({ length: 50 }, (_, i) => track(i, { plays: i, lastPlayedAt: T - DAY }));
    const plan = planRotation(tracks, { sharePct: 20, restDays: 30 }, '2026-11-06', null);
    expect(plan.rest).toHaveLength(10);
    expect(plan.rest.map((r) => r.trackId)).toEqual(Array.from({ length: 10 }, (_, k) => `t${String(49 - k).padStart(3, '0')}`));
    expect(plan.rest.every((r) => r.until === '2026-12-06')).toBe(true);
    expect(plan.activeAfter).toBe(40);
  });

  it('ne met jamais au repos un titre qui n’a pas été diffusé', () => {
    const tracks = Array.from({ length: 50 }, (_, i) => track(i, { plays: i < 3 ? 5 : 0 }));
    expect(planRotation(tracks, { sharePct: 20, restDays: 30 }, '2026-11-06', null).rest).toHaveLength(3);
  });

  it('protège les nouveautés ajoutées depuis la dernière rotation', () => {
    const last = T - 15 * DAY;
    const tracks = [
      ...Array.from({ length: 20 }, (_, i) => track(i, { plays: 2 })),
      ...Array.from({ length: 20 }, (_, i) => track(100 + i, { plays: 9, addedAt: last + DAY }))
    ];
    const plan = planRotation(tracks, { sharePct: 20, restDays: 30 }, '2026-11-06', last);
    expect(plan.rest).toHaveLength(8);
    expect(plan.rest.every((r) => !r.trackId.startsWith('t1'))).toBe(true);
  });

  it('fait revenir les titres dont le repos est fini', () => {
    const tracks = [track(1, { restedUntil: '2026-11-06' }), track(2, { restedUntil: '2026-11-07' }), ...Array.from({ length: 30 }, (_, i) => track(10 + i))];
    const plan = planRotation(tracks, { sharePct: 20, restDays: 30 }, '2026-11-06', null);
    expect(plan.back).toEqual(['t001']);
    expect(plan.activeAfter).toBe(31);
  });

  it('garde au moins la moitié de la liste en rotation', () => {
    const tracks = Array.from({ length: 20 }, (_, i) => track(i, { plays: 3, restedUntil: i < 9 ? '2026-12-01' : null }));
    const plan = planRotation(tracks, { sharePct: 60, restDays: 30 }, '2026-11-06', null);
    expect(plan.activeAfter).toBeGreaterThanOrEqual(10);
    expect(plan.rest.length).toBeLessThanOrEqual(1);
  });

  it('à diffusions égales, retire d’abord l’artiste le plus présent', () => {
    const tracks = [
      track(1, { artist: 'Daft Punk', plays: 4 }),
      track(2, { artist: 'Daft Punk', plays: 4 }),
      track(3, { artist: 'Daft Punk', plays: 4 }),
      track(4, { artist: 'Sade', plays: 4 }),
      ...Array.from({ length: 36 }, (_, i) => track(10 + i, { plays: 1 }))
    ];
    const plan = planRotation(tracks, { sharePct: 5, restDays: 30, minActive: 1 }, '2026-11-06', null);
    expect(plan.rest.map((r) => r.trackId)).toEqual(['t001', 't002']);
  });

  it('une petite liste n’est pas vidée', () => {
    const tracks = Array.from({ length: 8 }, (_, i) => track(i, { plays: 10 }));
    expect(planRotation(tracks, { sharePct: 50, restDays: 30 }, '2026-11-06', null).rest).toHaveLength(0);
  });
});

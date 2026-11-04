import { describe, expect, it } from 'vitest';
import { ambienceAt, emptyRotation, localTime, nextTrack, previewQueue, scheduleActive, seededRng, type Playlist, type PlayedTrack, type TrackMeta } from '../src/music';

const MIN = 60_000;
const lib = (n: number, artistOf = (i: number) => `Artiste ${i}`): Map<string, TrackMeta> =>
  new Map(Array.from({ length: n }, (_, i) => [`t${i}`, { id: `t${i}`, title: `Titre ${i}`, artist: artistOf(i) }]));
const pl = (p: Partial<Playlist> & Pick<Playlist, 'id' | 'trackIds'>): Playlist => ({ name: p.id, type: 'standard', weight: 5, order: 'shuffle', avoidDuplicates: true, ...p });
const T0 = new Date(2026, 10, 4, 14, 0).getTime(); // mercredi 4 nov. 2026, 14:00 (heure locale)
const local = (t: number) => localTime(new Date(t));

function run(playlists: Playlist[], tracks: Map<string, TrackMeta>, n: number, seed = 1, stepSec = 210) {
  const rng = seededRng(seed);
  let history: PlayedTrack[] = [];
  let state = emptyRotation();
  let t = T0;
  const out: { id: string; pl: string; reason: string; relaxed: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const c = nextTrack({ now: t, local: local(t), playlists, tracks, history, state, rng });
    if (!c) break;
    out.push({ id: c.track.id, pl: c.playlist.id, reason: c.reason, relaxed: c.relaxed });
    history.push({ trackId: c.track.id, playlistId: c.playlist.id, at: t, title: c.track.title, artist: c.track.artist, isJingle: c.playlist.isJingle });
    state = c.state;
    t += stepSec * 1000;
  }
  return out;
}

describe('rotation standard', () => {
  it('respecte les poids entre listes', () => {
    const tracks = lib(40);
    const a = pl({ id: 'a', weight: 20, avoidDuplicates: false, trackIds: [...tracks.keys()].slice(0, 20) });
    const b = pl({ id: 'b', weight: 5, avoidDuplicates: false, trackIds: [...tracks.keys()].slice(20) });
    const r = run([a, b], tracks, 2000);
    const share = r.filter((x) => x.pl === 'a').length / r.length;
    expect(share).toBeGreaterThan(0.76);
    expect(share).toBeLessThan(0.84);
  });

  it('mélangé : joue tout avant de répéter', () => {
    const tracks = lib(12);
    const r = run([pl({ id: 'a', avoidDuplicates: false, trackIds: [...tracks.keys()] })], tracks, 12);
    expect(new Set(r.map((x) => x.id)).size).toBe(12);
  });

  it('séquentiel : dans l’ordre de la liste', () => {
    const tracks = lib(4);
    const r = run([pl({ id: 'a', order: 'sequential', avoidDuplicates: false, trackIds: ['t2', 't0', 't3', 't1'] })], tracks, 6);
    expect(r.map((x) => x.id)).toEqual(['t2', 't0', 't3', 't1', 't2', 't0']);
  });

  it('espace un même artiste (90 min par défaut)', () => {
    const tracks = lib(40, (i) => `Artiste ${i % 30}`); // 30 artistes, certains avec 2 titres
    const r = run([pl({ id: 'a', trackIds: [...tracks.keys()] })], tracks, 25, 7, 210);
    const plays = r.map((x, i) => ({ artist: tracks.get(x.id)!.artist, at: i * 210 }));
    for (let i = 0; i < plays.length; i++)
      for (let j = i + 1; j < plays.length; j++)
        if (plays[i].artist === plays[j].artist) expect(plays[j].at - plays[i].at).toBeGreaterThanOrEqual(90 * 60);
    expect(r.every((x) => !x.relaxed)).toBe(true);
  });

  it('assouplit les espacements si la bibliothèque est trop petite, sans bloquer', () => {
    const tracks = lib(3);
    const r = run([pl({ id: 'a', trackIds: [...tracks.keys()] })], tracks, 6);
    expect(r).toHaveLength(6);
    expect(r.some((x) => x.relaxed)).toBe(true);
  });
});

describe('listes hors rotation', () => {
  const tracks = new Map<string, TrackMeta>([...lib(20), ['j1', { id: 'j1', title: 'Jingle', artist: '' }]]);
  const music = pl({ id: 'music', avoidDuplicates: false, trackIds: [...lib(20).keys()] });

  it('une fois tous les 3 titres (jingle)', () => {
    const jingle = pl({ id: 'jingle', type: 'once_per_songs', everySongs: 3, isJingle: true, trackIds: ['j1'] });
    const r = run([music, jingle], tracks, 12);
    expect(r.map((x) => x.pl)).toEqual(['music', 'music', 'music', 'jingle', 'music', 'music', 'music', 'jingle', 'music', 'music', 'music', 'jingle']);
  });

  it('toutes les 15 minutes', () => {
    const promo = pl({ id: 'promo', type: 'once_per_minutes', everyMinutes: 15, trackIds: ['j1'], isJingle: true });
    const r = run([music, promo], tracks, 20, 3, 300); // un titre toutes les 5 min
    const idx = r.map((x, i) => (x.pl === 'promo' ? i : -1)).filter((i) => i >= 0);
    expect(idx[0]).toBe(0);
    for (let k = 1; k < idx.length; k++) expect(idx[k] - idx[k - 1]).toBe(3);
  });

  it('une fois par heure à la minute 30', () => {
    const top = pl({ id: 'top', type: 'once_per_hour', minuteOfHour: 30, trackIds: ['j1'], isJingle: true });
    const r = run([music, top], tracks, 30, 3, 240); // 14:00 → 16:00
    const times = r.map((x, i) => ({ x, at: new Date(T0 + i * 240_000) })).filter((e) => e.x.pl === 'top').map((e) => e.at.getHours() * 60 + e.at.getMinutes());
    expect(times).toEqual([14 * 60 + 32, 15 * 60 + 32]);
  });
});

describe('horaires', () => {
  const t = (h: number, m: number, day = 3, date = '2026-11-04') => ({ minuteOfDay: h * 60 + m, dayOfWeek: day, date });
  it('créneau, jours et dates', () => {
    const s = { startMin: 600, endMin: 720, days: [1, 2, 3, 4, 5], startDate: '2026-11-01', endDate: '2026-11-30' };
    expect(scheduleActive(s, t(10, 30))).toBe(true);
    expect(scheduleActive(s, t(12, 0))).toBe(false);
    expect(scheduleActive(s, t(10, 30, 6))).toBe(false);
    expect(scheduleActive(s, t(10, 30, 3, '2026-12-01'))).toBe(false);
  });
  it('passe minuit', () => {
    const s = { startMin: 22 * 60, endMin: 2 * 60 };
    expect(scheduleActive(s, t(23, 0))).toBe(true);
    expect(scheduleActive(s, t(1, 0))).toBe(true);
    expect(scheduleActive(s, t(12, 0))).toBe(false);
  });
  it('une liste programmée ne joue que dans son créneau', () => {
    const tracks = lib(20);
    const noel = pl({ id: 'noel', weight: 25, avoidDuplicates: false, trackIds: ['t0', 't1'], schedule: { startDate: '2026-12-01', endDate: '2026-12-24' } });
    const base = pl({ id: 'base', avoidDuplicates: false, trackIds: [...tracks.keys()].slice(2) });
    expect(run([noel, base], tracks, 30).every((x) => x.pl === 'base')).toBe(true);
  });
  it('journée type : ambiance selon l’heure', () => {
    const parts = [
      { id: 'o', name: 'Ouverture', ambienceId: 'soft', startMin: 570, endMin: 660 },
      { id: 'd', name: 'Déjeuner', ambienceId: 'energie', startMin: 780, endMin: 900 }
    ];
    expect(ambienceAt(parts, t(13, 30)).ambienceId).toBe('energie');
    expect(ambienceAt(parts, t(12, 0), 'signature').ambienceId).toBe('signature');
  });
});

describe('aperçu', () => {
  it('simule les prochains titres', () => {
    const tracks = lib(10);
    const q = previewQueue({ playlists: [pl({ id: 'a', trackIds: [...tracks.keys()] })], tracks, history: [], start: new Date(T0), count: 5, rng: seededRng(2) });
    expect(q).toHaveLength(5);
    expect(q[1].at - q[0].at).toBe(210_000);
  });
});

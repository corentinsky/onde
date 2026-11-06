import { describe, expect, it } from 'vitest';
import { overlayDue, pickOverlay, type OverlayHistoryItem } from '../src/overlay';
import { seededRng } from '../src/music';

const songs = (n: number): OverlayHistoryItem[] => Array.from({ length: n }, () => ({}));

describe('overlayDue', () => {
  it('pose une voix tous les N titres', () => {
    const h: OverlayHistoryItem[] = [{ overlayId: 'v1' }, ...songs(2)];
    expect(overlayDue(4, h)).toBe(false); // 3e titre depuis la voix
    expect(overlayDue(4, [...h, {}])).toBe(true); // le prochain est le 4e
  });

  it('les jingles ne comptent pas comme des titres', () => {
    const h: OverlayHistoryItem[] = [{ overlayId: 'v1' }, {}, { isJingle: true }, {}, { isJingle: true }];
    expect(overlayDue(4, h)).toBe(false);
    expect(overlayDue(3, h)).toBe(true);
  });

  it('sans voix récente, attend N titres depuis le début', () => {
    expect(overlayDue(4, songs(2))).toBe(false);
    expect(overlayDue(4, songs(3))).toBe(true);
    expect(overlayDue(1, [])).toBe(true);
  });
});

describe('pickOverlay', () => {
  it('évite les voix récentes', () => {
    const h: OverlayHistoryItem[] = [{ overlayId: 'a' }, {}, { overlayId: 'b' }];
    const picks = new Set(Array.from({ length: 20 }, (_, i) => pickOverlay(['a', 'b', 'c'], h, seededRng(i))));
    expect([...picks]).toEqual(['c']);
  });

  it('une seule voix : toujours elle ; aucune : rien', () => {
    expect(pickOverlay(['a'], [{ overlayId: 'a' }])).toBe('a');
    expect(pickOverlay([], [])).toBeNull();
  });
});

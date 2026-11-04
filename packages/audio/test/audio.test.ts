import { describe, expect, it } from 'vitest';
import { analyze, effectiveMix, gainFor, kWeighting, measureLoudness, samplePeakDbfs } from '../src/index';

/** Sinus stéréo à niveau donné (dBFS, 0 = pleine échelle), durée en secondes. */
function sine(fs: number, sec: number, dbfs: number, freq = 997): Float32Array {
  const a = Math.pow(10, dbfs / 20);
  const x = new Float32Array(Math.round(fs * sec));
  for (let i = 0; i < x.length; i++) x[i] = a * Math.sin((2 * Math.PI * freq * i) / fs);
  return x;
}
const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const silence = (fs: number, sec: number) => new Float32Array(Math.round(fs * sec));
const stereo = (x: Float32Array) => [x, x.slice()];

describe('filtre K', () => {
  it('retrouve les coefficients de référence à 48 kHz (BS.1770-4)', () => {
    const [shelf, hp] = kWeighting(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 6);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 6);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 6);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 6);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 6);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 6);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 6);
  });
});

describe('volume intégré (EBU Tech 3341)', () => {
  it('sinus 1 kHz stéréo à −23 dBFS → −23 LUFS (48 kHz)', () => {
    const { integrated } = measureLoudness(stereo(sine(48000, 20, -23)), 48000);
    expect(integrated).toBeGreaterThan(-23.1);
    expect(integrated).toBeLessThan(-22.9);
  });
  it('même mesure à 44,1 kHz', () => {
    const { integrated } = measureLoudness(stereo(sine(44100, 20, -23)), 44100);
    expect(Math.abs(integrated + 23)).toBeLessThan(0.1);
  });
  it('sinus à −36 dBFS → −36 LUFS', () => {
    const { integrated } = measureLoudness(stereo(sine(48000, 20, -36)), 48000);
    expect(Math.abs(integrated + 36)).toBeLessThan(0.1);
  });
  it('les silences sont écartés par les portes', () => {
    const x = concat(sine(48000, 10, -20), silence(48000, 10));
    const { integrated } = measureLoudness(stereo(x), 48000);
    expect(Math.abs(integrated + 20)).toBeLessThan(0.2);
  });
  it('crête échantillon', () => {
    expect(samplePeakDbfs([sine(48000, 1, -6)])).toBeCloseTo(-6, 1);
  });
});

describe('gain de normalisation', () => {
  it('vise la cible', () => expect(gainFor(-12, -6, -18)).toBe(-6));
  it('ne fait jamais écrêter', () => expect(gainFor(-24, -2, -18, -1)).toBe(1));
});

describe('points de mix', () => {
  const fs = 44100;
  it('saute les silences de tête et de queue', () => {
    const x = concat(silence(fs, 2), sine(fs, 30, -14, 440), silence(fs, 1.5));
    const a = analyze(stereo(x), fs);
    expect(Math.abs(a.cueIn - 2)).toBeLessThan(0.05);
    expect(Math.abs(a.cueOut - 32)).toBeLessThan(0.05);
    expect(a.durationSec).toBeCloseTo(33.5, 1);
  });
  it('fin franche : pas de chevauchement', () => {
    const a = analyze(stereo(concat(sine(fs, 30, -14, 440), silence(fs, 1))), fs);
    expect(a.crossStart).toBe(a.cueOut);
  });
  it('fin en fondu : le titre suivant démarre pendant la descente', () => {
    const body = sine(fs, 30, -14, 440);
    const fade = sine(fs, 10, -14, 440);
    for (let i = 0; i < fade.length; i++) fade[i] *= 1 - i / fade.length;
    const a = analyze(stereo(concat(body, fade)), fs);
    expect(a.crossStart).toBeGreaterThan(30);
    expect(a.crossStart).toBeLessThan(a.cueOut - 2);
    expect(a.fadeOut).toBeCloseTo(a.cueOut - a.crossStart, 2);
  });
  it('signale les points à vérifier', () => {
    const a = analyze(stereo(concat(silence(fs, 4), sine(fs, 30, -0.05, 440))), fs);
    expect(a.warnings).toContain('long_intro_silence');
    expect(a.warnings).toContain('clipping');
  });
  it('fichier silencieux', () => {
    expect(analyze(stereo(silence(fs, 5)), fs).warnings).toEqual(['silent']);
  });
  it('mode d’enchaînement', () => {
    const p = { cueIn: 1, cueOut: 200, crossStart: 195, fadeIn: 0.1, fadeOut: 5 };
    expect(effectiveMix(p, 'none', 2).crossStart).toBe(200);
    expect(effectiveMix(p, 'normal', 3).crossStart).toBe(197);
    expect(effectiveMix(p, 'smart', 2).crossStart).toBe(195);
  });
});

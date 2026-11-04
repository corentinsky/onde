/**
 * Analyse audio d’Onde : volume (EBU R128 / ITU-R BS.1770-4) et points de mix.
 *
 * Exécutée dans la régie au dépôt d’un morceau (sur le PCM décodé par le navigateur).
 * Pure et testée : aucune dépendance au navigateur.
 *
 * Points de mix, en secondes depuis le début du fichier (mêmes notions qu’AzuraCast) :
 *  - cueIn       : début audible (les silences de tête sont sautés)
 *  - cueOut      : fin audible (les silences de queue sont sautés)
 *  - crossStart  : moment où le titre suivant démarre (chevauchement, « overlay »)
 *  - fadeIn      : durée du fondu d’entrée à partir de cueIn
 *  - fadeOut     : durée du fondu de sortie, terminé à cueOut
 */

export const ANALYSIS_VERSION = 1;

export interface AnalysisOptions {
  /** Seuil de silence, en LU sous le volume intégré (début et fin audibles). */
  silenceLu?: number;
  /** Le chevauchement commence quand le volume passe sous (intégré − overlayLu). */
  overlayLu?: number;
  /** Fin longue : au-delà de cette durée de traîne, on cherche un seuil plus bas. */
  longTailSec?: number;
  /** Seuil supplémentaire pour les fins longues (LU). */
  longTailExtraLu?: number;
  /** Nombre de points de la forme d’onde. */
  waveformPoints?: number;
}

export interface Analysis {
  version: number;
  durationSec: number;
  sampleRate: number;
  channels: number;
  /** Volume intégré (LUFS). -Infinity si silence complet. */
  integratedLufs: number;
  /** Plage de volume (LRA approximative, LU). */
  loudnessRangeLu: number;
  /** Crête échantillon (dBFS). */
  peakDbfs: number;
  cueIn: number;
  cueOut: number;
  crossStart: number;
  fadeIn: number;
  fadeOut: number;
  /** Forme d’onde (0..1), pour l’éditeur de points de mix. */
  waveform: number[];
  /** Avertissements pour la régie (« à vérifier »). */
  warnings: Warning[];
}

export type Warning = 'silent' | 'too_quiet' | 'clipping' | 'long_intro_silence' | 'long_outro_silence' | 'very_short';

const DEFAULTS: Required<AnalysisOptions> = {
  silenceLu: 42,
  overlayLu: 8,
  longTailSec: 15,
  longTailExtraLu: 12,
  waveformPoints: 400
};

// ───────────────────────── Filtre K (BS.1770-4) ─────────────────────────
interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** Coefficients du filtre de pondération K, recalculés pour toute fréquence d’échantillonnage. */
export function kWeighting(fs: number): [Biquad, Biquad] {
  // Étage 1 : plateau haut (effet de la tête)
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0
  };
  // Étage 2 : passe-haut RLB
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const highpass: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, highpass];
}

function filter(x: Float32Array, [s1, s2]: [Biquad, Biquad]): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0; // étage 1
  let u1 = 0, u2 = 0, v1 = 0, v2 = 0; // étage 2
  for (let n = 0; n < x.length; n++) {
    const xn = x[n];
    const yn = s1.b0 * xn + s1.b1 * x1 + s1.b2 * x2 - s1.a1 * y1 - s1.a2 * y2;
    x2 = x1; x1 = xn; y2 = y1; y1 = yn;
    const vn = s2.b0 * yn + s2.b1 * u1 + s2.b2 * u2 - s2.a1 * v1 - s2.a2 * v2;
    u2 = u1; u1 = yn; v2 = v1; v1 = vn;
    y[n] = vn;
  }
  return y;
}

const lufs = (meanSquare: number) => (meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : -Infinity);

export interface Loudness {
  integrated: number;
  /** Volume « momentané » par bloc de 400 ms, pas de 100 ms. */
  blocks: { start: number; lufs: number }[];
  rangeLu: number;
}

/** Volume intégré BS.1770-4 avec portes absolue (−70 LUFS) et relative (−10 LU). */
export function measureLoudness(channels: Float32Array[], fs: number): Loudness {
  const coeffs = kWeighting(fs);
  const weighted = channels.slice(0, 2).map((c) => filter(c, coeffs)); // L, R : poids 1
  const n = weighted[0]?.length ?? 0;
  const block = Math.round(0.4 * fs);
  const hop = Math.round(0.1 * fs);
  if (n < block) return { integrated: -Infinity, blocks: [], rangeLu: 0 };

  // Sommes cumulées des carrés : chaque bloc se calcule en O(1).
  const cum = weighted.map((w) => {
    const c = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) c[i + 1] = c[i] + w[i] * w[i];
    return c;
  });
  const ms: number[] = [];
  const blocks: { start: number; lufs: number }[] = [];
  for (let s = 0; s + block <= n; s += hop) {
    let z = 0;
    for (const c of cum) z += (c[s + block] - c[s]) / block;
    ms.push(z);
    blocks.push({ start: s / fs, lufs: lufs(z) });
  }

  const abs = ms.filter((z) => lufs(z) > -70);
  if (!abs.length) return { integrated: -Infinity, blocks, rangeLu: 0 };
  const relGate = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((z) => lufs(z) > relGate);
  const integrated = lufs(gated.reduce((a, b) => a + b, 0) / gated.length);

  // Plage de volume simplifiée (EBU 3342 : percentiles 10–95 des blocs, porte −20 LU).
  const st = blocks.map((b) => b.lufs).filter((l) => l > -70 && l > integrated - 20).sort((a, b) => a - b);
  const pct = (p: number) => st[Math.min(st.length - 1, Math.max(0, Math.round((p / 100) * (st.length - 1))))];
  const rangeLu = st.length ? pct(95) - pct(10) : 0;
  return { integrated, blocks, rangeLu };
}

export function samplePeakDbfs(channels: Float32Array[]): number {
  let peak = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > peak) peak = a; }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/**
 * Gain à appliquer pour atteindre la cible (LUFS), sans que la crête dépasse le plafond (dBFS).
 * Même logique que la normalisation d’AzuraCast/autocue : on ne pousse jamais au point d’écrêter.
 */
export function gainFor(integratedLufs: number, peakDbfs: number, targetLufs = -18, ceilingDbfs = -1): number {
  if (!Number.isFinite(integratedLufs)) return 0;
  const wanted = targetLufs - integratedLufs;
  const room = ceilingDbfs - peakDbfs;
  return Math.round(Math.min(wanted, room) * 10) / 10;
}

/** RMS en dBFS par fenêtres de 10 ms (mono) : sert à affiner les points au centième. */
function fineRms(channels: Float32Array[], fs: number) {
  const win = Math.max(1, Math.round(0.01 * fs));
  const n = channels[0].length;
  const out: number[] = [];
  for (let s = 0; s < n; s += win) {
    let sum = 0, cnt = 0;
    for (const c of channels.slice(0, 2)) for (let i = s; i < Math.min(n, s + win); i++) { sum += c[i] * c[i]; cnt++; }
    out.push(sum > 0 ? 10 * Math.log10(sum / cnt) : -Infinity);
  }
  return { win: win / fs, rms: out };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function analyze(channels: Float32Array[], sampleRate: number, options: AnalysisOptions = {}): Analysis {
  const o = { ...DEFAULTS, ...options };
  const n = channels[0]?.length ?? 0;
  const duration = n / sampleRate;
  const { integrated, blocks, rangeLu } = measureLoudness(channels, sampleRate);
  const peak = samplePeakDbfs(channels);
  const waveform = waveformPeaks(channels, o.waveformPoints);
  const warnings: Warning[] = [];

  if (!Number.isFinite(integrated)) {
    return { version: ANALYSIS_VERSION, durationSec: duration, sampleRate, channels: channels.length, integratedLufs: -Infinity, loudnessRangeLu: 0, peakDbfs: peak, cueIn: 0, cueOut: duration, crossStart: duration, fadeIn: 0, fadeOut: 0, waveform, warnings: ['silent'] };
  }

  const silence = Math.max(-70, integrated - o.silenceLu);
  const audible = blocks.filter((b) => b.lufs > silence);
  const first = audible[0];
  const last = audible[audible.length - 1];

  // Affinage à 10 ms : premier/dernier instant au-dessus du seuil (RMS non pondéré, seuil converti en dBFS).
  const { win, rms } = fineRms(channels, sampleRate);
  // Seuil LUFS converti en RMS par canal (stéréo : −3,01 dB ; mono : 0 dB).
  const thrDb = silence + 0.691 - 10 * Math.log10(Math.min(2, channels.length));
  let cueIn = first.start;
  {
    const from = Math.max(0, Math.floor((first.start - 0.1) / win));
    const to = Math.min(rms.length, Math.ceil((first.start + 0.5) / win));
    for (let i = from; i < to; i++) if (rms[i] > thrDb) { cueIn = i * win; break; }
  }
  let cueOut = Math.min(duration, last.start + 0.4);
  {
    const from = Math.min(rms.length - 1, Math.ceil(cueOut / win));
    const to = Math.max(0, Math.floor((last.start - 0.1) / win));
    for (let i = from; i >= to; i--) if (rms[i] > thrDb) { cueOut = Math.min(duration, (i + 1) * win); break; }
  }

  // Point de chevauchement : dernier bloc encore « plein », en remontant depuis la fin.
  const findCross = (lu: number) => {
    const thr = integrated - lu;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.start + 0.4 > cueOut + 0.05) continue;
      if (b.lufs >= thr) return Math.min(cueOut, b.start + 0.4);
    }
    return cueOut;
  };
  let crossStart = findCross(o.overlayLu);
  if (cueOut - crossStart > o.longTailSec) crossStart = findCross(o.overlayLu + o.longTailExtraLu);
  crossStart = Math.max(cueIn, Math.min(cueOut, crossStart));
  if (cueOut - crossStart < 0.1) crossStart = cueOut; // fin franche : pas de chevauchement

  if (integrated < -30) warnings.push('too_quiet');
  if (peak > -0.1) warnings.push('clipping');
  if (cueIn > 3) warnings.push('long_intro_silence');
  if (duration - cueOut > 5) warnings.push('long_outro_silence');
  if (cueOut - cueIn < 20) warnings.push('very_short');

  return {
    version: ANALYSIS_VERSION,
    durationSec: round2(duration),
    sampleRate,
    channels: channels.length,
    integratedLufs: Math.round(integrated * 10) / 10,
    loudnessRangeLu: Math.round(rangeLu * 10) / 10,
    peakDbfs: Math.round(peak * 10) / 10,
    cueIn: round2(cueIn),
    cueOut: round2(cueOut),
    crossStart: round2(crossStart),
    fadeIn: 0.1,
    fadeOut: round2(Math.max(0.1, cueOut - crossStart)),
    waveform,
    warnings
  };
}

/** Crêtes par tranche (0..1, 3 décimales). */
export function waveformPeaks(channels: Float32Array[], points = 400): number[] {
  const n = channels[0]?.length ?? 0;
  if (!n) return [];
  const step = n / points;
  const out: number[] = [];
  for (let p = 0; p < points; p++) {
    let m = 0;
    const a = Math.floor(p * step), b = Math.min(n, Math.floor((p + 1) * step));
    for (const c of channels) for (let i = a; i < b; i++) { const v = Math.abs(c[i]); if (v > m) m = v; }
    out.push(Math.round(Math.min(1, m) * 1000) / 1000);
  }
  return out;
}

/** Points de mix effectifs selon le mode d’enchaînement de l’ambiance. */
export type CrossfadeMode = 'smart' | 'normal' | 'none';
export interface MixPoints { cueIn: number; cueOut: number; crossStart: number; fadeIn: number; fadeOut: number }

export function effectiveMix(p: MixPoints, mode: CrossfadeMode, crossfadeSec: number): MixPoints {
  if (mode === 'none') return { ...p, crossStart: p.cueOut, fadeOut: 0, fadeIn: 0 };
  if (mode === 'normal') {
    const c = Math.max(p.cueIn, p.cueOut - crossfadeSec);
    return { ...p, crossStart: c, fadeOut: p.cueOut - c, fadeIn: Math.min(crossfadeSec, p.fadeIn || crossfadeSec) };
  }
  // smart : on respecte le point de chevauchement détecté, borné par la durée maximale.
  const c = Math.max(p.crossStart, p.cueOut - Math.max(crossfadeSec, 0.1) * 4);
  return { ...p, crossStart: c, fadeOut: Math.max(0.1, p.cueOut - c) };
}

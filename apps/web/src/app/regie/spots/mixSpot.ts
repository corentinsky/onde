/**
 * Fabrication d’un spot dans le navigateur : voix (IA ou fichier), fond musical facultatif,
 * volume normalisé au niveau de la musique (−18 LUFS, crête sous −1 dBFS), export WAV.
 */
import { gainFor, measureLoudness, samplePeakDbfs } from '@onde/audio';

const SR = 44100;
const chans = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i));

export interface Rendered {
  wav: Blob;
  duration: number;
  lufs: number;
}

/** Fond musical 16 LU sous la voix ; entrée 1,2 s avant la voix, sortie en fondu après. */
export async function renderSpot(voice: AudioBuffer, bed: AudioBuffer | null, targetLufs = -18): Promise<Rendered> {
  const pre = bed ? 1.2 : 0.15;
  const post = bed ? 1.8 : 0.3;
  const duration = pre + voice.duration + post;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * SR), SR);

  const v = ctx.createBufferSource();
  v.buffer = voice;
  v.connect(ctx.destination);
  v.start(pre);

  if (bed) {
    // Un fichier mono est joué sur deux enceintes : +3 dB par rapport à sa mesure.
    const mono = (x: AudioBuffer) => (x.numberOfChannels === 1 ? 3.01 : 0);
    const lv = measureLoudness(chans(voice), voice.sampleRate).integrated + mono(voice);
    const lb = measureLoudness(chans(bed), bed.sampleRate).integrated + mono(bed);
    const level = Number.isFinite(lv) && Number.isFinite(lb) ? Math.pow(10, (lv - 16 - lb) / 20) : 0.15;
    const b = ctx.createBufferSource();
    b.buffer = bed;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.linearRampToValueAtTime(level, 0.6);
    g.gain.setValueAtTime(level, pre + voice.duration + 0.2);
    g.gain.linearRampToValueAtTime(0.0001, duration);
    b.connect(g).connect(ctx.destination);
    // On part du cœur du morceau, pas de son introduction.
    b.start(0, Math.min(30, bed.duration * 0.3));
  }

  const mixed = await ctx.startRendering();
  const c = chans(mixed);
  const lufs = measureLoudness(c, SR).integrated;
  const gain = Math.pow(10, gainFor(lufs, samplePeakDbfs(c), targetLufs) / 20);
  for (const ch of c) for (let i = 0; i < ch.length; i++) ch[i] = Math.max(-1, Math.min(1, ch[i] * gain));
  return { wav: encodeWav(c, SR), duration, lufs: measureLoudness(c, SR).integrated };
}

export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const n = channels[0].length;
  const k = channels.length;
  const buf = new ArrayBuffer(44 + n * k * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * k * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, k, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * k * 2, true);
  v.setUint16(32, k * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * k * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < k; c++) {
      v.setInt16(o, Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767), true);
      o += 2;
    }
  return new Blob([buf], { type: 'audio/wav' });
}

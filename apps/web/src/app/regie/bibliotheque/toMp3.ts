/**
 * Compression des morceaux lourds avant l’envoi (WAV, FLAC, MP3 à fort débit…) : MP3 192 kb/s.
 * Le flux des boutiques est en 128 kb/s : au-delà, la différence ne s’entend pas, mais le stockage
 * et la bande passante (émetteur, cache des lecteurs) coûtent quatre à huit fois plus.
 */

/** Débit au-delà duquel un fichier est recompressé (bits par seconde). */
const MAX_BPS = 200_000;
const BITRATE = 192;

/** Le fichier peut-il être envoyé tel quel ? MP3 ou AAC déjà légers : oui. */
export function keepAsIs(file: File, durationSec: number): boolean {
  if (!/\.(mp3|m4a|aac)$/i.test(file.name)) return false;
  return durationSec > 0 && (file.size * 8) / durationSec <= MAX_BPS;
}

/** Encode le son décodé en MP3, par tranches, en rendant la main à la page entre deux tranches. */
export async function toMp3(buf: AudioBuffer, onProgress?: (percent: number) => void): Promise<Blob> {
  const { createMp3Encoder } = await import('wasm-media-encoders');
  const enc = await createMp3Encoder();
  const stereo = buf.numberOfChannels > 1;
  enc.configure({
    sampleRate: buf.sampleRate,
    channels: stereo ? 2 : 1,
    bitrate: BITRATE,
    outputSampleRate: buf.sampleRate === 48000 ? 48000 : 44100
  });
  const channels = stereo ? [buf.getChannelData(0), buf.getChannelData(1)] : [buf.getChannelData(0)];
  const step = buf.sampleRate * 5;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < buf.length; i += step) {
    // L’encodeur réutilise sa mémoire de sortie : on copie chaque tranche.
    parts.push(enc.encode(channels.map((c) => c.subarray(i, i + step))).slice());
    onProgress?.(Math.min(99, Math.round(((i + step) / buf.length) * 100)));
    await new Promise((r) => setTimeout(r, 0));
  }
  parts.push(enc.finalize().slice());
  onProgress?.(100);
  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
}

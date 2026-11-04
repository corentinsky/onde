'use client';

/**
 * Son d’un spot : voix générée par IA (avec fond musical facultatif) ou fichier déjà produit.
 * Le spot est mixé et normalisé dans le navigateur, puis enregistré dans le dossier de l’enseigne.
 */
import { useRef, useState } from 'react';
import { browserClient, browserConfigured } from '@/lib/supabase/browser';
import { generateVoice } from '../voix-actions';
import { renderSpot } from './mixSpot';

interface Props {
  orgId: string;
  voices: { id: string; name: string; description: string }[];
  beds: { id: string; label: string; url: string }[];
  voiceReady: boolean;
  voiceError?: string | null;
}

type Mode = 'ai' | 'file' | 'none';

export function SpotAudio({ orgId, voices, beds, voiceReady, voiceError }: Props) {
  const [mode, setMode] = useState<Mode>(voiceReady ? 'ai' : 'file');
  const [text, setText] = useState('');
  const [voice, setVoice] = useState(voices[0]?.id ?? '');
  const [bed, setBed] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ path: string; url: string; duration: number; lufs: number; kind: 'ai' | 'file'; voice: string } | null>(null);
  const ctx = useRef<AudioContext | null>(null);

  const decode = async (data: ArrayBuffer) => {
    ctx.current ??= new AudioContext();
    return ctx.current.decodeAudioData(data);
  };

  async function finish(voiceBuf: AudioBuffer, kind: 'ai' | 'file', voiceName: string) {
    setStatus('Mixage et réglage du volume…');
    const bedBuf = kind === 'ai' && bed ? await decode(await (await fetch(beds.find((b) => b.id === bed)!.url)).arrayBuffer()) : null;
    const r = await renderSpot(voiceBuf, bedBuf);
    if (r.duration > 600) throw new Error('Spot trop long (10 min au plus).');
    let path = '';
    if (browserConfigured) {
      setStatus('Enregistrement…');
      path = `${orgId}/${crypto.randomUUID()}.wav`;
      const up = await browserClient().storage.from('spots').upload(path, r.wav, { contentType: 'audio/wav', upsert: false });
      if (up.error) throw new Error(up.error.message);
    }
    if (result?.url) URL.revokeObjectURL(result.url);
    setResult({ path, url: URL.createObjectURL(r.wav), duration: r.duration, lufs: r.lufs, kind, voice: voiceName });
    setStatus('');
  }

  async function run(job: () => Promise<void>) {
    setBusy(true);
    setStatus('');
    try {
      await job();
    } catch (e) {
      setStatus((e as Error).message || 'Échec');
    } finally {
      setBusy(false);
    }
  }

  const generate = () =>
    run(async () => {
      setStatus('Génération de la voix…');
      const r = await generateVoice(text, voice);
      if (r.error || !r.audio) throw new Error(r.error ?? 'Échec de la génération');
      const bytes = Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0));
      await finish(await decode(bytes.buffer), 'ai', voices.find((v) => v.id === voice)?.name ?? '');
    });

  const fromFile = (file: File) =>
    run(async () => {
      setStatus('Lecture du fichier…');
      await finish(await decode(await file.arrayBuffer()), 'file', '');
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <span>Son du spot</span>
        <div className="choice">
          <label><input type="radio" checked={mode === 'ai'} onChange={() => setMode('ai')} disabled={!voiceReady} /><span>Voix IA</span></label>
          <label><input type="radio" checked={mode === 'file'} onChange={() => setMode('file')} /><span>Fichier produit</span></label>
          <label><input type="radio" checked={mode === 'none'} onChange={() => setMode('none')} /><span>Texte seul</span></label>
        </div>
      </fieldset>

      <label className="field">
        <span>{mode === 'file' ? 'Texte (pour mémoire)' : 'Texte lu'}</span>
        <textarea className="textarea" name="script" value={text} onChange={(e) => setText(e.target.value)} maxLength={800} placeholder="Offrez l’élégance : la carte cadeau est disponible en caisse." />
      </label>
      {mode === 'none' && <p className="small muted" style={{ margin: 0 }}>Le lecteur lira le texte avec la voix de l’appareil : à réserver aux essais.</p>}
      {!voiceReady && (
        <p className="small muted" style={{ margin: 0 }}>
          {voiceError ? `Voix IA indisponible : ${voiceError}` : 'Voix IA : ajoutez la clé ELEVENLABS_API_KEY dans Vercel pour l’activer.'}
        </p>
      )}

      {mode === 'ai' && voiceReady && (
        <div className="form-grid" style={{ alignItems: 'end' }}>
          <label className="field">
            <span>Voix</span>
            <select className="select" value={voice} onChange={(e) => setVoice(e.target.value)}>
              {voices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.description ? ` · ${v.description}` : ''}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Fond musical</span>
            <select className="select" value={bed} onChange={(e) => setBed(e.target.value)}>
              <option value="">Sans fond musical</option>
              {beds.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-dark" onClick={generate} disabled={busy || text.trim().length < 3}>{result?.kind === 'ai' ? 'Régénérer' : 'Générer la voix'}</button>
        </div>
      )}

      {mode === 'file' && (
        <label className="field">
          <span>Fichier (MP3, WAV, M4A)</span>
          <input className="input" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac" disabled={busy} onChange={(e) => e.target.files?.[0] && fromFile(e.target.files[0])} />
        </label>
      )}

      {status && <div className="small muted" role="status">{status}</div>}

      {result && mode !== 'none' && (
        <div className="card" style={{ margin: 0, padding: 14, background: 'var(--surface-2)' }}>
          <div className="small" style={{ marginBottom: 8 }}>
            Prêt : {result.duration.toFixed(1)} s · {result.lufs.toFixed(1)} LUFS{result.voice ? ` · voix ${result.voice}` : ''}
          </div>
          <audio controls src={result.url} style={{ width: '100%' }} />
          <input type="hidden" name="audio_path" value={result.path} />
          <input type="hidden" name="audio_kind" value={result.kind} />
          <input type="hidden" name="voice_name" value={result.voice} />
          <input type="hidden" name="audio_duration" value={Math.ceil(result.duration)} />
        </div>
      )}
    </div>
  );
}

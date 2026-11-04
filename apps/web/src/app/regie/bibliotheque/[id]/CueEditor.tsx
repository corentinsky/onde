'use client';

/**
 * Éditeur des points de mix (équivalent du « Visual Cue Editor » d’AzuraCast).
 * Forme d’onde, marqueurs déplaçables (début, chevauchement, fin), écoute des transitions
 * avec le gain et les fondus réellement appliqués par le lecteur.
 */
import { useEffect, useRef, useState } from 'react';
import { analyze, gainFor } from '@onde/audio';

interface Props {
  duration: number;
  waveform: number[];
  initial: { cueIn: number; crossStart: number; cueOut: number; fadeIn: number; fadeOut: number };
  integratedLufs: number | null;
  peakDbfs: number | null;
  audioUrl: string | null;
  targetLufs: number;
}

type Marker = 'cueIn' | 'crossStart' | 'cueOut';
const COLORS: Record<Marker, string> = { cueIn: '#34c759', crossStart: '#0071e3', cueOut: '#ff3b30' };
const NAMES: Record<Marker, string> = { cueIn: 'Début', crossStart: 'Chevauchement', cueOut: 'Fin' };

export function CueEditor({ duration, waveform, initial, integratedLufs, peakDbfs, audioUrl, targetLufs }: Props) {
  const [p, setP] = useState(initial);
  const [drag, setDrag] = useState<Marker | null>(null);
  const [status, setStatus] = useState('');
  // « keep » : points inchangés, l’état manuel/automatique du titre reste tel quel.
  const [manual, setManual] = useState<'keep' | 'true' | 'false'>('keep');
  // Saisie en cours au clavier : appliquée à la sortie du champ, pas à chaque touche.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const svg = useRef<SVGSVGElement>(null);
  const ctx = useRef<AudioContext | null>(null);
  const buffer = useRef<AudioBuffer | null>(null);
  const playing = useRef<AudioScheduledSourceNode[]>([]);
  const gain = integratedLufs != null ? gainFor(integratedLufs, peakDbfs ?? 0, targetLufs) : 0;

  const W = 1000, H = 160;
  const x = (t: number) => (t / duration) * W;
  const tAt = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };

  const set = (m: Marker, t: number) => {
    setManual('true');
    setP((cur) => {
      const n = { ...cur, [m]: Math.round(t * 100) / 100 };
      if (m === 'cueIn') n.cueIn = Math.min(n.cueIn, n.crossStart - 0.1);
      if (m === 'cueOut') n.cueOut = Math.max(n.cueOut, n.crossStart);
      if (m === 'crossStart') n.crossStart = Math.max(n.cueIn, Math.min(n.cueOut, n.crossStart));
      n.fadeOut = Math.round(Math.max(0.1, n.cueOut - n.crossStart) * 100) / 100;
      return n;
    });
  };
  const commit = (name: string, k: keyof typeof initial) => {
    const raw = draft[name];
    setDraft(({ [name]: _gone, ...rest }) => rest);
    if (raw == null) return;
    const v = Number(raw.replace(',', '.'));
    if (!Number.isFinite(v)) return;
    if (k === 'fadeIn' || k === 'fadeOut') {
      setManual('true');
      setP((cur) => ({ ...cur, [k]: Math.max(0, Math.min(30, Math.round(v * 100) / 100)) }));
    } else set(k, Math.max(0, Math.min(duration, v)));
  };
  /** Les erreurs d’écoute (fichier indisponible, format) s’affichent au lieu d’être silencieuses. */
  const safe = (fn: () => Promise<void>) => () => {
    fn().catch((e: Error) => setStatus(`Écoute impossible : ${e.message}`));
  };

  useEffect(() => () => { ctx.current?.close(); }, []);

  async function load() {
    if (buffer.current) return buffer.current;
    if (!audioUrl) throw new Error('Fichier indisponible');
    setStatus('Chargement du fichier…');
    ctx.current ??= new AudioContext();
    const res = await fetch(audioUrl);
    if (!res.ok) throw new Error('fichier inaccessible, rechargez la page');
    const data = await res.arrayBuffer();
    buffer.current = await ctx.current.decodeAudioData(data);
    setStatus('');
    return buffer.current;
  }

  function stop() {
    playing.current.forEach((s) => { try { s.stop(); } catch { /* déjà arrêté */ } });
    playing.current = [];
  }

  /** Joue [from, to] avec le gain de normalisation et des fondus. */
  async function play(from: number, to: number, fadeIn: number, fadeOutFrom: number | null) {
    const b = await load();
    const c = ctx.current!;
    await c.resume();
    stop();
    const src = c.createBufferSource();
    src.buffer = b;
    const g = c.createGain();
    const lin = Math.pow(10, gain / 20);
    const t0 = c.currentTime + 0.05;
    g.gain.setValueAtTime(fadeIn > 0 ? 0.0001 : lin, t0);
    if (fadeIn > 0) g.gain.linearRampToValueAtTime(lin, t0 + fadeIn);
    if (fadeOutFrom != null && fadeOutFrom < to) {
      g.gain.setValueAtTime(lin, t0 + (fadeOutFrom - from));
      g.gain.linearRampToValueAtTime(0.0001, t0 + (to - from));
    }
    src.connect(g).connect(c.destination);
    src.start(t0, from, to - from);
    playing.current = [src];
  }

  /** Transition réelle : la fin de ce titre, et son propre début qui démarre au point de chevauchement. */
  async function transition() {
    const b = await load();
    const c = ctx.current!;
    await c.resume();
    stop();
    const lin = Math.pow(10, gain / 20);
    const t0 = c.currentTime + 0.05;
    const lead = Math.min(8, p.crossStart - p.cueIn);
    const a = c.createBufferSource(); a.buffer = b;
    const ga = c.createGain();
    ga.gain.setValueAtTime(lin, t0);
    ga.gain.setValueAtTime(lin, t0 + lead);
    ga.gain.linearRampToValueAtTime(0.0001, t0 + lead + (p.cueOut - p.crossStart));
    a.connect(ga).connect(c.destination);
    a.start(t0, p.crossStart - lead, lead + (p.cueOut - p.crossStart));
    const n = c.createBufferSource(); n.buffer = b;
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t0 + lead);
    gn.gain.linearRampToValueAtTime(lin, t0 + lead + Math.max(0.05, p.fadeIn));
    n.connect(gn).connect(c.destination);
    n.start(t0 + lead, p.cueIn, 10);
    playing.current = [a, n];
  }

  async function reanalyze() {
    const b = await load();
    setStatus('Analyse…');
    const r = analyze(Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i)), b.sampleRate);
    setP({ cueIn: r.cueIn, crossStart: r.crossStart, cueOut: r.cueOut, fadeIn: r.fadeIn, fadeOut: r.fadeOut });
    setDraft({});
    setManual('false');
    setStatus('Points recalculés. Enregistrez pour les garder.');
  }

  const bars = waveform.length ? waveform : new Array(200).fill(0.05);
  const bw = W / bars.length;

  return (
    <div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: 180, display: 'block', background: '#1d1d1f', borderRadius: 16, touchAction: 'none', cursor: drag ? 'grabbing' : 'default' }}
        onPointerMove={(e) => drag && set(drag, tAt(e.clientX))}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
        role="img"
        aria-label="Forme d’onde et points de mix"
      >
        <rect x={0} y={0} width={x(p.cueIn)} height={H} fill="#000" opacity={0.55} />
        <rect x={x(p.cueOut)} y={0} width={W - x(p.cueOut)} height={H} fill="#000" opacity={0.55} />
        <rect x={x(p.crossStart)} y={0} width={Math.max(0, x(p.cueOut) - x(p.crossStart))} height={H} fill="#0071e3" opacity={0.18} />
        {bars.map((v, i) => {
          const t = (i + 0.5) * (duration / bars.length);
          const inside = t >= p.cueIn && t <= p.cueOut;
          const h = Math.max(1, v * (H - 20));
          return <rect key={i} x={i * bw} y={(H - h) / 2} width={Math.max(0.6, bw * 0.7)} height={h} fill={inside ? '#f5f5f7' : '#636366'} />;
        })}
        {(Object.keys(COLORS) as Marker[]).map((m) => (
          <g key={m} onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(m); }} style={{ cursor: 'ew-resize' }}>
            <rect x={x(p[m]) - 8} y={0} width={16} height={H} fill="transparent" />
            <line x1={x(p[m])} x2={x(p[m])} y1={0} y2={H} stroke={COLORS[m]} strokeWidth={3} vectorEffect="non-scaling-stroke" />
            <rect x={x(p[m]) - 6} y={0} width={12} height={12} fill={COLORS[m]} />
          </g>
        ))}
      </svg>
      <div className="actions" style={{ marginTop: 10, fontSize: 13, gap: 16 }}>
        {(Object.keys(COLORS) as Marker[]).map((m) => (
          <span key={m} className="status"><span className="dot" style={{ background: COLORS[m] }} />{NAMES[m]}</span>
        ))}
        <span className="muted">Zone bleue : fondu de sortie, pendant lequel le titre suivant démarre.</span>
      </div>

      <div className="form-grid" style={{ marginTop: 18 }}>
        {([['cue_in', 'cueIn', 'Début (s)'], ['cross_start', 'crossStart', 'Chevauchement (s)'], ['cue_out', 'cueOut', 'Fin (s)'], ['fade_in', 'fadeIn', 'Fondu d’entrée (s)'], ['fade_out', 'fadeOut', 'Fondu de sortie (s)']] as const).map(([name, k, lab]) => (
          <label key={name} className="field">
            <span>{lab}</span>
            <input
              className="input"
              type="number"
              step="0.01"
              min={0}
              max={duration}
              name={name}
              value={draft[name] ?? String(p[k])}
              onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value }))}
              onBlur={() => commit(name, k)}
            />
          </label>
        ))}
      </div>
      <input type="hidden" name="manual" value={manual} />

      <div className="actions" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-dark btn-small" onClick={safe(() => play(p.cueIn, Math.min(p.cueOut, p.cueIn + 12), p.fadeIn, null))} disabled={!audioUrl}>Écouter le début</button>
        <button type="button" className="btn btn-dark btn-small" onClick={safe(() => play(Math.max(p.cueIn, p.crossStart - 8), p.cueOut, 0, p.crossStart))} disabled={!audioUrl}>Écouter la fin</button>
        <button type="button" className="btn btn-dark btn-small" onClick={safe(transition)} disabled={!audioUrl}>Écouter l’enchaînement</button>
        <button type="button" className="btn btn-secondary btn-small" onClick={stop}>Arrêter</button>
        <button type="button" className="btn btn-secondary btn-small" onClick={safe(reanalyze)} disabled={!audioUrl}>Réanalyser</button>
        {status && <span className="small muted" style={{ alignSelf: 'center' }}>{status}</span>}
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        Écoute avec le gain appliqué en boutique : {gain > 0 ? '+' : ''}{gain} dB pour atteindre {targetLufs} LUFS sans dépasser −1 dBFS.
      </p>
    </div>
  );
}

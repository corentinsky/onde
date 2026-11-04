'use client';

/**
 * Dépôt de morceaux : lecture des étiquettes, décodage et analyse dans le navigateur
 * (volume EBU R128, points de mix), puis envoi du fichier et de l’analyse.
 */
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { analyze, gainFor, type Analysis } from '@onde/audio';
import { browserClient, browserConfigured } from '@/lib/supabase/browser';

interface Item {
  name: string;
  status: 'waiting' | 'reading' | 'analysing' | 'uploading' | 'done' | 'error';
  message?: string;
  result?: { title: string; artist: string; a: Analysis };
}

const label: Record<Item['status'], string> = {
  waiting: 'En attente',
  reading: 'Lecture des étiquettes…',
  analysing: 'Analyse du son…',
  uploading: 'Envoi…',
  done: 'Prêt',
  error: 'Erreur'
};

function fromFileName(name: string) {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
  const m = base.match(/^(.*?)\s+-\s+(.*)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base.trim() };
}

export function Uploader({ playlists }: { playlists: { id: string; label: string }[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('');

  const update = (i: number, patch: Partial<Item>) => setItems((list) => list.map((it, k) => (k === i ? { ...it, ...patch } : it)));

  async function process(files: File[]) {
    const audio = files.filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(f.name));
    if (!audio.length) return;
    const start = items.length;
    setItems((list) => [...list, ...audio.map((f) => ({ name: f.name, status: 'waiting' as const }))]);
    setBusy(true);
    const ctx = new AudioContext();
    // Les titres déposés s’ajoutent à la fin de la liste choisie, dans l’ordre du dépôt.
    const list = target;
    let pos = 1;
    if (list && browserConfigured) {
      const { data: last } = await browserClient().from('playlist_tracks').select('position').eq('playlist_id', list).order('position', { ascending: false }).limit(1).maybeSingle();
      pos = (last?.position ?? 0) + 1;
    }
    for (let k = 0; k < audio.length; k++) {
      const file = audio[k];
      const i = start + k;
      try {
        update(i, { status: 'reading' });
        let meta = { ...fromFileName(file.name), album: '', genre: '', year: null as number | null, isrc: null as string | null };
        try {
          const { parseBlob } = await import('music-metadata');
          const { common } = await parseBlob(file, { skipCovers: true });
          meta = {
            title: common.title || meta.title,
            artist: common.artist || meta.artist,
            album: common.album || '',
            genre: common.genre?.[0] || '',
            year: common.year ?? null,
            isrc: common.isrc?.[0] ?? null
          };
        } catch {
          /* pas d’étiquettes lisibles : on garde le nom du fichier */
        }

        update(i, { status: 'analysing' });
        const buf = await ctx.decodeAudioData(await file.arrayBuffer());
        const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
        const a = analyze(channels, buf.sampleRate);
        if (a.warnings.includes('silent')) throw new Error('Fichier silencieux');

        if (!browserConfigured) {
          update(i, { status: 'done', message: 'Analyse seulement (mode démo)', result: { title: meta.title, artist: meta.artist, a } });
          continue;
        }
        update(i, { status: 'uploading', result: { title: meta.title, artist: meta.artist, a } });
        const sb = browserClient();
        const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
        const path = `${crypto.randomUUID()}.${ext}`;
        const up = await sb.storage.from('music').upload(path, file, { contentType: file.type || 'audio/mpeg', upsert: false });
        if (up.error) throw new Error(up.error.message);
        const { data: row, error } = await sb
          .from('tracks')
          .insert({
            storage_path: path,
            file_name: file.name,
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            genre: meta.genre,
            year: meta.year,
            isrc: meta.isrc,
            duration_sec: a.durationSec,
            sample_rate: a.sampleRate,
            channels: a.channels,
            integrated_lufs: Number.isFinite(a.integratedLufs) ? a.integratedLufs : null,
            loudness_range_lu: a.loudnessRangeLu,
            peak_dbfs: Number.isFinite(a.peakDbfs) ? a.peakDbfs : null,
            cue_in: a.cueIn,
            cue_out: a.cueOut,
            cross_start: a.crossStart,
            fade_in: a.fadeIn,
            fade_out: a.fadeOut,
            waveform: a.waveform,
            warnings: a.warnings,
            analysis_version: a.version
          })
          .select('id')
          .single();
        if (error) {
          await sb.storage.from('music').remove([path]);
          throw new Error(error.message);
        }
        if (list) {
          const { error: listError } = await sb.from('playlist_tracks').insert({ playlist_id: list, track_id: row.id, position: pos++ });
          if (listError) {
            update(i, { status: 'done', message: `Dans la bibliothèque, mais pas dans la liste : ${listError.message}` });
            continue;
          }
        }
        update(i, { status: 'done' });
      } catch (e) {
        update(i, { status: 'error', message: (e as Error).message });
      }
    }
    await ctx.close();
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="card">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); process(Array.from(e.dataTransfer.files)); }}
        style={{ border: `1.5px dashed ${over ? 'var(--accent)' : 'var(--line-strong)'}`, background: over ? '#eef5ff' : 'var(--surface-2)', borderRadius: 18, padding: '28px 24px', textAlign: 'center' }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>Déposez vos morceaux</div>
        <p className="sub" style={{ margin: '6px auto 16px', maxWidth: 560 }}>
          MP3, WAV, FLAC, M4A. Chaque titre est analysé dans votre navigateur : volume (EBU R128), crête, début et fin audibles, point de chevauchement.
        </p>
        <div className="actions" style={{ justifyContent: 'center', alignItems: 'center' }}>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => input.current?.click()}>Choisir des fichiers</button>
          {playlists.length > 0 && (
            <select className="select" style={{ width: 'auto' }} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Ajouter à une liste">
              <option value="">Sans liste pour l’instant</option>
              {playlists.map((p) => <option key={p.id} value={p.id}>Ajouter à : {p.label}</option>)}
            </select>
          )}
        </div>
        <input ref={input} type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg" multiple hidden onChange={(e) => { process(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      </div>
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="table" aria-live="polite">
            <thead><tr><th>Fichier</th><th>État</th><th>Volume</th><th>Gain à −18</th><th>Début</th><th>Chevauchement</th><th>Fin</th></tr></thead>
            <tbody>
              {items.map((it, k) => {
                const a = it.result?.a;
                return (
                  <tr key={k}>
                    <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.result ? `${it.result.artist ? `${it.result.artist} – ` : ''}${it.result.title}` : it.name}</td>
                    <td><span className="status" style={{ color: it.status === 'error' ? 'var(--danger)' : 'inherit' }}><span className="dot" style={{ background: it.status === 'done' ? 'var(--ok)' : it.status === 'error' ? 'var(--danger)' : 'var(--warn)' }} />{it.message ?? label[it.status]}</span></td>
                    <td>{a ? `${a.integratedLufs} LUFS` : '—'}</td>
                    <td>{a ? `${gainFor(a.integratedLufs, a.peakDbfs) > 0 ? '+' : ''}${gainFor(a.integratedLufs, a.peakDbfs)} dB` : '—'}</td>
                    <td>{a ? `${a.cueIn.toFixed(2)} s` : '—'}</td>
                    <td>{a ? `${a.crossStart.toFixed(2)} s` : '—'}</td>
                    <td>{a ? `${a.cueOut.toFixed(2)} s` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

'use client';

/**
 * Lecteur boutique (version pilote, dans un navigateur).
 * Joue lui-même la musique de la bibliothèque (programmation, normalisation, points de mix),
 * ou à défaut le flux de l’ambiance ; insère les spots entre deux titres selon les règles,
 * envoie son signal de vie, ses preuves de diffusion et l’historique des titres.
 * Garde son programme et sa musique en mémoire pour continuer si la connexion tombe.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildRequests, decide, toRules, type Decision, type PlayedSpot, type ScheduleSpot, type ScheduledSpot } from '@onde/rules';
import { MusicEngine, type MusicSchedule, type TrackStart } from './MusicEngine';
import './player.css';

const VERSION = '0.3.0-web';
const keys = (p: string) => ({
  token: `${p}token`,
  schedule: `${p}schedule`,
  logs: `${p}logs`,
  history: `${p}history`,
  handled: `${p}handled`,
  emergency: `${p}emergency`,
  trackplays: `${p}trackplays`
});
// La démo a son propre stockage : ses données ne doivent jamais partir vers le serveur.
let K = keys('onde.');

type Spot = ScheduleSpot & { script?: string; audio_url?: string | null };
interface Schedule {
  store: { name: string; max_volume?: number; timezone?: string | null } | null;
  rules: Parameters<typeof toRules>[0] & { duck_music?: boolean };
  org: { hq_spots_enabled: boolean; emergency: Emergency | null } | null;
  stream: { name: string; url: string | null } | null;
  spots: Spot[];
  music?: MusicSchedule | null;
}
interface Emergency { id: string; text: string; kind: string }
interface NP { title: string; artist: string; remaining: number; at: number; ambience?: string; daypart?: string | null; position?: number; length?: number }
interface TrackPlay { track_id: string; playlist_id: string; title: string; artist: string; isrc: string | null; played_at: string; duration_sec: number }
interface Log { spot_id: string; scheduled_for: string; played_at?: string; status: 'played' | 'missed'; reason?: string }

const read = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* stockage plein ou indisponible : on continue en mémoire */
  }
};
const midnight = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const hhmm = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ───── Démo : un programme fictif, sans serveur ─────
const DEMO_TRACKS = [
  ['Velvet Hours', 'Nuits Blanches'],
  ['Paper Boats', 'Anna Veil'],
  ['Glass City', 'Kora Nine'],
  ['Slow Linen', 'Maren Aldo']
];
function demoSchedule(): Schedule {
  const now = new Date();
  const m = now.getHours() * 60 + now.getMinutes();
  const t = (x: number) => `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}:00`;
  return {
    store: { name: 'Lyon Part-Dieu (démo)' },
    rules: { priority: ['national', 'regional', 'store'], max_per_break: 3, max_seconds_per_hour: 240, min_gap_same_spot_min: 20, window_min: 20, never_cut_track: true, duck_music: true },
    org: { hq_spots_enabled: true, emergency: null },
    stream: { name: 'Signature', url: null },
    spots: [
      { id: 'demo-noel', origin: 'national', title: 'Carte cadeau de Noël', script: 'Offrez l’élégance : la carte cadeau Maison Aubert est disponible en caisse.', duration_sec: 6, mode: 'next_break', daily_start: t(m), daily_end: t(m + 120), every_min: 90, fixed_times: null, window_min: 20, audio_url: null },
      { id: 'demo-retouches', origin: 'store', title: 'Retouches en cabine', script: 'Nos conseillers vous accompagnent en cabine pour vos retouches.', duration_sec: 5, mode: 'next_break', daily_start: t(m), daily_end: t(m + 120), every_min: null, fixed_times: [t(m)], window_min: 20, audio_url: null }
    ]
  };
}

export function Player({ demo }: { demo: boolean }) {
  K = keys(demo ? 'onde.demo.' : 'onde.');
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState('');
  const [pairError, setPairError] = useState('');
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [started, setStarted] = useState(false);
  const [online, setOnline] = useState(true);
  const [np, setNp] = useState<NP | null>(null);
  const [onAir, setOnAir] = useState<{ title: string; origin: string } | null>(null);
  const [next, setNext] = useState<{ at: number; titles: string[] } | null>(null);
  const [emergency, setEmergency] = useState<Emergency | null>(null);
  const [clock, setClock] = useState(Date.now());

  const music = useRef<HTMLAudioElement | null>(null);
  const engine = useRef<MusicEngine | null>(null);
  const outputLufs = useRef<number | null>(null);
  const busy = useRef(false);
  const startedAt = useRef(0);
  const scheduleRef = useRef<Schedule | null>(null);
  const npRef = useRef<NP | null>(null);
  scheduleRef.current = schedule;
  npRef.current = np;

  // ───── Démarrage : jeton et programme gardés en mémoire ─────
  useEffect(() => {
    if (demo) {
      setToken('demo');
      setSchedule(demoSchedule());
    } else {
      setToken(read<string | null>(K.token, null));
      setSchedule(read<Schedule | null>(K.schedule, null));
    }
    setReady(true);
  }, [demo]);

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(`/api/device/${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
        cache: 'no-store'
      });
      if (res.status === 401) {
        localStorage.removeItem(K.token);
        setToken(null);
        throw new Error('Lecteur non reconnu');
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    [token]
  );

  // ───── Appairage ─────
  const pair = async (e: React.FormEvent) => {
    e.preventDefault();
    setPairError('');
    try {
      const res = await fetch('/api/device/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, app_version: VERSION }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Code refusé');
      write(K.token, body.token);
      setToken(body.token);
    } catch (err) {
      setPairError((err as Error).message);
    }
  };

  // ───── Programme : toutes les 5 min ─────
  useEffect(() => {
    if (!token || demo) return;
    const load = async () => {
      try {
        const s = (await api('schedule')) as Schedule;
        setSchedule(s);
        write(K.schedule, s);
        setOnline(true);
      } catch {
        setOnline(false);
      }
    };
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => clearInterval(id);
  }, [token, demo, api]);

  // ───── Titre en cours d’un flux externe : toutes les 15 s (démo : titres simulés de 75 s) ─────
  useEffect(() => {
    if (!token || !started) return;
    if (demo) {
      const t0 = Date.now();
      const tick = () => {
        const elapsed = ((Date.now() - t0) / 1000) % 75;
        const i = Math.floor((Date.now() - t0) / 75_000) % DEMO_TRACKS.length;
        setNp({ title: DEMO_TRACKS[i][0], artist: DEMO_TRACKS[i][1], remaining: 75 - elapsed, at: Date.now(), position: elapsed, length: 75 });
      };
      tick();
      const id = setInterval(tick, 5_000);
      return () => clearInterval(id);
    }
    const load = async () => {
      if (engine.current) return; // musique jouée par le lecteur : il sait ce qu’il joue
      try {
        const r = (await api('nowplaying')) as { now_playing: { title: string; artist: string; remaining: number } | null };
        if (!engine.current) setNp(r.now_playing ? { ...r.now_playing, at: Date.now() } : null);
      } catch {
        /* inconnu : les spots passent dès qu’ils sont dus */
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [token, started, demo, api]);

  // ───── Signal de vie, preuves et titres joués : toutes les 30 s ─────
  useEffect(() => {
    if (!token || demo) return;
    const beat = async () => {
      const cur = npRef.current;
      try {
        const r = (await api('heartbeat', {
          method: 'POST',
          body: JSON.stringify({
            app_version: VERSION,
            now_playing: cur ? { title: cur.title, artist: cur.artist, ambience: cur.ambience ?? null, ends_at: new Date(cur.at + cur.remaining * 1000).toISOString() } : null,
            cache_seconds: engine.current ? engine.current.cacheSeconds() : null,
            output_lufs: engine.current ? outputLufs.current : null
          })
        })) as { emergency: Emergency | null };
        setOnline(true);
        setEmergency(r.emergency);
        const logs = read<Log[]>(K.logs, []);
        const tracks = read<TrackPlay[]>(K.trackplays, []);
        if (logs.length || tracks.length) {
          await api('playlog', { method: 'POST', body: JSON.stringify({ entries: logs, tracks }) });
          // On ne retire que ce qui a été envoyé : ce qui est arrivé pendant l’envoi part au prochain signal.
          write(K.logs, read<Log[]>(K.logs, []).slice(logs.length));
          write(K.trackplays, read<TrackPlay[]>(K.trackplays, []).slice(tracks.length));
        }
      } catch {
        setOnline(false);
      }
    };
    beat();
    const id = setInterval(beat, 30_000);
    return () => clearInterval(id);
  }, [token, demo, api]);

  // ───── Son ─────
  const baseVolume = () => Math.min(1, (scheduleRef.current?.store?.max_volume ?? 80) / 100);
  /** Niveau de la musique, de 0 (coupée) à 1 (volume de la boutique). */
  const duckTo = async (level: number, ms = 800) => {
    if (engine.current) return engine.current.duck(level, ms);
    const a = music.current;
    if (!a) return;
    const from = a.volume;
    const to = level * baseVolume();
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      a.volume = from + ((to - from) * i) / steps;
      await sleep(ms / steps);
    }
  };

  const say = (text: string) =>
    new Promise<void>((resolve) => {
      if (typeof speechSynthesis === 'undefined') return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      const fr = speechSynthesis.getVoices().find((v) => v.lang.startsWith('fr'));
      if (fr) u.voice = fr;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
      setTimeout(resolve, Math.max(4000, text.length * 120)); // filet de sécurité
    });

  const playFile = (url: string) =>
    new Promise<void>((resolve, reject) => {
      const a = new Audio(url);
      a.volume = baseVolume();
      a.onended = () => resolve();
      a.onerror = () => reject(new Error('audio'));
      a.play().catch(reject);
    });

  const playBreak = useCallback(async (items: ScheduledSpot[]) => {
    busy.current = true;
    const s = scheduleRef.current;
    // Entre deux titres joués par le lecteur, la musique est déjà arrêtée : rien à baisser.
    const between = engine.current != null && engine.current.state !== 'playing';
    const duck = s?.rules?.duck_music !== false;
    if (!between) {
      if (duck) await duckTo(0.15);
      else if (engine.current) await duckTo(0, 300);
      else music.current?.pause();
    }
    for (const it of items) {
      const spot = s?.spots.find((x) => x.id === it.request.spotId);
      setOnAir({ title: it.request.title, origin: it.request.origin });
      let status: Log['status'] = 'played';
      let reason: string | undefined;
      try {
        if (spot?.audio_url) await playFile(spot.audio_url);
        else await say(spot?.script || it.request.title);
      } catch {
        status = 'missed';
        reason = 'audio_error';
      }
      const handled = new Set(read<string[]>(K.handled, []));
      handled.add(it.request.id);
      write(K.handled, [...handled].filter((h) => h.endsWith(`#${midnight()}`)));
      write(K.history, [...read<PlayedSpot[]>(K.history, []), { spotId: it.request.spotId, at: Date.now(), durationSec: it.request.durationSec }].slice(-200));
      write(K.logs, [...read<Log[]>(K.logs, []), { spot_id: it.request.spotId, scheduled_for: new Date(it.request.requestedAt).toISOString(), played_at: new Date().toISOString(), status, reason }]);
      await sleep(400);
    }
    setOnAir(null);
    if (!between) {
      if (duck || engine.current) await duckTo(1);
      else music.current?.play().catch(() => undefined);
    }
    busy.current = false;
  }, []);

  /** Que faut-il jouer maintenant, sachant qu’il reste `remaining` secondes au titre en cours ? */
  const decideNow = useCallback((remaining: number | null): Decision | null => {
    const s = scheduleRef.current;
    if (!s) return null;
    const day = midnight();
    const handled = new Set(read<string[]>(K.handled, []).filter((h) => h.endsWith(`#${day}`)));
    const tracks = s.music?.tracks ?? [];
    const d = decide({
      now: Date.now(),
      trackRemainingSec: remaining,
      // Ce qui devait passer avant l’allumage du lecteur n’est pas compté comme manqué.
      requests: buildRequests(s.spots, day).filter((r) => r.requestedAt + (r.windowMin ?? toRules(s.rules).windowMin) * 60_000 >= startedAt.current),
      rules: toRules(s.rules),
      history: read<PlayedSpot[]>(K.history, []),
      handled,
      avgTrackSec: engine.current && tracks.length ? tracks.reduce((a, t) => a + t.cue_out - t.cue_in, 0) / tracks.length : undefined
    });
    if (d.missed.length) {
      for (const m of d.missed) handled.add(m.request.id);
      write(K.handled, [...handled]);
      write(K.logs, [...read<Log[]>(K.logs, []), ...d.missed.map((m) => ({ spot_id: m.request.spotId, scheduled_for: new Date(m.request.requestedAt).toISOString(), status: 'missed' as const, reason: m.reason }))]);
    }
    return d;
  }, []);

  // ───── Musique jouée par le lecteur (bibliothèque Onde) ─────
  const hasMusic = (s: Schedule | null) => Boolean(s?.music?.tracks.some((t) => t.url) && s.music.playlists.some((p) => p.trackIds.length));

  const startEngine = useCallback(
    (s: Schedule) => {
      const e = new MusicEngine({
        onTrackStart: (t: TrackStart) => {
          outputLufs.current = t.outputLufs;
          if (t.isJingle) return; // les jingles ne figurent pas dans l’historique des titres
          const play: TrackPlay = {
            track_id: t.track.id,
            playlist_id: t.playlistId,
            title: t.track.title,
            artist: t.track.artist,
            isrc: t.track.isrc,
            played_at: new Date().toISOString(),
            duration_sec: Math.round((t.track.cue_out - t.track.cue_in) * 10) / 10
          };
          write(K.trackplays, [...read<TrackPlay[]>(K.trackplays, []), play].slice(-2000));
        },
        breakDue: (rem) => {
          const d = decideNow(rem);
          return Boolean(d?.next && d.next.kind === 'between_tracks' && d.next.at <= Date.now() + rem * 1000 + 1500);
        },
        runBreak: async () => {
          while (busy.current) await sleep(200);
          const d = decideNow(0);
          if (d?.play.length) await playBreak(d.play);
        },
        isBusy: () => busy.current
      });
      e.setSchedule(s.music!, s.store?.timezone ?? null);
      e.setBaseVolume(baseVolume());
      engine.current = e;
      music.current?.pause();
      void e.start();
    },
    [decideNow, playBreak]
  );

  // Programme mis à jour : nouveaux titres, volume ; bascule sur la bibliothèque dès qu’elle a de quoi jouer.
  useEffect(() => {
    if (!started || !schedule || demo) return;
    const e = engine.current;
    if (e) {
      if (schedule.music) e.setSchedule(schedule.music, schedule.store?.timezone ?? null);
      e.setBaseVolume(baseVolume());
    } else if (hasMusic(schedule)) startEngine(schedule);
  }, [schedule, started, demo, startEngine]);

  useEffect(() => () => engine.current?.stop(), []);

  // ───── Urgence : passe tout de suite, une fois ─────
  useEffect(() => {
    if (!started || !emergency || read<string | null>(K.emergency, null) === emergency.id) return;
    write(K.emergency, emergency.id);
    (async () => {
      busy.current = true;
      speechSynthesis?.cancel();
      await duckTo(0, 300);
      setOnAir({ title: 'Annonce d’urgence', origin: 'emergency' });
      await say(emergency.text);
      await say(emergency.text);
      setOnAir(null);
      await duckTo(1);
      busy.current = false;
    })();
  }, [emergency, started]);

  // ───── Boucle : chaque seconde, que faut-il jouer ? ─────
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => {
      setClock(Date.now());
      const e = engine.current;
      if (e) {
        const n = e.nowPlaying();
        setNp(n ? { title: n.title, artist: n.artist, ambience: n.ambience, daypart: n.daypart, position: n.position, length: n.length, remaining: e.remaining() ?? 0, at: Date.now() } : null);
      }
      if (!scheduleRef.current || busy.current) return;
      const cur = npRef.current;
      const remaining = e ? e.remaining() : cur ? cur.remaining - (Date.now() - cur.at) / 1000 : null;
      const d = decideNow(remaining);
      if (!d) return;
      setNext(d.next ? { at: d.next.at, titles: d.next.items.map((i) => i.request.title) } : null);
      if (!d.play.length) return;
      // Musique jouée par le lecteur : l’écran entre deux titres est lancé par le moteur, au point de sortie.
      if (e && d.kind === 'between_tracks' && e.state !== 'idle') return;
      playBreak(d.play);
    }, 1000);
    return () => clearInterval(id);
  }, [started, playBreak, decideNow]);

  // ───── Écran toujours allumé ─────
  useEffect(() => {
    if (!started || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const get = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        /* refusé : l’écran pourra se mettre en veille */
      }
    };
    get();
    const onVis = () => document.visibilityState === 'visible' && get();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => undefined);
    };
  }, [started]);

  const start = async () => {
    startedAt.current = Date.now();
    if (!demo && schedule && hasMusic(schedule)) startEngine(schedule);
    else {
      const a = music.current;
      if (a && schedule?.stream?.url) {
        a.src = schedule.stream.url;
        a.volume = baseVolume();
        await a.play().catch(() => undefined);
      }
    }
    setStarted(true);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  const onMusicError = () => {
    const url = scheduleRef.current?.stream?.url;
    if (!url || !music.current || engine.current) return;
    setTimeout(() => {
      if (!music.current || engine.current) return;
      music.current.src = `${url}${url.includes('?') ? '&' : '?'}r=${Date.now()}`;
      music.current.play().catch(() => undefined);
    }, 5000);
  };

  if (!ready) return <div className="lp" />;

  if (!token) {
    return (
      <div className="lp lp-center">
        <form className="lp-pair" onSubmit={pair}>
          <div className="lp-brand">Onde</div>
          <h1>Installer ce lecteur</h1>
          <p>Saisissez le code affiché dans la fiche de la boutique, côté régie.</p>
          <input
            className="lp-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            maxLength={10}
            autoFocus
            autoComplete="off"
            aria-label="Code d’installation"
            placeholder="ABCD2345"
          />
          {pairError && <p className="lp-error" role="alert">{pairError}</p>}
          <button className="lp-btn" type="submit" disabled={code.length < 6}>Appairer</button>
        </form>
      </div>
    );
  }

  return (
    <div className="lp">
      <audio ref={music} onError={onMusicError} onStalled={onMusicError} preload="none" />
      <header className="lp-top">
        <div className="lp-brand">Onde · {schedule?.store?.name ?? 'Boutique'}</div>
        <div className="lp-chips">
          {demo && <span className="lp-chip">Démo</span>}
          <span className="lp-chip"><span className="lp-dot" style={{ background: online ? '#34c759' : '#ff9f0a' }} />{online ? 'Connecté' : 'Hors ligne, programme en mémoire'}</span>
          <span className="lp-chip">{hhmm(clock)}</span>
        </div>
      </header>

      {!started ? (
        <div className="lp-center lp-grow">
          <button className="lp-btn lp-start" onClick={start}>Démarrer la diffusion</button>
          <p className="lp-hint">Le navigateur exige un geste pour lancer le son. À faire une fois à l’ouverture.</p>
        </div>
      ) : (
        <main className="lp-grow lp-main">
          {onAir ? (
            <section className={`lp-onair ${onAir.origin === 'emergency' ? 'lp-urgent' : ''}`} aria-live="assertive">
              <div className="lp-label">{onAir.origin === 'emergency' ? 'Urgence' : 'Annonce en cours'}</div>
              <div className="lp-title">{onAir.title}</div>
            </section>
          ) : (
            <section aria-live="polite">
              <div className="lp-label">
                {np?.ambience ? `Ambiance ${np.ambience}${np.daypart ? ` · ${np.daypart}` : ''}` : !engine.current && schedule?.stream?.name ? `Ambiance ${schedule.stream.name}` : 'En cours'}
              </div>
              <div className="lp-title">{np?.title ?? (hasMusic(schedule) || schedule?.stream?.url ? 'Lecture en cours' : 'Aucune musique programmée')}</div>
              <div className="lp-artist">{np?.artist ?? ''}</div>
              {np?.length ? (
                <div className="lp-progress" role="progressbar" aria-label="Avancement du titre" aria-valuemin={0} aria-valuemax={Math.round(np.length)} aria-valuenow={Math.round(np.position ?? 0)}>
                  <div style={{ width: `${Math.min(100, ((np.position ?? 0) / np.length) * 100)}%` }} />
                </div>
              ) : null}
            </section>
          )}
          <section className="lp-next">
            <div className="lp-label">Prochain écran</div>
            {next ? (
              <div>
                <strong>{hhmm(next.at)}</strong> · {next.titles.join(' · ')}
              </div>
            ) : (
              <div>Aucun spot prévu pour l’instant</div>
            )}
          </section>
        </main>
      )}
      <footer className="lp-foot">Lecteur {VERSION}</footer>
    </div>
  );
}

import { getSession, listSpots, listStoreStatus } from '@/lib/data';
import { frequency, statusLabel } from '@/lib/format';
import { isConfigured, supabaseServer } from '@/lib/supabase/server';
import { listVoices, voiceConfigured } from '@/lib/voice';
import { createSpot, setSpotStatus, startEmergency, stopEmergency, toggleHqSpots } from '../actions';
import { SpotAudio } from './SpotAudio';

/** Liens d’écoute des spots, et morceaux de la bibliothèque proposés en fond musical. */
async function audioLinks(paths: string[]) {
  if (!isConfigured) return { spotUrl: new Map<string, string>(), beds: [] as { id: string; label: string; url: string }[] };
  const sb = await supabaseServer();
  const [{ data: signed }, { data: tracks }] = await Promise.all([
    paths.length ? sb.storage.from('spots').createSignedUrls(paths, 3600) : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
    sb.from('tracks').select('id, title, artist, storage_path').eq('enabled', true).order('title').limit(40)
  ]);
  const { data: bedUrls } = tracks?.length ? await sb.storage.from('music').createSignedUrls(tracks.map((t) => t.storage_path as string), 3600) : { data: [] };
  const bedUrl = new Map((bedUrls ?? []).map((u) => [u.path, u.signedUrl]));
  return {
    spotUrl: new Map((signed ?? []).filter((u) => u.path).map((u) => [u.path as string, u.signedUrl])),
    beds: (tracks ?? [])
      .map((t) => ({ id: t.id as string, label: `${t.title}${t.artist ? ` · ${t.artist}` : ''}`, url: bedUrl.get(t.storage_path as string) ?? '' }))
      .filter((b) => b.url)
  };
}

export const metadata = { title: 'Spots nationaux' };

export default async function Spots() {
  const { org } = await getSession();
  if (!org) return null;
  const [all, stores, voices] = await Promise.all([listSpots(org.id), listStoreStatus(org.id), listVoices()]);
  const spots = all.filter((s) => s.origin !== 'store');
  const { spotUrl, beds } = await audioLinks(spots.map((s) => s.audio_path).filter((p): p is string => !!p));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{org.name} · {stores.length} boutiques</div>
          <h1>Spots nationaux</h1>
          <p className="lead">Créés une fois, joués dans toutes les boutiques. Chaque lecteur les place entre deux titres, avant les messages des boutiques.</p>
        </div>
      </div>

      <section className="card card-dark" aria-label="Contrôle du réseau">
        <div className="page-head" style={{ alignItems: 'center' }}>
          <div>
            <div className="status sub">
              <span className="dot" style={{ background: org.hq_spots_enabled ? 'var(--ok)' : 'var(--warn)' }} />
              {org.hq_spots_enabled ? `Actifs dans les ${stores.length} boutiques` : 'Suspendus dans tout le réseau'}
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 6 }}>Spots du siège</div>
            <div className="small muted" style={{ marginTop: 4 }}>Un geste pour tout suspendre. La musique et les messages des boutiques continuent.</div>
          </div>
          <form action={toggleHqSpots}>
            <input type="hidden" name="org_id" value={org.id} />
            <input type="hidden" name="enabled" value={String(!org.hq_spots_enabled)} />
            <button className={`btn ${org.hq_spots_enabled ? 'btn-secondary' : 'btn-primary'}`} type="submit">
              {org.hq_spots_enabled ? 'Tout suspendre' : 'Tout reprendre'}
            </button>
          </form>
        </div>
      </section>

      <section className="card" aria-label="Annonce d’urgence" style={org.emergency ? { background: '#fff1f0', borderColor: '#ffd1cc' } : undefined}>
        {org.emergency ? (
          <div className="page-head" style={{ alignItems: 'center' }}>
            <div>
              <div className="status" style={{ color: '#b3261e', fontWeight: 600 }}><span className="dot" style={{ background: 'var(--danger)' }} />Annonce d’urgence en cours</div>
              <p style={{ margin: '8px 0 0', maxWidth: 640 }}>{org.emergency.text}</p>
            </div>
            <form action={stopEmergency}>
              <input type="hidden" name="org_id" value={org.id} />
              <button className="btn btn-dark" type="submit">Arrêter l’annonce</button>
            </form>
          </div>
        ) : (
          <form action={startEmergency} className="page-head" style={{ alignItems: 'center' }}>
            <input type="hidden" name="org_id" value={org.id} />
            <div>
              <h2>Annonce d’urgence</h2>
              <p className="sub">Coupe la musique et passe immédiatement dans toutes les boutiques, avant tout autre spot.</p>
              <div className="choice" style={{ marginTop: 12 }}>
                <label><input type="radio" name="kind" value="evacuation" defaultChecked /><span>Évacuation</span></label>
                <label><input type="radio" name="kind" value="closing" /><span>Fermeture immédiate</span></label>
                <label><input type="radio" name="kind" value="security" /><span>Consignes de sécurité</span></label>
              </div>
            </div>
            <button className="btn btn-danger" type="submit">Diffuser maintenant</button>
          </form>
        )}
      </section>

      <div className="row">
        <section className="card">
          <h2>Programmés</h2>
          <div className="list">
            {spots.length === 0 && <div className="empty">Aucun spot national pour l’instant.</div>}
            {spots.map((s) => (
              <div className="list-item" key={s.id} style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{s.title}</div>
                  <div className="small muted">
                    {s.target} · {frequency(s)} · {s.duration_sec} s · {s.audio_kind === 'ai' ? `voix IA${s.voice_name ? ` (${s.voice_name})` : ''}` : s.audio_path ? 'fichier' : 'texte seul'}
                  </div>
                  {s.script && <div className="small" style={{ marginTop: 6 }}>{s.script}</div>}
                  {s.audio_path && spotUrl.get(s.audio_path) && <audio controls preload="none" src={spotUrl.get(s.audio_path) ?? undefined} style={{ marginTop: 8, height: 32, maxWidth: '100%' }} aria-label={`Écouter ${s.title}`} />}
                </div>
                <div className="actions" style={{ flex: '0 0 auto' }}>
                  <span className="tag">{statusLabel[s.status]}</span>
                  {s.status === 'approved' || s.status === 'paused' ? (
                    <form action={setSpotStatus}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="status" value={s.status === 'approved' ? 'paused' : 'approved'} />
                      <button className="btn btn-secondary btn-small" type="submit">{s.status === 'approved' ? 'Pause' : 'Reprendre'}</button>
                    </form>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card" id="nouveau">
          <h2>Nouveau spot national</h2>
          <p className="sub">Envoyé à tout le réseau. Le ciblage par région arrive à l’étape suivante.</p>
          <form action={createSpot} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
            <input type="hidden" name="org_id" value={org.id} />
            <label className="field"><span>Titre</span><input className="input" name="title" required placeholder="Carte cadeau de Noël" /></label>
            <SpotAudio orgId={org.id} voices={voices} beds={beds} voiceReady={voiceConfigured && voices.length > 0} />
            <div className="form-grid">
              <label className="field"><span>Durée (s), si texte seul</span><input className="input" type="number" name="duration_sec" min={1} max={600} defaultValue={15} /></label>
              <label className="field"><span>Du</span><input className="input" type="date" name="starts_on" /></label>
              <label className="field"><span>Au</span><input className="input" type="date" name="ends_on" /></label>
            </div>
            <div className="form-grid">
              <label className="field"><span>De</span><input className="input" type="time" name="daily_start" defaultValue="10:00" /></label>
              <label className="field"><span>À</span><input className="input" type="time" name="daily_end" defaultValue="19:00" /></label>
              <label className="field"><span>Heure fixe</span><input className="input" type="time" name="fixed_time" defaultValue="10:00" /></label>
            </div>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <span>Fréquence</span>
              <div className="choice">
                {[['60', 'Toutes les heures'], ['90', 'Toutes les 90 min'], ['120', 'Toutes les 2 h'], ['fixed', 'Heure fixe']].map(([v, l], i) => (
                  <label key={v}><input type="radio" name="frequency" value={v} defaultChecked={i === 2} /><span>{l}</span></label>
                ))}
              </div>
            </fieldset>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <span>Mode</span>
              <div className="choice">
                <label><input type="radio" name="mode" value="next_break" defaultChecked /><span>Au prochain écran</span></label>
                <label><input type="radio" name="mode" value="sync" /><span>À la seconde, partout</span></label>
              </div>
            </fieldset>
            <button className="btn btn-primary" type="submit" style={{ alignSelf: 'flex-start' }}>Programmer dans les {stores.length} boutiques</button>
          </form>
        </section>
      </div>
    </>
  );
}

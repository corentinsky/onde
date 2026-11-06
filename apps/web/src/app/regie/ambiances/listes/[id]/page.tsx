import Link from 'next/link';
import { notFound } from 'next/navigation';
import { previewQueue, seededRng, type Playlist } from '@onde/rules';
import { getSession } from '@/lib/data';
import { DAYS, getTracksByIds, listAmbiences, listPlaylists, listRotations, listTracks, mmss, orderLabel, toMin, typeLabel, type PlaylistRow } from '@/lib/music';
import { addToPlaylist, deletePlaylist, removeFromPlaylist, rotateNow, savePlaylist } from '../../../musique-actions';

const shortDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

export const metadata = { title: 'Liste de lecture' };

const toEngine = (p: PlaylistRow): Playlist => ({
  id: p.id,
  name: p.name,
  type: p.type,
  weight: p.weight,
  order: p.play_order,
  everySongs: p.every_songs,
  everyMinutes: p.every_minutes,
  minuteOfHour: p.minute_of_hour,
  schedule: { startMin: toMin(p.start_time), endMin: toMin(p.end_time), days: p.days, startDate: p.start_date, endDate: p.end_date },
  avoidDuplicates: p.avoid_duplicates,
  isJingle: p.is_jingle,
  enabled: p.enabled,
  // Les titres au repos (rotation automatique) ne passent pas.
  trackIds: p.track_ids.filter((t) => !p.resting[t])
});

export default async function PlaylistPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; enregistre?: string; renouvele?: string }> }) {
  const { id } = await params;
  const { q = '', enregistre, renouvele } = await searchParams;
  const { org } = await getSession();
  if (!org) return null;
  const [playlists, ambiences, library] = await Promise.all([listPlaylists(org.id), listAmbiences(org.id), listTracks({ q, size: 200 })]);
  const p = playlists.find((x) => x.id === id);
  if (!p) notFound();
  const rotations = await listRotations(p.id);
  const last = rotations[0];
  const restingCount = Object.keys(p.resting).length;
  const nextRotation = p.rotation_days ? (p.rotated_at ? new Date(Date.parse(p.rotated_at) + p.rotation_days * 86_400_000).toISOString().slice(0, 10) : null) : null;
  const amb = ambiences.find((a) => a.id === p.ambience_id);
  // Tous les titres des listes de l’ambiance, quelle que soit la taille de la bibliothèque.
  const sameAmbRows = playlists.filter((x) => x.ambience_id === p.ambience_id);
  const ambTracks = await getTracksByIds([...new Set(sameAmbRows.flatMap((x) => x.track_ids))]);
  const byId = new Map(ambTracks.map((t) => [t.id, t]));
  const inList = p.track_ids.map((tid) => byId.get(tid)).filter((t): t is (typeof ambTracks)[number] => !!t);
  const inSet = new Set(p.track_ids);
  const candidates = library.rows.filter((t) => !inSet.has(t.id));

  // Aperçu : les 12 prochains titres de l’ambiance, avec toutes ses listes, à partir de maintenant.
  // Les voix posées ne passent pas seules : elles se superposent aux titres.
  const sameAmb = sameAmbRows.filter((x) => !x.is_overlay).map(toEngine);
  const tracks = new Map(ambTracks.filter((t) => t.enabled).map((t) => [t.id, { id: t.id, title: t.title, artist: t.artist }]));
  const preview = previewQueue({
    playlists: sameAmb,
    tracks,
    history: [],
    start: new Date(),
    count: 12,
    rng: seededRng(7),
    rules: amb ? { titleSeparationMin: amb.title_separation_min, artistSeparationMin: amb.artist_separation_min } : undefined
  });
  const listName = new Map(playlists.map((x) => [x.id, x.name]));

  return (
    <>
      <Link href="/regie/ambiances" className="small">← Ambiances et listes</Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">{org.name} · ambiance {amb?.name}</div>
          <h1>{p.name}</h1>
        </div>
        {enregistre && <span className="tag" role="status">Enregistré</span>}
        {renouvele && <span className="tag" role="status">Liste renouvelée</span>}
      </div>

      <div className="row">
        <form action={savePlaylist} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input type="hidden" name="id" value={p.id} />
          <h2>Règles de la liste</h2>
          <div className="form-grid">
            <label className="field"><span>Nom</span><input className="input" name="name" defaultValue={p.name} required /></label>
            <label className="field"><span>Type</span>
              <select className="select" name="type" defaultValue={p.type}>
                {Object.entries(typeLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="field"><span>Poids (1 à 25, rotation standard)</span><input className="input" type="number" min={1} max={25} name="weight" defaultValue={p.weight} /></label>
            <label className="field"><span>Ordre</span>
              <select className="select" name="play_order" defaultValue={p.play_order}>
                {Object.entries(orderLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="field"><span>Tous les X titres</span><input className="input" type="number" min={1} name="every_songs" defaultValue={p.every_songs ?? ''} /></label>
            <label className="field"><span>Toutes les X minutes</span><input className="input" type="number" min={1} name="every_minutes" defaultValue={p.every_minutes ?? ''} /></label>
            <label className="field"><span>À la minute (chaque heure)</span><input className="input" type="number" min={0} max={59} name="minute_of_hour" defaultValue={p.minute_of_hour ?? ''} /></label>
          </div>

          <div style={{ fontWeight: 600, marginTop: 6 }}>Programmation</div>
          <div className="form-grid">
            <label className="field"><span>De</span><input className="input" type="time" name="start_time" defaultValue={p.start_time?.slice(0, 5) ?? ''} /></label>
            <label className="field"><span>À</span><input className="input" type="time" name="end_time" defaultValue={p.end_time?.slice(0, 5) ?? ''} /></label>
            <label className="field"><span>Du</span><input className="input" type="date" name="start_date" defaultValue={p.start_date ?? ''} /></label>
            <label className="field"><span>Au</span><input className="input" type="date" name="end_date" defaultValue={p.end_date ?? ''} /></label>
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <span>Jours (aucun coché = tous les jours)</span>
            <div className="choice">
              {DAYS.map((d, i) => (
                <label key={d}><input type="checkbox" name="days" value={i + 1} defaultChecked={p.days?.includes(i + 1) ?? false} /><span>{d}</span></label>
              ))}
            </div>
          </fieldset>

          <div style={{ fontWeight: 600, marginTop: 6 }}>Rotation automatique</div>
          <p className="small muted" style={{ margin: 0 }}>
            À chaque échéance, les titres les plus diffusés passent au repos et ceux dont le repos est fini reviennent. Les titres ajoutés depuis la dernière rotation sont protégés.
          </p>
          <div className="form-grid">
            <label className="field"><span>Renouveler</span>
              <select className="select" name="rotation_days" defaultValue={p.rotation_days ?? ''}>
                <option value="">Jamais</option>
                <option value="7">Toutes les semaines</option>
                <option value="15">Tous les 15 jours</option>
                <option value="30">Tous les mois</option>
                {p.rotation_days && ![7, 15, 30].includes(p.rotation_days) && <option value={p.rotation_days}>Tous les {p.rotation_days} jours</option>}
              </select>
            </label>
            <label className="field"><span>Part mise au repos (%)</span><input className="input" type="number" min={5} max={60} name="rotation_share" defaultValue={p.rotation_share} /></label>
            <label className="field"><span>Durée du repos (jours)</span><input className="input" type="number" min={1} max={365} name="rotation_rest_days" defaultValue={p.rotation_rest_days} /></label>
          </div>

          {[
            ['avoid_duplicates', 'Éviter les doublons', 'Respecte les espacements titre et artiste de l’ambiance.', p.avoid_duplicates],
            ['is_jingle', 'Jingle', 'Ne compte pas comme un titre et n’apparaît pas dans les métadonnées.', p.is_jingle],
            ['is_overlay', 'Voix posée sur l’intro', 'A cappella ou voix courte jouée par-dessus le début du titre, la musique baisse dessous. Réglez « Tous les X titres ». Sur le flux de l’enseigne.', p.is_overlay],
            ['enabled', 'Liste active', 'Désactivée, elle ne passe plus.', p.enabled]
          ].map(([name, label, help, checked]) => (
            <div className="switch-row" key={name as string}>
              <div><div>{label as string}</div><div className="small muted">{help as string}</div></div>
              <label className="switch"><input type="checkbox" name={name as string} defaultChecked={checked as boolean} aria-label={label as string} /><span /></label>
            </div>
          ))}
          <div className="actions">
            <button className="btn btn-primary" type="submit">Enregistrer</button>
          </div>
        </form>

        <section className="card">
          <h2>Les prochains titres de l’ambiance</h2>
          <p className="sub">Simulation à partir de maintenant, avec toutes les listes de « {amb?.name} » et leurs règles.</p>
          <div className="list">
            {preview.length === 0 && <div className="empty">Aucun titre jouable pour l’instant : ajoutez des titres ou vérifiez les horaires.</div>}
            {preview.map(({ at, choice }, i) => (
              <div key={i} className="list-item" style={{ padding: '10px 0' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{choice.track.title}</div>
                  <div className="small muted">{choice.track.artist} · {listName.get(choice.playlist.id)}{choice.relaxed ? ' · espacement assoupli' : ''}</div>
                </div>
                <span className="small muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="page-head" style={{ alignItems: 'center' }}>
          <h2>Rotation</h2>
          <form action={rotateNow}>
            <input type="hidden" name="id" value={p.id} />
            <button className="btn btn-secondary btn-small" type="submit" disabled={inList.length === 0}>Renouveler maintenant</button>
          </form>
        </div>
        <p className="sub">
          {p.rotation_days ? `Automatique tous les ${p.rotation_days} jours` : 'Automatique désactivée'}
          {nextRotation ? ` · prochaine le ${shortDate(nextRotation)}` : p.rotation_days ? ' · première demain matin' : ''}
          {` · ${inList.length - restingCount} titre${inList.length - restingCount > 1 ? 's' : ''} en rotation, ${restingCount} au repos`}
        </p>
        {last ? (
          <div className="small" style={{ lineHeight: 1.7 }}>
            <div className="muted">
              Dernière rotation le {new Date(last.ran_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })}
              {last.trigger === 'manual' ? ' (à la main)' : ''} : {last.rested.length} au repos, {last.returned.length} de retour.
            </div>
            {last.rested.length > 0 && (
              <div>Au repos : {last.rested.slice(0, 12).map((r) => `${r.title} (${r.plays} passage${r.plays > 1 ? 's' : ''})`).join(', ')}{last.rested.length > 12 ? '…' : ''}</div>
            )}
            {last.returned.length > 0 && <div>De retour : {last.returned.slice(0, 12).map((r) => r.title).join(', ')}{last.returned.length > 12 ? '…' : ''}</div>}
          </div>
        ) : (
          <div className="small muted">Aucune rotation pour l’instant.</div>
        )}
      </section>

      <section className="card">
        <div className="page-head" style={{ alignItems: 'baseline' }}>
          <h2>Titres de la liste ({inList.length})</h2>
          <span className="small muted">{mmss(inList.reduce((a, t) => a + t.cue_out - t.cue_in, 0), 0)} au total</span>
        </div>
        <div className="list">
          {inList.length === 0 && <div className="empty">Liste vide.</div>}
          {inList.map((t, i) => (
            <div key={t.id} className="list-item" style={{ padding: '10px 0' }}>
              <div style={{ minWidth: 0 }}>
                <span className="small muted" style={{ marginRight: 10 }}>{i + 1}</span>
                <Link href={`/regie/bibliotheque/${t.id}`} style={{ fontWeight: 500 }}>{t.title}</Link>
                <span className="small muted"> · {t.artist} · {mmss(t.cue_out - t.cue_in, 0)}</span>
                {p.resting[t.id] && <span className="tag" style={{ marginLeft: 8 }}>Au repos jusqu’au {shortDate(p.resting[t.id])}</span>}
              </div>
              <form action={removeFromPlaylist}>
                <input type="hidden" name="playlist_id" value={p.id} />
                <input type="hidden" name="track_id" value={t.id} />
                <button className="btn btn-secondary btn-small" type="submit">Retirer</button>
              </form>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="page-head" style={{ alignItems: 'center' }}>
          <h2>Ajouter depuis la bibliothèque</h2>
          <form>
            <input className="input" name="q" defaultValue={q} placeholder="Rechercher" style={{ width: 240 }} aria-label="Rechercher dans la bibliothèque" />
          </form>
        </div>
        <form action={addToPlaylist}>
          <input type="hidden" name="playlist_id" value={p.id} />
          <div className="list" style={{ maxHeight: 420, overflowY: 'auto' }}>
            {candidates.length === 0 && <div className="empty">Rien à ajouter{q ? ' pour cette recherche' : ''}.</div>}
            {library.total > library.rows.length && <div className="small muted" style={{ padding: '8px 0' }}>{library.rows.length} premiers titres sur {library.total} : affinez la recherche.</div>}
            {candidates.map((t) => (
              <label key={t.id} className="list-item" style={{ padding: '9px 0', cursor: 'pointer', justifyContent: 'flex-start', gap: 12 }}>
                <input type="checkbox" name="track_id" value={t.id} />
                <span style={{ fontWeight: 500 }}>{t.title}</span>
                <span className="small muted">{t.artist} · {mmss(t.cue_out - t.cue_in, 0)}</span>
              </label>
            ))}
          </div>
          {candidates.length > 0 && <button className="btn btn-primary" type="submit" style={{ marginTop: 14 }}>Ajouter la sélection</button>}
        </form>
      </section>

      <form action={deletePlaylist}>
        <input type="hidden" name="id" value={p.id} />
        <button className="btn btn-secondary btn-small" type="submit">Supprimer la liste</button>
      </form>
    </>
  );
}

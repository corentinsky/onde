/**
 * Rotation automatique d’une liste : à intervalle régulier (15 jours par défaut), les titres les plus
 * diffusés depuis la dernière rotation passent « au repos » quelques semaines, ceux dont le repos est
 * fini reviennent. Les nouveautés (ajoutées depuis la dernière rotation) sont protégées un cycle.
 *
 * Pur et testé : la date du jour et les diffusions sont passées en entrée.
 */

export interface RotationTrack {
  trackId: string;
  artist: string;
  /** Ajout à la liste (ms epoch). */
  addedAt: number;
  /** Au repos jusqu’à cette date exclue (AAAA-MM-JJ), sinon null. */
  restedUntil: string | null;
  /** Diffusions depuis la dernière rotation. */
  plays: number;
  /** Dernière diffusion (ms epoch), sinon null. */
  lastPlayedAt: number | null;
}

export interface RotationSettings {
  /** Part des titres en rotation mise au repos à chaque cycle (en %). */
  sharePct: number;
  /** Durée du repos (en jours). */
  restDays: number;
  /** Titres toujours en rotation, au minimum (défaut : la moitié de la liste, 12 au moins). */
  minActive?: number;
}

export interface RotationPlan {
  /** Titres mis au repos, avec leur date de retour. */
  rest: { trackId: string; until: string }[];
  /** Titres dont le repos est fini : ils reviennent. */
  back: string[];
  /** Titres en rotation après le passage. */
  activeAfter: number;
  total: number;
}

const DAY = 86_400_000;

/** Date AAAA-MM-JJ décalée de n jours. */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** Jours pleins entre deux dates AAAA-MM-JJ. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/** Le titre est-il au repos aujourd’hui ? */
export function isResting(restedUntil: string | null | undefined, today: string): boolean {
  return Boolean(restedUntil && restedUntil > today);
}

/** La rotation est-elle due aujourd’hui ? (dernière rotation datée du jour où elle a eu lieu) */
export function rotationDue(everyDays: number | null | undefined, lastDate: string | null | undefined, today: string): boolean {
  if (!everyDays || everyDays < 1) return false;
  if (!lastDate) return true;
  return daysBetween(lastDate, today) >= everyDays;
}

export function planRotation(tracks: RotationTrack[], settings: RotationSettings, today: string, lastRotatedAt: number | null): RotationPlan {
  const total = tracks.length;
  const back = tracks.filter((t) => t.restedUntil && !isResting(t.restedUntil, today)).map((t) => t.trackId);
  const active = tracks.filter((t) => !isResting(t.restedUntil, today));
  const minActive = Math.min(active.length, Math.max(settings.minActive ?? 12, Math.ceil(total / 2)));
  const share = Math.min(60, Math.max(0, settings.sharePct)) / 100;
  const quota = Math.max(0, Math.min(Math.round(active.length * share), active.length - minActive));

  // Plus un artiste est présent dans la rotation, plus ses titres partent en premier à égalité de diffusions.
  const perArtist = new Map<string, number>();
  for (const t of active) {
    const a = t.artist.trim().toLowerCase();
    perArtist.set(a, (perArtist.get(a) ?? 0) + 1);
  }
  const candidates = active
    .filter((t) => t.plays > 0)
    .filter((t) => lastRotatedAt == null || t.addedAt <= lastRotatedAt)
    .sort(
      (a, b) =>
        b.plays - a.plays ||
        (perArtist.get(b.artist.trim().toLowerCase()) ?? 0) - (perArtist.get(a.artist.trim().toLowerCase()) ?? 0) ||
        (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) ||
        a.trackId.localeCompare(b.trackId)
    );
  const until = addDays(today, Math.max(1, Math.round(settings.restDays)));
  const rest = candidates.slice(0, quota).map((t) => ({ trackId: t.trackId, until }));
  return { rest, back, activeAfter: active.length - rest.length, total };
}

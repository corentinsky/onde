/**
 * Voix posées sur l’intro (a cappella, « drops ») : un fichier court joué par-dessus le début d’un titre,
 * la musique baissée dessous, tous les N titres. Pur et testé.
 */

export interface OverlayHistoryItem {
  isJingle?: boolean;
  /** Une voix a été posée sur ce titre. */
  overlayId?: string | null;
}

/** Une voix est-elle due sur le prochain titre ? (historique du plus ancien au plus récent) */
export function overlayDue(everySongs: number | null | undefined, history: OverlayHistoryItem[]): boolean {
  const n = Math.max(1, Math.round(everySongs ?? 4));
  let songs = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.overlayId) return songs >= n - 1;
    if (!h.isJingle) songs += 1;
  }
  return songs >= n - 1;
}

/** Choisit la voix en évitant les plus récentes, tant qu’il en reste d’autres. */
export function pickOverlay(ids: string[], history: OverlayHistoryItem[], rng: () => number = Math.random): string | null {
  if (!ids.length) return null;
  const recent = history.map((h) => h.overlayId).filter((x): x is string => !!x).slice(-Math.max(0, Math.min(3, ids.length - 1)));
  const pool = ids.filter((id) => !recent.includes(id));
  const from = pool.length ? pool : ids;
  return from[Math.floor(rng() * from.length) % from.length];
}

import type { Incident, Origin, StoreState } from './data';

export const originLabel: Record<Origin, string> = {
  emergency: 'Urgence',
  national: 'National',
  regional: 'Régional',
  store: 'Boutique'
};

export const stateLabel: Record<StoreState, { label: string; color: string }> = {
  online: { label: 'En ligne', color: 'var(--ok)' },
  offline: { label: 'Hors ligne', color: 'var(--store)' },
  silent: { label: 'Silence', color: 'var(--warn)' },
  no_device: { label: 'Sans lecteur', color: 'var(--line-strong)' }
};

export const incidentLabel: Record<Incident['kind'], string> = {
  offline: 'Boutique hors ligne',
  silence: 'Silence en salle',
  volume: 'Volume trop élevé',
  stuck: 'Lecture bloquée',
  cache_low: 'Musique en avance insuffisante',
  spot_missed: 'Spot non diffusé'
};

export const statusLabel: Record<string, string> = {
  draft: 'Brouillon',
  pending_review: 'À valider',
  approved: 'Actif',
  rejected: 'Refusé',
  paused: 'En pause',
  archived: 'Archivé'
};

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'jamais';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `il y a ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

export function hours(seconds: number | null): string {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

export function clock(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(iso));
}

export function frequency(spot: { every_min: number | null; fixed_times: string[] | null; mode: string }): string {
  if (spot.fixed_times?.length) return `${spot.mode === 'sync' ? 'À la seconde, ' : ''}${spot.fixed_times.map((t) => t.slice(0, 5)).join(', ')}`;
  if (spot.every_min) return spot.every_min % 60 === 0 ? `Toutes les ${spot.every_min / 60} h` : `Toutes les ${spot.every_min} min`;
  return 'Non programmé';
}

/** Date du jour à Paris (AAAA-MM-JJ). */
export const todayParis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

/** Statut affiché : un spot actif dont la période est passée est « Terminé », pas encore commencée « À venir ». */
export function spotState(s: { status: string; starts_on: string | null; ends_on: string | null }): { key: string; label: string; live: boolean } {
  const today = todayParis();
  if (s.status === 'approved' && s.ends_on && s.ends_on < today) return { key: 'ended', label: 'Terminé', live: false };
  if (s.status === 'approved' && s.starts_on && s.starts_on > today) return { key: 'upcoming', label: 'À venir', live: false };
  return { key: s.status, label: statusLabel[s.status] ?? s.status, live: s.status === 'approved' };
}

const dm = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
/** Période d’un spot en clair : « du 4 nov. au 10 nov. », « jusqu’au 10 nov. », « à partir du 4 nov. ». */
export function period(s: { starts_on: string | null; ends_on: string | null }): string {
  if (s.starts_on && s.ends_on) return s.starts_on === s.ends_on ? `le ${dm(s.starts_on)}` : `du ${dm(s.starts_on)} au ${dm(s.ends_on)}`;
  if (s.ends_on) return `jusqu’au ${dm(s.ends_on)}`;
  if (s.starts_on) return `à partir du ${dm(s.starts_on)}`;
  return 'sans date de fin';
}

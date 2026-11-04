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

// Données du mode démo (aucun compte Supabase configuré). Enseignes fictives.
import type { Incident, Org, PlayLog, RulesRow, Spot, StoreRow } from './data';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export const orgs: Org[] = [
  { id: 'a0000000-0000-4000-8000-000000000001', name: 'Maison Aubert', slug: 'maison-aubert', hq_spots_enabled: true },
  { id: 'a0000000-0000-4000-8000-000000000002', name: 'Atelier Verne', slug: 'atelier-verne', hq_spots_enabled: true }
];

const s = (
  id: number,
  name: string,
  city: string,
  region: string,
  status: StoreRow['status'],
  seenMin: number,
  title: string | null,
  artist: string | null,
  lufs: number | null,
  incidents = 0
): StoreRow => ({
  store_id: `c0000000-0000-4000-8000-00000000000${id}`,
  name,
  city,
  region,
  status,
  last_seen_at: ago(seenMin),
  now_playing: title ? { title, artist: artist ?? '' } : null,
  cache_seconds: 64_800 - id * 1800,
  output_lufs: lufs,
  app_version: '0.1.0',
  open_incidents: incidents
});

export const stores: StoreRow[] = [
  s(4, 'Bordeaux Sainte-Catherine', 'Bordeaux', 'Nouvelle-Aquitaine', 'online', 0.1, 'Glass City', 'Kora Nine', -9.2, 1),
  s(5, 'Lille Euralille', 'Lille', 'Hauts-de-France', 'offline', 6, 'Late Light', 'The Corners', -18.6, 1),
  s(2, 'Lyon Part-Dieu', 'Lyon', 'Auvergne-Rhône-Alpes', 'online', 0.2, 'Velvet Hours', 'Nuits Blanches', -19.0),
  s(6, 'Marseille Prado', 'Marseille', 'PACA', 'offline', 120, null, null, null, 1),
  s(3, 'Nantes Atlantis', 'Nantes', 'Pays de la Loire', 'online', 0.7, 'Slow Linen', 'Maren Aldo', -18.1),
  s(1, 'Paris Haussmann', 'Paris', 'Île-de-France', 'online', 0.3, 'Paper Boats', 'Anna Veil', -18.4)
];

export const incidents: Incident[] = [
  { id: 'i3', store_id: stores[0].store_id, store_name: 'Bordeaux Sainte-Catherine', kind: 'volume', details: 'Le niveau dépasse de 9 dB le plafond fixé par le siège.', started_at: ago(4) },
  { id: 'i2', store_id: stores[1].store_id, store_name: 'Lille Euralille', kind: 'offline', details: 'Connexion instable, reconnexion en cours. Aucune coupure de son.', started_at: ago(6) },
  { id: 'i1', store_id: stores[3].store_id, store_name: 'Marseille Prado', kind: 'offline', details: 'Boutique hors ligne. Le lecteur joue sa musique en avance.', started_at: ago(120) }
];

const base = { script: '', starts_on: null, ends_on: null, daily_start: '10:00', daily_end: '19:00', every_min: null, fixed_times: null, created_at: ago(600) };
export const spots: Spot[] = [
  { ...base, id: 'e1', origin: 'national', title: 'Carte cadeau de Noël', script: 'Offrez l’élégance : la carte cadeau Maison Aubert est disponible en caisse.', duration_sec: 14, mode: 'next_break', status: 'approved', starts_on: '2026-12-01', ends_on: '2026-12-24', daily_start: '11:00', every_min: 90, target: 'Tout le réseau' },
  { ...base, id: 'e2', origin: 'national', title: 'Retouches offertes', script: 'Les retouches sont offertes sur tous les costumes jusqu’à dimanche.', duration_sec: 12, mode: 'next_break', status: 'approved', starts_on: '2026-11-01', ends_on: '2026-11-30', daily_end: '19:30', every_min: 120, target: 'Tout le réseau' },
  { ...base, id: 'e3', origin: 'national', title: 'Lancement des soldes', script: 'Les soldes d’hiver commencent aujourd’hui chez Maison Aubert.', duration_sec: 20, mode: 'sync', status: 'approved', starts_on: '2027-01-07', ends_on: '2027-01-07', fixed_times: ['10:00'], target: 'Tout le réseau' },
  { ...base, id: 'e4', origin: 'store', title: 'Démarque -20 % sur les costumes', script: 'Dernière démarque ce week-end : moins 20 % sur les costumes. Nos conseillers vous accompagnent en cabine.', duration_sec: 12, mode: 'next_break', status: 'pending_review', target: 'Lyon Part-Dieu', created_at: ago(35) },
  { ...base, id: 'e5', origin: 'store', title: 'Nocturne jeudi', script: 'Votre boutique vous accueille jusqu’à 21 h ce jeudi.', duration_sec: 10, mode: 'next_break', status: 'pending_review', target: 'Paris Haussmann', created_at: ago(80) }
];

export const rules: RulesRow = {
  priority: ['national', 'regional', 'store'],
  max_per_break: 3,
  max_seconds_per_hour: 240,
  min_gap_same_spot_min: 20,
  window_min: 20,
  never_cut_track: true,
  duck_music: true,
  alert_on_miss: true
};

export const playLogs: PlayLog[] = [
  { id: 6, spot_title: 'Carte cadeau de Noël', origin: 'national', status: 'played', at: ago(29), reason: null },
  { id: 5, spot_title: 'Retouches en cabine', origin: 'store', status: 'played', at: ago(29), reason: null },
  { id: 4, spot_title: 'Carte de fidélité', origin: 'store', status: 'played', at: ago(62), reason: null },
  { id: 3, spot_title: 'Carte cadeau de Noël', origin: 'national', status: 'played', at: ago(118), reason: null },
  { id: 2, spot_title: 'Collection cérémonie', origin: 'regional', status: 'missed', at: ago(136), reason: 'window' },
  { id: 1, spot_title: 'Ouverture', origin: 'store', status: 'played', at: ago(240), reason: null }
];

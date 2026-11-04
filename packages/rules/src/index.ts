/**
 * Moteur de règles de diffusion d’Onde.
 *
 * Exécuté à l’identique par le lecteur en boutique (hors connexion) et par la
 * régie (simulation). Pur : aucune horloge ni réseau, tout est passé en entrée.
 */

export type Origin = 'emergency' | 'national' | 'regional' | 'store';
export type Mode = 'next_break' | 'sync';

export interface SpotRequest {
  /** Identifiant unique de cette demande de passage. */
  id: string;
  /** Identifiant du spot (sert à espacer deux passages du même spot). */
  spotId: string;
  title: string;
  origin: Origin;
  durationSec: number;
  /** Heure demandée (ms epoch). */
  requestedAt: number;
  mode: Mode;
  /** Fenêtre de tolérance propre au spot, sinon celle des règles. */
  windowMin?: number;
}

export interface Rules {
  /** Ordre de priorité hors urgence (l’urgence passe toujours en premier). */
  priority: Exclude<Origin, 'emergency'>[];
  maxPerBreak: number;
  /** Durée cumulée maximale de spots sur une heure glissante. */
  maxSecondsPerHour: number;
  minGapSameSpotMin: number;
  windowMin: number;
  neverCutTrack: boolean;
}

export const DEFAULT_RULES: Rules = {
  priority: ['national', 'regional', 'store'],
  maxPerBreak: 3,
  maxSecondsPerHour: 240,
  minGapSameSpotMin: 20,
  windowMin: 20,
  neverCutTrack: true
};

export interface PlayedSpot {
  spotId: string;
  at: number;
  durationSec: number;
}

export interface PlanInput {
  now: number;
  /** Fin du titre en cours (ms epoch). */
  currentTrackEndsAt: number;
  /** Durées (s) des titres suivants, dans l’ordre de lecture. */
  upcomingTrackSec: number[];
  requests: SpotRequest[];
  rules: Rules;
  /** Spots déjà joués (pour les plafonds et l’espacement). */
  history?: PlayedSpot[];
}

export interface ScheduledSpot {
  request: SpotRequest;
  startsAt: number;
}

export interface Break {
  at: number;
  kind: 'interrupt' | 'sync' | 'between_tracks';
  items: ScheduledSpot[];
}

export type MissReason = 'window' | 'hourly_cap' | 'same_spot_gap';

export interface Missed {
  request: SpotRequest;
  reason: MissReason;
}

export interface Plan {
  breaks: Break[];
  missed: Missed[];
  /** Demandes encore à venir, au-delà de l’horizon calculé. */
  pending: SpotRequest[];
}

const MIN = 60_000;
const HOUR = 60 * MIN;

export function rank(origin: Origin, rules: Rules): number {
  if (origin === 'emergency') return -1;
  const i = rules.priority.indexOf(origin);
  return i === -1 ? rules.priority.length : i;
}

export function sortByPriority(requests: SpotRequest[], rules: Rules): SpotRequest[] {
  return [...requests].sort(
    (a, b) => rank(a.origin, rules) - rank(b.origin, rules) || a.requestedAt - b.requestedAt || a.id.localeCompare(b.id)
  );
}

function windowEnd(r: SpotRequest, rules: Rules): number {
  return r.requestedAt + (r.windowMin ?? rules.windowMin) * MIN;
}

/**
 * Calcule les prochains écrans de spots.
 *
 * - Urgence : passe immédiatement, coupe le titre.
 * - Synchronisé : passe à l’heure exacte demandée, dans toutes les boutiques.
 * - Sinon : au premier écran entre deux titres, par ordre de priorité,
 *   dans la limite des plafonds et de la fenêtre de tolérance.
 */
export function planBreaks(input: PlanInput): Plan {
  const { now, rules } = input;
  const history: PlayedSpot[] = [...(input.history ?? [])];
  const breaks: Break[] = [];
  const missed: Missed[] = [];

  const emergencies = input.requests.filter((r) => r.origin === 'emergency');
  const syncs = input.requests.filter((r) => r.origin !== 'emergency' && r.mode === 'sync');
  let queue = sortByPriority(
    input.requests.filter((r) => r.origin !== 'emergency' && r.mode !== 'sync'),
    rules
  );

  const record = (b: Break) => {
    let t = b.at;
    for (const it of b.items) {
      it.startsAt = t;
      history.push({ spotId: it.request.spotId, at: t, durationSec: it.request.durationSec });
      t += it.request.durationSec * 1000;
    }
    breaks.push(b);
    return t;
  };

  if (emergencies.length) {
    record({ at: now, kind: 'interrupt', items: sortByPriority(emergencies, rules).map((request) => ({ request, startsAt: now })) });
  }

  for (const r of [...syncs].sort((a, b) => a.requestedAt - b.requestedAt)) {
    const at = Math.max(r.requestedAt, now);
    if (at > windowEnd(r, rules)) {
      missed.push({ request: r, reason: 'window' });
      continue;
    }
    const existing = breaks.find((b) => b.kind === 'sync' && b.at === at);
    if (existing) existing.items.push({ request: r, startsAt: at });
    else record({ at, kind: 'sync', items: [{ request: r, startsAt: at }] });
  }

  const secondsInLastHour = (t: number) =>
    history.filter((h) => h.at > t - HOUR && h.at <= t).reduce((acc, h) => acc + h.durationSec, 0);
  const lastPlayOf = (spotId: string) =>
    history.filter((h) => h.spotId === spotId).reduce((acc, h) => Math.max(acc, h.at), -Infinity);

  // Heures des écrans entre deux titres.
  const slots: number[] = [];
  let t = rules.neverCutTrack ? Math.max(input.currentTrackEndsAt, now) : now;
  slots.push(t);
  for (const sec of input.upcomingTrackSec) {
    t += sec * 1000;
    slots.push(t);
  }

  let shift = 0;
  for (let i = 0; i < slots.length && queue.length; i++) {
    const at = slots[i] + shift;
    const items: ScheduledSpot[] = [];
    const remaining: SpotRequest[] = [];
    let used = 0;
    let breakSec = 0;

    for (const r of queue) {
      if (r.requestedAt > at) {
        remaining.push(r);
        continue;
      }
      if (at > windowEnd(r, rules)) {
        missed.push({ request: r, reason: 'window' });
        continue;
      }
      if (used >= rules.maxPerBreak) {
        remaining.push(r);
        continue;
      }
      if (at - lastPlayOf(r.spotId) < rules.minGapSameSpotMin * MIN) {
        remaining.push(r);
        continue;
      }
      if (secondsInLastHour(at) + breakSec + r.durationSec > rules.maxSecondsPerHour) {
        remaining.push(r);
        continue;
      }
      items.push({ request: r, startsAt: at });
      used += 1;
      breakSec += r.durationSec;
    }

    if (items.length) {
      const end = record({ at, kind: 'between_tracks', items });
      shift += end - at;
    }
    queue = remaining;
  }

  // Ce qui reste : manqué si la fenêtre est dépassée à la fin de l’horizon, sinon en attente.
  const horizon = slots[slots.length - 1] + shift;
  const pending: SpotRequest[] = [];
  for (const r of queue) {
    if (horizon > windowEnd(r, rules) && r.requestedAt <= horizon) {
      const blockedByCap = secondsInLastHour(horizon) + r.durationSec > rules.maxSecondsPerHour;
      const blockedByGap = horizon - lastPlayOf(r.spotId) < rules.minGapSameSpotMin * MIN;
      missed.push({ request: r, reason: blockedByGap ? 'same_spot_gap' : blockedByCap ? 'hourly_cap' : 'window' });
    } else pending.push(r);
  }

  breaks.sort((a, b) => a.at - b.at);
  return { breaks, missed, pending };
}

export interface RecurringSpot {
  spotId: string;
  title: string;
  origin: Exclude<Origin, 'emergency'>;
  durationSec: number;
  mode: Mode;
  /** Heure de début et de fin quotidienne, en minutes depuis minuit (heure locale boutique). */
  dailyStartMin: number;
  dailyEndMin: number;
  /** Passage toutes les N minutes, ou heures fixes. */
  everyMin?: number;
  fixedTimesMin?: number[];
  windowMin?: number;
}

/**
 * Déplie un spot récurrent en demandes de passage pour une journée.
 * `dayStart` = minuit local de la boutique (ms epoch).
 */
export function expandDay(spot: RecurringSpot, dayStart: number): SpotRequest[] {
  const times: number[] = [];
  if (spot.fixedTimesMin?.length) times.push(...spot.fixedTimesMin);
  else if (spot.everyMin && spot.everyMin > 0) {
    for (let m = spot.dailyStartMin; m <= spot.dailyEndMin; m += spot.everyMin) times.push(m);
  }
  return times
    .filter((m) => m >= spot.dailyStartMin && m <= spot.dailyEndMin)
    .map((m) => ({
      id: `${spot.spotId}@${m}`,
      spotId: spot.spotId,
      title: spot.title,
      origin: spot.origin,
      durationSec: spot.durationSec,
      requestedAt: dayStart + m * MIN,
      mode: spot.mode,
      windowMin: spot.windowMin
    }));
}

export * from './player';

/**
 * Ce que le lecteur en boutique doit faire, maintenant.
 * Appelé toutes les secondes par le lecteur ; pur et testé.
 */
import { DEFAULT_RULES, expandDay, planBreaks, type Break, type Missed, type Origin, type PlayedSpot, type Rules, type ScheduledSpot, type SpotRequest } from './index';

const MIN = 60_000;

/** Ligne de règles telle que stockée dans la base. */
export interface RulesRow {
  priority: Exclude<Origin, 'emergency'>[];
  max_per_break: number;
  max_seconds_per_hour: number;
  min_gap_same_spot_min: number;
  window_min: number;
  never_cut_track: boolean;
}

export function toRules(row: Partial<RulesRow> | null | undefined): Rules {
  if (!row) return DEFAULT_RULES;
  return {
    priority: row.priority?.length === 3 ? row.priority : DEFAULT_RULES.priority,
    maxPerBreak: row.max_per_break ?? DEFAULT_RULES.maxPerBreak,
    maxSecondsPerHour: row.max_seconds_per_hour ?? DEFAULT_RULES.maxSecondsPerHour,
    minGapSameSpotMin: row.min_gap_same_spot_min ?? DEFAULT_RULES.minGapSameSpotMin,
    windowMin: row.window_min ?? DEFAULT_RULES.windowMin,
    neverCutTrack: row.never_cut_track ?? DEFAULT_RULES.neverCutTrack
  };
}

/** Spot tel que renvoyé par GET /api/device/schedule. */
export interface ScheduleSpot {
  id: string;
  origin: Origin;
  title: string;
  duration_sec: number;
  mode: 'next_break' | 'sync';
  daily_start: string; // "10:00:00"
  daily_end: string;
  every_min: number | null;
  fixed_times: string[] | null;
  window_min: number | null;
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Demandes de passage du jour pour une boutique. `dayStart` = minuit local. */
export function buildRequests(spots: ScheduleSpot[], dayStart: number): SpotRequest[] {
  return spots
    .filter((s) => s.origin !== 'emergency')
    .flatMap((s) =>
      expandDay(
        {
          spotId: s.id,
          title: s.title,
          origin: s.origin as Exclude<Origin, 'emergency'>,
          durationSec: s.duration_sec,
          mode: s.mode,
          dailyStartMin: toMin(s.daily_start),
          dailyEndMin: toMin(s.daily_end),
          everyMin: s.every_min ?? undefined,
          fixedTimesMin: s.fixed_times?.map(toMin),
          windowMin: s.window_min ?? undefined
        },
        dayStart
      ).map((r) => ({ ...r, id: `${r.id}#${dayStart}` }))
    );
}

export interface DecideInput {
  now: number;
  /** Secondes restantes du titre en cours ; null si inconnu (on joue dès que c’est dû). */
  trackRemainingSec: number | null;
  requests: SpotRequest[];
  rules: Rules;
  history: PlayedSpot[];
  /** Demandes déjà jouées ou déclarées manquées. */
  handled: ReadonlySet<string>;
  avgTrackSec?: number;
  /** Marge pour déclencher un écran (ms). */
  toleranceMs?: number;
}

export interface Decision {
  /** À jouer tout de suite, dans l’ordre. */
  play: ScheduledSpot[];
  kind: Break['kind'] | null;
  /** Demandes dont la fenêtre est réellement dépassée. */
  missed: Missed[];
  /** Prochain écran prévu (pour l’affichage). */
  next: Break | null;
}

export function decide(input: DecideInput): Decision {
  const { now, rules } = input;
  const tolerance = input.toleranceMs ?? 1500;
  const avg = input.avgTrackSec ?? 210;
  const pending = input.requests.filter((r) => !input.handled.has(r.id));
  const remaining = input.trackRemainingSec;

  const plan = planBreaks({
    now,
    currentTrackEndsAt: now + Math.max(0, remaining ?? 0) * 1000,
    upcomingTrackSec: Array.from({ length: 8 }, () => avg),
    requests: pending,
    rules: remaining == null ? { ...rules, neverCutTrack: false } : rules,
    history: input.history
  });

  const missed = plan.missed.filter((m) => now > m.request.requestedAt + (m.request.windowMin ?? rules.windowMin) * MIN);
  const first = plan.breaks[0] ?? null;
  const due = first && first.at <= now + tolerance;
  return {
    play: due ? first.items : [],
    kind: due ? first.kind : null,
    missed,
    next: first
  };
}

import type { FatigueReadiness, LatLon, PlannedWorkout, Sport } from '../types.js';
import type { LoopRouteRequest } from './loopRouteGenerator.js';
import {
  parseWorkoutStructure,
  repeatSegmentDistanceKm,
  stepDistanceKm,
  totalDistanceKm,
  type WorkoutStructure,
} from './workoutSteps.js';

export const DEFAULT_PACE_KMH: Record<Sport, number> = {
  run: 10, // ~6:00 min/km, used only when there's no Strava history to calibrate from
  bike: 25,
};

const RECOVERY_KEYWORDS = /recovery|regener|volno|easy|lehk|shake ?out/i;

export interface RoutePlan extends LoopRouteRequest {
  /** Set when the workout has recognizable work intervals: a good size for a
   *  short, repeatable loop to do the hard reps on (see workoutSteps.ts). */
  repeatSegmentKm?: number;
  structure?: WorkoutStructure;
  /** The speed actually used for every distance/pace estimate below -
   *  whichever of override/Strava-average/app-default applied. */
  paceKmh: number;
  /** First/last stretch of the main route that should always stay easy
   *  regardless of how intense the middle of the workout is - see
   *  loopRouteGenerator.ts's strictGradeWindows. */
  warmupKm?: number;
  cooldownKm?: number;
}

export interface BuildRouteOptions {
  surface?: 'road' | 'gravel';
  /** Overrides Strava-derived/default pace for every estimate (target
   *  distance from duration, warmup/cooldown split, repeat segment size). */
  speedOverrideKmh?: number;
}

export function mapIntervalsTypeToSport(type: string): Sport {
  const t = type.toLowerCase();
  if (t.includes('ride') || t.includes('bike') || t.includes('cycl')) return 'bike';
  return 'run';
}

function estimateDistanceKm(movingTimeS: number, paceKmh: number): number {
  return (movingTimeS / 3600) * paceKmh;
}

/**
 * Turns a planned workout (from intervals.icu) plus a readiness signal (from
 * recent Strava activity) into a concrete route plan.
 *
 * Terrain preference is deliberately NOT "flatten everything with
 * intervals": a route only needs to be flat when the point is to go easy
 * (high fatigue, or an explicitly easy/recovery session) — an interval or
 * otherwise intense workout is exactly the case where a hillier route can
 * be the right call (hill repeats, more engaging terrain for a hard
 * session), so it's left to lean hilly by default like everything else.
 */
export function buildRouteRequest(
  workout: PlannedWorkout,
  start: LatLon,
  readiness?: FatigueReadiness,
  options: BuildRouteOptions = {},
): RoutePlan {
  const sport = mapIntervalsTypeToSport(workout.type);
  const paceKmh = options.speedOverrideKmh ?? readiness?.recentAvgSpeedKmh ?? DEFAULT_PACE_KMH[sport];

  const structure = parseWorkoutStructure(workout) ?? undefined;

  const targetDistanceKm = workout.distanceM
    ? workout.distanceM / 1000
    : structure
      ? totalDistanceKm(structure.steps, paceKmh)
      : estimateDistanceKm(workout.movingTimeS ?? 3600, paceKmh);

  const preferFlat =
    readiness?.fatigueLevel === 'high' ||
    RECOVERY_KEYWORDS.test(workout.name) ||
    RECOVERY_KEYWORDS.test(workout.description ?? '');

  const repeatSegmentKm = structure ? (repeatSegmentDistanceKm(structure.steps, paceKmh) ?? undefined) : undefined;

  const warmupStep = structure?.steps.find((s) => s.kind === 'warmup');
  const cooldownStep = [...(structure?.steps ?? [])].reverse().find((s) => s.kind === 'cooldown');

  return {
    start,
    targetDistanceKm,
    sport,
    preferFlat,
    surface: sport === 'bike' ? (options.surface ?? 'road') : undefined,
    repeatSegmentKm,
    structure,
    paceKmh,
    warmupKm: warmupStep ? stepDistanceKm(warmupStep, paceKmh) : undefined,
    cooldownKm: cooldownStep ? stepDistanceKm(cooldownStep, paceKmh) : undefined,
  };
}

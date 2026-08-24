import type { FatigueReadiness, LatLon, PlannedWorkout, Sport } from '../types.js';
import type { LoopRouteRequest } from './loopRouteGenerator.js';
import {
  parseWorkoutStructure,
  repeatSegmentDistanceKm,
  totalDistanceKm,
  type WorkoutStructure,
} from './workoutSteps.js';

const DEFAULT_PACE_KMH: Record<Sport, number> = {
  run: 10, // ~6:00 min/km, used only when there's no Strava history to calibrate from
  bike: 25,
};

const RECOVERY_KEYWORDS = /recovery|regener|volno|easy|lehk|shake ?out/i;

export interface RoutePlan extends LoopRouteRequest {
  /** Set when the workout has recognizable work intervals: a good size for a
   *  short, repeatable loop to do the hard reps on (see workoutSteps.ts). */
  repeatSegmentKm?: number;
  structure?: WorkoutStructure;
}

export function mapIntervalsTypeToSport(type: string): Sport {
  const t = type.toLowerCase();
  if (t.includes('ride') || t.includes('bike') || t.includes('cycl')) return 'bike';
  return 'run';
}

function estimateDistanceKm(
  movingTimeS: number,
  sport: Sport,
  readiness: FatigueReadiness | undefined,
): number {
  const speedKmh = readiness?.recentAvgSpeedKmh ?? DEFAULT_PACE_KMH[sport];
  return (movingTimeS / 3600) * speedKmh;
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
  surface: 'road' | 'gravel' = 'road',
): RoutePlan {
  const sport = mapIntervalsTypeToSport(workout.type);
  const paceKmh = readiness?.recentAvgSpeedKmh ?? DEFAULT_PACE_KMH[sport];

  const structure = parseWorkoutStructure(workout) ?? undefined;

  const targetDistanceKm = workout.distanceM
    ? workout.distanceM / 1000
    : structure
      ? totalDistanceKm(structure.steps, paceKmh)
      : estimateDistanceKm(workout.movingTimeS ?? 3600, sport, readiness);

  const preferFlat =
    readiness?.fatigueLevel === 'high' ||
    RECOVERY_KEYWORDS.test(workout.name) ||
    RECOVERY_KEYWORDS.test(workout.description ?? '');

  const repeatSegmentKm = structure ? (repeatSegmentDistanceKm(structure.steps, paceKmh) ?? undefined) : undefined;

  return {
    start,
    targetDistanceKm,
    sport,
    preferFlat,
    surface: sport === 'bike' ? surface : undefined,
    repeatSegmentKm,
    structure,
  };
}

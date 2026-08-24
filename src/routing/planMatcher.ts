import type { FatigueReadiness, LatLon, PlannedWorkout, Sport } from '../types.js';
import type { LoopRouteRequest } from './loopRouteGenerator.js';

const DEFAULT_PACE_KMH: Record<Sport, number> = {
  run: 10, // ~6:00 min/km, used only when there's no Strava history to calibrate from
  bike: 25,
};

const RECOVERY_KEYWORDS = /recovery|regener|volno|easy|lehk|shake ?out/i;

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
 * recent Strava activity) into a concrete route request. This does not yet
 * try to match a workout's internal structure (e.g. specific interval
 * repeats) to route segments — it targets the workout's total distance and
 * lets fatigue/keywords steer flat-vs-hilly preference. Structured interval
 * matching is a natural next step, see README.
 */
export function buildRouteRequest(
  workout: PlannedWorkout,
  start: LatLon,
  readiness?: FatigueReadiness,
): LoopRouteRequest {
  const sport = mapIntervalsTypeToSport(workout.type);

  const targetDistanceKm = workout.distanceM
    ? workout.distanceM / 1000
    : estimateDistanceKm(workout.movingTimeS ?? 3600, sport, readiness);

  const preferFlat =
    readiness?.fatigueLevel === 'high' ||
    RECOVERY_KEYWORDS.test(workout.name) ||
    RECOVERY_KEYWORDS.test(workout.description ?? '');

  return {
    start,
    targetDistanceKm,
    sport,
    preferFlat,
  };
}

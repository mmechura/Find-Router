import { haversineDistanceKm } from './geo.js';
import type { ElevationClient } from '../integrations/elevation.js';
import type { LatLon } from '../types.js';

/** Max grade tolerated when a stretch is supposed to be easy (recovery/warmup/cooldown). */
export const STRICT_MAX_GRADE_PERCENT = 4;
/** Max grade tolerated elsewhere - hills are fine for an intense session, but this still
 *  rules out genuinely extreme/unsafe grades regardless of intent. */
export const RELAXED_MAX_GRADE_PERCENT = 12;
/** Total climbing (m) allowed per km of route when the user explicitly wants
 *  flat terrain. A per-segment grade cap alone doesn't catch a rolling
 *  profile that never exceeds it on any one leg but still climbs a lot in
 *  aggregate over a long loop - this catches that case. */
export const STRICT_MAX_GAIN_PER_KM = 10;

export interface GradeWindow {
  fromKm: number;
  toKm: number;
  maxGradePercent: number;
}

export interface GradeCheckOptions {
  /** Applies everywhere not covered by a stricter window below. */
  maxGradePercent: number;
  /** Stricter limits for specific stretches (e.g. warmup/cooldown bookends). */
  strictWindows?: GradeWindow[];
  /** Caps total climbing relative to distance - see STRICT_MAX_GAIN_PER_KM.
   *  Omit to skip this check (hills are explicitly fine). */
  maxGainPerKm?: number;
}

export interface GradeViolation {
  atKm: number;
  gradePercent: number;
  limitPercent: number;
}

export interface GainViolation {
  totalGainM: number;
  limitM: number;
  totalKm: number;
}

export interface ElevationCheckResult {
  gradeViolation: GradeViolation | null;
  gainViolation: GainViolation | null;
}

function sampleEvenly(points: LatLon[], maxCount: number): LatLon[] {
  if (points.length <= maxCount) return points;
  const sampled: LatLon[] = [];
  const step = (points.length - 1) / (maxCount - 1);
  for (let i = 0; i < maxCount; i++) sampled.push(points[Math.round(i * step)]);
  return sampled;
}

function limitAt(km: number, options: GradeCheckOptions): number {
  const windows = options.strictWindows?.filter((w) => km >= w.fromKm && km <= w.toKm) ?? [];
  if (windows.length === 0) return options.maxGradePercent;
  return Math.min(options.maxGradePercent, ...windows.map((w) => w.maxGradePercent));
}

/**
 * Walks a route's elevation profile (sampled via `elevationClient`, since
 * Mapy.com's routing geometry can have far more points than one elevation
 * batch call allows) in a single pass and checks two independent things:
 *
 * 1. `gradeViolation` - the first place the grade between two consecutive
 *    samples exceeds whatever limit applies at that point along the route
 *    (the overall `maxGradePercent`, or a stricter `strictWindows` entry).
 * 2. `gainViolation` - total climbing (sum of positive elevation deltas)
 *    against `maxGainPerKm` × route length, when that option is set. A
 *    rolling profile can stay under any single-segment grade limit while
 *    still climbing a lot in aggregate over a long loop, so a "flat"
 *    preference needs this cumulative check too, not just the per-segment
 *    one - see STRICT_MAX_GAIN_PER_KM.
 *
 * Missing elevation data for a sample (Mapy.com returns none for a small
 * fraction of the world) just skips that segment rather than failing the
 * whole check.
 */
export async function checkRouteElevation(
  coords: LatLon[],
  elevationClient: ElevationClient,
  options: GradeCheckOptions,
): Promise<ElevationCheckResult> {
  const sampled = sampleEvenly(coords, 256);
  if (sampled.length < 2) return { gradeViolation: null, gainViolation: null };

  const elevations = await elevationClient.elevations(sampled);

  let cumulativeKm = 0;
  let totalGainM = 0;
  let gradeViolation: GradeViolation | null = null;

  for (let i = 1; i < sampled.length; i++) {
    const legKm = haversineDistanceKm(sampled[i - 1], sampled[i]);
    cumulativeKm += legKm;

    const e0 = elevations[i - 1];
    const e1 = elevations[i];
    if (e0 == null || e1 == null) continue;

    const deltaM = e1 - e0;
    if (deltaM > 0) totalGainM += deltaM;

    const legM = legKm * 1000;
    if (legM < 5) continue; // avoid noise from near-duplicate points

    if (!gradeViolation) {
      const gradePercent = (Math.abs(deltaM) / legM) * 100;
      const limitPercent = limitAt(cumulativeKm, options);
      if (gradePercent > limitPercent) {
        gradeViolation = { atKm: cumulativeKm, gradePercent, limitPercent };
      }
    }
  }

  let gainViolation: GainViolation | null = null;
  if (options.maxGainPerKm != null && cumulativeKm > 0) {
    const limitM = options.maxGainPerKm * cumulativeKm;
    if (totalGainM > limitM) {
      gainViolation = { totalGainM, limitM, totalKm: cumulativeKm };
    }
  }

  return { gradeViolation, gainViolation };
}

/** Grade-only convenience wrapper around checkRouteElevation, kept for
 *  callers that only care about the per-segment check. */
export async function checkRouteGrade(
  coords: LatLon[],
  elevationClient: ElevationClient,
  options: GradeCheckOptions,
): Promise<GradeViolation | null> {
  const { gradeViolation } = await checkRouteElevation(coords, elevationClient, options);
  return gradeViolation;
}

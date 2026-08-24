import { clamp, destinationPoint, mulberry32 } from './geo.js';
import type { LatLon, MapyProfile, MapyRouteResult, Sport } from '../types.js';

export interface MapyRoutingClient {
  route(waypoints: LatLon[], profile: MapyProfile): Promise<MapyRouteResult>;
}

export interface LoopRouteRequest {
  start: LatLon;
  targetDistanceKm: number;
  sport: Sport;
  /** Prefer flatter/more direct paths over hilly trails. Mapy.com has no elevation
   *  constraint in its routing API, so this only steers the profile choice
   *  (road/fast vs. hiking/mountain) — it is a heuristic, not a guarantee. */
  preferFlat?: boolean;
  /** Fixes the loop shape for reproducible/testable output. */
  seed?: number;
  maxIterations?: number;
  /** Acceptable relative error vs. targetDistanceKm, e.g. 0.07 = +/-7%. */
  toleranceRatio?: number;
}

export interface LoopRouteResult {
  waypoints: LatLon[];
  actualDistanceKm: number;
  durationS: number;
  geometry: MapyRouteResult['geometry'];
  profile: MapyProfile;
  iterations: number;
}

export function pickProfile(sport: Sport, preferFlat = false): MapyProfile {
  if (sport === 'bike') return preferFlat ? 'bike_road' : 'bike_mountain';
  return preferFlat ? 'foot_fast' : 'foot_hiking';
}

/** Rough shape-point count: about one vertex per 3km of target distance, clamped to a sane range. */
function pickShapePointCount(targetDistanceKm: number): number {
  return clamp(Math.round(targetDistanceKm / 3), 3, 8);
}

function buildLoopWaypoints(
  start: LatLon,
  radiusKm: number,
  count: number,
  rng: () => number,
): LatLon[] {
  const points: LatLon[] = [];
  const jitterDeg = 25;
  for (let i = 1; i <= count; i++) {
    const baseBearing = (360 / (count + 1)) * i;
    const bearing = baseBearing + (rng() * 2 - 1) * jitterDeg;
    const radiusVariance = 0.8 + rng() * 0.4; // 0.8x - 1.2x, keeps the loop from being a perfect circle
    points.push(destinationPoint(start, bearing, radiusKm * radiusVariance));
  }
  return points;
}

/**
 * Generates a loop route starting and ending at `start` that approximates
 * `targetDistanceKm`, by proposing shape points around the start and asking
 * the Mapy.com Routing API to snap them to real paths/roads, then correcting
 * the radius proportionally until the returned length is within tolerance.
 */
export async function generateLoopRoute(
  req: LoopRouteRequest,
  mapy: MapyRoutingClient,
): Promise<LoopRouteResult> {
  if (req.targetDistanceKm <= 0) {
    throw new Error('targetDistanceKm must be positive');
  }

  const profile = pickProfile(req.sport, req.preferFlat);
  const pointCount = pickShapePointCount(req.targetDistanceKm);
  const rng = mulberry32(req.seed ?? Date.now());
  const toleranceRatio = req.toleranceRatio ?? 0.07;
  const maxIterations = req.maxIterations ?? 5;

  // Circumference of a circle = 2*pi*r, so this is the starting guess for a
  // loop of length targetDistanceKm; real paths rarely follow it exactly,
  // hence the iterative correction below.
  let radiusKm = req.targetDistanceKm / (2 * Math.PI);

  let best: LoopRouteResult | undefined;
  let bestError = Infinity;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const shapePoints = buildLoopWaypoints(req.start, radiusKm, pointCount, rng);
    const waypoints = [req.start, ...shapePoints, req.start];
    const result = await mapy.route(waypoints, profile);

    const error = Math.abs(result.lengthKm / req.targetDistanceKm - 1);
    if (error < bestError) {
      bestError = error;
      best = {
        waypoints,
        actualDistanceKm: result.lengthKm,
        durationS: result.durationS,
        geometry: result.geometry,
        profile,
        iterations: iteration,
      };
    }

    if (error <= toleranceRatio) break;

    const ratio = result.lengthKm / req.targetDistanceKm;
    // Guard against a degenerate 0-length response before dividing.
    radiusKm = ratio > 0 ? radiusKm / ratio : radiusKm * 1.5;
  }

  if (!best) {
    throw new Error('Mapy.com routing did not return a usable route');
  }
  return best;
}

import { clamp, destinationPoint, mulberry32 } from './geo.js';
import { findBacktrackSpurs } from './spurs.js';
import { findExcludedZoneViolation } from './excludedZones.js';
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
  /** Round-trip out-and-back length (km) below which a backtrack is tolerated as noise. */
  maxAcceptableSpurKm?: number;
}

export interface LoopRouteResult {
  waypoints: LatLon[];
  actualDistanceKm: number;
  durationS: number;
  geometry: MapyRouteResult['geometry'];
  profile: MapyProfile;
  iterations: number;
  /** Longest detected dead-end out-and-back detour in the final route, for visibility/debugging. */
  worstSpurKm: number;
}

/**
 * Bike routes always use `bike_road` (paved): this app targets road-bike
 * training (slick tires), so `bike_mountain` - which favours unpaved
 * trails - is never an acceptable surface, regardless of terrain
 * preference. Hilly-vs-flat for bikes is expressed elsewhere (route
 * shaping), not by switching to an off-road profile.
 */
export function pickProfile(sport: Sport, preferFlat = false): MapyProfile {
  if (sport === 'bike') return 'bike_road';
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
  // A bit higher than the distance-only version: some of these iterations
  // may need to be "spent" rerolling a shape that clips a dead end or a
  // no-go zone rather than just refining distance.
  const maxIterations = req.maxIterations ?? 8;
  // Round-trip length below which a backtrack is treated as noise (e.g. a
  // short driveway) rather than the annoying "in 150m, turn around" spur.
  const maxAcceptableSpurKm = req.maxAcceptableSpurKm ?? 0.12;

  // Circumference of a circle = 2*pi*r, so this is the starting guess for a
  // loop of length targetDistanceKm; real paths rarely follow it exactly,
  // hence the iterative correction below.
  let radiusKm = req.targetDistanceKm / (2 * Math.PI);

  let best: LoopRouteResult | undefined;
  let bestScore = Infinity;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const shapePoints = buildLoopWaypoints(req.start, radiusKm, pointCount, rng);
    const waypoints = [req.start, ...shapePoints, req.start];
    const result = await mapy.route(waypoints, profile);

    const routeCoords: LatLon[] = result.geometry.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
    const { worstSpurKm } = findBacktrackSpurs(routeCoords);
    const zoneViolation = findExcludedZoneViolation(routeCoords);

    const distanceError = Math.abs(result.lengthKm / req.targetDistanceKm - 1);
    // A no-go zone is disqualifying, not just "worse": weight it far above
    // anything distance/spur scoring could otherwise offset.
    const score = (zoneViolation ? 1000 : 0) + worstSpurKm * 10 + distanceError;

    if (score < bestScore) {
      bestScore = score;
      best = {
        waypoints,
        actualDistanceKm: result.lengthKm,
        durationS: result.durationS,
        geometry: result.geometry,
        profile,
        iterations: iteration,
        worstSpurKm,
      };
    }

    const isGoodEnough = !zoneViolation && distanceError <= toleranceRatio && worstSpurKm <= maxAcceptableSpurKm;
    if (isGoodEnough) break;

    const ratio = result.lengthKm / req.targetDistanceKm;
    // Guard against a degenerate 0-length response before dividing.
    radiusKm = ratio > 0 ? radiusKm / ratio : radiusKm * 1.5;
  }

  if (!best) {
    throw new Error('Mapy.com routing did not return a usable route');
  }
  return best;
}

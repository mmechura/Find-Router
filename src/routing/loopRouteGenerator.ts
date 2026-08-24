import { clamp, destinationPoint, mulberry32 } from './geo.js';
import { findBacktrackSpurs } from './spurs.js';
import { legOverlapRatio } from './legOverlap.js';
import { staticExclusionChecker, type ExclusionChecker } from './excludedZones.js';
import { checkRouteElevation, type GradeWindow } from './elevationProfile.js';
import type { ElevationClient } from '../integrations/elevation.js';
import type { RoadSnapper } from './roadSnapper.js';
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
  /** Bike only: 'road' (paved, default) or 'gravel' (ok with unpaved tracks). Ignored for run. */
  surface?: 'road' | 'gravel';
  /** Fixes the loop shape for reproducible/testable output. */
  seed?: number;
  maxIterations?: number;
  /** Acceptable relative error vs. targetDistanceKm, e.g. 0.07 = +/-7%. */
  toleranceRatio?: number;
  /** Round-trip out-and-back length (km) below which a backtrack is tolerated as noise. */
  maxAcceptableSpurKm?: number;
  /** How close (km) two legs of the loop have to run to count as "the same
   *  road" - see legOverlap.ts. Default ~30m absorbs GPS/snap noise and
   *  opposite-side-of-road offsets, same tolerance used elsewhere for this. */
  legOverlapBufferKm?: number;
  /** Fraction (0-1) of a leg allowed to retrace an earlier leg before it's
   *  worth re-picking that leg's endpoint (see maxLegRetries) or, failing
   *  that, counting against this candidate's score. */
  maxLegOverlapRatio?: number;
  /** How many extra attempts to re-pick a single leg's endpoint when it
   *  retraces an earlier leg, before giving up and keeping the
   *  least-overlapping attempt. Each extra attempt is one more Mapy.com
   *  call, so this stays small. */
  maxLegRetries?: number;
  /** Defaults to a network-free, static-list-only checker (see excludedZones.ts).
   *  route.ts wires in a live OSM-backed one via buildExclusionChecker(). */
  exclusionChecker?: ExclusionChecker;
  /** Snaps each proposed shape point to the nearest real road/path (see
   *  roadSnapper.ts) instead of using the raw, possibly-off-road coordinate.
   *  Omit to fall back to the raw coordinate (e.g. in tests). */
  roadSnapper?: RoadSnapper;
  /** Verifies the route's elevation profile via Mapy.com's Elevation API and
   *  rejects a candidate whose grade exceeds what's acceptable - either
   *  everywhere (`maxGradePercent`) or within specific stretches
   *  (`strictWindows`, e.g. the warmup/cooldown bookends). Omit to skip
   *  elevation checking entirely (no client needed then). */
  elevationGate?: {
    client: ElevationClient;
    maxGradePercent: number;
    strictWindows?: GradeWindow[];
    /** Caps total climbing per km - see STRICT_MAX_GAIN_PER_KM. Omit to
     *  skip (hills are fine, e.g. preferFlat is false). */
    maxGainPerKm?: number;
  };
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
  /** Worst fraction (0-1) of any one leg that retraces an earlier leg of the
   *  same loop - see legOverlap.ts. Only the Mapy.com loop generator
   *  populates this (each leg is a separate routing call there); other
   *  engines leave it undefined. */
  worstLegOverlapRatio?: number;
}

/**
 * Bike routes default to `bike_road` (paved) since that's the common case
 * (slick tires), but the rider might take a gravel bike out instead - in
 * that case `bike_mountain` (Mapy.com's closest profile to "unpaved ok") is
 * the right choice. Either way this is a hard surface constraint, not a
 * terrain-difficulty one: hilly-vs-flat for bikes doesn't change the
 * profile, only which bike is in the garage today does.
 */
export function pickProfile(sport: Sport, preferFlat = false, surface: 'road' | 'gravel' = 'road'): MapyProfile {
  if (sport === 'bike') return surface === 'gravel' ? 'bike_mountain' : 'bike_road';
  return preferFlat ? 'foot_fast' : 'foot_hiking';
}

/** Rough shape-point count: about one vertex per 3km of target distance, clamped to a sane range. */
function pickShapePointCount(targetDistanceKm: number): number {
  return clamp(Math.round(targetDistanceKm / 3), 3, 8);
}

/** One candidate point for shape-point slot `i` of `count`, at bearing
 *  `(360/(count+1))*i` plus random jitter - a fresh call redraws the jitter,
 *  which is how routeLoopSegmented() below re-picks a leg's endpoint on retry. */
function proposeShapePoint(
  start: LatLon,
  slot: number,
  count: number,
  radiusKm: number,
  rng: () => number,
  roadSnapper: RoadSnapper | undefined,
): LatLon {
  const jitterDeg = 25;
  const baseBearing = (360 / (count + 1)) * slot;
  const bearing = baseBearing + (rng() * 2 - 1) * jitterDeg;
  const radiusVariance = 0.8 + rng() * 0.4; // 0.8x - 1.2x, keeps the loop from being a perfect circle
  const idealPoint = destinationPoint(start, bearing, radiusKm * radiusVariance);
  // Snap to a real road/path point when we have road-network data for the
  // area - a raw synthetic coordinate is what caused the "drive into a
  // cul-de-sac and back" spurs in the first place.
  return roadSnapper?.nearest(idealPoint) ?? idealPoint;
}

interface SegmentedRoute {
  waypoints: LatLon[];
  coords: LatLon[];
  lengthKm: number;
  durationS: number;
  worstLegOverlapRatio: number;
}

/**
 * Routes the loop leg by leg (start -> p1, p1 -> p2, ..., pN -> start) as
 * independent point-to-point Mapy.com calls, instead of one call carrying
 * every waypoint. This is what makes leg-vs-leg overlap checking possible:
 * with a single multi-waypoint call, there's no way to tell "did the road
 * back from p3 reuse the same road already ridden between p1 and p2" -
 * whereas checking each leg's own polyline against the ones already
 * accepted catches exactly that (see legOverlap.ts), which a same-point
 * mirror-symmetry check like spurs.ts's `findBacktrackSpurs` cannot: that
 * only sees an immediate local turnaround, not two far-apart legs sharing a
 * road. When a leg overlaps too much, only that leg's endpoint is re-picked
 * and re-routed - the legs already accepted stay as they are.
 */
async function routeLoopSegmented(
  start: LatLon,
  pointCount: number,
  radiusKm: number,
  profile: MapyProfile,
  mapy: MapyRoutingClient,
  rng: () => number,
  roadSnapper: RoadSnapper | undefined,
  options: { overlapBufferKm: number; maxOverlapRatio: number; maxRetries: number },
): Promise<SegmentedRoute> {
  const waypoints: LatLon[] = [start];
  const legs: LatLon[][] = [];
  let lengthKm = 0;
  let durationS = 0;
  let worstLegOverlapRatio = 0;

  for (let slot = 1; slot <= pointCount + 1; slot++) {
    const closingLeg = slot === pointCount + 1; // last leg always returns to start - nothing to re-pick
    const from = waypoints[waypoints.length - 1];
    const attempts = closingLeg ? 1 : 1 + options.maxRetries;

    let bestAttempt: { point: LatLon; coords: LatLon[]; lengthKm: number; durationS: number; overlapRatio: number } | undefined;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const to = closingLeg ? start : proposeShapePoint(start, slot, pointCount, radiusKm, rng, roadSnapper);
      const result = await mapy.route([from, to], profile);
      const coords: LatLon[] = result.geometry.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
      const overlapRatio = legOverlapRatio(coords, legs, options.overlapBufferKm);
      if (!bestAttempt || overlapRatio < bestAttempt.overlapRatio) {
        bestAttempt = { point: to, coords, lengthKm: result.lengthKm, durationS: result.durationS, overlapRatio };
      }
      if (overlapRatio <= options.maxOverlapRatio) break; // good enough - stop spending retries on this leg
    }

    waypoints.push(bestAttempt!.point);
    legs.push(bestAttempt!.coords);
    lengthKm += bestAttempt!.lengthKm;
    durationS += bestAttempt!.durationS;
    worstLegOverlapRatio = Math.max(worstLegOverlapRatio, bestAttempt!.overlapRatio);
  }

  // Concatenate leg polylines into one continuous track without duplicating
  // the point each pair of consecutive legs shares.
  const coords: LatLon[] = [waypoints[0]];
  for (const leg of legs) coords.push(...leg.slice(1));

  return { waypoints, coords, lengthKm, durationS, worstLegOverlapRatio };
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

  const profile = pickProfile(req.sport, req.preferFlat, req.surface);
  let pointCount = pickShapePointCount(req.targetDistanceKm);
  const minPointCount = 3;
  const rng = mulberry32(req.seed ?? Date.now());
  const toleranceRatio = req.toleranceRatio ?? 0.07;
  // A bit higher than the distance-only version: some of these iterations
  // may need to be "spent" rerolling a shape that clips a dead end or a
  // no-go zone rather than just refining distance.
  const maxIterations = req.maxIterations ?? 8;
  // Round-trip length below which a backtrack is treated as noise (e.g. a
  // short driveway) rather than the annoying "in 150m, turn around" spur.
  const maxAcceptableSpurKm = req.maxAcceptableSpurKm ?? 0.12;
  const legOverlapOptions = {
    overlapBufferKm: req.legOverlapBufferKm ?? 0.03,
    maxOverlapRatio: req.maxLegOverlapRatio ?? 0.3,
    maxRetries: req.maxLegRetries ?? 1,
  };
  const exclusionChecker = req.exclusionChecker ?? staticExclusionChecker();

  // Circumference of a circle = 2*pi*r, so this is the starting guess for a
  // loop of length targetDistanceKm; real paths rarely follow it exactly,
  // hence the iterative correction below.
  let radiusKm = req.targetDistanceKm / (2 * Math.PI);

  let best: LoopRouteResult | undefined;
  let bestScore = Infinity;
  let badStreak = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const segmented = await routeLoopSegmented(req.start, pointCount, radiusKm, profile, mapy, rng, req.roadSnapper, legOverlapOptions);
    const { waypoints, coords: routeCoords, lengthKm, durationS, worstLegOverlapRatio } = segmented;
    const geometry: MapyRouteResult['geometry'] = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: routeCoords.map((p) => [p.lon, p.lat]) },
    };

    const { worstSpurKm } = findBacktrackSpurs(routeCoords);
    const zoneViolation = exclusionChecker.check(routeCoords);
    const distanceError = Math.abs(lengthKm / req.targetDistanceKm - 1);
    const cheapChecksGood =
      !zoneViolation &&
      distanceError <= toleranceRatio &&
      worstSpurKm <= maxAcceptableSpurKm &&
      worstLegOverlapRatio <= legOverlapOptions.maxOverlapRatio;

    // Elevation is a real Mapy.com API call per candidate - only spend it on
    // a candidate that would otherwise already be accepted, instead of on
    // every iteration regardless of whether the cheaper checks even passed.
    const elevationCheck =
      cheapChecksGood && req.elevationGate
        ? await checkRouteElevation(routeCoords, req.elevationGate.client, {
            maxGradePercent: req.elevationGate.maxGradePercent,
            strictWindows: req.elevationGate.strictWindows,
            maxGainPerKm: req.elevationGate.maxGainPerKm,
          })
        : null;
    const gradeViolation = elevationCheck?.gradeViolation ?? null;
    const gainViolation = elevationCheck?.gainViolation ?? null;

    // No-go zones and elevation violations are disqualifying, not just
    // "worse": weighted far above anything distance/spur/overlap scoring
    // could offset.
    const score =
      (zoneViolation ? 1000 : 0) +
      (gradeViolation ? 500 : 0) +
      (gainViolation ? 500 : 0) +
      worstSpurKm * 10 +
      worstLegOverlapRatio * 50 +
      distanceError;

    if (score < bestScore) {
      bestScore = score;
      best = {
        waypoints,
        actualDistanceKm: lengthKm,
        durationS,
        geometry,
        profile,
        iterations: iteration,
        worstSpurKm,
        worstLegOverlapRatio,
      };
    }

    if (cheapChecksGood && !gradeViolation && !gainViolation) break;

    // A shape that keeps clipping a dead end, a no-go zone, or too steep/too
    // much climbing isn't going to fix itself by nudging the radius - every
    // few failed attempts, try a simpler shape with fewer forced waypoints
    // instead, since each one is an extra chance to land somewhere only
    // reachable by backtracking or with an unwanted hill in the way.
    badStreak++;
    if (!cheapChecksGood && badStreak >= 3 && pointCount > minPointCount) {
      pointCount--;
      badStreak = 0;
    }

    const ratio = lengthKm / req.targetDistanceKm;
    // Guard against a degenerate 0-length response before dividing.
    radiusKm = ratio > 0 ? radiusKm / ratio : radiusKm * 1.5;
  }

  if (!best) {
    throw new Error('Mapy.com routing did not return a usable route');
  }
  return best;
}

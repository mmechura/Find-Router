import { clamp } from './geo.js';
import { checkRouteElevation } from './elevationProfile.js';
import type { ElevationClient } from '../integrations/elevation.js';
import type { BRouterRoutingClient, NogoCircle } from '../integrations/brouter.js';
import type { LatLon, MapyProfile } from '../types.js';
import type { LoopRouteResult } from './loopRouteGenerator.js';

export interface BRouterLoopRouteRequest {
  start: LatLon;
  targetDistanceKm: number;
  /** .brf profile name (without extension) to ask BRouter for, e.g. 'bike-road-flat'. */
  brouterProfile: string;
  /** Reported in the result and used to build the Mapy.com planner deep-link
   *  (buildMapyPlannerUrl still runs unchanged for this engine, see route.ts)
   *  - Milestone 1 only produces bike-road routes, so this is always
   *  'bike_road' today. */
  mapyProfile: MapyProfile;
  nogos?: NogoCircle[];
  directionDeg?: number;
  /** Non-blocking cross-check against the existing Mapy.com Elevation API
   *  gain/grade logic (elevationProfile.ts): logs a warning if it disagrees
   *  with a route BRouter already produced, but never rejects or retries -
   *  unlike the Mapy-based generator's elevationGate, this never changes
   *  which route is returned. Purely to build confidence data before a
   *  future milestone considers dropping this secondary check entirely for
   *  the BRouter path. Omit to skip it. */
  elevationObservability?: {
    client: ElevationClient;
    maxGradePercent: number;
    maxGainPerKm?: number;
  };
}

/** Same "about one via-point per 3km" sizing the Mapy path uses (see
 *  loopRouteGenerator.ts's pickShapePointCount) - kept separate rather than
 *  shared since it's used here for a different purpose (sampling an
 *  already-found route for the Mapy planner deep-link, not proposing shape
 *  points to search from). */
function pickWaypointCount(targetDistanceKm: number): number {
  return clamp(Math.round(targetDistanceKm / 3), 3, 8);
}

/** Evenly samples `count` interior points from a full route polyline, so the
 *  Mapy.com planner deep-link gets a handful of via-points instead of every
 *  single track point BRouter returned. */
function sampleInteriorWaypoints(coords: LatLon[], count: number): LatLon[] {
  const interior = coords.slice(1, -1);
  if (interior.length <= count) return interior;
  const step = (interior.length - 1) / (count - 1);
  const sampled: LatLon[] = [];
  for (let i = 0; i < count; i++) sampled.push(interior[Math.round(i * step)]);
  return sampled;
}

/**
 * Generates a loop route via a self-hosted BRouter instance's native
 * round-trip search, instead of the Mapy.com-based generator's
 * shape-point-guessing + retry loop (loopRouteGenerator.ts). A single
 * BRouterClient.roundTrip() call both finds the route AND satisfies the
 * elevation/no-go constraints at search time (baked into the .brf profile
 * and `nogos`, respectively) - see docs/ARCHITECTURE.md, Variant 2
 * Milestone 1.
 */
export async function generateLoopRouteViaBRouter(
  req: BRouterLoopRouteRequest,
  brouter: BRouterRoutingClient,
): Promise<LoopRouteResult> {
  if (req.targetDistanceKm <= 0) {
    throw new Error('targetDistanceKm must be positive');
  }

  const result = await brouter.roundTrip({
    start: req.start,
    targetDistanceKm: req.targetDistanceKm,
    profile: req.brouterProfile,
    directionDeg: req.directionDeg,
    nogos: req.nogos,
  });

  const coords: LatLon[] = result.geometry.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));

  if (req.elevationObservability) {
    try {
      const { gradeViolation, gainViolation } = await checkRouteElevation(coords, req.elevationObservability.client, {
        maxGradePercent: req.elevationObservability.maxGradePercent,
        maxGainPerKm: req.elevationObservability.maxGainPerKm,
      });
      if (gradeViolation || gainViolation) {
        console.warn(
          `BRouter route (reported ascend ${result.ascendM.toFixed(0)}m/descend ${result.descendM.toFixed(0)}m) still fails the Mapy Elevation API check:`,
          gradeViolation ?? gainViolation,
        );
      }
    } catch (err) {
      console.warn('BRouter elevation observability check failed:', (err as Error).message);
    }
  }

  const waypointCount = pickWaypointCount(req.targetDistanceKm);

  return {
    waypoints: [req.start, ...sampleInteriorWaypoints(coords, waypointCount), req.start],
    actualDistanceKm: result.lengthKm,
    // BRouter's own time estimate has the same "baked-in profile speed"
    // problem the Mapy path already works around - route.ts immediately
    // overrides this with estimateDurationS(), same as for the Mapy-based
    // generator, so 0 here is never actually shown to a user.
    durationS: 0,
    geometry: result.geometry,
    profile: req.mapyProfile,
    iterations: 1,
    worstSpurKm: 0,
  };
}

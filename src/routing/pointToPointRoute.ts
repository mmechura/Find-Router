import { checkRouteElevation, type GradeWindow } from './elevationProfile.js';
import { pickProfile, type LoopRouteResult, type MapyRoutingClient } from './loopRouteGenerator.js';
import type { ExclusionChecker } from './excludedZones.js';
import type { ElevationClient } from '../integrations/elevation.js';
import type { LatLon, Sport } from '../types.js';

export interface PointToPointRequest {
  start: LatLon;
  end: LatLon;
  sport: Sport;
  preferFlat?: boolean;
  surface?: 'road' | 'gravel';
  exclusionChecker?: ExclusionChecker;
  elevationGate?: {
    client: ElevationClient;
    maxGradePercent: number;
    strictWindows?: GradeWindow[];
    maxGainPerKm?: number;
  };
}

export interface PointToPointRouteResult extends LoopRouteResult {
  /** Heads-up when the route touches a no-go zone or breaks the elevation
   *  gate. Unlike generateLoopRoute(), there's exactly one route from A to
   *  B to find - no shape points to reroll and no alternative candidate to
   *  fall back on - so this is informational, not a rejection. */
  warning?: string;
}

/**
 * Routes directly from `start` to `end` via Mapy.com, instead of searching
 * for a loop of a target distance (generateLoopRoute.ts): there's exactly
 * one route to find here, so it's a single routing call plus the same
 * exclusion/elevation checks the loop generator uses, downgraded from
 * "reject and retry" to "report" since there's nothing else to try.
 */
export async function generatePointToPointRoute(
  req: PointToPointRequest,
  mapy: MapyRoutingClient,
): Promise<PointToPointRouteResult> {
  const profile = pickProfile(req.sport, req.preferFlat, req.surface);
  const waypoints = [req.start, req.end];
  const result = await mapy.route(waypoints, profile);
  const routeCoords: LatLon[] = result.geometry.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));

  let warning: string | undefined;
  const zoneViolation = req.exclusionChecker?.check(routeCoords);
  if (zoneViolation) {
    warning = `Trasa prochází přes ${zoneViolation.name} - appka to u trasy z bodu A do bodu B nemá jak objet, zkontroluj/uprav ji v Mapy.com plánovači.`;
  } else if (req.elevationGate) {
    const { gradeViolation, gainViolation } = await checkRouteElevation(routeCoords, req.elevationGate.client, {
      maxGradePercent: req.elevationGate.maxGradePercent,
      strictWindows: req.elevationGate.strictWindows,
      maxGainPerKm: req.elevationGate.maxGainPerKm,
    });
    if (gradeViolation) {
      warning = `Trasa má úsek se sklonem přes ${gradeViolation.limitPercent}% (kolem ${gradeViolation.atKm.toFixed(1)}. km) - appka to u trasy z bodu A do bodu B nemá jak objet.`;
    } else if (gainViolation) {
      warning = `Trasa má ${Math.round(gainViolation.totalGainM)} m převýšení na ${gainViolation.totalKm.toFixed(1)} km - víc, než by odpovídalo "Radši rovina".`;
    }
  }

  return {
    waypoints,
    actualDistanceKm: result.lengthKm,
    durationS: result.durationS,
    geometry: result.geometry,
    profile,
    iterations: 1,
    worstSpurKm: 0,
    warning,
  };
}

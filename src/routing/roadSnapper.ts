import { boundsAround, haversineDistanceKm } from './geo.js';
import { fetchRoadWays } from '../integrations/overpass.js';
import type { LatLon, Sport } from '../types.js';

export interface RoadSnapper {
  /** Nearest known road/path point to `target`, or null if nothing is close enough to be useful. */
  nearest(target: LatLon): LatLon | null;
}

/** Beyond this, the nearest known road point isn't really "the same place" as the target anymore. */
const MAX_SNAP_DISTANCE_KM = 0.3;

export function roadSnapperFromPoints(points: LatLon[]): RoadSnapper {
  return {
    nearest(target) {
      let best: LatLon | null = null;
      let bestDistanceKm = Infinity;
      for (const point of points) {
        const d = haversineDistanceKm(target, point);
        if (d < bestDistanceKm) {
          bestDistanceKm = d;
          best = point;
        }
      }
      return best && bestDistanceKm <= MAX_SNAP_DISTANCE_KM ? best : null;
    },
  };
}

/**
 * Builds a snapper backed by a live OSM road-network lookup (via Overpass)
 * around `center` - a candidate shape point then snaps to the nearest
 * actual road/path node instead of using an arbitrary lat/lon that might
 * sit in the middle of a field or a building.
 *
 * Fetches once - call before generating route candidates, not per
 * candidate. Returns null (meaning "don't snap, use raw coordinates") if
 * Overpass fails or returns nothing usable, same fail-open philosophy as
 * excludedZones.ts's buildExclusionChecker.
 */
export async function buildRoadSnapper(
  center: LatLon,
  radiusKm: number,
  sport: Sport,
  fetchImpl: typeof fetch = fetch,
): Promise<RoadSnapper | null> {
  try {
    const bbox = boundsAround(center, radiusKm * 1.6 + 0.6);
    const ways = await fetchRoadWays(bbox, sport, fetchImpl);
    const points = ways.flatMap((way) => way.points);
    if (points.length === 0) return null;
    return roadSnapperFromPoints(points);
  } catch (err) {
    console.warn('Road network lookup failed, using unsnapped waypoints:', (err as Error).message);
    return null;
  }
}

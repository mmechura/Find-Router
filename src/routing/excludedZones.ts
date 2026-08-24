import { destinationPoint, distancePointToSegmentKm, haversineDistanceKm } from './geo.js';
import { fetchRestrictedWays, type BoundingBox, type RestrictedWay } from '../integrations/overpass.js';
import type { LatLon, Sport } from '../types.js';

export interface ExcludedZone {
  name: string;
  contains(point: LatLon): boolean;
}

export interface ExclusionChecker {
  /** Returns the first violated zone for any point in `coords`, or null if none. */
  check(coords: LatLon[]): ExcludedZone | null;
}

function boxZone(name: string, bounds: BoundingBox): ExcludedZone {
  return {
    name,
    contains(point) {
      return point.lat >= bounds.minLat && point.lat <= bounds.maxLat && point.lon >= bounds.minLon && point.lon <= bounds.maxLon;
    },
  };
}

/**
 * A zone that follows the actual shape of a road/way rather than its
 * bounding box - important for long, diagonal features like a motorway,
 * where a bounding box would falsely flag a huge unrelated area between
 * its two ends.
 */
function polylineZone(name: string, points: LatLon[], bufferKm: number): ExcludedZone {
  return {
    name,
    contains(point) {
      if (points.length === 1) return haversineDistanceKm(point, points[0]) <= bufferKm;
      for (let i = 0; i < points.length - 1; i++) {
        if (distancePointToSegmentKm(point, points[i], points[i + 1]) <= bufferKm) return true;
      }
      return false;
    },
  };
}

/**
 * Hand-maintained fallback for anywhere the dynamic OSM check (below)
 * doesn't already cover - e.g. the OSM data itself is missing an access
 * tag for a place that's locally known to be off-limits.
 *
 * Add an entry here whenever a generated route goes somewhere it shouldn't
 * and reporting it upstream to OpenStreetMap isn't an option or hasn't
 * caught up yet. To get accurate corners, right-click the two opposite
 * corners of the area on mapy.com ("Zkopírovat souřadnice").
 *
 * NOTE: the Třinecké železárny box below is a rough first estimate from a
 * screenshot, not verified against real coordinates - it needs tightening
 * once real corner coordinates are available (see README). It's mostly
 * redundant now that fetchRestrictedWays() covers OSM-tagged private/no
 * access areas dynamically, but stays as a safety net.
 */
const STATIC_ZONE_BOUNDS: { name: string; bounds: BoundingBox }[] = [
  {
    name: 'Třinecké železárny (uzavřený průmyslový areál, za závorou)',
    bounds: { minLat: 49.679, maxLat: 49.696, minLon: 18.614, maxLon: 18.646 },
  },
];

export const EXCLUDED_ZONES: ExcludedZone[] = STATIC_ZONE_BOUNDS.map((z) => boxZone(z.name, z.bounds));

function boundsAround(center: LatLon, radiusKm: number): BoundingBox {
  return {
    minLat: destinationPoint(center, 180, radiusKm).lat,
    maxLat: destinationPoint(center, 0, radiusKm).lat,
    minLon: destinationPoint(center, 270, radiusKm).lon,
    maxLon: destinationPoint(center, 90, radiusKm).lon,
  };
}

function nameForWay(way: RestrictedWay): string {
  const reason =
    (way.tags.access && `access=${way.tags.access}`) ||
    (way.tags.highway && `highway=${way.tags.highway}`) ||
    (way.tags.bicycle === 'no' && 'bicycle=no') ||
    (way.tags.barrier && `barrier=${way.tags.barrier}`) ||
    'omezený přístup';
  const label = way.tags.name ? ` - ${way.tags.name}` : '';
  return `OSM ${reason}${label} (way ${way.id})`;
}

/** Zone check using only the static list above - no network involved. */
export function staticExclusionChecker(): ExclusionChecker {
  return {
    check(coords) {
      for (const zone of EXCLUDED_ZONES) {
        if (coords.some((point) => zone.contains(point))) return zone;
      }
      return null;
    },
  };
}

/**
 * Builds a checker that combines the static list with a live OSM lookup
 * (via Overpass) for private/no-access ways/gates, plus - for bikes -
 * motorways/expressways and bicycle=no roads, within `radiusKm` of
 * `center`. Fetches once - call this before generating route candidates,
 * not per candidate, and reuse the returned checker across all of them.
 *
 * Network failures (Overpass down, rate-limited, unreachable) degrade
 * gracefully to the static-only checker rather than blocking route
 * generation - this is a safety net, not a hard dependency.
 */
export async function buildExclusionChecker(
  center: LatLon,
  radiusKm: number,
  sport: Sport,
  fetchImpl: typeof fetch = fetch,
): Promise<ExclusionChecker> {
  const dynamicZones: ExcludedZone[] = [];
  try {
    // Generous buffer: candidate waypoints can land noticeably farther
    // from `center` than the nominal loop radius once jitter is applied.
    const bbox = boundsAround(center, radiusKm * 1.6 + 0.6);
    const ways = await fetchRestrictedWays(bbox, fetchImpl, { excludeMotorRoads: sport === 'bike' });
    for (const way of ways) {
      // A 30m buffer around the road/fence line itself, not its bounding
      // box - see polylineZone() for why that distinction matters here.
      dynamicZones.push(polylineZone(nameForWay(way), way.points, 0.03));
    }
  } catch (err) {
    console.warn('Overpass zone lookup failed, using static exclusion list only:', (err as Error).message);
  }

  const allZones = [...EXCLUDED_ZONES, ...dynamicZones];
  return {
    check(coords) {
      for (const zone of allZones) {
        if (coords.some((point) => zone.contains(point))) return zone;
      }
      return null;
    },
  };
}

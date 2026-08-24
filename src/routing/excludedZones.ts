import { destinationPoint } from './geo.js';
import { fetchRestrictedWays, type BoundingBox, type RestrictedWay } from '../integrations/overpass.js';
import type { LatLon } from '../types.js';

export interface ExcludedZone {
  name: string;
  bounds: BoundingBox;
}

export interface ExclusionChecker {
  /** Returns the first violated zone for any point in `coords`, or null if none. */
  check(coords: LatLon[]): ExcludedZone | null;
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
export const EXCLUDED_ZONES: ExcludedZone[] = [
  {
    name: 'Třinecké železárny (uzavřený průmyslový areál, za závorou)',
    bounds: { minLat: 49.679, maxLat: 49.696, minLon: 18.614, maxLon: 18.646 },
  },
];

function isInBounds(point: LatLon, bounds: BoundingBox): boolean {
  return (
    point.lat >= bounds.minLat &&
    point.lat <= bounds.maxLat &&
    point.lon >= bounds.minLon &&
    point.lon <= bounds.maxLon
  );
}

function boundsAround(center: LatLon, radiusKm: number): BoundingBox {
  return {
    minLat: destinationPoint(center, 180, radiusKm).lat,
    maxLat: destinationPoint(center, 0, radiusKm).lat,
    minLon: destinationPoint(center, 270, radiusKm).lon,
    maxLon: destinationPoint(center, 90, radiusKm).lon,
  };
}

function boundsOfWay(way: RestrictedWay, bufferKm: number): BoundingBox {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of way.points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  // ~1 degree of latitude is ~111km; good enough for a small buffer.
  const bufferDeg = bufferKm / 111;
  return {
    minLat: minLat - bufferDeg,
    maxLat: maxLat + bufferDeg,
    minLon: minLon - bufferDeg,
    maxLon: maxLon + bufferDeg,
  };
}

/** Zone check using only the static list above - no network involved. */
export function staticExclusionChecker(): ExclusionChecker {
  return {
    check(coords) {
      for (const zone of EXCLUDED_ZONES) {
        if (coords.some((point) => isInBounds(point, zone.bounds))) return zone;
      }
      return null;
    },
  };
}

/**
 * Builds a checker that combines the static list with a live OSM lookup
 * (via Overpass) for private/no-access ways and gates within `radiusKm` of
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
  fetchImpl: typeof fetch = fetch,
): Promise<ExclusionChecker> {
  const dynamicZones: ExcludedZone[] = [];
  try {
    // Generous buffer: candidate waypoints can land noticeably farther
    // from `center` than the nominal loop radius once jitter is applied.
    const bbox = boundsAround(center, radiusKm * 1.6 + 0.6);
    const ways = await fetchRestrictedWays(bbox, fetchImpl);
    for (const way of ways) {
      dynamicZones.push({
        name: `OSM ${way.tags.access ?? way.tags.barrier ?? 'omezený přístup'}${way.tags.name ? ` - ${way.tags.name}` : ''} (way ${way.id})`,
        bounds: boundsOfWay(way, 0.03),
      });
    }
  } catch (err) {
    console.warn('Overpass zone lookup failed, using static exclusion list only:', (err as Error).message);
  }

  const allZones = [...EXCLUDED_ZONES, ...dynamicZones];
  return {
    check(coords) {
      for (const zone of allZones) {
        if (coords.some((point) => isInBounds(point, zone.bounds))) return zone;
      }
      return null;
    },
  };
}

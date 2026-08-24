import type { LatLon } from '../types.js';

export interface ExcludedZone {
  name: string;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

/**
 * Areas the router must never route through, regardless of what Mapy.com's
 * road data suggests is passable - private/gated industrial sites, closed
 * grounds, etc. This is a simple bounding-box check, not real geofencing:
 * good enough to reject a candidate route and try another, not meant to be
 * pixel-precise.
 *
 * Add an entry here whenever a generated route goes somewhere it shouldn't;
 * to get accurate corners, right-click the two opposite corners of the area
 * on mapy.com ("Zkopírovat souřadnice") and use those as the box.
 *
 * NOTE: the Třinecké železárny box below is a rough first estimate from a
 * screenshot, not verified against real coordinates - it needs tightening
 * once real corner coordinates are available (see README).
 */
export const EXCLUDED_ZONES: ExcludedZone[] = [
  {
    name: 'Třinecké železárny (uzavřený průmyslový areál, za závorou)',
    bounds: { minLat: 49.679, maxLat: 49.696, minLon: 18.614, maxLon: 18.646 },
  },
];

function isInBounds(point: LatLon, bounds: ExcludedZone['bounds']): boolean {
  return (
    point.lat >= bounds.minLat &&
    point.lat <= bounds.maxLat &&
    point.lon >= bounds.minLon &&
    point.lon <= bounds.maxLon
  );
}

/** Returns the first excluded zone any point in `coords` falls inside, or null if none. */
export function findExcludedZoneViolation(coords: LatLon[]): ExcludedZone | null {
  for (const zone of EXCLUDED_ZONES) {
    if (coords.some((point) => isInBounds(point, zone.bounds))) return zone;
  }
  return null;
}

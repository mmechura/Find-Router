import type { LatLon } from '../types.js';

const EARTH_RADIUS_KM = 6371;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function haversineDistanceKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Point at `distanceKm` from `start` along initial bearing `bearingDeg` (0 = north, clockwise). */
export function destinationPoint(start: LatLon, bearingDeg: number, distanceKm: number): LatLon {
  const brng = toRad(bearingDeg);
  const lat1 = toRad(start.lat);
  const lon1 = toRad(start.lon);
  const angularDistance = distanceKm / EARTH_RADIUS_KM;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(brng),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

/** Deterministic seeded PRNG (mulberry32) so route generation is reproducible per seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** A bounding box roughly `radiusKm` in every direction from `center`. */
export function boundsAround(center: LatLon, radiusKm: number): BoundingBox {
  return {
    minLat: destinationPoint(center, 180, radiusKm).lat,
    maxLat: destinationPoint(center, 0, radiusKm).lat,
    minLon: destinationPoint(center, 270, radiusKm).lon,
    maxLon: destinationPoint(center, 90, radiusKm).lon,
  };
}

/**
 * Shortest distance from `point` to the segment a-b, in km. Uses a flat
 * (equirectangular) approximation around `a` - accurate enough for the
 * tens-of-meters buffers this is used for, not meant for long distances.
 */
export function distancePointToSegmentKm(point: LatLon, a: LatLon, b: LatLon): number {
  const kmPerDegLat = 110.574;
  const kmPerDegLon = 111.32 * Math.cos(toRad(a.lat));
  const toXY = (p: LatLon) => ({ x: (p.lon - a.lon) * kmPerDegLon, y: (p.lat - a.lat) * kmPerDegLat });

  const A = { x: 0, y: 0 };
  const B = toXY(b);
  const P = toXY(point);

  const abx = B.x - A.x;
  const aby = B.y - A.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : clamp((P.x * abx + P.y * aby) / lenSq, 0, 1);
  const closestX = A.x + t * abx;
  const closestY = A.y + t * aby;

  return Math.hypot(P.x - closestX, P.y - closestY);
}

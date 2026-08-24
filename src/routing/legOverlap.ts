import { distancePointToSegmentKm, haversineDistanceKm } from './geo.js';
import type { LatLon } from '../types.js';

function isNearPolyline(point: LatLon, polyline: LatLon[], bufferKm: number): boolean {
  if (polyline.length === 1) return haversineDistanceKm(point, polyline[0]) <= bufferKm;
  for (let i = 0; i < polyline.length - 1; i++) {
    if (distancePointToSegmentKm(point, polyline[i], polyline[i + 1]) <= bufferKm) return true;
  }
  return false;
}

/**
 * Fraction (0-1) of `leg`'s length that runs within `bufferKm` of any
 * already-accepted leg of the same loop. Used to catch a loop retracing a
 * road it already used on an earlier leg (the "ride out and back on the
 * same road" problem a single-vertex spur check can't see, since the two
 * overlapping stretches aren't adjacent in the route - see
 * loopRouteGenerator.ts and spurs.ts, which only catches an immediate
 * local turnaround).
 */
export function legOverlapRatio(leg: LatLon[], previousLegs: LatLon[][], bufferKm: number): number {
  if (leg.length < 2 || previousLegs.length === 0) return 0;

  let overlappingKm = 0;
  let totalKm = 0;
  for (let i = 0; i < leg.length - 1; i++) {
    const a = leg[i];
    const b = leg[i + 1];
    const segKm = haversineDistanceKm(a, b);
    totalKm += segKm;
    const midpoint = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
    if (previousLegs.some((prevLeg) => isNearPolyline(midpoint, prevLeg, bufferKm))) {
      overlappingKm += segKm;
    }
  }
  return totalKm > 0 ? overlappingKm / totalKm : 0;
}

import { haversineDistanceKm } from './geo.js';
import type { LatLon } from '../types.js';

export interface SpurInfo {
  /** Sum of every detected out-and-back detour, round trip. */
  totalSpurKm: number;
  /** The longest single out-and-back detour found, round trip. */
  worstSpurKm: number;
}

const MATCH_TOLERANCE_KM = 0.02; // ~20m - absorbs GPS/snap noise, not a real fork in the road

/**
 * Finds "dead-end" out-and-back detours in a routed path: a stretch where the
 * path travels away from the route and then backtracks along (approximately)
 * the same coordinates, which is what Mapy.com's router produces whenever a
 * requested waypoint only has one way in (a cul-de-sac, a driveway, a path
 * that just stops) - you enter the street and immediately turn back.
 *
 * Detected by looking for local mirror symmetry in the coordinate sequence:
 * if coords[k-1], coords[k-2], ... very nearly equal coords[k+1], coords[k+2],
 * ... for a few points around some index k, that's the path retracing itself
 * around a turnaround point at k. A legitimate loop (going around a block)
 * does not produce this pattern - only a genuine "there and back" does.
 */
export function findBacktrackSpurs(coords: LatLon[], minMatchPoints = 2): SpurInfo {
  let totalSpurKm = 0;
  let worstSpurKm = 0;
  let skipUntil = -1;

  for (let k = 1; k < coords.length - 1; k++) {
    if (k <= skipUntil) continue;

    let matched = 0;
    while (
      k - 1 - matched >= 0 &&
      k + 1 + matched < coords.length &&
      haversineDistanceKm(coords[k - 1 - matched], coords[k + 1 + matched]) < MATCH_TOLERANCE_KM
    ) {
      matched++;
    }

    if (matched >= minMatchPoints) {
      let legKm = 0;
      for (let i = k - matched; i < k; i++) legKm += haversineDistanceKm(coords[i], coords[i + 1]);
      const roundTripKm = legKm * 2;
      totalSpurKm += roundTripKm;
      worstSpurKm = Math.max(worstSpurKm, roundTripKm);
      skipUntil = k + matched; // don't double-count the same mirrored stretch
    }
  }

  return { totalSpurKm, worstSpurKm };
}

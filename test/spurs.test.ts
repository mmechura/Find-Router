import { describe, expect, it } from 'vitest';
import { findBacktrackSpurs } from '../src/routing/spurs.js';
import type { LatLon } from '../src/types.js';

describe('findBacktrackSpurs', () => {
  it('finds nothing on a straight path', () => {
    const coords: LatLon[] = [
      { lat: 50.0, lon: 14.0 },
      { lat: 50.01, lon: 14.0 },
      { lat: 50.02, lon: 14.0 },
      { lat: 50.03, lon: 14.0 },
    ];
    expect(findBacktrackSpurs(coords)).toEqual({ totalSpurKm: 0, worstSpurKm: 0 });
  });

  it('finds nothing on a closed loop (square) that never retraces itself', () => {
    const coords: LatLon[] = [
      { lat: 50.0, lon: 14.0 },
      { lat: 50.01, lon: 14.0 },
      { lat: 50.01, lon: 14.01 },
      { lat: 50.0, lon: 14.01 },
      { lat: 50.0, lon: 14.0 },
    ];
    expect(findBacktrackSpurs(coords)).toEqual({ totalSpurKm: 0, worstSpurKm: 0 });
  });

  it('detects a dead-end out-and-back detour', () => {
    // A -> B -> C -> D (dead end) -> C -> B -> E: a genuine cul-de-sac spur
    // from B out to D and back.
    const a: LatLon = { lat: 50.0, lon: 14.0 };
    const b: LatLon = { lat: 50.01, lon: 14.0 };
    const c: LatLon = { lat: 50.02, lon: 14.0 };
    const d: LatLon = { lat: 50.03, lon: 14.0 };
    const e: LatLon = { lat: 50.01, lon: 14.02 };
    const coords = [a, b, c, d, c, b, e];

    const result = findBacktrackSpurs(coords);
    expect(result.worstSpurKm).toBeGreaterThan(0);
    // b -> c -> d is ~2.2km one way (2 legs of ~1.1km at this latitude), so
    // the round trip should be roughly double that.
    const oneWayKm =
      Math.round(
        (Math.abs(c.lat - b.lat) + Math.abs(d.lat - c.lat)) * 111 * 10,
      ) / 10;
    expect(result.worstSpurKm).toBeGreaterThan(oneWayKm); // round trip > one-way
    expect(result.totalSpurKm).toBeCloseTo(result.worstSpurKm, 5); // only one spur here
  });

  it('does not flag a sharp but non-retracing turn', () => {
    // A 90-degree corner is not a backtrack: the mirrored points don't match.
    const coords: LatLon[] = [
      { lat: 50.0, lon: 14.0 },
      { lat: 50.01, lon: 14.0 },
      { lat: 50.01, lon: 14.01 },
      { lat: 50.02, lon: 14.01 },
    ];
    expect(findBacktrackSpurs(coords).worstSpurKm).toBe(0);
  });
});

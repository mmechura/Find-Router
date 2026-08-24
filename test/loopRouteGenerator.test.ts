import { describe, expect, it } from 'vitest';
import { generateLoopRoute, pickProfile, type MapyRoutingClient } from '../src/routing/loopRouteGenerator.js';
import { haversineDistanceKm } from '../src/routing/geo.js';
import type { LatLon, MapyRouteResult } from '../src/types.js';

function sumPathKm(points: LatLon[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistanceKm(points[i - 1], points[i]);
  }
  return total;
}

/** Fake routing client: treats the straight-line path between waypoints as the
 * "real" route, inflated by a fixed detour factor to emulate roads not being
 * perfectly straight. Good enough to exercise the radius-correction loop
 * without any network access. */
function fakeMapyClient(detourFactor = 1.2): MapyRoutingClient {
  return {
    async route(waypoints, profile): Promise<MapyRouteResult> {
      const lengthKm = sumPathKm(waypoints) * detourFactor;
      return {
        lengthKm,
        durationS: lengthKm * 300,
        geometry: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: waypoints.map((p) => [p.lon, p.lat]),
          },
          properties: { profile },
        },
      };
    },
  };
}

describe('pickProfile', () => {
  it('maps sport + preference to a Mapy.com profile', () => {
    expect(pickProfile('run', false)).toBe('foot_hiking');
    expect(pickProfile('run', true)).toBe('foot_fast');
    expect(pickProfile('bike', false)).toBe('bike_mountain');
    expect(pickProfile('bike', true)).toBe('bike_road');
  });
});

describe('generateLoopRoute', () => {
  const start: LatLon = { lat: 50.0755, lon: 14.4378 };

  it('converges to within tolerance of the target distance', async () => {
    const result = await generateLoopRoute(
      { start, targetDistanceKm: 10, sport: 'run', seed: 1 },
      fakeMapyClient(),
    );
    const error = Math.abs(result.actualDistanceKm / 10 - 1);
    expect(error).toBeLessThanOrEqual(0.07);
  });

  it('starts and ends at the requested point', async () => {
    const result = await generateLoopRoute(
      { start, targetDistanceKm: 8, sport: 'bike', seed: 2 },
      fakeMapyClient(),
    );
    expect(result.waypoints[0]).toEqual(start);
    expect(result.waypoints[result.waypoints.length - 1]).toEqual(start);
  });

  it('is reproducible for the same seed', async () => {
    const a = await generateLoopRoute(
      { start, targetDistanceKm: 12, sport: 'run', seed: 99 },
      fakeMapyClient(),
    );
    const b = await generateLoopRoute(
      { start, targetDistanceKm: 12, sport: 'run', seed: 99 },
      fakeMapyClient(),
    );
    expect(a.waypoints).toEqual(b.waypoints);
  });

  it('varies the route for different seeds', async () => {
    const a = await generateLoopRoute(
      { start, targetDistanceKm: 12, sport: 'run', seed: 1 },
      fakeMapyClient(),
    );
    const b = await generateLoopRoute(
      { start, targetDistanceKm: 12, sport: 'run', seed: 2 },
      fakeMapyClient(),
    );
    expect(a.waypoints).not.toEqual(b.waypoints);
  });

  it('rejects a non-positive target distance', async () => {
    await expect(
      generateLoopRoute({ start, targetDistanceKm: 0, sport: 'run' }, fakeMapyClient()),
    ).rejects.toThrow();
  });
});

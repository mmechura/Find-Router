import { describe, expect, it, vi } from 'vitest';
import { generatePointToPointRoute } from '../src/routing/pointToPointRoute.js';
import type { MapyRoutingClient } from '../src/routing/loopRouteGenerator.js';
import type { LatLon, MapyRouteResult } from '../src/types.js';

const start: LatLon = { lat: 49.593, lon: 18.712 };
const end: LatLon = { lat: 49.575, lon: 18.756 };

function fakeMapy(coords: LatLon[] = [start, end]): MapyRoutingClient {
  return {
    async route(): Promise<MapyRouteResult> {
      return {
        lengthKm: 12,
        durationS: 3000,
        geometry: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords.map((p) => [p.lon, p.lat]) } },
      };
    },
  };
}

describe('generatePointToPointRoute', () => {
  it('routes directly start -> end, no shape points', async () => {
    const result = await generatePointToPointRoute({ start, end, sport: 'bike' }, fakeMapy());
    expect(result.waypoints).toEqual([start, end]);
    expect(result.actualDistanceKm).toBe(12);
    expect(result.iterations).toBe(1);
    expect(result.worstSpurKm).toBe(0);
    expect(result.warning).toBeUndefined();
  });

  it('warns (but still returns the route) when it crosses an excluded zone', async () => {
    const exclusionChecker = { check: () => ({ name: 'Zkušební zóna', contains: () => true }) };
    const result = await generatePointToPointRoute({ start, end, sport: 'bike', exclusionChecker }, fakeMapy());
    expect(result.warning).toMatch(/Zkušební zóna/);
    expect(result.actualDistanceKm).toBe(12);
  });

  it('warns when the elevation gate is violated, without rejecting', async () => {
    const elevationClient = { elevations: vi.fn(async (points: LatLon[]) => points.map((_, i) => i * 200)) };
    const result = await generatePointToPointRoute(
      { start, end, sport: 'run', elevationGate: { client: elevationClient, maxGradePercent: 4 } },
      fakeMapy(),
    );
    expect(result.warning).toMatch(/sklon/);
  });

  it('has no warning when nothing is violated', async () => {
    const exclusionChecker = { check: () => null };
    const elevationClient = { elevations: vi.fn(async (points: LatLon[]) => points.map(() => 100)) };
    const result = await generatePointToPointRoute(
      { start, end, sport: 'run', exclusionChecker, elevationGate: { client: elevationClient, maxGradePercent: 12 } },
      fakeMapy(),
    );
    expect(result.warning).toBeUndefined();
  });
});

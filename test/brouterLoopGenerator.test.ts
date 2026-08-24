import { describe, expect, it, vi } from 'vitest';
import { generateLoopRouteViaBRouter } from '../src/routing/brouterLoopGenerator.js';
import type { BRouterRoundTripRequest, BRouterRouteResult, BRouterRoutingClient } from '../src/integrations/brouter.js';
import type { LatLon } from '../src/types.js';

function fakeBRouterClient(coords: LatLon[], overrides: Partial<BRouterRouteResult> = {}): BRouterRoutingClient {
  return {
    async roundTrip(): Promise<BRouterRouteResult> {
      return {
        lengthKm: 25,
        ascendM: 30,
        descendM: 30,
        geometry: {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords.map((p) => [p.lon, p.lat]) },
        },
        ...overrides,
      };
    },
  };
}

const start: LatLon = { lat: 49.593, lon: 18.712 };

function longLoopCoords(): LatLon[] {
  // 12 points roughly around `start`, first === last (closed loop), like a
  // real BRouter round-trip polyline would be.
  const coords: LatLon[] = [];
  for (let i = 0; i <= 12; i++) {
    const angle = (i / 12) * 2 * Math.PI;
    coords.push({ lat: start.lat + Math.sin(angle) * 0.05, lon: start.lon + Math.cos(angle) * 0.05 });
  }
  coords[coords.length - 1] = start;
  coords[0] = start;
  return coords;
}

describe('generateLoopRouteViaBRouter', () => {
  it('maps a BRouter result into the shared LoopRouteResult shape', async () => {
    const result = await generateLoopRouteViaBRouter(
      { start, targetDistanceKm: 25, brouterProfile: 'bike-road-flat', mapyProfile: 'bike_road' },
      fakeBRouterClient(longLoopCoords()),
    );

    expect(result.actualDistanceKm).toBe(25);
    expect(result.profile).toBe('bike_road');
    expect(result.iterations).toBe(1);
    expect(result.worstSpurKm).toBe(0);
    expect(result.waypoints[0]).toEqual(start);
    expect(result.waypoints[result.waypoints.length - 1]).toEqual(start);
  });

  it('samples a small, planner-friendly number of interior waypoints instead of the full polyline', async () => {
    const coords = longLoopCoords(); // 13 points including duplicated start/end
    const result = await generateLoopRouteViaBRouter(
      { start, targetDistanceKm: 25, brouterProfile: 'bike-road-flat', mapyProfile: 'bike_road' },
      fakeBRouterClient(coords),
    );
    // ~25km / 3km per point, clamped to [3, 8] - well under the raw polyline size.
    expect(result.waypoints.length).toBeLessThan(coords.length);
    expect(result.waypoints.length).toBeGreaterThanOrEqual(2 + 3);
  });

  it("lets route.ts override the duration afterwards (0 here, never BRouter's own estimate)", async () => {
    const result = await generateLoopRouteViaBRouter(
      { start, targetDistanceKm: 10, brouterProfile: 'bike-road-hilly', mapyProfile: 'bike_road' },
      fakeBRouterClient(longLoopCoords()),
    );
    expect(result.durationS).toBe(0);
  });

  it('rejects a non-positive target distance', async () => {
    await expect(
      generateLoopRouteViaBRouter(
        { start, targetDistanceKm: 0, brouterProfile: 'bike-road-flat', mapyProfile: 'bike_road' },
        fakeBRouterClient(longLoopCoords()),
      ),
    ).rejects.toThrow();
  });

  it('passes profile, nogos and direction straight through to the client', async () => {
    const roundTrip = vi.fn(async (): Promise<BRouterRouteResult> => ({
      lengthKm: 10,
      ascendM: 0,
      descendM: 0,
      geometry: { type: 'Feature', geometry: { type: 'LineString', coordinates: longLoopCoords().map((p) => [p.lon, p.lat]) } },
    }));
    const client: BRouterRoutingClient = { roundTrip };
    const nogos = [{ name: 'Třinecké železárny', center: { lat: 49.685, lon: 18.63 }, radiusKm: 1.2 }];

    await generateLoopRouteViaBRouter(
      { start, targetDistanceKm: 10, brouterProfile: 'bike-road-flat', mapyProfile: 'bike_road', nogos, directionDeg: 45 },
      client,
    );

    expect(roundTrip).toHaveBeenCalledWith(
      expect.objectContaining<Partial<BRouterRoundTripRequest>>({
        start,
        targetDistanceKm: 10,
        profile: 'bike-road-flat',
        nogos,
        directionDeg: 45,
      }),
    );
  });

  it('logs a warning (but still returns the route) when the observability check disagrees with BRouter', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A steady climb across all points - well past a 5 m/km gain budget.
    const coords = longLoopCoords();
    const elevationClient = { elevations: vi.fn(async (points: LatLon[]) => points.map((_, i) => i * 50)) };

    const result = await generateLoopRouteViaBRouter(
      {
        start,
        targetDistanceKm: 25,
        brouterProfile: 'bike-road-flat',
        mapyProfile: 'bike_road',
        elevationObservability: { client: elevationClient, maxGradePercent: 50, maxGainPerKm: 5 },
      },
      fakeBRouterClient(coords),
    );

    expect(result).toBeDefined();
    expect(elevationClient.elevations).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not warn when the observability check agrees the route is fine', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const elevationClient = { elevations: vi.fn(async (points: LatLon[]) => points.map(() => 400)) };

    await generateLoopRouteViaBRouter(
      {
        start,
        targetDistanceKm: 25,
        brouterProfile: 'bike-road-flat',
        mapyProfile: 'bike_road',
        elevationObservability: { client: elevationClient, maxGradePercent: 4, maxGainPerKm: 10 },
      },
      fakeBRouterClient(longLoopCoords()),
    );

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('never rejects/retries because of the observability check, even if the elevation client throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const elevationClient = { elevations: vi.fn(async () => { throw new Error('Mapy Elevation API is down'); }) };

    const result = await generateLoopRouteViaBRouter(
      {
        start,
        targetDistanceKm: 25,
        brouterProfile: 'bike-road-flat',
        mapyProfile: 'bike_road',
        elevationObservability: { client: elevationClient, maxGradePercent: 4, maxGainPerKm: 10 },
      },
      fakeBRouterClient(longLoopCoords()),
    );

    expect(result).toBeDefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

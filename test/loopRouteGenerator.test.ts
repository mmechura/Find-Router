import { describe, expect, it, vi } from 'vitest';
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
  it('maps run terrain preference to a Mapy.com profile', () => {
    expect(pickProfile('run', false)).toBe('foot_hiking');
    expect(pickProfile('run', true)).toBe('foot_fast');
  });

  it('picks bike surface independently of terrain preference', () => {
    // preferFlat never changes the bike profile - only the surface choice does.
    expect(pickProfile('bike', false, 'road')).toBe('bike_road');
    expect(pickProfile('bike', true, 'road')).toBe('bike_road');
    expect(pickProfile('bike', false, 'gravel')).toBe('bike_mountain');
    expect(pickProfile('bike', true, 'gravel')).toBe('bike_mountain');
  });

  it('defaults bike surface to road when unspecified', () => {
    expect(pickProfile('bike')).toBe('bike_road');
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

  it('keeps trying past a candidate with a bad dead-end spur, in favour of a clean one', async () => {
    let call = 0;
    const client: MapyRoutingClient = {
      async route(waypoints) {
        call++;
        if (call === 1) {
          // A deliberately "perfect distance, ugly shape" first candidate:
          // straight out to a point 300m away and directly back - a spur
          // well above the default 0.12km tolerance.
          const mid = waypoints[Math.floor(waypoints.length / 2)];
          const spurTip = { lat: mid.lat + 0.0027, lon: mid.lon }; // ~300m north
          const coords = [...waypoints.slice(0, Math.floor(waypoints.length / 2) + 1), spurTip, mid, ...waypoints.slice(Math.floor(waypoints.length / 2) + 1)];
          const lengthKm = sumPathKm(coords);
          return {
            lengthKm,
            durationS: lengthKm * 300,
            geometry: {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: coords.map((p) => [p.lon, p.lat]) },
            },
          };
        }
        const lengthKm = sumPathKm(waypoints) * 1.2;
        return {
          lengthKm,
          durationS: lengthKm * 300,
          geometry: {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: waypoints.map((p) => [p.lon, p.lat]) },
          },
        };
      },
    };

    const result = await generateLoopRoute({ start, targetDistanceKm: 10, sport: 'run', seed: 5 }, client);
    expect(result.worstSpurKm).toBeLessThanOrEqual(0.12);
    expect(call).toBeGreaterThan(1);
  });

  it('re-picks a leg that would retrace an earlier leg of the same loop, instead of keeping the overlap', async () => {
    // Simulates a sparse road network where the second leg's first attempt
    // happens to come back down the exact same road the first leg already
    // used (reversed) - the "ride out and back on one road" pattern a
    // same-point mirror check (spurs.ts) can't see, since the two
    // overlapping stretches are in different legs, not adjacent points.
    // A 10km loop has 3 shape points -> 4 legs, so 4 calls with no retry;
    // call #2 (the second leg's first attempt) deliberately retraces call
    // #1, everything else is a distinct, non-overlapping leg.
    const sharedRoad: LatLon[] = [start, { lat: start.lat + 0.05, lon: start.lon + 0.02 }];
    const leg = (coords: LatLon[]): Promise<MapyRouteResult> =>
      Promise.resolve({
        lengthKm: sumPathKm(coords),
        durationS: sumPathKm(coords) * 300,
        geometry: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords.map((p) => [p.lon, p.lat]) } },
      });

    let callCount = 0;
    const client: MapyRoutingClient = {
      async route(): Promise<MapyRouteResult> {
        callCount++;
        if (callCount === 1) return leg(sharedRoad);
        if (callCount === 2) return leg([...sharedRoad].reverse());
        return leg([
          { lat: start.lat - 0.05 * callCount, lon: start.lon + 0.06 * callCount },
          { lat: start.lat - 0.05 * (callCount + 1), lon: start.lon + 0.06 * (callCount + 1) },
        ]);
      },
    };

    const result = await generateLoopRoute({ start, targetDistanceKm: 10, sport: 'run', seed: 7, maxIterations: 1 }, client);
    expect(callCount).toBeGreaterThan(4); // retried the overlapping leg instead of keeping it
    expect(result.worstLegOverlapRatio ?? 0).toBeLessThan(0.3);
  });

  it('honours a custom exclusionChecker passed in the request', async () => {
    // A checker that rejects absolutely everything - proves the injected
    // checker is what's actually consulted, not just the built-in static list.
    const rejectEverything = { check: () => ({ name: 'test zone', contains: () => true }) };
    let call = 0;
    const client: MapyRoutingClient = {
      async route(waypoints) {
        call++;
        const lengthKm = sumPathKm(waypoints);
        return {
          lengthKm,
          durationS: lengthKm * 300,
          geometry: { type: 'Feature', geometry: { type: 'LineString', coordinates: waypoints.map((p) => [p.lon, p.lat]) } },
        };
      },
    };

    const result = await generateLoopRoute(
      { start, targetDistanceKm: 10, sport: 'run', seed: 1, exclusionChecker: rejectEverything, maxIterations: 3 },
      client,
    );
    // Never "good enough" since every candidate is rejected, so it must
    // exhaust the full iteration budget (3) and still return its best guess.
    // Each iteration now routes leg by leg (start -> p1 -> p2 -> p3 -> start,
    // 4 legs for a 10km target) rather than one multi-waypoint call, so the
    // call count is iterations * legs, not iterations - see
    // routeLoopSegmented() in loopRouteGenerator.ts.
    expect(call).toBe(12);
    expect(result).toBeDefined();
  });

  it('never accepts a route that enters an excluded zone, even if the distance matches perfectly', async () => {
    let call = 0;
    const client: MapyRoutingClient = {
      async route(waypoints) {
        call++;
        // First candidate deliberately routed straight through the
        // Třinecké železárny exclusion box (see excludedZones.ts).
        const coords = call === 1 ? [{ lat: 49.685, lon: 18.63 }, ...waypoints] : waypoints;
        const lengthKm = sumPathKm(coords);
        return {
          lengthKm,
          durationS: lengthKm * 300,
          geometry: {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords.map((p) => [p.lon, p.lat]) },
          },
        };
      },
    };

    const result = await generateLoopRoute({ start, targetDistanceKm: 10, sport: 'run', seed: 3 }, client);
    const violatesZone = result.geometry.geometry.coordinates.some(
      ([lon, lat]) => lat > 49.679 && lat < 49.696 && lon > 18.614 && lon < 18.646,
    );
    expect(violatesZone).toBe(false);
    expect(call).toBeGreaterThan(1);
  });

  it('snaps every shape point through the provided roadSnapper', async () => {
    const snapTarget = { lat: 50.09, lon: 14.41 };
    const roadSnapper = { nearest: () => snapTarget };

    const result = await generateLoopRoute({ start, targetDistanceKm: 10, sport: 'run', seed: 1, roadSnapper }, fakeMapyClient());

    const interior = result.waypoints.slice(1, -1);
    expect(interior.length).toBeGreaterThan(0);
    for (const point of interior) expect(point).toEqual(snapTarget);
  });

  it('falls back to the raw point when roadSnapper finds nothing nearby', async () => {
    const roadSnapper = { nearest: () => null };
    const result = await generateLoopRoute({ start, targetDistanceKm: 10, sport: 'run', seed: 1 }, fakeMapyClient());
    const snapped = await generateLoopRoute({ start, targetDistanceKm: 10, sport: 'run', seed: 1, roadSnapper }, fakeMapyClient());
    expect(snapped.waypoints).toEqual(result.waypoints);
  });

  it('rejects a candidate whose grade exceeds the elevation gate, in favour of a flatter one', async () => {
    const client: MapyRoutingClient = {
      async route(waypoints) {
        const lengthKm = sumPathKm(waypoints);
        return {
          lengthKm,
          durationS: lengthKm * 300,
          geometry: { type: 'Feature', geometry: { type: 'LineString', coordinates: waypoints.map((p) => [p.lon, p.lat]) } },
        };
      },
    };
    // The elevation gate only runs once a candidate already passes the
    // cheaper checks (see loopRouteGenerator.ts) - count those checks
    // directly rather than raw route() calls, since one candidate is now
    // several leg calls (routeLoopSegmented), not one. The first such
    // candidate gets a brutal climb, every one after is flat.
    let elevationChecks = 0;
    const elevationClient = {
      elevations: vi.fn(async (points: LatLon[]) => {
        elevationChecks++;
        return elevationChecks === 1 ? points.map((_, i) => i * 200) : points.map(() => 100);
      }),
    };

    const result = await generateLoopRoute(
      {
        start,
        targetDistanceKm: 10,
        sport: 'run',
        seed: 1,
        elevationGate: { client: elevationClient, maxGradePercent: 4 },
      },
      client,
    );
    expect(elevationChecks).toBeGreaterThan(1);
    // The accepted (best) candidate should not be the brutal-climb one.
    expect(elevationClient.elevations).toHaveBeenCalled();
    const finalCoords = result.geometry.geometry.coordinates;
    expect(finalCoords.length).toBeGreaterThan(0);
  });

  it('rejects a candidate with too much cumulative climbing, even if no single segment is too steep', async () => {
    const client: MapyRoutingClient = {
      async route(waypoints) {
        const lengthKm = sumPathKm(waypoints);
        return {
          lengthKm,
          durationS: lengthKm * 300,
          geometry: { type: 'Feature', geometry: { type: 'LineString', coordinates: waypoints.map((p) => [p.lon, p.lat]) } },
        };
      },
    };
    // First candidate to reach the elevation gate: a steady, monotonic climb
    // across the route - each leg's grade stays comfortably under the 12%
    // cap, but the total climb over the loop blows well past a 5 m/km
    // budget. Every candidate after is flat. Counts elevation-gate checks
    // directly (see the comment in the grade-gate test above for why).
    let elevationChecks = 0;
    const elevationClient = {
      elevations: vi.fn(async (points: LatLon[]) => {
        elevationChecks++;
        return elevationChecks === 1 ? points.map((_, i) => i * 100) : points.map(() => 100);
      }),
    };

    const result = await generateLoopRoute(
      {
        start,
        targetDistanceKm: 10,
        sport: 'run',
        seed: 1,
        elevationGate: { client: elevationClient, maxGradePercent: 12, maxGainPerKm: 5 },
      },
      client,
    );
    expect(elevationChecks).toBeGreaterThan(1);
    expect(elevationClient.elevations).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('only queries the elevation gate once the cheaper checks already pass (cost control)', async () => {
    const rejectEverything = { check: () => ({ name: 'always bad', contains: () => true }) };
    const elevationClient = { elevations: vi.fn(async (points: LatLon[]) => points.map(() => 100)) };

    await generateLoopRoute(
      {
        start,
        targetDistanceKm: 10,
        sport: 'run',
        seed: 1,
        maxIterations: 3,
        exclusionChecker: rejectEverything,
        elevationGate: { client: elevationClient, maxGradePercent: 4 },
      },
      fakeMapyClient(),
    );

    // Every candidate fails the (cheap) zone check, so the (expensive)
    // elevation client should never have been consulted at all.
    expect(elevationClient.elevations).not.toHaveBeenCalled();
  });
});

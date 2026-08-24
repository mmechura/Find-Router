import { describe, expect, it, vi } from 'vitest';
import { BRouterClient } from '../src/integrations/brouter.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function canned(coordinates: [number, number, number?][], properties: Record<string, unknown> = {}): unknown {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties,
      },
    ],
  };
}

describe('BRouterClient.roundTrip', () => {
  const start = { lat: 49.593, lon: 18.712 };

  it('builds the request with the confirmed BRouter param names', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request) => jsonResponse(canned([[18.712, 49.593, 400], [18.72, 49.6, 410]], { 'track-length': 1000 })));

    await new BRouterClient('http://localhost:17777', fetchImpl).roundTrip({
      start,
      targetDistanceKm: 25,
      profile: 'bike-road-flat',
      directionDeg: 90,
      nogos: [{ name: 'test', center: { lat: 49.685, lon: 18.63 }, radiusKm: 1 }],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/brouter');
    expect(url.searchParams.get('lonlats')).toBe('18.712000,49.593000');
    expect(url.searchParams.get('profile')).toBe('bike-road-flat');
    expect(url.searchParams.get('roundTripDistance')).toBe('25000');
    expect(url.searchParams.get('roundTripDirectionAdd')).toBe('90');
    expect(url.searchParams.get('nogos')).toBe('18.630000,49.685000,1000');
    expect(url.searchParams.get('format')).toBe('geojson');
  });

  it('omits roundTripDirectionAdd when no direction is given', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request) => jsonResponse(canned([[18.712, 49.593, 400], [18.72, 49.6, 410]])));
    await new BRouterClient('http://localhost:17777', fetchImpl).roundTrip({ start, targetDistanceKm: 10, profile: 'bike-road-hilly' });
    const url = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(url.searchParams.has('roundTripDirectionAdd')).toBe(false);
    expect(url.searchParams.has('nogos')).toBe(false);
  });

  it('prefers the reported track-length over summing the polyline itself', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(canned([[18.712, 49.593, 400], [18.72, 49.6, 410]], { 'track-length': 12345 })),
    );
    const result = await new BRouterClient('http://localhost:17777', fetchImpl).roundTrip({
      start,
      targetDistanceKm: 10,
      profile: 'bike-road-flat',
    });
    expect(result.lengthKm).toBeCloseTo(12.345, 5);
  });

  it('falls back to summing the polyline when track-length is missing', async () => {
    // Two points ~1km apart (roughly 0.009 degrees latitude), no properties at all.
    const fetchImpl = vi.fn(async () => jsonResponse(canned([[18.712, 49.593, 400], [18.712, 49.602, 400]])));
    const result = await new BRouterClient('http://localhost:17777', fetchImpl).roundTrip({
      start,
      targetDistanceKm: 10,
      profile: 'bike-road-flat',
    });
    expect(result.lengthKm).toBeCloseTo(1, 1);
  });

  it('computes ascend/descend from the per-point elevation, not a "properties" field', async () => {
    // 400 -> 450 (climb 50) -> 420 (drop 30) -> 440 (climb 20): ascend 70, descend 30.
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        canned(
          [
            [18.712, 49.593, 400],
            [18.713, 49.594, 450],
            [18.714, 49.595, 420],
            [18.715, 49.596, 440],
          ],
          { 'plain-ascend': 999 }, // deliberately different, to prove this isn't what's read
        ),
      ),
    );
    const result = await new BRouterClient('http://localhost:17777', fetchImpl).roundTrip({
      start,
      targetDistanceKm: 10,
      profile: 'bike-road-flat',
    });
    expect(result.ascendM).toBeCloseTo(70, 5);
    expect(result.descendM).toBeCloseTo(30, 5);
  });

  it('treats missing elevation values as no change rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(canned([[18.712, 49.593], [18.713, 49.594]])));
    const result = await new BRouterClient('http://localhost:17777', fetchImpl).roundTrip({
      start,
      targetDistanceKm: 10,
      profile: 'bike-road-flat',
    });
    expect(result.ascendM).toBe(0);
    expect(result.descendM).toBe(0);
  });

  it('strips elevation from the returned geometry (2-tuples only)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(canned([[18.712, 49.593, 400], [18.713, 49.594, 410]])));
    const result = await new BRouterClient('http://localhost:17777', fetchImpl).roundTrip({
      start,
      targetDistanceKm: 10,
      profile: 'bike-road-flat',
    });
    expect(result.geometry.geometry.coordinates).toEqual([
      [18.712, 49.593],
      [18.713, 49.594],
    ]);
  });

  it('rejects a non-positive target distance without making a request', async () => {
    const fetchImpl = vi.fn();
    await expect(
      new BRouterClient('http://localhost:17777', fetchImpl).roundTrip({ start, targetDistanceKm: 0, profile: 'bike-road-flat' }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws with the response body on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'no route found' }, false, 500));
    await expect(
      new BRouterClient('http://localhost:17777', fetchImpl).roundTrip({ start, targetDistanceKm: 10, profile: 'bike-road-flat' }),
    ).rejects.toThrow(/500/);
  });

  it('throws when BRouter returns no features', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ type: 'FeatureCollection', features: [] }));
    await expect(
      new BRouterClient('http://localhost:17777', fetchImpl).roundTrip({ start, targetDistanceKm: 10, profile: 'bike-road-flat' }),
    ).rejects.toThrow();
  });
});

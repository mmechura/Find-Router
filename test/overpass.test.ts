import { describe, expect, it, vi } from 'vitest';
import { fetchRestrictedWays, fetchRoadWays } from '../src/integrations/overpass.js';

describe('fetchRestrictedWays', () => {
  it('parses way elements with geometry into RestrictedWay records', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        elements: [
          {
            type: 'way',
            id: 42,
            tags: { access: 'private' },
            geometry: [
              { lat: 50.1, lon: 14.1 },
              { lat: 50.1001, lon: 14.1001 },
            ],
          },
          { type: 'node', id: 7, tags: {} }, // no geometry - should be ignored
        ],
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const ways = await fetchRestrictedWays({ minLat: 50, maxLat: 50.2, minLon: 14, maxLon: 14.2 }, fetchImpl);
    expect(ways).toHaveLength(1);
    expect(ways[0].id).toBe(42);
    expect(ways[0].tags.access).toBe('private');
    expect(ways[0].points).toHaveLength(2);
  });

  it('throws with the response body when the request fails', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => 'rate limited',
    })) as unknown as typeof fetch;

    await expect(
      fetchRestrictedWays({ minLat: 50, maxLat: 50.2, minLon: 14, maxLon: 14.2 }, fetchImpl),
    ).rejects.toThrow(/429/);
  });
});

describe('fetchRoadWays', () => {
  it('excludes footway/path/pedestrian from the bike query but includes them for run', async () => {
    let capturedBody = '';
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '');
      return { ok: true, json: async () => ({ elements: [] }), text: async () => '' };
    }) as unknown as typeof fetch;

    const bbox = { minLat: 50, maxLat: 50.2, minLon: 14, maxLon: 14.2 };
    await fetchRoadWays(bbox, 'run', fetchImpl);
    expect(decodeURIComponent(capturedBody)).toContain('footway');

    await fetchRoadWays(bbox, 'bike', fetchImpl);
    expect(decodeURIComponent(capturedBody)).not.toContain('footway');
  });
});

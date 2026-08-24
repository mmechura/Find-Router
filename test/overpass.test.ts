import { describe, expect, it, vi } from 'vitest';
import { fetchRestrictedWays } from '../src/integrations/overpass.js';

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

import { describe, expect, it, vi } from 'vitest';
import { MapyElevationClient } from '../src/integrations/elevation.js';

describe('MapyElevationClient.elevations', () => {
  it('maps items to elevation values in the same order, null for missing data', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [{ elevation: 198.37 }, { elevation: -100000 }] }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const client = new MapyElevationClient('key', fetchImpl);
    const result = await client.elevations([
      { lat: 50.07, lon: 14.4 },
      { lat: 50.08, lon: 14.41 },
    ]);
    expect(result).toEqual([198.37, null]);
  });

  it('splits more than 256 points into multiple batch requests', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const count = new URL(url).searchParams.getAll('positions').length;
      return {
        ok: true,
        json: async () => ({ items: Array.from({ length: count }, () => ({ elevation: 100 })) }),
        text: async () => '',
      };
    }) as unknown as typeof fetch;

    const points = Array.from({ length: 300 }, (_, i) => ({ lat: 50 + i * 0.0001, lon: 14 }));
    const client = new MapyElevationClient('key', fetchImpl);
    const result = await client.elevations(points);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(300);
  });

  it('throws with the response body on a failed request', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limited' })) as unknown as typeof fetch;
    const client = new MapyElevationClient('key', fetchImpl);
    await expect(client.elevations([{ lat: 50, lon: 14 }])).rejects.toThrow(/429/);
  });
});

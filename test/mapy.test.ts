import { describe, expect, it, vi } from 'vitest';
import { MapyClient, buildMapyPlannerUrl } from '../src/integrations/mapy.js';

describe('MapyClient.geocode', () => {
  it('maps geocode items to a flat {label, lat, lon} list', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          { name: 'Třinec', label: 'Třinec, Česko', position: { lon: 18.6394, lat: 49.6769 } },
          { name: 'Náměstí', label: 'Náměstí, Třinec', position: { lon: 18.64, lat: 49.677 } },
        ],
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const client = new MapyClient('test-key', fetchImpl);
    const results = await client.geocode('Třinec');

    expect(results).toEqual([
      { label: 'Třinec, Česko', lat: 49.6769, lon: 18.6394 },
      { label: 'Náměstí, Třinec', lat: 49.677, lon: 18.64 },
    ]);

    const calledUrl = new URL((fetchImpl.mock.calls[0][0] as string));
    expect(calledUrl.searchParams.get('query')).toBe('Třinec');
    expect(calledUrl.searchParams.get('apikey')).toBe('test-key');
  });

  it('returns an empty array when there are no matches', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }), text: async () => '' })) as unknown as typeof fetch;
    const client = new MapyClient('test-key', fetchImpl);
    expect(await client.geocode('asdkjhaskjdh')).toEqual([]);
  });

  it('throws with the response body on a failed request', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 422, text: async () => 'bad query' })) as unknown as typeof fetch;
    const client = new MapyClient('test-key', fetchImpl);
    await expect(client.geocode('')).rejects.toThrow(/422/);
  });
});

describe('buildMapyPlannerUrl', () => {
  it('builds a mapy.com planner URL with start, end and waypoints', () => {
    const url = buildMapyPlannerUrl(
      [
        { lat: 50.0755, lon: 14.4378 },
        { lat: 50.08, lon: 14.44 },
        { lat: 50.0755, lon: 14.4378 },
      ],
      'foot_hiking',
    );
    expect(url).toContain('https://mapy.com/fnc/v1/route?');
    expect(url).toContain('routeType=foot_hiking');
    expect(url).toContain('start=14.437800%2C50.075500');
    expect(url).toContain('waypoints=14.440000%2C50.080000');
  });
});

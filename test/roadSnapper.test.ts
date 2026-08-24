import { describe, expect, it, vi } from 'vitest';
import { roadSnapperFromPoints, buildRoadSnapper } from '../src/routing/roadSnapper.js';

describe('roadSnapperFromPoints', () => {
  const points = [
    { lat: 50.0, lon: 14.0 },
    { lat: 50.01, lon: 14.0 },
    { lat: 50.02, lon: 14.0 },
  ];

  it('returns the nearest point when within the snap distance', () => {
    const snapper = roadSnapperFromPoints(points);
    const result = snapper.nearest({ lat: 50.0099, lon: 14.0001 });
    expect(result).toEqual(points[1]);
  });

  it('returns null when nothing is close enough', () => {
    const snapper = roadSnapperFromPoints(points);
    expect(snapper.nearest({ lat: 51, lon: 15 })).toBeNull();
  });

  it('returns null for an empty point list', () => {
    expect(roadSnapperFromPoints([]).nearest({ lat: 50, lon: 14 })).toBeNull();
  });
});

describe('buildRoadSnapper', () => {
  it('flattens fetched road ways into a working snapper', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        elements: [
          {
            type: 'way',
            id: 1,
            tags: { highway: 'residential' },
            geometry: [
              { lat: 50.075, lon: 14.437 },
              { lat: 50.076, lon: 14.438 },
            ],
          },
        ],
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const snapper = await buildRoadSnapper({ lat: 50.0755, lon: 14.4375 }, 2, 'run', fetchImpl);
    expect(snapper).not.toBeNull();
    expect(snapper!.nearest({ lat: 50.0751, lon: 14.4371 })).toEqual({ lat: 50.075, lon: 14.437 });
  });

  it('returns null when the lookup fails, instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await buildRoadSnapper({ lat: 50.0755, lon: 14.4375 }, 2, 'run', fetchImpl)).toBeNull();
  });

  it('returns null when Overpass has no road data for the area', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ elements: [] }), text: async () => '' })) as unknown as typeof fetch;
    expect(await buildRoadSnapper({ lat: 50.0755, lon: 14.4375 }, 2, 'run', fetchImpl)).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { staticExclusionChecker, buildExclusionChecker } from '../src/routing/excludedZones.js';
import type { RestrictedWay } from '../src/integrations/overpass.js';

describe('staticExclusionChecker', () => {
  it('returns null for a route nowhere near an excluded zone', () => {
    const coords = [
      { lat: 50.0755, lon: 14.4378 },
      { lat: 50.08, lon: 14.44 },
    ];
    expect(staticExclusionChecker().check(coords)).toBeNull();
  });

  it('flags a route that passes through the Třinecké železárny box', () => {
    const coords = [
      { lat: 49.7, lon: 18.6 }, // well outside
      { lat: 49.685, lon: 18.63 }, // inside the seeded bounding box
    ];
    const violation = staticExclusionChecker().check(coords);
    expect(violation).not.toBeNull();
    expect(violation!.name).toMatch(/Třinecké železárny/);
  });
});

describe('buildExclusionChecker', () => {
  it('combines the static list with dynamically fetched OSM ways', async () => {
    const fakeWay: RestrictedWay = {
      id: 123,
      tags: { access: 'private' },
      points: [
        { lat: 50.2, lon: 15.2 },
        { lat: 50.2005, lon: 15.2005 },
      ],
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ elements: [{ type: 'way', id: 123, tags: fakeWay.tags, geometry: fakeWay.points }] }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const checker = await buildExclusionChecker({ lat: 50.2, lon: 15.2 }, 5, 'run', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledOnce();

    // Near the newly fetched OSM way's actual line (within the buffer).
    expect(checker.check([{ lat: 50.2002, lon: 15.2002 }])).not.toBeNull();
    // Still catches the static Třinecké železárny box too.
    expect(checker.check([{ lat: 49.685, lon: 18.63 }])).not.toBeNull();
    // Somewhere unrelated to either.
    expect(checker.check([{ lat: 10, lon: 10 }])).toBeNull();
  });

  it('falls back to the static-only checker when the OSM lookup fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const checker = await buildExclusionChecker({ lat: 50.2, lon: 15.2 }, 5, 'run', fetchImpl);
    // Doesn't throw, and the static zone still works.
    expect(checker.check([{ lat: 49.685, lon: 18.63 }])).not.toBeNull();
    expect(checker.check([{ lat: 10, lon: 10 }])).toBeNull();
  });

  it('does not flag points far from a long, diagonal way just because they share its bounding box', async () => {
    // A long diagonal "motorway" from one corner of the area to the other -
    // a bounding-box check would wrongly treat the whole rectangle between
    // the two ends as excluded; a polyline check should not.
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        elements: [
          {
            type: 'way',
            id: 999,
            tags: { highway: 'motorway' },
            geometry: [
              { lat: 50.0, lon: 15.0 },
              { lat: 50.2, lon: 15.2 },
            ],
          },
        ],
      }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const checker = await buildExclusionChecker({ lat: 50.1, lon: 15.1 }, 5, 'bike', fetchImpl);
    // Near the far corner of the bounding box, but nowhere near the actual line.
    expect(checker.check([{ lat: 50.0, lon: 15.2 }])).toBeNull();
    // Actually on the line.
    expect(checker.check([{ lat: 50.1, lon: 15.1 }])).not.toBeNull();
  });

  it('asks Overpass to also exclude motor roads for bike but not run', async () => {
    let capturedBody = '';
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '');
      return { ok: true, json: async () => ({ elements: [] }), text: async () => '' };
    }) as unknown as typeof fetch;

    await buildExclusionChecker({ lat: 50.2, lon: 15.2 }, 5, 'bike', fetchImpl);
    expect(capturedBody).toContain('motorway');

    await buildExclusionChecker({ lat: 50.2, lon: 15.2 }, 5, 'run', fetchImpl);
    expect(capturedBody).not.toContain('motorway');
  });
});

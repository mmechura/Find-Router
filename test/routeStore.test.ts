import { describe, expect, it, vi, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileRouteStore, UpstashRouteStore, type StoredRoute } from '../src/routing/routeStore.js';

function fakeStoredRoute(overrides: Partial<StoredRoute> = {}): StoredRoute {
  return {
    id: 'route-1',
    createdAt: '2026-08-24T10:00:00.000Z',
    workoutDate: '2026-08-24',
    workoutName: 'Test workout',
    sport: 'run',
    targetDistanceKm: 10,
    route: {
      waypoints: [{ lat: 50, lon: 14 }],
      actualDistanceKm: 10.1,
      durationS: 3000,
      geometry: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[14, 50]] } },
      profile: 'foot_hiking',
      iterations: 1,
      worstSpurKm: 0,
    },
    plannerUrl: 'https://mapy.com/fnc/v1/route?start=14,50&end=14,50&routeType=foot_hiking',
    ...overrides,
  };
}

describe('FileRouteStore', () => {
  const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const storePath = join(dataDir, 'routes.json');

  afterEach(() => {
    if (existsSync(storePath)) rmSync(storePath);
  });

  it('round-trips a saved route through list() and get()', async () => {
    const store = new FileRouteStore();
    const route = fakeStoredRoute();
    await store.save(route);

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe('route-1');

    const fetched = await store.get('route-1');
    expect(fetched).toEqual(route);
  });

  it('returns newest first and respects the list limit', async () => {
    const store = new FileRouteStore();
    await store.save(fakeStoredRoute({ id: 'a' }));
    await store.save(fakeStoredRoute({ id: 'b' }));
    await store.save(fakeStoredRoute({ id: 'c' }));

    const listed = await store.list(2);
    expect(listed.map((r) => r.id)).toEqual(['c', 'b']);
  });

  it('returns null for an unknown id', async () => {
    const store = new FileRouteStore();
    expect(await store.get('does-not-exist')).toBeNull();
  });
});

describe('UpstashRouteStore', () => {
  it('pushes JSON to the front of the list and trims it', async () => {
    const redis = { lpush: vi.fn(), ltrim: vi.fn(), lrange: vi.fn() };
    const store = new UpstashRouteStore(redis as any);
    const route = fakeStoredRoute();

    await store.save(route);

    expect(redis.lpush).toHaveBeenCalledWith('find-router:routes', JSON.stringify(route));
    expect(redis.ltrim).toHaveBeenCalledWith('find-router:routes', 0, 199);
  });

  it('parses lrange results back into StoredRoute objects', async () => {
    const route = fakeStoredRoute();
    const redis = { lpush: vi.fn(), ltrim: vi.fn(), lrange: vi.fn(async () => [JSON.stringify(route)]) };
    const store = new UpstashRouteStore(redis as any);

    const listed = await store.list(10);
    expect(listed).toEqual([route]);
    expect(redis.lrange).toHaveBeenCalledWith('find-router:routes', 0, 9);
  });

  it('finds a route by id by scanning the full list', async () => {
    const route = fakeStoredRoute({ id: 'target' });
    const other = fakeStoredRoute({ id: 'other' });
    const redis = { lpush: vi.fn(), ltrim: vi.fn(), lrange: vi.fn(async () => [JSON.stringify(other), JSON.stringify(route)]) };
    const store = new UpstashRouteStore(redis as any);

    expect(await store.get('target')).toEqual(route);
    expect(await store.get('missing')).toBeNull();
  });
});

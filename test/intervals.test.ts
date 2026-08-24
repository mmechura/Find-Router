import { describe, expect, it, vi } from 'vitest';
import { IntervalsClient } from '../src/integrations/intervals.js';

function fakeFetch(events: unknown[]) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => events,
    text: async () => '',
  })) as unknown as typeof fetch;
}

describe('IntervalsClient.listPlannedWorkouts', () => {
  it('maps each event to a PlannedWorkout using its own date', async () => {
    const events = [
      { id: 1, category: 'WORKOUT', name: 'Long run', type: 'Run', start_date_local: '2026-08-24T08:00:00' },
      { id: 2, category: 'WORKOUT', name: 'Recovery ride', type: 'Ride', start_date_local: '2026-08-26T18:00:00' },
    ];
    const client = new IntervalsClient('key', 'i123', fakeFetch(events));
    const workouts = await client.listPlannedWorkouts('2026-08-24', '2026-08-30');

    expect(workouts).toHaveLength(2);
    expect(workouts[0]).toMatchObject({ id: '1', date: '2026-08-24', name: 'Long run', type: 'Run' });
    expect(workouts[1]).toMatchObject({ id: '2', date: '2026-08-26', name: 'Recovery ride', type: 'Ride' });
  });

  it('returns an empty array when the API returns nothing usable', async () => {
    const client = new IntervalsClient('key', 'i123', fakeFetch(null as unknown as unknown[]));
    expect(await client.listPlannedWorkouts('2026-08-24', '2026-08-30')).toEqual([]);
  });

  it('sends HTTP Basic auth with the literal API_KEY username', async () => {
    let capturedAuth: string | undefined;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedAuth = (init?.headers as Record<string, string>)?.Authorization;
      return { ok: true, json: async () => [], text: async () => '' };
    }) as unknown as typeof fetch;

    const client = new IntervalsClient('my-secret-key', 'i123', fetchImpl);
    await client.listPlannedWorkouts('2026-08-24', '2026-08-24');

    const expected = `Basic ${Buffer.from('API_KEY:my-secret-key').toString('base64')}`;
    expect(capturedAuth).toBe(expected);
  });
});

describe('IntervalsClient.getPlannedWorkout', () => {
  it('returns the first workout for that single day, or null', async () => {
    const withWorkout = new IntervalsClient(
      'key',
      'i123',
      fakeFetch([{ id: 5, category: 'WORKOUT', name: 'Tempo', type: 'Run', start_date_local: '2026-08-24' }]),
    );
    expect(await withWorkout.getPlannedWorkout('2026-08-24')).toMatchObject({ id: '5', name: 'Tempo' });

    const empty = new IntervalsClient('key', 'i123', fakeFetch([]));
    expect(await empty.getPlannedWorkout('2026-08-24')).toBeNull();
  });
});

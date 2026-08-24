import { describe, expect, it } from 'vitest';
import { computeReadiness } from '../src/routing/readiness.js';
import type { StravaActivitySummary } from '../src/integrations/strava.js';

function activity(daysAgo: number, overrides: Partial<StravaActivitySummary> = {}): StravaActivitySummary {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    id: daysAgo,
    type: 'Run',
    start_date: date.toISOString(),
    distance: 10000,
    moving_time: 3000,
    ...overrides,
  };
}

describe('computeReadiness', () => {
  it('flags high fatigue after a heavy recent week vs. a quiet month', () => {
    const activities = [
      activity(1, { moving_time: 7200 }),
      activity(2, { moving_time: 7200 }),
      activity(3, { moving_time: 7200 }),
      activity(20, { moving_time: 1800 }),
    ];
    const result = computeReadiness(activities, 'run');
    expect(result.fatigueLevel).toBe('high');
  });

  it('flags low fatigue after a quiet recent week vs. a busy month', () => {
    const activities = [
      activity(1, { moving_time: 600 }),
      activity(10, { moving_time: 7200 }),
      activity(15, { moving_time: 7200 }),
      activity(25, { moving_time: 7200 }),
    ];
    const result = computeReadiness(activities, 'run');
    expect(result.fatigueLevel).toBe('low');
  });

  it('derives average speed only from matching-sport activities', () => {
    const activities = [
      activity(1, { type: 'Run', distance: 10000, moving_time: 3600 }), // 10 km/h
      activity(2, { type: 'Ride', distance: 40000, moving_time: 3600 }), // should be ignored for run
    ];
    const result = computeReadiness(activities, 'run');
    expect(result.recentAvgSpeedKmh).toBeCloseTo(10, 5);
  });

  it('leaves average speed undefined when there is no matching-sport history', () => {
    const activities = [activity(1, { type: 'Ride' })];
    const result = computeReadiness(activities, 'run');
    expect(result.recentAvgSpeedKmh).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { buildRouteRequest, mapIntervalsTypeToSport } from '../src/routing/planMatcher.js';
import type { PlannedWorkout } from '../src/types.js';

const start = { lat: 50.0755, lon: 14.4378 };

describe('mapIntervalsTypeToSport', () => {
  it('maps Ride variants to bike', () => {
    expect(mapIntervalsTypeToSport('Ride')).toBe('bike');
    expect(mapIntervalsTypeToSport('VirtualRide')).toBe('bike');
    expect(mapIntervalsTypeToSport('GravelRide')).toBe('bike');
  });

  it('defaults everything else to run', () => {
    expect(mapIntervalsTypeToSport('Run')).toBe('run');
    expect(mapIntervalsTypeToSport('TrailRun')).toBe('run');
  });
});

describe('buildRouteRequest', () => {
  it('uses the planned distance directly when present', () => {
    const workout: PlannedWorkout = {
      id: '1',
      date: '2026-08-24',
      name: 'Tempo run',
      type: 'Run',
      distanceM: 12000,
    };
    const req = buildRouteRequest(workout, start);
    expect(req.targetDistanceKm).toBeCloseTo(12, 5);
    expect(req.sport).toBe('run');
  });

  it('estimates distance from duration and Strava pace when distance is missing', () => {
    const workout: PlannedWorkout = {
      id: '2',
      date: '2026-08-24',
      name: 'Easy run',
      type: 'Run',
      movingTimeS: 3600,
    };
    const req = buildRouteRequest(workout, start, {
      acuteToChronicRatio: 1,
      fatigueLevel: 'moderate',
      recentAvgSpeedKmh: 12,
    });
    expect(req.targetDistanceKm).toBeCloseTo(12, 5);
  });

  it('prefers flat routes when fatigue is high', () => {
    const workout: PlannedWorkout = { id: '3', date: '2026-08-24', name: 'Long run', type: 'Run', distanceM: 15000 };
    const req = buildRouteRequest(workout, start, {
      acuteToChronicRatio: 1.5,
      fatigueLevel: 'high',
    });
    expect(req.preferFlat).toBe(true);
  });

  it('prefers flat routes when the workout name signals recovery', () => {
    const workout: PlannedWorkout = {
      id: '4',
      date: '2026-08-24',
      name: 'Recovery shakeout',
      type: 'Run',
      distanceM: 5000,
    };
    const req = buildRouteRequest(workout, start);
    expect(req.preferFlat).toBe(true);
  });
});

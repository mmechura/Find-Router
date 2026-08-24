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

  it('does NOT force a flat route just because the workout has intervals', () => {
    const workout: PlannedWorkout = {
      id: '5',
      date: '2026-08-24',
      name: 'Intervaly',
      type: 'Run',
      description: 'Rozcvička 2km, 6x1km (400m klus), 2km vyklusání',
    };
    const req = buildRouteRequest(workout, start, { acuteToChronicRatio: 1, fatigueLevel: 'moderate' });
    // Intervals/intense sessions are exactly where a hillier route is fine
    // (or even desirable) -- only fatigue/explicit recovery should flatten it.
    expect(req.preferFlat).toBe(false);
  });

  it('still flattens an interval workout when fatigue is high', () => {
    const workout: PlannedWorkout = {
      id: '6',
      date: '2026-08-24',
      name: 'Intervaly',
      type: 'Run',
      description: '6x1km (400m klus)',
    };
    const req = buildRouteRequest(workout, start, { acuteToChronicRatio: 1.5, fatigueLevel: 'high' });
    expect(req.preferFlat).toBe(true);
  });

  it("forces a flat route when terrain override is 'flat', even for an intense workout", () => {
    const workout: PlannedWorkout = {
      id: '13',
      date: '2026-08-24',
      name: 'Intervaly',
      type: 'Run',
      description: '6x1km (400m klus)',
    };
    const req = buildRouteRequest(workout, start, undefined, { terrain: 'flat' });
    expect(req.preferFlat).toBe(true);
  });

  it("forces a hilly route when terrain override is 'hilly', even with high fatigue/recovery", () => {
    const workout: PlannedWorkout = { id: '14', date: '2026-08-24', name: 'Recovery shakeout', type: 'Run', distanceM: 5000 };
    const req = buildRouteRequest(workout, start, { acuteToChronicRatio: 1.5, fatigueLevel: 'high' }, { terrain: 'hilly' });
    expect(req.preferFlat).toBe(false);
  });

  it("keeps the automatic heuristic when terrain override is 'auto' or unset", () => {
    const workout: PlannedWorkout = { id: '15', date: '2026-08-24', name: 'Recovery shakeout', type: 'Run', distanceM: 5000 };
    expect(buildRouteRequest(workout, start, undefined, { terrain: 'auto' }).preferFlat).toBe(true);
    expect(buildRouteRequest(workout, start).preferFlat).toBe(true);
  });

  it('sums a parsed structure into the target distance when no explicit distance is set', () => {
    const workout: PlannedWorkout = {
      id: '7',
      date: '2026-08-24',
      name: 'Intervaly',
      type: 'Run',
      description: 'Rozcvička 2km, 6x1km (400m klus), 2km vyklusání',
    };
    const req = buildRouteRequest(workout, start);
    // 2 (warmup) + 6x1 (work) + 5x0.4 (recovery between reps) + 2 (cooldown) = 12 km
    expect(req.targetDistanceKm).toBeCloseTo(12, 5);
    expect(req.repeatSegmentKm).toBeCloseTo(1.4, 5);
  });

  it('leaves repeatSegmentKm unset for a plain, non-structured workout', () => {
    const workout: PlannedWorkout = { id: '8', date: '2026-08-24', name: 'Easy run', type: 'Run', distanceM: 8000 };
    const req = buildRouteRequest(workout, start);
    expect(req.repeatSegmentKm).toBeUndefined();
  });

  it('passes surface through for bike workouts', () => {
    const workout: PlannedWorkout = { id: '9', date: '2026-08-24', name: 'Endurance ride', type: 'Ride', distanceM: 40000 };
    expect(buildRouteRequest(workout, start, undefined, { surface: 'gravel' }).surface).toBe('gravel');
    expect(buildRouteRequest(workout, start, undefined, { surface: 'road' }).surface).toBe('road');
  });

  it('ignores surface for run workouts (not a bike-only concept)', () => {
    const workout: PlannedWorkout = { id: '10', date: '2026-08-24', name: 'Easy run', type: 'Run', distanceM: 8000 };
    expect(buildRouteRequest(workout, start, undefined, { surface: 'gravel' }).surface).toBeUndefined();
  });

  it('uses a speed override for duration-based distance estimates instead of Strava/default pace', () => {
    const workout: PlannedWorkout = { id: '11', date: '2026-08-24', name: 'Easy run', type: 'Run', movingTimeS: 3600 };
    const req = buildRouteRequest(workout, start, { acuteToChronicRatio: 1, fatigueLevel: 'moderate', recentAvgSpeedKmh: 12 }, { speedOverrideKmh: 8 });
    expect(req.targetDistanceKm).toBeCloseTo(8, 5);
    expect(req.paceKmh).toBe(8);
  });

  it('exposes warmup/cooldown distance for the strict grade windows', () => {
    const workout: PlannedWorkout = {
      id: '12',
      date: '2026-08-24',
      name: 'Intervaly',
      type: 'Run',
      description: 'Rozcvička 2km, 6x1km (400m klus), 2km vyklusání',
    };
    const req = buildRouteRequest(workout, start);
    expect(req.warmupKm).toBeCloseTo(2, 5);
    expect(req.cooldownKm).toBeCloseTo(2, 5);
  });
});

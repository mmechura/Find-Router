import { describe, expect, it } from 'vitest';
import {
  parseWorkoutStructure,
  repeatSegmentDistanceKm,
  stepDistanceKm,
  totalDistanceKm,
} from '../src/routing/workoutSteps.js';
import type { PlannedWorkout } from '../src/types.js';

function workout(overrides: Partial<PlannedWorkout>): PlannedWorkout {
  return { id: '1', date: '2026-08-24', name: 'Trénink', type: 'Run', ...overrides };
}

describe('parseWorkoutStructure', () => {
  it('returns null when there is no recognizable interval pattern', () => {
    expect(parseWorkoutStructure(workout({ description: 'Klidný běh, žádné intervaly.' }))).toBeNull();
  });

  it('parses warmup + distance reps + recovery + cooldown (Czech)', () => {
    const structure = parseWorkoutStructure(
      workout({ description: 'Rozcvička 2km, 6x1km (400m klus), 2km vyklusání' }),
    );
    expect(structure).not.toBeNull();
    expect(structure!.steps).toEqual([
      { kind: 'warmup', distanceKm: 2 },
      { kind: 'work', distanceKm: 1 },
      { kind: 'recovery', distanceKm: 0.4 },
      { kind: 'work', distanceKm: 1 },
      { kind: 'recovery', distanceKm: 0.4 },
      { kind: 'work', distanceKm: 1 },
      { kind: 'recovery', distanceKm: 0.4 },
      { kind: 'work', distanceKm: 1 },
      { kind: 'recovery', distanceKm: 0.4 },
      { kind: 'work', distanceKm: 1 },
      { kind: 'recovery', distanceKm: 0.4 },
      { kind: 'work', distanceKm: 1 },
      { kind: 'cooldown', distanceKm: 2 },
    ]);
  });

  it('parses warmup/cooldown in minutes and reps in meters (English)', () => {
    const structure = parseWorkoutStructure(
      workout({ description: 'Warm up 10min, 8x400m, cool down 10min' }),
    );
    expect(structure).not.toBeNull();
    expect(structure!.steps[0]).toEqual({ kind: 'warmup', durationS: 600 });
    expect(structure!.steps.filter((s) => s.kind === 'work')).toHaveLength(8);
    expect(structure!.steps.filter((s) => s.kind === 'work')[0]).toEqual({ kind: 'work', distanceKm: 0.4 });
    expect(structure!.steps.at(-1)).toEqual({ kind: 'cooldown', durationS: 600 });
  });

  it('parses time-based reps without an explicit recovery spec', () => {
    const structure = parseWorkoutStructure(workout({ description: '3x5min tempo' }));
    expect(structure).not.toBeNull();
    expect(structure!.steps).toEqual([
      { kind: 'work', durationS: 300 },
      { kind: 'work', durationS: 300 },
      { kind: 'work', durationS: 300 },
    ]);
  });
});

describe('totalDistanceKm / stepDistanceKm', () => {
  it('estimates duration-based steps from pace and sums with distance-based steps', () => {
    const steps = [{ kind: 'warmup' as const, durationS: 600 }, { kind: 'work' as const, distanceKm: 1 }];
    expect(stepDistanceKm(steps[0], 12)).toBeCloseTo(2, 5); // 10 min at 12 km/h = 2 km
    expect(totalDistanceKm(steps, 12)).toBeCloseTo(3, 5);
  });
});

describe('repeatSegmentDistanceKm', () => {
  it('combines one work step with the recovery right after it', () => {
    const structure = parseWorkoutStructure(
      workout({ description: 'Rozcvička 2km, 6x1km (400m klus), 2km vyklusání' }),
    )!;
    expect(repeatSegmentDistanceKm(structure.steps, 12)).toBeCloseTo(1.4, 5);
  });

  it('returns null when there is no work step', () => {
    expect(repeatSegmentDistanceKm([{ kind: 'warmup', distanceKm: 2 }], 12)).toBeNull();
  });
});

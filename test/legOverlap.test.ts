import { describe, expect, it } from 'vitest';
import { legOverlapRatio } from '../src/routing/legOverlap.js';
import type { LatLon } from '../src/types.js';

describe('legOverlapRatio', () => {
  const a: LatLon = { lat: 50.0, lon: 14.0 };
  const b: LatLon = { lat: 50.05, lon: 14.02 };

  it('is 0 when there are no previous legs', () => {
    expect(legOverlapRatio([a, b], [], 0.03)).toBe(0);
  });

  it('is ~1 when the leg exactly retraces an earlier leg (reversed)', () => {
    const previousLeg = [a, b];
    const thisLeg = [b, a]; // same road, opposite direction
    expect(legOverlapRatio(thisLeg, [previousLeg], 0.03)).toBeCloseTo(1, 5);
  });

  it('is 0 when the leg runs nowhere near any previous leg', () => {
    const previousLeg = [a, b];
    const farAway: LatLon = { lat: 49.5, lon: 13.5 };
    const farAway2: LatLon = { lat: 49.55, lon: 13.52 };
    expect(legOverlapRatio([farAway, farAway2], [previousLeg], 0.03)).toBe(0);
  });

  it('is partial when only part of the leg runs along a previous one', () => {
    const previousLeg = [a, b];
    // Starts by overlapping `previousLeg`, then diverges far away.
    const partiallyOverlapping = [a, b, { lat: 49.5, lon: 13.5 }];
    const ratio = legOverlapRatio(partiallyOverlapping, [previousLeg], 0.03);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });

  it('checks against every previous leg, not just the most recent one', () => {
    const legOne = [a, b];
    const legTwo = [b, { lat: 50.1, lon: 14.1 }];
    expect(legOverlapRatio([...legOne].reverse(), [legTwo, legOne], 0.03)).toBeCloseTo(1, 5);
  });
});

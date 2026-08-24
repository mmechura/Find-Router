import { describe, expect, it } from 'vitest';
import { checkRouteElevation, checkRouteGrade } from '../src/routing/elevationProfile.js';
import type { ElevationClient } from '../src/integrations/elevation.js';
import type { LatLon } from '../src/types.js';

function fakeElevationClient(values: (number | null)[]): ElevationClient {
  return { elevations: async () => values };
}

// ~0.001 deg latitude is ~110m - convenient, predictable leg length.
function latSteps(count: number): LatLon[] {
  return Array.from({ length: count }, (_, i) => ({ lat: 50 + i * 0.001, lon: 14 }));
}

describe('checkRouteGrade', () => {
  it('returns null for a flat profile', async () => {
    const coords = latSteps(5);
    const client = fakeElevationClient([100, 100, 100, 100, 100]);
    expect(await checkRouteGrade(coords, client, { maxGradePercent: 4 })).toBeNull();
  });

  it('flags a segment steeper than the overall limit', async () => {
    const coords = latSteps(5);
    const client = fakeElevationClient([100, 100, 150, 150, 150]); // ~45% between index 1-2
    const violation = await checkRouteGrade(coords, client, { maxGradePercent: 12 });
    expect(violation).not.toBeNull();
    expect(violation!.gradePercent).toBeGreaterThan(12);
    expect(violation!.limitPercent).toBe(12);
  });

  it('applies a stricter window limit only within that window', async () => {
    const coords = latSteps(5); // cumulative km roughly 0, 0.11, 0.22, 0.33, 0.44
    // ~4.5% grade on every leg - fine under a relaxed 12% overall limit.
    const client = fakeElevationClient([100, 105, 110, 115, 120]);

    const okEverywhere = await checkRouteGrade(coords, client, { maxGradePercent: 12 });
    expect(okEverywhere).toBeNull();

    const strictEarly = await checkRouteGrade(coords, client, {
      maxGradePercent: 12,
      strictWindows: [{ fromKm: 0, toKm: 0.3, maxGradePercent: 4 }],
    });
    expect(strictEarly).not.toBeNull();
    expect(strictEarly!.atKm).toBeLessThanOrEqual(0.3);
  });

  it('skips segments with missing elevation data instead of crashing', async () => {
    const coords = latSteps(4);
    const client = fakeElevationClient([100, null, 100, 200]); // last leg is a real violation
    const violation = await checkRouteGrade(coords, client, { maxGradePercent: 4 });
    expect(violation).not.toBeNull();
    // Only the last leg (index 2->3) could have triggered it, since index 0->1 and 1->2 involve the null.
    expect(violation!.atKm).toBeGreaterThan(0.2);
  });

  it('returns null for fewer than two points', async () => {
    const client = fakeElevationClient([100]);
    expect(await checkRouteGrade([{ lat: 50, lon: 14 }], client, { maxGradePercent: 4 })).toBeNull();
  });
});

describe('checkRouteElevation (cumulative gain)', () => {
  it('flags a rolling profile that stays under the per-segment grade limit but climbs too much overall', async () => {
    const coords = latSteps(11); // 10 legs of ~111m each
    // Alternating +8m/-8m every leg: ~7.2% grade (fine under a 12% cap),
    // but 5 climbing legs x 8m = 40m of total gain over ~1.1km.
    const client = fakeElevationClient([100, 108, 100, 108, 100, 108, 100, 108, 100, 108, 100]);

    const result = await checkRouteElevation(coords, client, { maxGradePercent: 12, maxGainPerKm: 10 });
    expect(result.gradeViolation).toBeNull();
    expect(result.gainViolation).not.toBeNull();
    expect(result.gainViolation!.totalGainM).toBeCloseTo(40, 0);
  });

  it('does not flag cumulative gain for a genuinely flat profile', async () => {
    const coords = latSteps(11);
    const client = fakeElevationClient(Array(11).fill(100));
    const result = await checkRouteElevation(coords, client, { maxGradePercent: 12, maxGainPerKm: 10 });
    expect(result.gainViolation).toBeNull();
  });

  it('skips the cumulative gain check entirely when maxGainPerKm is omitted', async () => {
    const coords = latSteps(11);
    const client = fakeElevationClient([100, 108, 100, 108, 100, 108, 100, 108, 100, 108, 100]);
    const result = await checkRouteElevation(coords, client, { maxGradePercent: 12 });
    expect(result.gainViolation).toBeNull();
  });
});

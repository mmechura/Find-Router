import { describe, expect, it } from 'vitest';
import { findExcludedZoneViolation } from '../src/routing/excludedZones.js';

describe('findExcludedZoneViolation', () => {
  it('returns null for a route nowhere near an excluded zone', () => {
    const coords = [
      { lat: 50.0755, lon: 14.4378 },
      { lat: 50.08, lon: 14.44 },
    ];
    expect(findExcludedZoneViolation(coords)).toBeNull();
  });

  it('flags a route that passes through the Třinecké železárny box', () => {
    const coords = [
      { lat: 49.7, lon: 18.6 }, // well outside
      { lat: 49.685, lon: 18.63 }, // inside the seeded bounding box
    ];
    const violation = findExcludedZoneViolation(coords);
    expect(violation).not.toBeNull();
    expect(violation!.name).toMatch(/Třinecké železárny/);
  });
});

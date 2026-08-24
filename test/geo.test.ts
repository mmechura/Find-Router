import { describe, expect, it } from 'vitest';
import { destinationPoint, haversineDistanceKm, mulberry32 } from '../src/routing/geo.js';

describe('haversineDistanceKm', () => {
  it('returns ~0 for identical points', () => {
    const p = { lat: 50.0755, lon: 14.4378 };
    expect(haversineDistanceKm(p, p)).toBeCloseTo(0, 6);
  });

  it('matches a known distance (Prague to Brno, ~185km)', () => {
    const prague = { lat: 50.0755, lon: 14.4378 };
    const brno = { lat: 49.1951, lon: 16.6068 };
    const d = haversineDistanceKm(prague, brno);
    expect(d).toBeGreaterThan(180);
    expect(d).toBeLessThan(190);
  });
});

describe('destinationPoint', () => {
  it('round-trips distance via haversine', () => {
    const start = { lat: 50.0755, lon: 14.4378 };
    const dest = destinationPoint(start, 45, 5);
    expect(haversineDistanceKm(start, dest)).toBeCloseTo(5, 1);
  });

  it('moving north increases latitude', () => {
    const start = { lat: 50.0, lon: 14.0 };
    const dest = destinationPoint(start, 0, 10);
    expect(dest.lat).toBeGreaterThan(start.lat);
    expect(dest.lon).toBeCloseTo(start.lon, 3);
  });
});

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('produces values in [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { decodePolyline } from '../src/routing/polyline.js';

describe('decodePolyline', () => {
  it('decodes the standard Google encoded-polyline test vector', () => {
    // From Google's own algorithm documentation.
    const coords = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(coords).toHaveLength(3);
    expect(coords[0].lat).toBeCloseTo(38.5, 5);
    expect(coords[0].lon).toBeCloseTo(-120.2, 5);
    expect(coords[1].lat).toBeCloseTo(40.7, 5);
    expect(coords[1].lon).toBeCloseTo(-120.95, 5);
    expect(coords[2].lat).toBeCloseTo(43.252, 5);
    expect(coords[2].lon).toBeCloseTo(-126.453, 5);
  });

  it('returns an empty array for an empty string', () => {
    expect(decodePolyline('')).toEqual([]);
  });
});

import type { LatLon } from '../types.js';

/**
 * Decodes Google's Encoded Polyline Algorithm Format, used by Strava for
 * `summary_polyline`/`polyline` on activities (precision 1e5, same as
 * Google Maps).
 */
export function decodePolyline(encoded: string): LatLon[] {
  const coordinates: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push({ lat: lat / 1e5, lon: lon / 1e5 });
  }

  return coordinates;
}

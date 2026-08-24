import type { LatLon } from '../types.js';

const ELEVATION_ENDPOINT = 'https://api.mapy.com/v1/elevation';
const MAX_POSITIONS_PER_REQUEST = 256;
/** Mapy.com's sentinel for "no elevation data at this position" in batch queries. */
const NO_DATA_SENTINEL = -100_000;

export interface ElevationClient {
  /** Elevation in meters for each input point, same order. null where no data was available. */
  elevations(points: LatLon[]): Promise<(number | null)[]>;
}

/**
 * Thin client around the Mapy.com Elevation API
 * (https://developer.mapy.com/rest-api-mapy-cz/function/elevation/,
 * GET /v1/elevation, up to 256 positions per request as "lon,lat").
 */
export class MapyElevationClient implements ElevationClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async elevations(points: LatLon[]): Promise<(number | null)[]> {
    const results: (number | null)[] = [];
    for (let i = 0; i < points.length; i += MAX_POSITIONS_PER_REQUEST) {
      const batch = points.slice(i, i + MAX_POSITIONS_PER_REQUEST);
      results.push(...(await this.fetchBatch(batch)));
    }
    return results;
  }

  private async fetchBatch(points: LatLon[]): Promise<(number | null)[]> {
    if (points.length === 0) return [];
    const url = new URL(ELEVATION_ENDPOINT);
    url.searchParams.set('apikey', this.apiKey);
    for (const p of points) url.searchParams.append('positions', `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`);

    const res = await this.fetchImpl(url.toString());
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Mapy.com elevation request failed (${res.status}): ${body}`);
    }
    const data = (await res.json()) as { items?: { elevation: number }[] };
    return (data.items ?? []).map((item) => (item.elevation === NO_DATA_SENTINEL ? null : item.elevation));
  }
}

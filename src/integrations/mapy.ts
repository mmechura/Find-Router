import type { LatLon, MapyProfile, MapyRouteResult } from '../types.js';
import type { MapyRoutingClient } from '../routing/loopRouteGenerator.js';

const ROUTING_ENDPOINT = 'https://api.mapy.com/v1/routing/route';
const PLANNER_ENDPOINT = 'https://mapy.com/fnc/v1/route';

function formatPoint(p: LatLon): string {
  // Mapy.com REST API expects "lon,lat" (GeoJSON/WGS84 axis order).
  return `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
}

/**
 * Thin client around the Mapy.com REST Routing API
 * (https://developer.mapy.com/rest-api-mapy-cz/function/routing/).
 *
 * NOTE: response field names (`length`, `duration`, `geometry`) follow the
 * published documentation at the time this was written. Mapy.com does not
 * expose per-point elevation in this endpoint, so elevation-aware routing
 * is out of scope here — `preferFlat` only steers the profile choice.
 */
export class MapyClient implements MapyRoutingClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async route(waypoints: LatLon[], profile: MapyProfile): Promise<MapyRouteResult> {
    if (waypoints.length < 2) {
      throw new Error('route() needs at least a start and an end point');
    }
    const [startPoint, ...rest] = waypoints;
    const endPoint = rest[rest.length - 1];
    const middlePoints = rest.slice(0, -1);

    const url = new URL(ROUTING_ENDPOINT);
    url.searchParams.set('apikey', this.apiKey);
    url.searchParams.set('routeType', profile);
    url.searchParams.set('start', formatPoint(startPoint));
    url.searchParams.set('end', formatPoint(endPoint));
    if (middlePoints.length > 0) {
      url.searchParams.set('waypoints', middlePoints.map(formatPoint).join(';'));
    }

    const res = await this.fetchImpl(url.toString());
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Mapy.com routing request failed (${res.status}): ${body}`);
    }
    const data = (await res.json()) as {
      length: number;
      duration: number;
      geometry: MapyRouteResult['geometry'];
    };

    return {
      lengthKm: data.length / 1000,
      durationS: data.duration,
      geometry: data.geometry,
    };
  }
}

/**
 * Builds a deep link that opens Mapy.com's own route planner pre-filled with
 * the generated waypoints. The user finishes the job there: review, tweak,
 * and use Mapy.com's native Export -> GPX, then load it onto a Garmin Edge.
 */
export function buildMapyPlannerUrl(waypoints: LatLon[], profile: MapyProfile): string {
  if (waypoints.length < 2) {
    throw new Error('buildMapyPlannerUrl() needs at least a start and an end point');
  }
  const [startPoint, ...rest] = waypoints;
  const endPoint = rest[rest.length - 1];
  const middlePoints = rest.slice(0, -1);

  const params = new URLSearchParams({
    start: formatPoint(startPoint),
    end: formatPoint(endPoint),
    routeType: profile,
  });
  if (middlePoints.length > 0) {
    params.set('waypoints', middlePoints.map(formatPoint).join(';'));
  }
  return `${PLANNER_ENDPOINT}?${params.toString()}`;
}

import type { LatLon, MapyProfile, MapyRouteResult } from '../types.js';
import type { MapyRoutingClient } from '../routing/loopRouteGenerator.js';

const ROUTING_ENDPOINT = 'https://api.mapy.com/v1/routing/route';
const GEOCODE_ENDPOINT = 'https://api.mapy.com/v1/geocode';
const PLANNER_ENDPOINT = 'https://mapy.com/fnc/v1/route';

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
}

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

  /**
   * Address/place -> coordinates via the Mapy.com Forward Geocoding API
   * (https://developer.mapy.com/rest-api-mapy-cz/function/geocoding/).
   * Biased towards Czechia by default since that's where this app's
   * exclusion-zone/spur-avoidance logic is tuned for.
   */
  async geocode(query: string, limit = 5): Promise<GeocodeResult[]> {
    const url = new URL(GEOCODE_ENDPOINT);
    url.searchParams.set('apikey', this.apiKey);
    url.searchParams.set('query', query);
    url.searchParams.set('lang', 'cs');
    url.searchParams.set('limit', String(limit));
    url.searchParams.append('type', 'regional');
    url.searchParams.append('type', 'poi');

    const res = await this.fetchImpl(url.toString());
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Mapy.com geocode request failed (${res.status}): ${body}`);
    }
    const data = (await res.json()) as {
      items?: { name: string; label: string; position: { lon: number; lat: number } }[];
    };

    return (data.items ?? []).map((item) => ({
      label: item.label || item.name,
      lat: item.position.lat,
      lon: item.position.lon,
    }));
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

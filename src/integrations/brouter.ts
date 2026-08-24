import { haversineDistanceKm } from '../routing/geo.js';
import type { LatLon, RouteGeometry } from '../types.js';

/** Absolute no-go circle: BRouter will never route through it. */
export interface NogoCircle {
  name: string;
  center: LatLon;
  radiusKm: number;
}

export interface BRouterRoundTripRequest {
  start: LatLon;
  targetDistanceKm: number;
  /** .brf profile name, without the .brf extension, e.g. 'bike-road-flat'. */
  profile: string;
  /** Omit to let BRouter pick its own (effectively random) direction. */
  directionDeg?: number;
  nogos?: NogoCircle[];
}

export interface BRouterRoutingClient {
  roundTrip(req: BRouterRoundTripRequest): Promise<BRouterRouteResult>;
}

export interface BRouterRouteResult {
  lengthKm: number;
  /** Total climbing/descending (m), derived from the per-point elevation
   *  BRouter's GeoJSON output embeds as each coordinate's third value -
   *  see computeAscendDescend() below for why this isn't read off a named
   *  "properties" field instead. */
  ascendM: number;
  descendM: number;
  geometry: RouteGeometry;
}

interface BRouterGeoJsonResponse {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'LineString'; coordinates: [number, number, number?][] };
    properties?: Record<string, unknown>;
  }[];
}

function formatNogos(nogos: NogoCircle[]): string {
  return nogos.map((n) => `${n.center.lon.toFixed(6)},${n.center.lat.toFixed(6)},${Math.round(n.radiusKm * 1000)}`).join('|');
}

/**
 * Sums positive/negative elevation deltas between consecutive track points.
 * BRouter's GeoJSON `properties` does carry a total ascend figure
 * ("plain-ascend"/"filtered ascend" - see FormatJson.java in the BRouter
 * source), but has no descend figure at all in either its GeoJSON or GPX
 * output - so both numbers here are computed from each coordinate's third
 * value ([lon, lat, eleM]) instead, for one consistent source.
 */
function computeAscendDescend(coordinates: [number, number, number?][]): { ascendM: number; descendM: number } {
  let ascendM = 0;
  let descendM = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const prevEle = coordinates[i - 1][2];
    const ele = coordinates[i][2];
    if (prevEle == null || ele == null) continue;
    const delta = ele - prevEle;
    if (delta > 0) ascendM += delta;
    else descendM += -delta;
  }
  return { ascendM, descendM };
}

/**
 * Prefers BRouter's own reported "track-length" (meters, confirmed key name
 * from FormatJson.java) since it's computed once server-side; falls back to
 * summing the returned polyline ourselves (equivalent in practice, since the
 * geometry already follows the actual road network rather than a straight
 * line) if that property is ever missing.
 */
function resolveLengthKm(coordinates: [number, number, number?][], properties: Record<string, unknown> | undefined): number {
  const reported = properties?.['track-length'];
  if (typeof reported === 'number' && Number.isFinite(reported) && reported > 0) {
    return reported / 1000;
  }
  let lengthKm = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [lon1, lat1] = coordinates[i - 1];
    const [lon2, lat2] = coordinates[i];
    lengthKm += haversineDistanceKm({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 });
  }
  return lengthKm;
}

/**
 * Thin client around a self-hosted BRouter instance's REST API
 * (https://github.com/abrensch/brouter, brouter-server module). Unlike
 * MapyClient, a single call here both finds a route AND searches for a
 * loop of the requested distance (BRouter's native round-trip mode) -
 * see brouterLoopGenerator.ts for why that replaces the shape-point-guessing
 * + retry loop the Mapy.com-based generator needs.
 */
export class BRouterClient implements BRouterRoutingClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async roundTrip(req: BRouterRoundTripRequest): Promise<BRouterRouteResult> {
    if (req.targetDistanceKm <= 0) {
      throw new Error('targetDistanceKm must be positive');
    }

    const url = new URL('/brouter', this.baseUrl);
    url.searchParams.set('lonlats', `${req.start.lon.toFixed(6)},${req.start.lat.toFixed(6)}`);
    url.searchParams.set('profile', req.profile);
    // Exact param names per BRouter's RoutingParamCollector: roundTripDistance
    // (meters) and roundTripDirectionAdd (degrees, added to BRouter's own
    // search direction rather than an absolute compass heading) - NOT the
    // lowercase "roundtrip..." spelling used in some third-party write-ups.
    url.searchParams.set('roundTripDistance', String(Math.round(req.targetDistanceKm * 1000)));
    if (req.directionDeg != null) {
      url.searchParams.set('roundTripDirectionAdd', String(Math.round(req.directionDeg)));
    }
    if (req.nogos && req.nogos.length > 0) {
      url.searchParams.set('nogos', formatNogos(req.nogos));
    }
    url.searchParams.set('format', 'geojson');

    const res = await this.fetchImpl(url.toString());
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`BRouter request failed (${res.status}): ${body}`);
    }
    const data = (await res.json()) as BRouterGeoJsonResponse;
    const feature = data.features?.[0];
    if (!feature) {
      throw new Error('BRouter returned no route');
    }

    const coordinates = feature.geometry.coordinates;
    const { ascendM, descendM } = computeAscendDescend(coordinates);
    const lengthKm = resolveLengthKm(coordinates, feature.properties);

    return {
      lengthKm,
      ascendM,
      descendM,
      geometry: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coordinates.map(([lon, lat]) => [lon, lat]) },
        properties: feature.properties,
      },
    };
  }
}

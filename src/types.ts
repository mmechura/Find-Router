export interface LatLon {
  lat: number;
  lon: number;
}

export type Sport = 'run' | 'bike';

export type MapyProfile =
  | 'foot_fast'
  | 'foot_hiking'
  | 'bike_road'
  | 'bike_mountain'
  | 'car_fast'
  | 'car_fast_traffic'
  | 'car_short';

export interface RouteGeometry {
  // GeoJSON Feature as returned by the Mapy.com routing API.
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  properties?: Record<string, unknown>;
}

export interface MapyRouteResult {
  lengthKm: number;
  durationS: number;
  geometry: RouteGeometry;
}

export interface FatigueReadiness {
  /** 7-day training load vs 28-day average, 1.0 = steady state. */
  acuteToChronicRatio: number;
  fatigueLevel: 'low' | 'moderate' | 'high';
  /** average speed observed on recent activities of the same sport, if any */
  recentAvgSpeedKmh?: number;
}

export interface PlannedWorkout {
  id: string;
  date: string;
  name: string;
  /** raw type string as reported by intervals.icu, e.g. "Run", "Ride" */
  type: string;
  distanceM?: number;
  movingTimeS?: number;
  description?: string;
  loadTarget?: number;
}

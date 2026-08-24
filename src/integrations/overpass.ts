import type { LatLon } from '../types.js';

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface RestrictedWay {
  id: number;
  tags: Record<string, string>;
  points: LatLon[];
}

/**
 * Queries OpenStreetMap (via the public Overpass API) for ways tagged as
 * private/no-access or gated within `bbox` - fences, private industrial
 * grounds, barriers, closed roads, etc. This is what lets the router avoid
 * "you're not allowed in there" areas generically, instead of relying on a
 * hand-maintained list of places someone happened to report.
 *
 * Best-effort by design: Overpass is a free, rate-limited public service,
 * so callers should treat a failure here as "no dynamic data available"
 * and fall back to whatever static exclusions they already have, not as a
 * reason to fail route generation outright.
 */
export async function fetchRestrictedWays(
  bbox: BoundingBox,
  fetchImpl: typeof fetch = fetch,
): Promise<RestrictedWay[]> {
  const box = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  const query = `[out:json][timeout:15];
(
  way["access"~"^(private|no)$"](${box});
  way["barrier"="gate"]["access"~"^(private|no)$"](${box});
  way["landuse"="industrial"]["access"~"^(private|no)$"](${box});
);
out geom;`;

  const res = await fetchImpl(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Overpass request failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    elements?: { type: string; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[];
  };

  return (data.elements ?? [])
    .filter((el) => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length > 0)
    .map((el) => ({
      id: el.id,
      tags: el.tags ?? {},
      points: el.geometry!.map((g) => ({ lat: g.lat, lon: g.lon })),
    }));
}

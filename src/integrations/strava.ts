const AUTHORIZE_ENDPOINT = 'https://www.strava.com/oauth/authorize';
const TOKEN_ENDPOINT = 'https://www.strava.com/oauth/token';
const API_BASE = 'https://www.strava.com/api/v3';

export interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string };
}

export interface StravaActivitySummary {
  id: number;
  type: string; // "Run", "Ride", ...
  start_date: string;
  distance: number; // meters
  moving_time: number; // seconds
  suffer_score?: number;
  map?: { summary_polyline?: string };
}

export function buildStravaAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all,profile:read_all',
    state,
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

export async function exchangeStravaCode(
  clientId: string,
  clientSecret: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StravaTokenResponse> {
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    throw new Error(`Strava token exchange failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<StravaTokenResponse>;
}

export async function refreshStravaToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StravaTokenResponse> {
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Strava token refresh failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<StravaTokenResponse>;
}

export class StravaClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const res = await this.fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Strava API request failed (${res.status}): ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  /** Activities in the last `days` days, newest first. Used to gauge recent load and pace. */
  async listRecentActivities(days: number): Promise<StravaActivitySummary[]> {
    const after = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    return this.get<StravaActivitySummary[]>('/athlete/activities', {
      after: String(after),
      per_page: '100',
    });
  }
}

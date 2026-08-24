import { config } from './config.js';
import { refreshStravaToken } from './integrations/strava.js';
import { loadStravaTokens, saveStravaTokens } from './tokenStore.js';

interface CachedAccessToken {
  accessToken: string;
  expiresAt: number; // unix seconds
}

// In-memory cache so we don't hit Strava's token endpoint on every request.
let cached: CachedAccessToken | null = null;

function isFresh(expiresAt: number): boolean {
  return expiresAt - 60 > Date.now() / 1000; // 60s safety margin
}

/**
 * Returns a valid Strava access token, or null if Strava isn't connected.
 *
 * Two sources, checked in order:
 * 1. STRAVA_REFRESH_TOKEN env var — works on hosts with no persistent disk
 *    (e.g. Render's free tier): every cold start just asks Strava for a
 *    fresh access token instead of relying on local storage.
 * 2. The local file token store written by the /auth/strava/callback flow —
 *    convenient for local development, refreshed automatically when it's
 *    close to expiry.
 */
export async function getValidStravaAccessToken(): Promise<string | null> {
  if (cached && isFresh(cached.expiresAt)) return cached.accessToken;

  if (config.stravaRefreshToken && config.stravaClientId && config.stravaClientSecret) {
    const tokens = await refreshStravaToken(
      config.stravaClientId,
      config.stravaClientSecret,
      config.stravaRefreshToken,
    );
    cached = { accessToken: tokens.access_token, expiresAt: tokens.expires_at };
    return tokens.access_token;
  }

  const fileTokens = loadStravaTokens();
  if (!fileTokens) return null;

  if (isFresh(fileTokens.expires_at)) {
    cached = { accessToken: fileTokens.access_token, expiresAt: fileTokens.expires_at };
    return fileTokens.access_token;
  }

  if (!config.stravaClientId || !config.stravaClientSecret) {
    // Can't refresh without app credentials; hand back what we have.
    return fileTokens.access_token;
  }

  const refreshed = await refreshStravaToken(
    config.stravaClientId,
    config.stravaClientSecret,
    fileTokens.refresh_token,
  );
  saveStravaTokens(refreshed);
  cached = { accessToken: refreshed.access_token, expiresAt: refreshed.expires_at };
  return refreshed.access_token;
}

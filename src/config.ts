import 'dotenv/config';

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  baseUrl: optional('BASE_URL') ?? 'http://localhost:3000',
  sessionSecret: optional('SESSION_SECRET') ?? 'dev-secret-change-me',

  mapyApiKey: optional('MAPY_API_KEY'),

  stravaClientId: optional('STRAVA_CLIENT_ID'),
  stravaClientSecret: optional('STRAVA_CLIENT_SECRET'),
  stravaRedirectUri: optional('STRAVA_REDIRECT_URI') ?? 'http://localhost:3000/auth/strava/callback',
  // Set this once (the /auth/strava/callback page shows it after connecting)
  // on hosts without a persistent disk, so the app can refresh a Strava
  // access token on every cold start instead of needing to reconnect.
  stravaRefreshToken: optional('STRAVA_REFRESH_TOKEN'),

  intervalsApiKey: optional('INTERVALS_API_KEY'),
  intervalsAthleteId: optional('INTERVALS_ATHLETE_ID'),

  // If set, gates the whole app behind HTTP Basic Auth (username can be
  // anything). Leave unset for local dev; set it before deploying anywhere
  // reachable from the internet, since this app has no user accounts of
  // its own and holds your Strava/Mapy.com/intervals.icu access.
  appPassword: optional('APP_PASSWORD'),
};

export type AppConfig = typeof config;

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

  intervalsApiKey: optional('INTERVALS_API_KEY'),
  intervalsAthleteId: optional('INTERVALS_ATHLETE_ID'),
};

export type AppConfig = typeof config;

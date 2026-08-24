import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StravaTokenResponse } from './integrations/strava.js';

// Single-user personal tool: one Strava token set, persisted to a local
// gitignored JSON file so a server restart doesn't force reconnecting.
// This is a convenience for local dev / Docker with a real disk - it's not
// the source of truth in production. On a read-only filesystem (Vercel and
// similar serverless hosts), writing here is expected to fail; that's fine,
// stravaSession.ts falls back to deriving a token from STRAVA_REFRESH_TOKEN
// on every cold start instead.
const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dirname, '..', 'data', 'strava-tokens.json');

export function saveStravaTokens(tokens: StravaTokenResponse): void {
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(tokens, null, 2), 'utf8');
  } catch {
    // Read-only filesystem (e.g. Vercel) - nothing to do, see comment above.
  }
}

export function loadStravaTokens(): StravaTokenResponse | null {
  if (!existsSync(STORE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf8')) as StravaTokenResponse;
  } catch {
    return null;
  }
}

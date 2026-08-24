import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StravaTokenResponse } from './integrations/strava.js';

// Single-user personal tool: one Strava token set, persisted to a local
// gitignored JSON file so a server restart doesn't force reconnecting.
const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dirname, '..', 'data', 'strava-tokens.json');

export function saveStravaTokens(tokens: StravaTokenResponse): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(tokens, null, 2), 'utf8');
}

export function loadStravaTokens(): StravaTokenResponse | null {
  if (!existsSync(STORE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf8')) as StravaTokenResponse;
  } catch {
    return null;
  }
}

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Redis } from '@upstash/redis';
import { config } from '../config.js';
import type { LoopRouteResult } from './loopRouteGenerator.js';
import type { Sport } from '../types.js';

export interface StoredRoute {
  id: string;
  createdAt: string;
  workoutDate: string;
  workoutName: string;
  sport: Sport;
  targetDistanceKm: number;
  route: LoopRouteResult;
  plannerUrl: string;
  repeatRoute?: LoopRouteResult;
  repeatPlannerUrl?: string;
}

export interface RouteStore {
  save(route: StoredRoute): Promise<void>;
  list(limit?: number): Promise<StoredRoute[]>;
  get(id: string): Promise<StoredRoute | null>;
}

const MAX_STORED = 200;

// ---- Local file store: local dev / Docker convenience, not for Vercel ----
// Two levels up: this file lives in src/routing/ (or dist/routing/ once built).
const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dirname, '..', '..', 'data', 'routes.json');

export class FileRouteStore implements RouteStore {
  private read(): StoredRoute[] {
    if (!existsSync(STORE_PATH)) return [];
    try {
      return JSON.parse(readFileSync(STORE_PATH, 'utf8')) as StoredRoute[];
    } catch {
      return [];
    }
  }

  private write(routes: StoredRoute[]): void {
    try {
      mkdirSync(dirname(STORE_PATH), { recursive: true });
      writeFileSync(STORE_PATH, JSON.stringify(routes, null, 2), 'utf8');
    } catch {
      // Read-only filesystem (e.g. Vercel) - nothing to do; use
      // ROUTES_KV_REST_API_URL/TOKEN there instead, see routeStore.ts docs.
    }
  }

  async save(route: StoredRoute): Promise<void> {
    const routes = this.read();
    routes.unshift(route);
    this.write(routes.slice(0, MAX_STORED));
  }

  async list(limit = 50): Promise<StoredRoute[]> {
    return this.read().slice(0, limit);
  }

  async get(id: string): Promise<StoredRoute | null> {
    return this.read().find((r) => r.id === id) ?? null;
  }
}

// ---- Upstash Redis store: works on Vercel (or anywhere else) since it has
// no local disk of its own - the whole store lives in a single Redis list,
// newest first. ----
const ARCHIVE_KEY = 'find-router:routes';

type RedisListClient = Pick<Redis, 'lpush' | 'ltrim' | 'lrange'>;

export class UpstashRouteStore implements RouteStore {
  constructor(private readonly redis: RedisListClient) {}

  async save(route: StoredRoute): Promise<void> {
    await this.redis.lpush(ARCHIVE_KEY, JSON.stringify(route));
    await this.redis.ltrim(ARCHIVE_KEY, 0, MAX_STORED - 1);
  }

  async list(limit = 50): Promise<StoredRoute[]> {
    const raw = await this.redis.lrange<string>(ARCHIVE_KEY, 0, limit - 1);
    return raw.map((entry) => JSON.parse(entry) as StoredRoute);
  }

  async get(id: string): Promise<StoredRoute | null> {
    const all = await this.list(MAX_STORED);
    return all.find((r) => r.id === id) ?? null;
  }
}

/**
 * Picks the archive backend: Upstash Redis when ROUTES_KV_REST_API_URL/
 * TOKEN are set (works anywhere, including Vercel's read-only filesystem),
 * otherwise a local JSON file (fine for local dev/Docker, silently
 * ephemeral on a host with no persistent disk - see README -> Nasazení).
 */
export function getRouteStore(): RouteStore {
  if (config.routesKvUrl && config.routesKvToken) {
    const redis = new Redis({ url: config.routesKvUrl, token: config.routesKvToken, automaticDeserialization: false });
    return new UpstashRouteStore(redis);
  }
  return new FileRouteStore();
}

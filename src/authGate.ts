import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Gates the whole app behind a single shared password via HTTP Basic Auth.
 * This is a single-user personal tool with no accounts of its own — once
 * it's reachable from the internet (see README -> Nasazení), anyone with
 * the URL could otherwise trigger route generation (burning your Mapy.com
 * quota) or read your connected Strava/intervals.icu data. Set APP_PASSWORD
 * before deploying; leave it unset for local-only use.
 */
export function appPasswordGate(req: Request, res: Response, next: NextFunction): void {
  if (!config.appPassword) {
    next();
    return;
  }

  const header = req.headers.authorization;
  if (header?.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';
    if (password && safeEqual(password, config.appPassword)) {
      next();
      return;
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Find-Router"');
  res.status(401).send('Autentizace vyžadována.');
}

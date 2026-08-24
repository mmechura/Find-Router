import express from 'express';
import { join } from 'node:path';
import { config } from './config.js';
import { appPasswordGate } from './authGate.js';
import { authRouter } from './routes/auth.js';
import { workoutRouter } from './routes/workout.js';
import { routeRouter } from './routes/route.js';
import { geocodeRouter } from './routes/geocode.js';
import { archiveRouter } from './routes/archive.js';
import { heatmapRouter } from './routes/heatmap.js';

// process.cwd() rather than an __dirname-relative path: this needs to
// resolve correctly both for the local/Docker server (cwd = project root)
// and when bundled as a Vercel serverless function, where the bundler's
// own output location isn't something to rely on - see vercel.json's
// `includeFiles` for how `public/` actually gets shipped there.
const publicDir = join(process.cwd(), 'public');

const app = express();
app.disable('x-powered-by');

// Baseline hardening headers. CSP is deliberately tight (this app has no
// inline scripts/styles and vendors Leaflet locally - see README) with the
// one exception it actually needs: OpenStreetMap tile images for the
// in-browser map preview.
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: https://tile.openstreetmap.org",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  });
  next();
});

app.use(appPasswordGate);
app.use(express.json({ limit: '100kb' }));
app.use(express.static(publicDir));

app.use('/auth', authRouter);
app.use('/api/workout', workoutRouter);
app.use('/api/route', routeRouter);
app.use('/api/geocode', geocodeRouter);
app.use('/api/routes', archiveRouter);
app.use('/api/strava', heatmapRouter);

app.get('/api/config', (_req, res) => {
  res.json({ mapyApiKeyConfigured: Boolean(config.mapyApiKey) });
});

export default app;

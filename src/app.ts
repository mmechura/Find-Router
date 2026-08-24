import express from 'express';
import { join } from 'node:path';
import { config } from './config.js';
import { appPasswordGate } from './authGate.js';
import { authRouter } from './routes/auth.js';
import { workoutRouter } from './routes/workout.js';
import { routeRouter } from './routes/route.js';

// process.cwd() rather than an __dirname-relative path: this needs to
// resolve correctly both for the local/Docker server (cwd = project root)
// and when bundled as a Vercel serverless function, where the bundler's
// own output location isn't something to rely on - see vercel.json's
// `includeFiles` for how `public/` actually gets shipped there.
const publicDir = join(process.cwd(), 'public');

const app = express();
app.use(appPasswordGate);
app.use(express.json());
app.use(express.static(publicDir));

app.use('/auth', authRouter);
app.use('/api/workout', workoutRouter);
app.use('/api/route', routeRouter);

app.get('/api/config', (_req, res) => {
  res.json({ mapyApiKeyConfigured: Boolean(config.mapyApiKey) });
});

export default app;

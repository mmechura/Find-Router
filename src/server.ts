import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { appPasswordGate } from './authGate.js';
import { authRouter } from './routes/auth.js';
import { workoutRouter } from './routes/workout.js';
import { routeRouter } from './routes/route.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(appPasswordGate);
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

app.use('/auth', authRouter);
app.use('/api/workout', workoutRouter);
app.use('/api/route', routeRouter);

app.get('/api/config', (_req, res) => {
  res.json({ mapyApiKeyConfigured: Boolean(config.mapyApiKey) });
});

app.listen(config.port, () => {
  console.log(`Find-Router běží na ${config.baseUrl}`);
});

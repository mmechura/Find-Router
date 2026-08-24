import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { buildStravaAuthorizeUrl, exchangeStravaCode } from '../integrations/strava.js';
import { saveStravaTokens, loadStravaTokens } from '../tokenStore.js';

export const authRouter = Router();

authRouter.get('/strava/login', (_req, res) => {
  if (!config.stravaClientId) {
    res.status(500).send('STRAVA_CLIENT_ID není nastaven v .env');
    return;
  }
  const state = crypto.randomBytes(8).toString('hex');
  const url = buildStravaAuthorizeUrl(config.stravaClientId, config.stravaRedirectUri, state);
  res.redirect(url);
});

authRouter.get('/strava/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  const error = req.query.error as string | undefined;
  if (error) {
    res.status(400).send(`Strava autorizace zamítnuta: ${error}`);
    return;
  }
  if (!code || !config.stravaClientId || !config.stravaClientSecret) {
    res.status(400).send('Chybí autorizační kód nebo Strava API klíče.');
    return;
  }
  try {
    const tokens = await exchangeStravaCode(config.stravaClientId, config.stravaClientSecret, code);
    saveStravaTokens(tokens);
    res.redirect('/?strava=connected');
  } catch (err) {
    res.status(502).send(`Výměna Strava tokenu selhala: ${(err as Error).message}`);
  }
});

authRouter.get('/strava/status', (_req, res) => {
  const tokens = loadStravaTokens();
  res.json({ connected: Boolean(tokens), athlete: tokens?.athlete ?? null });
});

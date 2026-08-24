import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { buildStravaAuthorizeUrl, exchangeStravaCode } from '../integrations/strava.js';
import { saveStravaTokens, loadStravaTokens } from '../tokenStore.js';
import { getValidStravaAccessToken } from '../stravaSession.js';

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
    // Shown once, inline, rather than via a redirect query param, so the
    // refresh token never ends up in the URL/browser history/proxy logs.
    res.send(renderConnectedPage(tokens.refresh_token));
  } catch (err) {
    res.status(502).send(`Výměna Strava tokenu selhala: ${(err as Error).message}`);
  }
});

function renderConnectedPage(refreshToken: string): string {
  return `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><title>Strava připojena</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:2rem auto;padding:0 1rem}
code{background:#eee;padding:0.6rem;display:block;border-radius:6px;word-break:break-all;margin:0.5rem 0}</style>
</head><body>
<h1>Strava je připojena ✅</h1>
<p>Pro běh na <code>localhost</code> nemusíš nic dalšího dělat — token je uložený lokálně.</p>
<p>Pokud appku nasazuješ na hosting bez trvalého disku (např. Render free tier),
ulož si tenhle <strong>refresh token</strong> jako proměnnou prostředí
<code>STRAVA_REFRESH_TOKEN</code>, aby přežil restart/redeploy:</p>
<code>${refreshToken}</code>
<p><a href="/">Pokračovat do appky</a></p>
</body></html>`;
}

authRouter.get('/strava/status', async (_req, res) => {
  const fileTokens = loadStravaTokens();
  let connected = Boolean(fileTokens);
  if (!connected) {
    try {
      connected = Boolean(await getValidStravaAccessToken());
    } catch {
      connected = false;
    }
  }
  res.json({ connected, athlete: fileTokens?.athlete ?? null });
});

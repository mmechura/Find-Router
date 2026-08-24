import { Router } from 'express';
import { config } from '../config.js';
import { MapyClient } from '../integrations/mapy.js';

export const geocodeRouter = Router();

geocodeRouter.get('/', async (req, res) => {
  const query = (req.query.q as string | undefined)?.trim();
  if (!query) {
    res.status(400).json({ error: 'Chybí parametr q (hledaný text).' });
    return;
  }
  if (!config.mapyApiKey) {
    res.status(500).json({ error: 'MAPY_API_KEY není nastaven v .env' });
    return;
  }

  try {
    const mapy = new MapyClient(config.mapyApiKey);
    const results = await mapy.geocode(query);
    res.json({ results });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

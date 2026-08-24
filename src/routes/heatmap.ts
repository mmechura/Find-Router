import { Router } from 'express';
import { StravaClient } from '../integrations/strava.js';
import { getValidStravaAccessToken } from '../stravaSession.js';
import { decodePolyline } from '../routing/polyline.js';

export const heatmapRouter = Router();

const MIN_DAYS = 1;
const MAX_DAYS = 365 * 2;
const DEFAULT_DAYS = 180;

/**
 * Not Strava's own heatmap product (that's not exposed by the public API to
 * a personal app - only via strava.com itself or a paid enterprise Global
 * Heatmap license). This instead decodes `summary_polyline` off the same
 * recent-activities call `readiness.ts` already uses, giving a "where have
 * I actually ridden/run" overlay built from the user's own data.
 */
heatmapRouter.get('/heatmap', async (req, res) => {
  try {
    const accessToken = await getValidStravaAccessToken();
    if (!accessToken) {
      res.status(400).json({ error: 'Strava není připojená - připoj ji v Nastavení.' });
      return;
    }

    const requestedDays = Number(req.query.days);
    const days = Number.isFinite(requestedDays)
      ? Math.min(Math.max(requestedDays, MIN_DAYS), MAX_DAYS)
      : DEFAULT_DAYS;

    const strava = new StravaClient(accessToken);
    const activities = await strava.listRecentActivities(days);
    const tracks = activities
      .map((activity) => activity.map?.summary_polyline)
      .filter((polyline): polyline is string => Boolean(polyline))
      .map((polyline) => decodePolyline(polyline));

    res.json({ tracks, activityCount: activities.length });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

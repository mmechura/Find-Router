import { Router } from 'express';
import { config } from '../config.js';
import { IntervalsClient } from '../integrations/intervals.js';
import { MapyClient, buildMapyPlannerUrl } from '../integrations/mapy.js';
import { StravaClient } from '../integrations/strava.js';
import { getValidStravaAccessToken } from '../stravaSession.js';
import { computeReadiness } from '../routing/readiness.js';
import { buildRouteRequest, mapIntervalsTypeToSport } from '../routing/planMatcher.js';
import { generateLoopRoute } from '../routing/loopRouteGenerator.js';
import type { FatigueReadiness } from '../types.js';

export const routeRouter = Router();

routeRouter.post('/generate', async (req, res) => {
  const { date, lat, lon } = req.body as { date?: string; lat?: number; lon?: number };

  if (typeof lat !== 'number' || typeof lon !== 'number') {
    res.status(400).json({ error: 'Chybí výchozí bod (lat, lon).' });
    return;
  }
  if (!config.mapyApiKey) {
    res.status(500).json({ error: 'MAPY_API_KEY není nastaven v .env' });
    return;
  }
  if (!config.intervalsApiKey || !config.intervalsAthleteId) {
    res.status(500).json({ error: 'INTERVALS_API_KEY nebo INTERVALS_ATHLETE_ID není nastaven v .env' });
    return;
  }

  const workoutDate = date || new Date().toISOString().slice(0, 10);

  try {
    const intervals = new IntervalsClient(config.intervalsApiKey, config.intervalsAthleteId);
    const workout = await intervals.getPlannedWorkout(workoutDate);
    if (!workout) {
      res.status(404).json({ error: `Pro ${workoutDate} nebyl v intervals.icu nalezen žádný plánovaný trénink.` });
      return;
    }

    let readiness: FatigueReadiness | undefined;
    try {
      const accessToken = await getValidStravaAccessToken();
      if (accessToken) {
        const strava = new StravaClient(accessToken);
        const recent = await strava.listRecentActivities(28);
        readiness = computeReadiness(recent, mapIntervalsTypeToSport(workout.type));
      }
    } catch {
      // Strava is an optional enrichment signal — a token issue (e.g.
      // expired refresh token) should not block route generation.
      readiness = undefined;
    }

    const start = { lat, lon };
    const routeRequest = buildRouteRequest(workout, start, readiness);
    const mapy = new MapyClient(config.mapyApiKey);
    const route = await generateLoopRoute(routeRequest, mapy);
    const plannerUrl = buildMapyPlannerUrl(route.waypoints, route.profile);

    // For an interval workout, also propose a short loop sized to one
    // work+recovery cycle - a practical place to physically repeat the hard
    // reps, since a single long GPX track can't carry per-rep pace cues
    // anyway (see README). Same terrain preference as the main route: an
    // interval session isn't forced flat, so neither is this.
    let repeatRoute: Awaited<ReturnType<typeof generateLoopRoute>> | undefined;
    let repeatPlannerUrl: string | undefined;
    if (routeRequest.repeatSegmentKm && routeRequest.repeatSegmentKm >= 0.15) {
      repeatRoute = await generateLoopRoute(
        {
          start,
          targetDistanceKm: routeRequest.repeatSegmentKm,
          sport: routeRequest.sport,
          preferFlat: routeRequest.preferFlat,
        },
        mapy,
      );
      repeatPlannerUrl = buildMapyPlannerUrl(repeatRoute.waypoints, repeatRoute.profile);
    }

    res.json({
      workout,
      readiness,
      request: routeRequest,
      route,
      plannerUrl,
      repeatRoute,
      repeatPlannerUrl,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

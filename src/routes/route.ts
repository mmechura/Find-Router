import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { IntervalsClient } from '../integrations/intervals.js';
import { MapyClient, buildMapyPlannerUrl } from '../integrations/mapy.js';
import { StravaClient } from '../integrations/strava.js';
import { getValidStravaAccessToken } from '../stravaSession.js';
import { computeReadiness } from '../routing/readiness.js';
import { buildRouteRequest, mapIntervalsTypeToSport } from '../routing/planMatcher.js';
import { generateLoopRoute } from '../routing/loopRouteGenerator.js';
import { buildExclusionChecker } from '../routing/excludedZones.js';
import { buildRoadSnapper } from '../routing/roadSnapper.js';
import { getRouteStore } from '../routing/routeStore.js';
import { MapyElevationClient } from '../integrations/elevation.js';
import { RELAXED_MAX_GRADE_PERCENT, STRICT_MAX_GRADE_PERCENT, type GradeWindow } from '../routing/elevationProfile.js';
import type { FatigueReadiness } from '../types.js';
import type { RoutePlan } from '../routing/planMatcher.js';

export const routeRouter = Router();

interface GenerateBody {
  date?: string;
  lat?: number;
  lon?: number;
  surface?: 'road' | 'gravel';
  speedKmh?: number;
}

function gradeCeilingFor(preferFlat: boolean | undefined): number {
  return preferFlat ? STRICT_MAX_GRADE_PERCENT : RELAXED_MAX_GRADE_PERCENT;
}

/**
 * The main route's warmup/cooldown are always meant to be easy regardless
 * of how intense the middle of the session is, so they get a strict grade
 * ceiling of their own - approximated as the first/last `warmupKm`/
 * `cooldownKm` of the route (from planMatcher.ts, itself derived from the
 * speed in use). The interval reps themselves happen on the separate
 * repeat loop, not in the middle of this route, so no window is needed
 * for them here.
 */
function warmupCooldownWindows(routeRequest: RoutePlan): GradeWindow[] {
  const windows: GradeWindow[] = [];
  if (routeRequest.warmupKm) {
    windows.push({ fromKm: 0, toKm: routeRequest.warmupKm, maxGradePercent: STRICT_MAX_GRADE_PERCENT });
  }
  if (routeRequest.cooldownKm) {
    const fromKm = Math.max(0, routeRequest.targetDistanceKm - routeRequest.cooldownKm);
    windows.push({ fromKm, toKm: routeRequest.targetDistanceKm, maxGradePercent: STRICT_MAX_GRADE_PERCENT });
  }
  return windows;
}

async function loadWorkoutAndReadiness(workoutDate: string) {
  if (!config.intervalsApiKey || !config.intervalsAthleteId) {
    throw new Error('INTERVALS_API_KEY nebo INTERVALS_ATHLETE_ID není nastaven v .env');
  }
  const intervals = new IntervalsClient(config.intervalsApiKey, config.intervalsAthleteId);
  const workout = await intervals.getPlannedWorkout(workoutDate);
  if (!workout) return null;

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

  return { workout, readiness };
}

/**
 * Cheap recomputation of the route plan (target distance, warmup/cooldown
 * split, repeat segment size) for a given speed, with no Mapy/Overpass
 * calls - lets the UI show live numbers as the user tweaks the speed
 * field before committing to actually generating a route.
 */
routeRouter.post('/preview', async (req, res) => {
  const { date, lat, lon, surface, speedKmh } = req.body as GenerateBody;
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    res.status(400).json({ error: 'Chybí výchozí bod (lat, lon).' });
    return;
  }

  try {
    const workoutDate = date || new Date().toISOString().slice(0, 10);
    const loaded = await loadWorkoutAndReadiness(workoutDate);
    if (!loaded) {
      res.status(404).json({ error: `Pro ${workoutDate} nebyl v intervals.icu nalezen žádný plánovaný trénink.` });
      return;
    }
    const routeRequest = buildRouteRequest(loaded.workout, { lat, lon }, loaded.readiness, {
      surface: surface === 'gravel' ? 'gravel' : 'road',
      speedOverrideKmh: speedKmh,
    });
    res.json({ workout: loaded.workout, readiness: loaded.readiness, request: routeRequest });
  } catch (err) {
    res.status(err instanceof Error && err.message.includes('.env') ? 500 : 502).json({ error: (err as Error).message });
  }
});

routeRouter.post('/generate', async (req, res) => {
  const { date, lat, lon, surface, speedKmh } = req.body as GenerateBody;

  if (typeof lat !== 'number' || typeof lon !== 'number') {
    res.status(400).json({ error: 'Chybí výchozí bod (lat, lon).' });
    return;
  }
  if (!config.mapyApiKey) {
    res.status(500).json({ error: 'MAPY_API_KEY není nastaven v .env' });
    return;
  }

  const workoutDate = date || new Date().toISOString().slice(0, 10);

  try {
    const loaded = await loadWorkoutAndReadiness(workoutDate);
    if (!loaded) {
      res.status(404).json({ error: `Pro ${workoutDate} nebyl v intervals.icu nalezen žádný plánovaný trénink.` });
      return;
    }
    const { workout, readiness } = loaded;

    const start = { lat, lon };
    const routeRequest = buildRouteRequest(workout, start, readiness, {
      surface: surface === 'gravel' ? 'gravel' : 'road',
      speedOverrideKmh: speedKmh,
    });
    const mapy = new MapyClient(config.mapyApiKey);
    const elevationClient = new MapyElevationClient(config.mapyApiKey);
    const radiusKm = routeRequest.targetDistanceKm / (2 * Math.PI);

    // Two live OSM lookups covering the whole area this request could
    // plausibly touch, each fetched once and reused for both the main
    // route and the smaller interval-repeat loop below: no-go areas
    // (private/no-access ways, gates, motorways for bikes) and the real
    // road/path network to snap candidate waypoints onto. Both degrade
    // gracefully (fall back to static-only / unsnapped) rather than
    // failing the request if Overpass is slow or unreachable - see
    // excludedZones.ts and roadSnapper.ts.
    const [exclusionChecker, roadSnapper] = await Promise.all([
      buildExclusionChecker(start, radiusKm, routeRequest.sport),
      buildRoadSnapper(start, radiusKm, routeRequest.sport),
    ]);

    const route = await generateLoopRoute(
      {
        ...routeRequest,
        exclusionChecker,
        roadSnapper: roadSnapper ?? undefined,
        elevationGate: {
          client: elevationClient,
          maxGradePercent: gradeCeilingFor(routeRequest.preferFlat),
          strictWindows: warmupCooldownWindows(routeRequest),
        },
      },
      mapy,
    );
    const plannerUrl = buildMapyPlannerUrl(route.waypoints, route.profile);

    // For an interval workout, also propose a short loop sized to one
    // work+recovery cycle - a practical place to physically repeat the hard
    // reps, since a single long GPX track can't carry per-rep pace cues
    // anyway (see README). Same terrain preference as the main route: an
    // interval session isn't forced flat, so neither is this. It's one
    // consistent-effort loop, so a single grade ceiling (no windows) is
    // enough - unlike the main route it has no separate easy bookends.
    let repeatRoute: Awaited<ReturnType<typeof generateLoopRoute>> | undefined;
    let repeatPlannerUrl: string | undefined;
    if (routeRequest.repeatSegmentKm && routeRequest.repeatSegmentKm >= 0.15) {
      repeatRoute = await generateLoopRoute(
        {
          start,
          targetDistanceKm: routeRequest.repeatSegmentKm,
          sport: routeRequest.sport,
          preferFlat: routeRequest.preferFlat,
          surface: routeRequest.surface,
          exclusionChecker,
          roadSnapper: roadSnapper ?? undefined,
          elevationGate: { client: elevationClient, maxGradePercent: gradeCeilingFor(routeRequest.preferFlat) },
        },
        mapy,
      );
      repeatPlannerUrl = buildMapyPlannerUrl(repeatRoute.waypoints, repeatRoute.profile);
    }

    const storedRoute = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      workoutDate,
      workoutName: workout.name,
      sport: routeRequest.sport,
      targetDistanceKm: routeRequest.targetDistanceKm,
      route,
      plannerUrl,
      repeatRoute,
      repeatPlannerUrl,
    };
    try {
      await getRouteStore().save(storedRoute);
    } catch (err) {
      // The archive is a convenience, not a reason to fail a successful
      // generation - log and move on.
      console.warn('Failed to save route to archive:', (err as Error).message);
    }

    res.json({
      workout,
      readiness,
      request: routeRequest,
      route,
      plannerUrl,
      repeatRoute,
      repeatPlannerUrl,
      archivedId: storedRoute.id,
    });
  } catch (err) {
    res.status(err instanceof Error && err.message.includes('.env') ? 500 : 502).json({ error: (err as Error).message });
  }
});

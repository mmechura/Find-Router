import { Router } from 'express';
import { getRouteStore } from '../routing/routeStore.js';

export const archiveRouter = Router();

/** Summaries only - full geometry/planner links come from GET /:id, keeps the list cheap. */
archiveRouter.get('/', async (_req, res) => {
  try {
    const routes = await getRouteStore().list(50);
    res.json({
      routes: routes.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        workoutDate: r.workoutDate,
        workoutName: r.workoutName,
        sport: r.sport,
        targetDistanceKm: r.targetDistanceKm,
        actualDistanceKm: r.route.actualDistanceKm,
        hasRepeatRoute: Boolean(r.repeatRoute),
      })),
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

archiveRouter.get('/:id', async (req, res) => {
  try {
    const route = await getRouteStore().get(req.params.id);
    if (!route) {
      res.status(404).json({ error: 'Trasa nenalezena (možná byla appka mezitím restartovaná bez Vercel KV).' });
      return;
    }
    res.json(route);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

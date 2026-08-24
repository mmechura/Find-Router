import { Router } from 'express';
import { config } from '../config.js';
import { IntervalsClient } from '../integrations/intervals.js';

export const workoutRouter = Router();

workoutRouter.get('/plan', async (req, res) => {
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);

  if (!config.intervalsApiKey || !config.intervalsAthleteId) {
    res.status(500).json({ error: 'INTERVALS_API_KEY nebo INTERVALS_ATHLETE_ID není nastaven v .env' });
    return;
  }

  try {
    const client = new IntervalsClient(config.intervalsApiKey, config.intervalsAthleteId);
    const workout = await client.getPlannedWorkout(date);
    if (!workout) {
      res.status(404).json({ error: `Pro ${date} nebyl v intervals.icu nalezen žádný plánovaný trénink.` });
      return;
    }
    res.json(workout);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

import { Router } from 'express';
import { config } from '../config.js';
import { IntervalsClient } from '../integrations/intervals.js';
import { buildIcs } from '../routing/ics.js';

export const workoutRouter = Router();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function requireClient(res: import('express').Response): IntervalsClient | null {
  if (!config.intervalsApiKey || !config.intervalsAthleteId) {
    res.status(500).json({ error: 'INTERVALS_API_KEY nebo INTERVALS_ATHLETE_ID není nastaven v .env' });
    return null;
  }
  return new IntervalsClient(config.intervalsApiKey, config.intervalsAthleteId);
}

workoutRouter.get('/plan', async (req, res) => {
  const date = (req.query.date as string) || todayIso();
  const client = requireClient(res);
  if (!client) return;

  try {
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

/** Next two weeks by default - a browsable list so the user doesn't have to type a date to plan around. */
workoutRouter.get('/calendar', async (req, res) => {
  const from = (req.query.from as string) || todayIso();
  const to = (req.query.to as string) || addDaysIso(from, 13);
  const client = requireClient(res);
  if (!client) return;

  try {
    const workouts = await client.listPlannedWorkouts(from, to);
    res.json({ from, to, workouts });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

workoutRouter.get('/calendar.ics', async (req, res) => {
  const from = (req.query.from as string) || todayIso();
  const to = (req.query.to as string) || addDaysIso(from, 13);
  const client = requireClient(res);
  if (!client) return;

  try {
    const workouts = await client.listPlannedWorkouts(from, to);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="find-router-treninky.ics"');
    res.send(buildIcs(workouts));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

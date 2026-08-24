import type { PlannedWorkout } from '../types.js';

const API_BASE = 'https://intervals.icu/api/v1';

interface IntervalsEvent {
  id: number | string;
  category: string;
  name?: string;
  type?: string;
  distance?: number;
  moving_time?: number;
  description?: string;
  icu_training_load?: number;
  /** ISO date/datetime the event is scheduled for; field name per the
   *  documented schema at the time of writing - verify if intervals.icu
   *  changes it. */
  start_date_local?: string;
}

/**
 * Thin client around the intervals.icu REST API
 * (see https://intervals.icu/api-docs.html and the community "API
 * Integration Cookbook"). Auth is HTTP Basic with the literal username
 * "API_KEY" and the account's API key as the password.
 *
 * Field names below (`moving_time`, `icu_training_load`, ...) match the
 * documented event schema at the time of writing; verify against the live
 * docs if intervals.icu changes their API.
 */
export class IntervalsClient {
  constructor(
    private readonly apiKey: string,
    private readonly athleteId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private authHeader(): string {
    const token = Buffer.from(`API_KEY:${this.apiKey}`).toString('base64');
    return `Basic ${token}`;
  }

  /** All WORKOUT-category calendar events between `oldest` and `newest` (both YYYY-MM-DD, inclusive). */
  async listPlannedWorkouts(oldest: string, newest: string): Promise<PlannedWorkout[]> {
    const url = new URL(`${API_BASE}/athlete/${this.athleteId}/events`);
    url.searchParams.set('oldest', oldest);
    url.searchParams.set('newest', newest);
    url.searchParams.set('category', 'WORKOUT');

    const res = await this.fetchImpl(url.toString(), {
      headers: { Authorization: this.authHeader() },
    });
    if (!res.ok) {
      throw new Error(`intervals.icu request failed (${res.status}): ${await res.text()}`);
    }
    const events = (await res.json()) as IntervalsEvent[];
    if (!Array.isArray(events)) return [];

    return events.map((event) => ({
      id: String(event.id),
      date: event.start_date_local?.slice(0, 10) ?? oldest,
      name: event.name ?? 'Plánovaný trénink',
      type: event.type ?? 'Run',
      distanceM: event.distance,
      movingTimeS: event.moving_time,
      description: event.description,
      loadTarget: event.icu_training_load,
    }));
  }

  /** The first WORKOUT-category calendar event planned for `date` (YYYY-MM-DD), if any. */
  async getPlannedWorkout(date: string): Promise<PlannedWorkout | null> {
    const workouts = await this.listPlannedWorkouts(date, date);
    return workouts[0] ?? null;
  }
}

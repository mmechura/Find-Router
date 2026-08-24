import { describe, expect, it } from 'vitest';
import { buildIcs } from '../src/routing/ics.js';
import type { PlannedWorkout } from '../src/types.js';

describe('buildIcs', () => {
  it('wraps events in a valid VCALENDAR envelope', () => {
    const ics = buildIcs([]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
  });

  it('emits one all-day VEVENT per workout with escaped text', () => {
    const workouts: PlannedWorkout[] = [
      {
        id: '1',
        date: '2026-08-24',
        name: 'Intervaly, tvrdé',
        type: 'Run',
        distanceM: 10000,
        movingTimeS: 3600,
        description: 'Rozcvička; pak 6x1km',
      },
    ];
    const ics = buildIcs(workouts);
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:find-router-1@find-router');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260824');
    expect(ics).toContain('SUMMARY:Intervaly\\, tvrdé');
    expect(ics).toContain('DESCRIPTION:Run - 10.0 km - 60 min - Rozcvička\\; pak 6x1km');
    expect(ics).toContain('END:VEVENT');
  });

  it('falls back to just the sport type when nothing else is known', () => {
    const workouts: PlannedWorkout[] = [{ id: '2', date: '2026-08-25', name: 'Volno', type: 'Run' }];
    const ics = buildIcs(workouts);
    expect(ics).toContain('DESCRIPTION:Run\r\n');
  });
});

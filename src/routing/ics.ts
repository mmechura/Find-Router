import type { PlannedWorkout } from '../types.js';

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function nowUtcStamp(): string {
  return `${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

function workoutDescription(w: PlannedWorkout): string {
  const parts = [
    w.type,
    w.distanceM ? `${(w.distanceM / 1000).toFixed(1)} km` : null,
    w.movingTimeS ? `${Math.round(w.movingTimeS / 60)} min` : null,
    w.description,
  ].filter((part): part is string => Boolean(part));
  return parts.join(' - ');
}

/**
 * Builds a standalone iCalendar (RFC 5545) file from planned workouts, as
 * all-day events, for import into any calendar app. Minimal by design (no
 * timezones, alarms, attendees) - this is a one-way export of a read-only
 * plan, not a two-way calendar sync.
 */
export function buildIcs(workouts: PlannedWorkout[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Find-Router//Planovane treninky//CS', 'CALSCALE:GREGORIAN'];

  for (const workout of workouts) {
    const dateStamp = workout.date.replace(/-/g, '');
    const description = workoutDescription(workout);
    lines.push(
      'BEGIN:VEVENT',
      `UID:find-router-${workout.id}@find-router`,
      `DTSTAMP:${nowUtcStamp()}`,
      `DTSTART;VALUE=DATE:${dateStamp}`,
      `SUMMARY:${escapeIcsText(workout.name)}`,
    );
    if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

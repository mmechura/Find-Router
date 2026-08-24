import type { PlannedWorkout } from '../types.js';

export type WorkoutStepKind = 'warmup' | 'work' | 'recovery' | 'cooldown';

export interface WorkoutStep {
  kind: WorkoutStepKind;
  /** Exactly one of distanceKm/durationS is set, depending on how the step was specified. */
  distanceKm?: number;
  durationS?: number;
}

export interface WorkoutStructure {
  steps: WorkoutStep[];
  hasIntervals: true;
}

const NUM = '(\\d+(?:[.,]\\d+)?)';

const REPS_DIST_RE = new RegExp(`(\\d+)\\s*[x×]\\s*${NUM}\\s*(km|m)\\b`, 'i');
const REPS_TIME_RE = new RegExp(`(\\d+)\\s*[x×]\\s*${NUM}\\s*(min|sec)\\b`, 'i');
const RECOVERY_AFTER_RE = new RegExp(
  `(?:\\(|/|,\\s*)\\s*${NUM}\\s*(km|m|min|sec)\\s*(?:klus\\w*|volno|recovery|odpoč\\w*|jog|easy|rest)`,
  'i',
);
const WARMUP_KEYWORDS = 'warm[\\s-]?up|rozcvičk\\w*|rozjížděn\\w*';
const COOLDOWN_KEYWORDS = 'cool[\\s-]?down|vyklus\\w*|vychladn\\w*';
const MEASURE_UNITS = 'km|m|min|sec';

function parseNum(raw: string): number {
  return parseFloat(raw.replace(',', '.'));
}

function toDistanceKm(value: number, unit: string): number {
  return unit.toLowerCase() === 'km' ? value : value / 1000;
}

function toDurationS(value: number, unit: string): number {
  return unit.toLowerCase().startsWith('min') ? value * 60 : value;
}

/**
 * Finds a "<number> <unit>" measure near a keyword, in either spoken order:
 * "warmup 2km" / "rozcvička 2km" as well as "2km vyklusání" / "2km cooldown".
 */
function matchMeasureNearKeyword(text: string, keywordPattern: string): { distanceKm?: number; durationS?: number } | null {
  const afterRe = new RegExp(`(?:${keywordPattern})\\D{0,20}?${NUM}\\s*(${MEASURE_UNITS})\\b`, 'i');
  const beforeRe = new RegExp(`${NUM}\\s*(${MEASURE_UNITS})\\D{0,20}?(?:${keywordPattern})`, 'i');

  const match = text.match(afterRe) ?? text.match(beforeRe);
  if (!match) return null;

  const value = parseNum(match[1]);
  const unit = match[2].toLowerCase();
  return unit === 'km' || unit === 'm' ? { distanceKm: toDistanceKm(value, unit) } : { durationS: toDurationS(value, unit) };
}

/**
 * Best-effort extraction of a workout's warmup/work/recovery/cooldown
 * structure from its intervals.icu name+description text (e.g.
 * "Rozcvička 2km, 6x1km (400m klus), 2km vyklusání" or
 * "Warm up 10min, 8x1000m, cool down 10min").
 *
 * This is a heuristic text parser, not a real structured-workout reader:
 * intervals.icu's actual `workout_doc`/`icu_intervals` schema wasn't
 * reachable while building this (network access to intervals.icu was
 * blocked in the dev sandbox), so it works off whatever a coach/athlete
 * typically types into the workout description. Expect to refine the
 * patterns once you see your own real workout text go through it — that's
 * intentional, not a stopgap: returns null when no interval pattern is
 * recognized, so callers fall back to plain total-distance routing.
 */
export function parseWorkoutStructure(workout: PlannedWorkout): WorkoutStructure | null {
  const text = `${workout.name ?? ''}\n${workout.description ?? ''}`;

  const repsDist = text.match(REPS_DIST_RE);
  const repsTime = repsDist ? null : text.match(REPS_TIME_RE);
  if (!repsDist && !repsTime) return null;

  const steps: WorkoutStep[] = [];

  const warmup = matchMeasureNearKeyword(text, WARMUP_KEYWORDS);
  if (warmup) steps.push({ kind: 'warmup', ...warmup });

  const recovery = text.match(RECOVERY_AFTER_RE);
  const reps = parseInt((repsDist ?? repsTime)![1], 10);

  for (let i = 0; i < reps; i++) {
    if (repsDist) {
      steps.push({ kind: 'work', distanceKm: toDistanceKm(parseNum(repsDist[2]), repsDist[3]) });
    } else {
      steps.push({ kind: 'work', durationS: toDurationS(parseNum(repsTime![2]), repsTime![3]) });
    }

    if (i < reps - 1 && recovery) {
      const unit = recovery[2].toLowerCase();
      if (unit === 'km' || unit === 'm') {
        steps.push({ kind: 'recovery', distanceKm: toDistanceKm(parseNum(recovery[1]), unit) });
      } else {
        steps.push({ kind: 'recovery', durationS: toDurationS(parseNum(recovery[1]), unit) });
      }
    }
  }

  const cooldown = matchMeasureNearKeyword(text, COOLDOWN_KEYWORDS);
  if (cooldown) steps.push({ kind: 'cooldown', ...cooldown });

  return { steps, hasIntervals: true };
}

/** Converts a single step to a distance, estimating duration-based steps from `paceKmh`. */
export function stepDistanceKm(step: WorkoutStep, paceKmh: number): number {
  if (step.distanceKm != null) return step.distanceKm;
  if (step.durationS != null) return (step.durationS / 3600) * paceKmh;
  return 0;
}

export function totalDistanceKm(steps: WorkoutStep[], paceKmh: number): number {
  return steps.reduce((sum, step) => sum + stepDistanceKm(step, paceKmh), 0);
}

/**
 * Distance of one work interval plus the recovery right after it — a
 * practical size for a short loop the runner can physically repeat, rather
 * than trying to encode every rep into one long GPX track (a GPX course is
 * just geometry; it can't carry per-rep pace targets anyway — see README).
 * Returns null when the workout has no recognizable work step.
 */
export function repeatSegmentDistanceKm(steps: WorkoutStep[], paceKmh: number): number | null {
  const workIndex = steps.findIndex((step) => step.kind === 'work');
  if (workIndex === -1) return null;
  let distance = stepDistanceKm(steps[workIndex], paceKmh);
  const next = steps[workIndex + 1];
  if (next?.kind === 'recovery') distance += stepDistanceKm(next, paceKmh);
  return distance;
}

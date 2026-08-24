import type { FatigueReadiness, Sport } from '../types.js';
import type { StravaActivitySummary } from '../integrations/strava.js';

const SPORT_TO_STRAVA_TYPE: Record<Sport, string[]> = {
  run: ['Run', 'TrailRun', 'VirtualRun'],
  bike: ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide'],
};

/**
 * Very simplified acute:chronic training load ratio, using activity count
 * and moving time as a stand-in for a real load metric (Strava's
 * `suffer_score` requires a linked heart-rate/power stream and isn't always
 * present, so this falls back to duration when it's missing).
 *
 * This is a heuristic, not a physiological model: it exists only to decide
 * whether today's generated route should lean flat/easy or can include more
 * climbing, and should not be read as medical or coaching advice.
 */
export function computeReadiness(activities: StravaActivitySummary[], sport: Sport): FatigueReadiness {
  const now = Date.now();
  const load = (a: StravaActivitySummary) => a.suffer_score ?? a.moving_time / 60;

  const acuteMs = 7 * 24 * 60 * 60 * 1000;
  const chronicMs = 28 * 24 * 60 * 60 * 1000;

  const acute = activities.filter((a) => now - new Date(a.start_date).getTime() <= acuteMs);
  const chronic = activities.filter((a) => now - new Date(a.start_date).getTime() <= chronicMs);

  const acuteLoad = acute.reduce((sum, a) => sum + load(a), 0) / 7;
  const chronicLoad = chronic.reduce((sum, a) => sum + load(a), 0) / 28 || 1;
  const acuteToChronicRatio = acuteLoad / chronicLoad;

  let fatigueLevel: FatigueReadiness['fatigueLevel'] = 'moderate';
  if (acuteToChronicRatio >= 1.3) fatigueLevel = 'high';
  else if (acuteToChronicRatio <= 0.8) fatigueLevel = 'low';

  const sportTypes = SPORT_TO_STRAVA_TYPE[sport];
  const sameSport = activities.filter((a) => sportTypes.includes(a.type));
  let recentAvgSpeedKmh: number | undefined;
  if (sameSport.length > 0) {
    const totalKm = sameSport.reduce((sum, a) => sum + a.distance / 1000, 0);
    const totalH = sameSport.reduce((sum, a) => sum + a.moving_time / 3600, 0);
    if (totalH > 0) recentAvgSpeedKmh = totalKm / totalH;
  }

  return { acuteToChronicRatio, fatigueLevel, recentAvgSpeedKmh };
}

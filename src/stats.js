const DAY_MS = 24 * 60 * 60 * 1000;

// Two plays of the same song only count as "in a row" if they are this close.
// This stops a gap in tracking (laptop asleep, etc.) from faking a streak.
export const STREAK_GAP_MS = 30 * 60 * 1000;

/**
 * @param plays {{trackId: string, playedAt: number}[]} sorted oldest first
 * @returns Map of trackId -> { plays, bestStreak, playTimes, lastPlayed }
 */
export function computeTrackStats(plays) {
  const stats = new Map();
  let prev = null;
  let streak = 0;

  for (const play of plays) {
    let s = stats.get(play.trackId);
    if (!s) {
      s = { trackId: play.trackId, plays: 0, bestStreak: 0, playTimes: [], lastPlayed: 0 };
      stats.set(play.trackId, s);
    }
    s.plays++;
    s.playTimes.push(play.playedAt);
    s.lastPlayed = play.playedAt;

    const continuesStreak =
      prev && prev.trackId === play.trackId && play.playedAt - prev.playedAt <= STREAK_GAP_MS;
    streak = continuesStreak ? streak + 1 : 1;
    s.bestStreak = Math.max(s.bestStreak, streak);
    prev = play;
  }
  return stats;
}

export function playsWithinDays(stat, days, now = Date.now()) {
  const cutoff = now - days * DAY_MS;
  return stat.playTimes.filter((t) => t >= cutoff).length;
}

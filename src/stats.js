const DAY_MS = 24 * 60 * 60 * 1000;

// Two plays of the same song only count as "in a row" if they are this close.
// This stops a gap in tracking (laptop asleep, etc.) from faking a streak.
export const STREAK_GAP_MS = 30 * 60 * 1000;

/**
 * @param plays {{trackId: string, playedAt: number, listenedMs?: number, durationMs?: number}[]} sorted oldest first
 * @returns Map of trackId -> { plays, bestStreak, playTimes, listens, lastPlayed }
 */
export function computeTrackStats(plays) {
  const stats = new Map();
  let prev = null;
  let streak = 0;

  for (const play of plays) {
    let s = stats.get(play.trackId);
    if (!s) {
      s = { trackId: play.trackId, plays: 0, bestStreak: 0, playTimes: [], listens: [], lastPlayed: 0 };
      stats.set(play.trackId, s);
    }
    s.plays++;
    s.playTimes.push(play.playedAt);
    s.listens.push({ at: play.playedAt, listenedMs: play.listenedMs ?? null, durationMs: play.durationMs ?? null });
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

/** Fraction of the song that was heard (0-1), or null if nobody measured this play. */
export function completion(listen) {
  if (listen.listenedMs == null || !listen.durationMs) return null;
  return Math.min(1, listen.listenedMs / listen.durationMs);
}

/**
 * Counts the listens of one song that a rule accepts.
 *
 * - minCompletion: only listens where at least this % of the song was heard.
 *   Unmeasured plays count only when unmeasured is 'count'.
 * - withinDays: only listens from the last N days.
 * - Listens of the same song closer together than sessionGapMs form one session.
 * - maxPerSession: count at most this many listens from any one session, so
 *   leaving a song on repeat overnight can't run up the count.
 *
 * Returns { count, sessions }.
 */
export function countListens(stat, { minCompletion, withinDays, maxPerSession, unmeasured = 'ignore', sessionGapMs, now = Date.now() }) {
  const cutoff = withinDays ? now - withinDays * DAY_MS : -Infinity;
  const kept = stat.listens.filter((l) => {
    if (l.at < cutoff) return false;
    if (!minCompletion) return true;
    const heard = completion(l);
    return heard === null ? unmeasured === 'count' : heard * 100 >= minCompletion;
  });

  const sessionSizes = [];
  let previous = null;
  for (const l of kept) {
    if (previous === null || l.at - previous > sessionGapMs) sessionSizes.push(0);
    sessionSizes[sessionSizes.length - 1]++;
    previous = l.at;
  }
  const count = sessionSizes.reduce((sum, size) => sum + Math.min(size, maxPerSession ?? Infinity), 0);
  return { count, sessions: sessionSizes.length };
}

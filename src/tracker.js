import { getDb, transaction, upsertTrack } from './db.js';

// Spotify only counts a play after 30 seconds, so anything shorter is a skip.
export const MIN_LISTEN_MS = 30_000;
// Progress jumping back by more than this means the song started again (repeat, or you went back).
const RESTART_JUMP_MS = 10_000;
// Allow a little slack between our clock and Spotify's when deciding a jump forward was real listening.
const CLOCK_SLACK_MS = 3_000;

/**
 * Turns "what's playing right now" snapshots into measured listens.
 *
 * Call with the previous state, the latest snapshot (or null when nothing is
 * playing) and the current time. Returns the new state and any listens that
 * just finished. Seeking forward doesn't count as listening: we only credit as
 * much progress as real time allows.
 *
 * snapshot: { track, isPlaying, progressMs, durationMs }
 * listen:   { track, listenedMs, durationMs, startedAt, endedAt }
 */
export function advance(state, snapshot, now) {
  const finished = [];
  const finish = (s, endedAt) => {
    const listen = {
      track: s.track,
      listenedMs: Math.min(s.listenedMs, s.durationMs || Infinity),
      durationMs: s.durationMs,
      startedAt: s.startedAt,
      endedAt,
    };
    if (listen.listenedMs >= MIN_LISTEN_MS) finished.push(listen);
  };
  const begin = (snap) => ({
    track: snap.track,
    durationMs: snap.durationMs,
    startedAt: now - snap.progressMs,
    // A song we first see halfway through only gets credit from here on.
    listenedMs: 0,
    lastProgress: snap.progressMs,
    lastSeenAt: now,
    wasPlaying: snap.isPlaying,
  });

  if (!state) return { state: snapshot ? begin(snapshot) : null, finished };

  const sameSong = snapshot && snapshot.track.id === state.track.id;
  const restarted = sameSong && snapshot.progressMs < state.lastProgress - RESTART_JUMP_MS;

  if (!sameSong || restarted) {
    // How long the old song kept playing after we last looked. If something new is
    // playing, it ended when the new one started; otherwise assume it ran on.
    const nextStartedAt = snapshot ? now - snapshot.progressMs : now;
    const tail = state.wasPlaying
      ? Math.max(0, Math.min(nextStartedAt - state.lastSeenAt, state.durationMs - state.lastProgress))
      : 0;
    finish({ ...state, listenedMs: state.listenedMs + tail }, state.lastSeenAt + tail);
    return { state: snapshot ? begin(snapshot) : null, finished };
  }

  const moved = snapshot.progressMs - state.lastProgress;
  const elapsed = now - state.lastSeenAt;
  const credit = moved > 0 ? Math.min(moved, elapsed + CLOCK_SLACK_MS) : 0;
  return {
    state: {
      ...state,
      listenedMs: state.listenedMs + credit,
      lastProgress: snapshot.progressMs,
      lastSeenAt: now,
      wasPlaying: snapshot.isPlaying,
    },
    finished,
  };
}

// Spotify's recently-played timestamp and ours can differ by up to a song's length.
const matchWindowMs = (durationMs) => (durationMs || 300_000) + 180_000;

/**
 * Saves a measured listen. If Spotify's recently-played already reported this
 * play, the measurement is attached to that row instead of adding a duplicate.
 */
export function recordListen(listen) {
  const { track, listenedMs, durationMs, endedAt } = listen;
  const window = matchWindowMs(durationMs);
  transaction((d) => {
    upsertTrack(d, track);
    const match = d
      .prepare(`
        SELECT played_at FROM plays
        WHERE track_id = ? AND listened_ms IS NULL AND source = 'recent'
          AND played_at BETWEEN ? AND ?
        ORDER BY ABS(julianday(played_at) - julianday(?)) LIMIT 1
      `)
      .get(
        track.id,
        new Date(endedAt - window).toISOString(),
        new Date(endedAt + window).toISOString(),
        new Date(endedAt).toISOString(),
      );
    if (match) {
      d.prepare('UPDATE plays SET listened_ms = ?, duration_ms = ? WHERE played_at = ? AND track_id = ?')
        .run(listenedMs, durationMs, match.played_at, track.id);
    } else {
      d.prepare(`
        INSERT OR IGNORE INTO plays (played_at, track_id, source, listened_ms, duration_ms)
        VALUES (?, ?, 'live', ?, ?)
      `).run(new Date(endedAt).toISOString(), track.id, listenedMs, durationMs);
    }
  });
}

/**
 * For a play from Spotify's recently-played list: returns true if we already
 * have it, either from an earlier sync or measured live (which then gets linked).
 */
export function claimRecentPlay(d, trackId, spotifyPlayedAt, durationMs) {
  if (d.prepare('SELECT 1 FROM plays WHERE track_id = ? AND spotify_played_at = ?').get(trackId, spotifyPlayedAt)) {
    return true;
  }
  const at = Date.parse(spotifyPlayedAt);
  const window = matchWindowMs(durationMs);
  const live = d
    .prepare(`
      SELECT played_at FROM plays
      WHERE track_id = ? AND source = 'live' AND spotify_played_at IS NULL
        AND played_at BETWEEN ? AND ?
      ORDER BY ABS(julianday(played_at) - julianday(?)) LIMIT 1
    `)
    .get(trackId, new Date(at - window).toISOString(), new Date(at + window).toISOString(), spotifyPlayedAt);
  if (!live) return false;
  d.prepare('UPDATE plays SET spotify_played_at = ? WHERE played_at = ? AND track_id = ?')
    .run(spotifyPlayedAt, live.played_at, trackId);
  return true;
}

export function unmeasuredShare() {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS total, SUM(listened_ms IS NULL) AS unmeasured FROM plays')
    .get();
  return { total: row.total, unmeasured: row.unmeasured ?? 0 };
}

import { config } from './config.js';
import { hasScope, isLoggedIn } from './auth.js';
import { kvGet, kvSet } from './db.js';
import { getNowPlaying } from './player.js';
import { syncRecentPlays } from './sync.js';
import { applyRules } from './apply.js';
import { advance, recordListen } from './tracker.js';
import { loadSettings } from './rules.js';

// Check more often while music is playing so short songs and skips are measured accurately.
const PLAYING_POLL_MS = 10_000;
const IDLE_POLL_MS = 30_000;
// If whoever holds the lock hasn't checked in for this long, assume it stopped.
const LOCK_STALE_MS = 90_000;

const owner = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

/** Only one process (web server or `npm start`) should track at a time. */
function holdLock() {
  const lock = kvGet('backgroundLock');
  if (lock && lock.owner !== owner && Date.now() - lock.at < LOCK_STALE_MS) return false;
  kvSet('backgroundLock', { owner, at: Date.now() });
  return true;
}

/**
 * Measures listens, syncs recent plays, and applies rules on a timer.
 * Safe to call more than once per process; only the first call starts anything.
 */
export function startBackground({ log = console.log } = {}) {
  if (globalThis.__playlistPilotBackground) return;
  globalThis.__playlistPilotBackground = true;

  let state = null;
  let lastSync = 0;
  let lastApply = Date.now(); // Give a fresh start a sync before the first apply.
  let lastError = '';

  const report = (err) => {
    // Don't flood the log with the same failure every few seconds.
    if (err.message !== lastError) log(`PlaylistPilot: ${err.message}`);
    lastError = err.message;
  };

  const tick = async () => {
    let playing = false;
    try {
      if (!isLoggedIn() || !holdLock()) return;

      if (hasScope('user-read-currently-playing')) {
        const snapshot = await getNowPlaying();
        playing = Boolean(snapshot?.isPlaying);
        const result = advance(state, snapshot, Date.now());
        state = result.state;
        for (const listen of result.finished) recordListen(listen);
      }

      const now = Date.now();
      if (now - lastSync >= config.syncMinutes * 60_000) {
        lastSync = now;
        await syncRecentPlays();
      }
      if (loadSettings(config.rulesPath).autoApply && now - lastApply >= config.applyMinutes * 60_000) {
        lastApply = now;
        await applyRules({ log: () => {} });
      }
      lastError = '';
    } catch (err) {
      report(err);
    } finally {
      setTimeout(tick, playing ? PLAYING_POLL_MS : IDLE_POLL_MS);
    }
  };

  tick();
}

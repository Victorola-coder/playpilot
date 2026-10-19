import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Point the database at a throwaway file before anything opens it.
process.env.PLAYPILOT_DB = path.join(mkdtempSync(path.join(tmpdir(), 'playlistpilot-')), 'test.db');

const { advance, recordListen, claimRecentPlay } = await import('../src/tracker.js');
const { computeTrackStats, countListens } = await import('../src/stats.js');
const { normalizeRules, normalizeSettings, matchTracks } = await import('../src/rules.js');
const { getDb, loadPlays } = await import('../src/db.js');

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const song = (id, durationMs = 3 * MIN) => ({ id, name: `Song ${id}`, artists: [{ id: 'ar', name: 'Artist' }], duration_ms: durationMs });
const snap = (track, progressMs, isPlaying = true) => ({ track, progressMs, isPlaying, durationMs: track.duration_ms });

// Feeds snapshots taken every `step` ms; returns all finished listens.
function play(snapshots, step = 10 * SEC, start = 0) {
  let state = null;
  const finished = [];
  snapshots.forEach((s, i) => {
    const r = advance(state, s, start + i * step);
    state = r.state;
    finished.push(...r.finished);
  });
  return finished;
}

test('a song played to the end counts as a full listen', () => {
  const a = song('a');
  const b = song('b');
  // Polls every 10s through all 3 minutes of A, then B starts.
  const snaps = Array.from({ length: 18 }, (_, i) => snap(a, i * 10 * SEC));
  snaps.push(snap(b, 0));
  const [listen] = play(snaps);
  assert.equal(listen.track.id, 'a');
  assert.ok(listen.listenedMs >= 0.97 * a.duration_ms, `heard ${listen.listenedMs}`);
});

test('skipping after 40 seconds is recorded as a partial listen', () => {
  const a = song('a');
  const forty = [0, 10, 20, 30, 40].map((t) => snap(a, t * SEC));
  const [listen] = play([...forty, snap(song('b'), 0)]);
  assert.ok(listen.listenedMs >= 40 * SEC && listen.listenedMs <= 50 * SEC, `heard ${listen.listenedMs}`);
});

test('skips under 30 seconds are not recorded at all', () => {
  assert.equal(play([snap(song('a'), 0), snap(song('a'), 10 * SEC), snap(song('b'), 0)]).length, 0);
});

test('seeking to the end does not count as listening', () => {
  const a = song('a');
  const [listen] = play([snap(a, 0), snap(a, 10 * SEC), snap(a, 170 * SEC), snap(a, 180 * SEC), snap(song('b'), 0)]);
  assert.ok(listen.listenedMs < 40 * SEC, `heard ${listen.listenedMs}`);
});

test('a song on repeat becomes one listen per time through', () => {
  const a = song('a', MIN);
  const round = Array.from({ length: 6 }, (_, i) => snap(a, i * 10 * SEC));
  const listens = play([...round, ...round, ...round, snap(song('b'), 0)]);
  assert.equal(listens.length, 3);
});

test('pausing does not add listening time', () => {
  const a = song('a');
  const paused = Array.from({ length: 30 }, () => snap(a, 40 * SEC, false));
  const forty = [0, 10, 20, 30, 40].map((t) => snap(a, t * SEC));
  const [listen] = play([...forty, ...paused, snap(song('b'), 0)]);
  // 5 minutes paused at 0:40 must not turn into 5 minutes of listening.
  assert.ok(listen.listenedMs <= 50 * SEC, `heard ${listen.listenedMs}`);
});

// --- Counting listens -------------------------------------------------------

const listensOf = (list) =>
  computeTrackStats(list.map(([at, fraction]) => ({
    trackId: 't',
    playedAt: at,
    listenedMs: fraction === null ? null : fraction * 3 * MIN,
    durationMs: 3 * MIN,
  }))).get('t');

const opts = { sessionGapMs: HOUR, now: 10 * 24 * HOUR };

test('only listens above the completion bar count', () => {
  const stat = listensOf([[0, 1], [10 * MIN, 0.5], [20 * MIN, 0.85]]);
  assert.equal(countListens(stat, { ...opts, minCompletion: 80 }).count, 2);
});

test('unmeasured plays follow the setting', () => {
  const stat = listensOf([[0, 1], [10 * MIN, null]]);
  assert.equal(countListens(stat, { ...opts, minCompletion: 80, unmeasured: 'ignore' }).count, 1);
  assert.equal(countListens(stat, { ...opts, minCompletion: 80, unmeasured: 'count' }).count, 2);
});

test('seven plays in a row overnight are one session', () => {
  const overnight = listensOf(Array.from({ length: 7 }, (_, i) => [i * 3 * MIN, 1]));
  assert.deepEqual(countListens(overnight, opts), { count: 7, sessions: 1 });
  assert.equal(countListens(overnight, { ...opts, maxPerSession: 3 }).count, 3);
});

test('listens hours apart are separate sessions', () => {
  const spread = listensOf([[0, 1], [3 * MIN, 1], [5 * HOUR, 1], [26 * HOUR, 1]]);
  assert.deepEqual(countListens(spread, opts), { count: 4, sessions: 3 });
});

test('the overnight edge case: needs another session, then qualifies straight away', () => {
  const rule = normalizeRules({
    rules: [{ name: 'Keepers', playlist: 'P', match: { minPlays: 7, minCompletion: 80, minSessions: 2 } }],
  })[0];
  const tracks = new Map([['t', { id: 't', name: 'T', artistIds: [], artistNames: ['A'] }]]);
  const ctx = (stat) => ({ stats: new Map([['t', stat]]), tracks, saved: new Set(), now: opts.now });

  const overnight = Array.from({ length: 7 }, (_, i) => [i * 3 * MIN, 1]);
  assert.deepEqual(matchTracks(rule, ctx(listensOf(overnight))), []);
  assert.deepEqual(matchTracks(rule, ctx(listensOf([...overnight, [2 * 24 * HOUR, 0.9]]))), ['t']);
});

test('excluded songs are never picked', () => {
  const rule = normalizeRules({ rules: [{ name: 'r', playlist: 'P', match: { minPlays: 1 } }] })[0];
  const tracks = new Map([['t', { id: 't', name: 'T', artistIds: [], artistNames: ['A'] }]]);
  const stats = new Map([['t', listensOf([[0, 1]])]]);
  assert.deepEqual(matchTracks(rule, { stats, tracks, saved: new Set(), excluded: new Set(['t']), now: opts.now }), []);
});

// --- Validation -------------------------------------------------------------

test('validates the new rule options', () => {
  const bad = (match, extra = {}) => () => normalizeRules({ rules: [{ name: 'r', playlist: 'P', match, ...extra }] });
  assert.throws(bad({ minPlays: 7, minCompletion: 120 }), /percentage/);
  assert.throws(bad({ minStreak: 3, minCompletion: 80 }), /needs "minPlays" or "minSessions"/);
  assert.throws(bad({ minPlays: 3 }, { saveTo: 'liked', groupBy: 'genre' }), /can't be split/);
  assert.doesNotThrow(() => normalizeRules({ rules: [{ name: 'r', saveTo: 'liked', match: { minPlays: 7 } }] }));
  assert.throws(() => normalizeSettings({ sessionGapMinutes: 0 }), /sessionGapMinutes/);
  assert.equal(normalizeSettings().unmeasuredPlays, 'ignore');
});

// --- Merging Spotify's plays with measured ones ------------------------------

test('a measured listen and the same play from Spotify become one row', () => {
  const d = getDb();
  const t0 = Date.parse('2026-10-19T10:00:00Z');
  const track = song('merge1');

  recordListen({ track, listenedMs: 175 * SEC, durationMs: 180 * SEC, startedAt: t0, endedAt: t0 + 180 * SEC });
  // Spotify reports it a moment later with its own timestamp.
  assert.equal(claimRecentPlay(d, 'merge1', new Date(t0 + 182 * SEC).toISOString(), 180 * SEC), true);
  // Seeing the same Spotify entry again on the next sync is still a duplicate.
  assert.equal(claimRecentPlay(d, 'merge1', new Date(t0 + 182 * SEC).toISOString(), 180 * SEC), true);

  const plays = loadPlays().filter((p) => p.trackId === 'merge1');
  assert.equal(plays.length, 1);
  assert.equal(plays[0].listenedMs, 175 * SEC);
});

test('Spotify plays seen first get the measurement attached later', () => {
  const d = getDb();
  const t0 = Date.parse('2026-10-19T12:00:00Z');
  const at = new Date(t0).toISOString();
  d.prepare("INSERT INTO plays (played_at, track_id, source, spotify_played_at) VALUES (?, 'merge2', 'recent', ?)").run(at, at);

  recordListen({ track: song('merge2'), listenedMs: 60 * SEC, durationMs: 180 * SEC, startedAt: t0 - 60 * SEC, endedAt: t0 });
  const plays = loadPlays().filter((p) => p.trackId === 'merge2');
  assert.equal(plays.length, 1);
  assert.equal(plays[0].listenedMs, 60 * SEC);
});

test('two plays of the same song back to back stay two plays', () => {
  const d = getDb();
  const t0 = Date.parse('2026-10-19T14:00:00Z');
  const track = song('merge3');
  recordListen({ track, listenedMs: 180 * SEC, durationMs: 180 * SEC, startedAt: t0, endedAt: t0 + 180 * SEC });
  recordListen({ track, listenedMs: 180 * SEC, durationMs: 180 * SEC, startedAt: t0 + 180 * SEC, endedAt: t0 + 360 * SEC });
  claimRecentPlay(d, 'merge3', new Date(t0 + 181 * SEC).toISOString(), 180 * SEC);
  claimRecentPlay(d, 'merge3', new Date(t0 + 361 * SEC).toISOString(), 180 * SEC);
  assert.equal(loadPlays().filter((p) => p.trackId === 'merge3').length, 2);
});

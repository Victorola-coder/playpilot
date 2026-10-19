import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTrackStats, STREAK_GAP_MS } from '../src/stats.js';
import { groupTracks, matchTracks, normalizeRules } from '../src/rules.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = Date.UTC(2026, 9, 19);

// Builds plays from a list of [trackId, minutesAgo], oldest first.
const plays = (list) => list.map(([trackId, minsAgo]) => ({ trackId, playedAt: NOW - minsAgo * MIN }));

const tracks = new Map([
  ['a', { id: 'a', name: 'Song A', artistIds: ['x'], artistNames: ['Burna Boy'] }],
  ['b', { id: 'b', name: 'Song B', artistIds: ['y'], artistNames: ['Tems'] }],
  ['c', { id: 'c', name: 'Song C', artistIds: ['z'], artistNames: ['Drake'] }],
]);
const genresByArtist = new Map([
  ['x', ['afrobeats', 'nigerian pop']],
  ['y', ['afrobeats', 'alte']],
  ['z', ['rap']],
]);

test('counts back-to-back plays as a streak', () => {
  const stats = computeTrackStats(plays([['a', 30], ['a', 26], ['a', 22], ['b', 18], ['a', 14]]));
  assert.equal(stats.get('a').plays, 4);
  assert.equal(stats.get('a').bestStreak, 3);
  assert.equal(stats.get('b').bestStreak, 1);
});

test('a long gap in tracking breaks a streak', () => {
  const gapMins = STREAK_GAP_MS / MIN + 1;
  const stats = computeTrackStats(plays([['a', gapMins + 10], ['a', 5]]));
  assert.equal(stats.get('a').bestStreak, 1);
});

test('skips songs already saved when onlyUnsaved is on', () => {
  const stats = computeTrackStats(plays([['a', 50], ['a', 40], ['b', 30], ['b', 20]]));
  const [rule] = normalizeRules({ rules: [{ name: 'r', playlist: 'P', match: { minPlays: 2 } }] });
  const ctx = { stats, tracks, saved: new Set(['b']), now: NOW, genresByArtist };
  assert.deepEqual(matchTracks(rule, ctx), ['a']);
});

test('a list of conditions matches if any one does', () => {
  const stats = computeTrackStats(plays([['c', 10 * DAY / MIN], ['a', 50], ['a', 48], ['a', 46], ['b', 40], ['c', 30]]));
  const [rule] = normalizeRules({
    rules: [{ name: 'r', playlist: 'P', match: [{ minStreak: 3 }, { minPlays: 2, withinDays: 7 }] }],
  });
  const ctx = { stats, tracks, saved: new Set(), now: NOW, genresByArtist };
  // 'c' has 2 plays total but only 1 in the last 7 days.
  assert.deepEqual(matchTracks(rule, ctx), ['a']);
});

test('groups by the most common genre among picked songs', () => {
  const stats = computeTrackStats(plays([['a', 9], ['b', 8], ['c', 7]]));
  const [rule] = normalizeRules({ rules: [{ name: 'r', playlist: 'Mix · {group}', groupBy: 'genre', match: { minPlays: 1 } }] });
  const ctx = { stats, tracks, saved: new Set(), now: NOW, genresByArtist };
  const groups = groupTracks(rule, matchTracks(rule, ctx), ctx);
  const byName = Object.fromEntries(groups.map((g) => [g.playlist, g.trackIds.sort()]));
  assert.deepEqual(byName, { 'Mix · Afrobeats': ['a', 'b'], 'Mix · Rap': ['c'] });
});

test('rejects rules with typos in plain English', () => {
  assert.throws(
    () => normalizeRules({ rules: [{ name: 'r', playlist: 'P', match: { minPlay: 3 } }] }),
    /unknown condition "minPlay"/,
  );
});

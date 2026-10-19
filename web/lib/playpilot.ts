import 'server-only';
import { NextResponse } from 'next/server';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ROOT, config } from '../../src/config.js';
import { coverUrl, getDb, kvGet, kvSet, loadPlays, loadTracks } from '../../src/db.js';
import { hasScope, isLoggedIn } from '../../src/auth.js';
import { getNowPlaying } from '../../src/player.js';
import { completion, computeTrackStats, countListens, playsWithinDays } from '../../src/stats.js';
import { loadRules, loadSettings, readRawRules, saveRules } from '../../src/rules.js';
import { listExcluded, placesAdded } from '../../src/collection.js';
import { unmeasuredShare } from '../../src/tracker.js';
import type { RawFile, RawRule, RawSettings } from './rules-draft';

export { isLoggedIn, startLogin, finishLogin } from '../../src/auth.js';
export { syncRecentPlays } from '../../src/sync.js';
export { applyRules } from '../../src/apply.js';
export { allowTrack, excludeTrack, removeFromCollection } from '../../src/collection.js';

// Holds the PKCE verifier and state between /api/auth/login and the callback.
export const LOGIN_COOKIE = 'pp_login';

/**
 * The origin the browser actually used. Next normalises 127.0.0.1 to localhost in
 * nextUrl, but Spotify only accepts 127.0.0.1 redirect URIs, and cookies are per-host.
 */
export function requestOrigin(headers: Headers) {
  const proto = headers.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${headers.get('x-forwarded-host') ?? headers.get('host')}`;
}

/** NextResponse.redirect() rewrites 127.0.0.1 to localhost, so set Location ourselves. */
export function redirectTo(url: URL | string) {
  return new NextResponse(null, { status: 307, headers: { Location: url.toString() } });
}

export type Song = { id: string; name: string; artists: string; imageUrl: string | null };

export type TopSong = Song & {
  rank: number;
  plays: number;
  bestStreak: number;
  last30Days: number;
  sessions: number;
  /** Average % of the song heard across measured plays; null if none were measured. */
  avgHeard: number | null;
  excluded: boolean;
  /** PlaylistPilot has put this song in a playlist or Liked Songs. */
  added: boolean;
};

export type RuleIcon = 'repeat' | 'flame' | 'calendar' | 'tag' | 'heart' | 'check';

export type RuleSummary = { name: string; playlist: string; description: string; icon: RuleIcon; chips: string[] };

export type ManagedPlaylist = { name: string; id: string; songsAdded: number; url: string };

export function logout() {
  kvSet('auth', null);
}

export function getOverview() {
  const d = getDb();
  const count = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  return {
    plays: count('SELECT COUNT(*) AS n FROM plays'),
    songs: count('SELECT COUNT(DISTINCT track_id) AS n FROM plays'),
    autoAdded: count('SELECT COUNT(*) AS n FROM auto_adds'),
    latestPlay: (kvGet('lastPlayedAt') as string | undefined) ?? null,
    ...unmeasuredShare(),
  };
}

type Stat = { listens: { at: number; listenedMs: number | null; durationMs: number | null }[] };

function listenSummary(stat: Stat, sessionGapMs: number) {
  const heard = stat.listens.map(completion).filter((c): c is number => c !== null);
  return {
    sessions: countListens(stat, { sessionGapMs }).sessions,
    avgHeard: heard.length ? Math.round((heard.reduce((a, b) => a + b, 0) / heard.length) * 100) : null,
  };
}

type Track = { id: string; name: string | null; artistNames: string[]; imageUrl: string | null };

function toSong(id: string, track: Track | undefined): Song {
  return {
    id,
    name: track?.name ?? 'Unknown song',
    artists: track?.artistNames.join(', ') ?? '',
    imageUrl: track?.imageUrl ?? null,
  };
}

export function getSongs(ids: string[]): Song[] {
  const tracks = loadTracks();
  return ids.map((id) => toSong(id, tracks.get(id)));
}

export const SONGS_PER_PAGE = 10;

/** One page of your most-played songs. `page` is 1-based and clamped to the valid range. */
export function getTopSongs(page = 1) {
  const tracks = loadTracks();
  const sessionGapMs = loadSettings(config.rulesPath).sessionGapMinutes * 60_000;
  const excludedIds = new Set(listExcluded().map((e: { id: string }) => e.id));
  const all = [...computeTrackStats(loadPlays()).values()].sort(
    (a, b) => b.plays - a.plays || b.lastPlayed - a.lastPlayed,
  );
  const pages = Math.max(1, Math.ceil(all.length / SONGS_PER_PAGE));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (current - 1) * SONGS_PER_PAGE;
  const songs: TopSong[] = all.slice(start, start + SONGS_PER_PAGE).map((s, i) => ({
    ...toSong(s.trackId, tracks.get(s.trackId)),
    rank: start + i + 1,
    plays: s.plays,
    bestStreak: s.bestStreak,
    last30Days: playsWithinDays(s, 30),
    ...listenSummary(s, sessionGapMs),
    excluded: excludedIds.has(s.trackId),
    added: placesAdded(s.trackId).length > 0,
  }));
  return { songs, total: all.length, page: current, pages, maxPlays: all[0]?.plays ?? 1 };
}

export function getPlaylists(): ManagedPlaylist[] {
  const rows = getDb()
    .prepare(`
      SELECT m.name, m.id, COUNT(a.track_id) AS songsAdded
      FROM managed_playlists m LEFT JOIN auto_adds a ON a.playlist_id = m.id
      GROUP BY m.id ORDER BY songsAdded DESC, m.name
    `)
    .all() as { name: string; id: string; songsAdded: number }[];
  return rows.map((r) => ({ ...r, url: `https://open.spotify.com/playlist/${r.id}` }));
}

type Condition = {
  minPlays?: number;
  withinDays?: number;
  minCompletion?: number;
  minSessions?: number;
  maxPerSession?: number;
  minStreak?: number;
  artists?: string[];
  genres?: string[];
};

const orList = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items.at(-1)}` : items[0];

function describeCondition(c: Condition) {
  const parts: string[] = [];
  if (c.minPlays) {
    const listens = c.minCompletion ? `listened to ${c.minPlays}+ times (at least ${c.minCompletion}% each time)` : `played ${c.minPlays}+ times`;
    parts.push(`${listens}${c.withinDays ? ` in the last ${c.withinDays} days` : ''}`);
  }
  if (c.minSessions) parts.push(`across ${c.minSessions}+ separate sessions`);
  if (c.maxPerSession) parts.push(`counting at most ${c.maxPerSession} per session`);
  if (c.minStreak) parts.push(`played ${c.minStreak}+ times in a row`);
  if (c.artists) parts.push(`by ${orList(c.artists)}`);
  if (c.genres) parts.push(`in ${orList(c.genres)}`);
  return parts.join(', ');
}

function conditionChip(c: Condition) {
  const parts: string[] = [];
  if (c.minPlays) parts.push(`${c.minPlays}+ plays${c.withinDays ? ` in ${c.withinDays}d` : ''}`);
  if (c.minCompletion) parts.push(`${c.minCompletion}%+ heard`);
  if (c.minSessions) parts.push(`${c.minSessions}+ sessions`);
  if (c.maxPerSession) parts.push(`max ${c.maxPerSession}/session`);
  if (c.minStreak) parts.push(`${c.minStreak}+ in a row`);
  if (c.artists) parts.push(c.artists.length === 1 ? c.artists[0] : `${c.artists.length} artists`);
  if (c.genres) parts.push(c.genres.length === 1 ? c.genres[0] : `${c.genres.length} genres`);
  return parts.join(' + ');
}

function pickIcon(saveTo: string, groupBy: string | null, conditions: Condition[]): RuleIcon {
  if (saveTo === 'liked') return 'heart';
  if (groupBy) return 'tag';
  if (conditions.some((c) => c.minCompletion || c.minSessions)) return 'check';
  if (conditions.some((c) => c.withinDays)) return 'calendar';
  if (conditions.every((c) => c.minStreak && !c.minPlays)) return 'repeat';
  return 'flame';
}

/** Turns rules.json into plain sentences. Returns an error message instead if the file is broken. */
export function getRules(): { rules: RuleSummary[]; error: string | null } {
  try {
    const rules = loadRules(config.rulesPath).map((rule) => {
      const conditions = rule.conditions as Condition[];
      let text = `Songs ${conditions.map(describeCondition).join(', or ')}`;
      if (rule.onlyUnsaved) text += ' that you haven’t saved anywhere';
      if (rule.maxTracks) text += ` (top ${rule.maxTracks})`;
      if (rule.groupBy) text += `, split into one playlist per ${rule.groupBy}`;

      const chips = conditions.map(conditionChip);
      if (rule.onlyUnsaved) chips.push('Not saved yet');
      if (rule.maxTracks) chips.push(`Top ${rule.maxTracks}`);
      if (rule.groupBy) chips.push(`One per ${rule.groupBy}`);

      return {
        name: rule.name,
        playlist: rule.playlist.replace('{group}', `<${rule.groupBy}>`),
        description: `${text}.`,
        icon: pickIcon(rule.saveTo, rule.groupBy, conditions),
        chips,
      };
    });
    return { rules, error: null };
  } catch (err) {
    return { rules: [], error: (err as Error).message };
  }
}

/**
 * rules.json as written, for the settings form. Falls back to the example
 * rules when there's no rules.json yet; saving then creates it.
 */
export function getRawRules(): { rules: RawRule[]; settings: RawSettings; error: string | null; isExample: boolean } {
  const isExample = !existsSync(config.rulesPath);
  try {
    const raw = readRawRules(isExample ? path.join(ROOT, 'rules.example.json') : config.rulesPath);
    return { rules: Array.isArray(raw?.rules) ? raw.rules : [], settings: raw?.settings ?? {}, error: null, isExample };
  } catch (err) {
    return { rules: [], settings: {}, error: (err as Error).message, isExample };
  }
}

export function saveRawRules(raw: RawFile) {
  saveRules(config.rulesPath, raw);
}

export type ExcludedSong = Song & { excludedAt: string };

export function getExcluded(): ExcludedSong[] {
  return listExcluded().map((e: { id: string; name: string | null; artistNames: string[]; imageUrl: string | null; excludedAt: string }) => ({
    id: e.id,
    name: e.name ?? 'Unknown song',
    artists: e.artistNames.join(', '),
    imageUrl: e.imageUrl,
    excludedAt: e.excludedAt,
  }));
}

export type NowPlaying =
  | { status: 'disconnected' }
  | { status: 'needs-permission' }
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'playing';
      song: Song;
      isPlaying: boolean;
      progressMs: number;
      durationMs: number;
      plays: number;
      bestStreak: number;
    };

type SpotifyTrack = { id: string; name: string; artists: { name: string }[]; album?: { images?: { url: string }[] } };

export async function getNowPlayingInfo(): Promise<NowPlaying> {
  if (!isLoggedIn()) return { status: 'disconnected' };
  if (!hasScope('user-read-currently-playing')) return { status: 'needs-permission' };
  try {
    const now = await getNowPlaying();
    if (!now) return { status: 'idle' };
    const track = now.track as SpotifyTrack;
    const stat = computeTrackStats(loadPlays()).get(track.id);
    return {
      status: 'playing',
      song: { id: track.id, name: track.name, artists: track.artists.map((a) => a.name).join(', '), imageUrl: coverUrl(track) },
      isPlaying: now.isPlaying,
      progressMs: now.progressMs,
      durationMs: now.durationMs,
      plays: stat?.plays ?? 0,
      bestStreak: stat?.bestStreak ?? 0,
    };
  } catch (err) {
    return { status: 'error', message: (err as Error).message };
  }
}

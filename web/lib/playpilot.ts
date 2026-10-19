import 'server-only';
import { NextResponse } from 'next/server';
import { config } from '../../src/config.js';
import { getDb, kvGet, kvSet, loadPlays, loadTracks } from '../../src/db.js';
import { computeTrackStats, playsWithinDays } from '../../src/stats.js';
import { loadRules } from '../../src/rules.js';

export { isLoggedIn, startLogin, finishLogin } from '../../src/auth.js';
export { syncRecentPlays } from '../../src/sync.js';
export { applyRules } from '../../src/apply.js';

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

export type TopSong = Song & { plays: number; bestStreak: number; last30Days: number };

export type RuleIcon = 'repeat' | 'flame' | 'calendar' | 'tag';

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

export function getTopSongs(limit = 20): TopSong[] {
  const tracks = loadTracks();
  return [...computeTrackStats(loadPlays()).values()]
    .sort((a, b) => b.plays - a.plays || b.lastPlayed - a.lastPlayed)
    .slice(0, limit)
    .map((s) => ({
      ...toSong(s.trackId, tracks.get(s.trackId)),
      plays: s.plays,
      bestStreak: s.bestStreak,
      last30Days: playsWithinDays(s, 30),
    }));
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
  minStreak?: number;
  artists?: string[];
  genres?: string[];
};

const orList = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items.at(-1)}` : items[0];

function describeCondition(c: Condition) {
  const parts: string[] = [];
  if (c.minPlays) parts.push(`played ${c.minPlays}+ times${c.withinDays ? ` in the last ${c.withinDays} days` : ''}`);
  if (c.minStreak) parts.push(`played ${c.minStreak}+ times in a row`);
  if (c.artists) parts.push(`by ${orList(c.artists)}`);
  if (c.genres) parts.push(`in ${orList(c.genres)}`);
  return parts.join(', ');
}

function conditionChip(c: Condition) {
  const parts: string[] = [];
  if (c.minPlays) parts.push(`${c.minPlays}+ plays${c.withinDays ? ` in ${c.withinDays}d` : ''}`);
  if (c.minStreak) parts.push(`${c.minStreak}+ in a row`);
  if (c.artists) parts.push(c.artists.length === 1 ? c.artists[0] : `${c.artists.length} artists`);
  if (c.genres) parts.push(c.genres.length === 1 ? c.genres[0] : `${c.genres.length} genres`);
  return parts.join(' + ');
}

function pickIcon(groupBy: string | null, conditions: Condition[]): RuleIcon {
  if (groupBy) return 'tag';
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
        icon: pickIcon(rule.groupBy, conditions),
        chips,
      };
    });
    return { rules, error: null };
  } catch (err) {
    return { rules: [], error: (err as Error).message };
  }
}

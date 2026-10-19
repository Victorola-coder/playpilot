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

export type TopSong = {
  id: string;
  name: string;
  artists: string;
  plays: number;
  bestStreak: number;
  last30Days: number;
};

export type RuleSummary = { name: string; playlist: string; description: string };

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

export function getTopSongs(limit = 25): TopSong[] {
  const tracks = loadTracks();
  return [...computeTrackStats(loadPlays()).values()]
    .sort((a, b) => b.plays - a.plays || b.lastPlayed - a.lastPlayed)
    .slice(0, limit)
    .map((s) => {
      const t = tracks.get(s.trackId);
      return {
        id: s.trackId,
        name: t?.name ?? 'Unknown song',
        artists: t?.artistNames.join(', ') ?? '',
        plays: s.plays,
        bestStreak: s.bestStreak,
        last30Days: playsWithinDays(s, 30),
      };
    });
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

/** Turns rules.json into plain sentences. Returns an error message instead if the file is broken. */
export function getRules(): { rules: RuleSummary[]; error: string | null } {
  try {
    const rules = loadRules(config.rulesPath).map((rule) => {
      let text = `Songs ${rule.conditions.map(describeCondition).join(', or ')}`;
      if (rule.onlyUnsaved) text += ' that you haven’t saved anywhere';
      if (rule.maxTracks) text += ` (top ${rule.maxTracks})`;
      if (rule.groupBy) text += `, split into one playlist per ${rule.groupBy}`;
      return { name: rule.name, playlist: rule.playlist.replace('{group}', `<${rule.groupBy}>`), description: `${text}.` };
    });
    return { rules, error: null };
  } catch (err) {
    return { rules: [], error: (err as Error).message };
  }
}

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { playsWithinDays } from './stats.js';

const CONDITION_KEYS = new Set(['minPlays', 'withinDays', 'minStreak', 'artists', 'genres']);
const GROUP_BY = new Set(['genre', 'artist']);

function fail(ruleName, message) {
  throw new Error(`Rule "${ruleName}": ${message}`);
}

function normalizeCondition(ruleName, cond) {
  if (typeof cond !== 'object' || cond === null || Array.isArray(cond)) {
    fail(ruleName, '"match" must be an object, or a list of objects (any of them can match).');
  }
  for (const key of Object.keys(cond)) {
    if (!CONDITION_KEYS.has(key)) {
      fail(ruleName, `unknown condition "${key}". Use one of: ${[...CONDITION_KEYS].join(', ')}.`);
    }
  }
  // An empty condition would match every song you've ever played.
  if (!cond.minPlays && !cond.minStreak && !cond.artists?.length && !cond.genres?.length) {
    fail(ruleName, 'each condition needs at least a play count, a streak, artists or genres.');
  }
  for (const key of ['minPlays', 'withinDays', 'minStreak']) {
    if (key in cond && !(Number.isInteger(cond[key]) && cond[key] > 0)) {
      fail(ruleName, `"${key}" must be a whole number above 0.`);
    }
  }
  if (cond.withinDays && !cond.minPlays) fail(ruleName, '"withinDays" needs "minPlays" alongside it.');
  for (const key of ['artists', 'genres']) {
    if (key in cond && !(Array.isArray(cond[key]) && cond[key].every((v) => typeof v === 'string'))) {
      fail(ruleName, `"${key}" must be a list of names, e.g. ["Burna Boy"].`);
    }
  }
  return {
    ...cond,
    artists: cond.artists?.map((a) => a.toLowerCase()),
    genres: cond.genres?.map((g) => g.toLowerCase()),
  };
}

export function normalizeRules(raw) {
  const list = raw?.rules;
  if (!Array.isArray(list) || list.length === 0) throw new Error('rules.json needs a non-empty "rules" list.');

  const seen = new Set();
  return list
    .filter((rule) => rule.enabled !== false)
    .map((rule) => {
      const name = rule.name;
      if (!name || typeof name !== 'string') throw new Error('Every rule needs a "name".');
      if (seen.has(name)) fail(name, 'two rules have this name; names must be unique.');
      seen.add(name);
      if (!rule.playlist || typeof rule.playlist !== 'string') fail(name, 'needs a "playlist" name.');
      if (!rule.match) fail(name, 'needs a "match" section saying which songs to pick.');
      if (rule.groupBy && !GROUP_BY.has(rule.groupBy)) fail(name, '"groupBy" must be "genre" or "artist".');

      let playlist = rule.playlist;
      if (rule.groupBy && !playlist.includes('{group}')) playlist += ' · {group}';
      if (!rule.groupBy && playlist.includes('{group}')) fail(name, '"{group}" in the playlist name needs "groupBy".');

      const conditions = (Array.isArray(rule.match) ? rule.match : [rule.match]).map((c) => normalizeCondition(name, c));
      return {
        name,
        playlist,
        conditions,
        groupBy: rule.groupBy ?? null,
        onlyUnsaved: rule.onlyUnsaved ?? true,
        minGroupSize: rule.minGroupSize ?? 1,
        maxTracks: rule.maxTracks ?? null,
      };
    });
}

/** The rules file exactly as written, without defaults filled in. */
export function readRawRules(file) {
  if (!existsSync(file)) {
    throw new Error(`No rules file at ${file}. Copy rules.example.json to rules.json to get started.`);
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`rules.json is not valid JSON: ${err.message}`);
  }
}

export function loadRules(file) {
  return normalizeRules(readRawRules(file));
}

/** Validates every rule (including switched-off ones) and writes the file. Throws on the first problem. */
export function saveRules(file, raw) {
  normalizeRules({ rules: (raw?.rules ?? []).map((rule) => ({ ...rule, enabled: true })) });
  writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
}

export const needsGenres = (rule) => rule.groupBy === 'genre' || rule.conditions.some((c) => c.genres);

function trackGenres(track, genresByArtist) {
  return [...new Set(track.artistIds.flatMap((id) => genresByArtist.get(id) ?? []))];
}

function matchesCondition(cond, stat, track, ctx) {
  if (cond.minPlays) {
    const count = cond.withinDays ? playsWithinDays(stat, cond.withinDays, ctx.now) : stat.plays;
    if (count < cond.minPlays) return false;
  }
  if (cond.minStreak && stat.bestStreak < cond.minStreak) return false;
  if (cond.artists && !track.artistNames.some((a) => cond.artists.includes(a.toLowerCase()))) return false;
  if (cond.genres && !ctx.ignoreGenres) {
    const genres = trackGenres(track, ctx.genresByArtist);
    if (!genres.some((g) => cond.genres.some((want) => g.includes(want)))) return false;
  }
  return true;
}

/**
 * Returns the track IDs a rule picks, most-played first.
 * With ctx.ignoreGenres, genre filters are skipped so callers can find which
 * artists they need genre data for before doing the real pass.
 */
export function matchTracks(rule, ctx) {
  const picked = [];
  for (const [trackId, stat] of ctx.stats) {
    const track = ctx.tracks.get(trackId);
    if (!track) continue;
    if (rule.onlyUnsaved && ctx.saved.has(trackId)) continue;
    if (rule.conditions.some((cond) => matchesCondition(cond, stat, track, ctx))) picked.push(trackId);
  }
  picked.sort((a, b) => ctx.stats.get(b).plays - ctx.stats.get(a).plays || ctx.stats.get(b).lastPlayed - ctx.stats.get(a).lastPlayed);
  return rule.maxTracks ? picked.slice(0, rule.maxTracks) : picked;
}

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Splits picked tracks into playlists. Returns [{ playlist, trackIds }].
 * For genres, each song goes to whichever of its genres is most common among
 * the picked songs, which keeps playlists broad instead of one per micro-genre.
 */
export function groupTracks(rule, trackIds, ctx) {
  if (!rule.groupBy) return trackIds.length ? [{ playlist: rule.playlist, trackIds }] : [];

  const groups = new Map();
  const addTo = (group, id) => {
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(id);
  };

  if (rule.groupBy === 'artist') {
    for (const id of trackIds) {
      const artist = ctx.tracks.get(id).artistNames[0];
      if (artist) addTo(artist, id);
    }
  } else {
    const genresOf = new Map(trackIds.map((id) => [id, trackGenres(ctx.tracks.get(id), ctx.genresByArtist)]));
    const popularity = new Map();
    for (const genres of genresOf.values()) {
      for (const g of genres) popularity.set(g, (popularity.get(g) ?? 0) + 1);
    }
    for (const id of trackIds) {
      const genres = genresOf.get(id);
      if (genres.length === 0) continue;
      const best = genres.reduce((a, b) => (popularity.get(b) > popularity.get(a) ? b : a));
      addTo(titleCase(best), id);
    }
  }

  return [...groups]
    .filter(([, ids]) => ids.length >= rule.minGroupSize)
    .map(([group, ids]) => ({ playlist: rule.playlist.replaceAll('{group}', group), trackIds: ids }));
}

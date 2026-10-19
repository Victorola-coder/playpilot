import { config } from './config.js';
import { coverUrl, getDb, loadPlays, loadTracks, transaction, upsertTrack } from './db.js';
import { entryTrack, get, isMusicTrack, paginate, post } from './spotify.js';
import { computeTrackStats } from './stats.js';
import { groupTracks, loadRules, matchTracks, needsGenres } from './rules.js';

const GENRE_CACHE_DAYS = 30;
const PLAYLIST_DESCRIPTION = 'Kept up to date automatically by PlayPilot.';

async function playlistTrackIds(playlist) {
  const d = getDb();
  const cached = d.prepare('SELECT * FROM playlist_cache WHERE id = ?').get(playlist.id);
  if (cached?.snapshot_id === playlist.snapshot_id) return new Set(JSON.parse(cached.track_ids));

  const ids = [];
  for await (const entry of paginate(`/playlists/${playlist.id}/items`, { limit: 50 })) {
    const track = entryTrack(entry);
    if (isMusicTrack(track)) ids.push(track.id);
  }
  d.prepare(`
    INSERT INTO playlist_cache (id, snapshot_id, track_ids) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET snapshot_id = excluded.snapshot_id, track_ids = excluded.track_ids
  `).run(playlist.id, playlist.snapshot_id, JSON.stringify(ids));
  return new Set(ids);
}

/**
 * Everything you have "saved yourself": Liked Songs plus every playlist you own
 * or collaborate on, except the ones PlayPilot manages.
 * Spotify no longer lets dev-mode apps read playlists you only follow.
 */
async function loadLibrary(me, managedIds) {
  const saved = new Set();
  for await (const entry of paginate('/me/tracks', { limit: 50 })) {
    const track = entryTrack(entry);
    if (isMusicTrack(track)) saved.add(track.id);
  }

  const playlists = [];
  for await (const playlist of paginate('/me/playlists', { limit: 50 })) {
    if (!playlist) continue;
    playlists.push(playlist);
    const readable = playlist.owner?.id === me.id || playlist.collaborative;
    if (!readable || managedIds.has(playlist.id)) continue;
    for (const id of await playlistTrackIds(playlist)) saved.add(id);
  }
  return { saved, playlists };
}

/** Imported history only has names; look up the real artist IDs for tracks we care about. */
async function fillMissingArtists(trackIds, tracks) {
  const missing = trackIds.filter((id) => tracks.get(id).artistIds.length === 0);
  for (const id of missing) {
    const full = await get(`/tracks/${id}`);
    transaction((d) => upsertTrack(d, full));
    tracks.set(id, {
      id,
      name: full.name,
      artistIds: full.artists.map((a) => a.id),
      artistNames: full.artists.map((a) => a.name),
      imageUrl: coverUrl(full),
    });
  }
}

async function loadGenres(artistIds) {
  const d = getDb();
  const staleBefore = new Date(Date.now() - GENRE_CACHE_DAYS * 864e5).toISOString();
  const genres = new Map();
  for (const id of artistIds) {
    const row = d.prepare('SELECT genres, fetched_at FROM artists WHERE id = ?').get(id);
    if (row?.genres && row.fetched_at > staleBefore) {
      genres.set(id, JSON.parse(row.genres));
      continue;
    }
    // One request per artist: the batch /artists endpoint is gone for dev-mode apps.
    const artist = await get(`/artists/${id}`);
    const list = artist.genres ?? [];
    d.prepare(`
      INSERT INTO artists (id, name, genres, fetched_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, genres = excluded.genres, fetched_at = excluded.fetched_at
    `).run(id, artist.name, JSON.stringify(list), new Date().toISOString());
    genres.set(id, list);
  }
  return genres;
}

async function ensurePlaylist(name, playlists, meId) {
  const d = getDb();
  const managed = d.prepare('SELECT id FROM managed_playlists WHERE name = ?').get(name);
  let playlist = managed && playlists.find((p) => p.id === managed.id);

  // Adopt a playlist you already made with the exact same name.
  playlist ??= playlists.find((p) => p.name === name && p.owner?.id === meId);

  if (!playlist) {
    playlist = await post('/me/playlists', { name, public: false, description: PLAYLIST_DESCRIPTION });
    playlists.push(playlist);
  }
  if (managed && managed.id !== playlist.id) {
    // The old playlist was deleted; forget what we added to it.
    d.prepare('DELETE FROM auto_adds WHERE playlist_id = ?').run(managed.id);
  }
  d.prepare('INSERT INTO managed_playlists (name, id) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET id = excluded.id')
    .run(name, playlist.id);
  return playlist;
}

export async function applyRules({ dryRun = false, log = console.log } = {}) {
  const rules = loadRules(config.rulesPath);
  const d = getDb();
  const stats = computeTrackStats(loadPlays());
  if (stats.size === 0) {
    log('No plays recorded yet. Run `npm run sync` (or import your history) first.');
    return [];
  }

  const me = await get('/me');
  const managedIds = new Set(d.prepare('SELECT id FROM managed_playlists').all().map((r) => r.id));
  const { saved, playlists } = await loadLibrary(me, managedIds);
  const tracks = loadTracks();
  const ctx = { stats, tracks, saved, now: Date.now(), genresByArtist: new Map() };
  const summary = [];

  for (const rule of rules) {
    if (needsGenres(rule)) {
      const candidates = matchTracks(rule, { ...ctx, ignoreGenres: true });
      await fillMissingArtists(candidates, tracks);
      const artistIds = [...new Set(candidates.flatMap((id) => tracks.get(id).artistIds))];
      for (const [id, g] of await loadGenres(artistIds)) ctx.genresByArtist.set(id, g);
    }

    for (const group of groupTracks(rule, matchTracks(rule, ctx), ctx)) {
      const result = { rule: rule.name, playlist: group.playlist, matched: group.trackIds.length, added: [] };
      summary.push(result);

      if (dryRun) {
        result.added = group.trackIds;
        continue;
      }

      const playlist = await ensurePlaylist(group.playlist, playlists, me.id);
      const current = await playlistTrackIds(playlist);
      const alreadyAdded = new Set(
        d.prepare('SELECT track_id FROM auto_adds WHERE playlist_id = ?').all(playlist.id).map((r) => r.track_id),
      );
      const toAdd = group.trackIds.filter((id) => !current.has(id) && !alreadyAdded.has(id));

      for (let i = 0; i < toAdd.length; i += 100) {
        const chunk = toAdd.slice(i, i + 100);
        await post(`/playlists/${playlist.id}/items`, { uris: chunk.map((id) => `spotify:track:${id}`) });
        transaction(() => {
          const insert = d.prepare('INSERT OR IGNORE INTO auto_adds (playlist_id, track_id, rule, added_at) VALUES (?, ?, ?, ?)');
          const now = new Date().toISOString();
          for (const id of chunk) insert.run(playlist.id, id, rule.name, now);
        });
      }
      result.added = toAdd;
    }
  }

  for (const r of summary) {
    const verb = dryRun ? 'would get' : 'added';
    log(`${r.playlist}  (${r.rule}): ${verb} ${r.added.length} song${r.added.length === 1 ? '' : 's'}`);
    if (dryRun) {
      for (const id of r.added.slice(0, 10)) {
        const t = tracks.get(id);
        const s = stats.get(id);
        log(`    ${t.name} - ${t.artistNames.join(', ')}  [${s.plays} plays, best streak ${s.bestStreak}]`);
      }
      if (r.added.length > 10) log(`    ...and ${r.added.length - 10} more`);
    }
  }
  if (summary.length === 0) log('No songs match your rules yet.');
  return summary;
}

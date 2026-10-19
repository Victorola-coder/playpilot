import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { get, isMusicTrack } from './spotify.js';
import { getDb, kvGet, kvSet, transaction, upsertTrack } from './db.js';
import { claimRecentPlay } from './tracker.js';

// Spotify itself only counts a stream after 30 seconds; we use the same bar for imports.
const MIN_IMPORT_MS = 30_000;

/**
 * Pulls the latest plays from Spotify. The API only exposes the last 50, so this
 * needs to run every ~15 minutes to avoid gaps.
 */
export async function syncRecentPlays() {
  const lastSeen = kvGet('lastPlayedAt');
  const page = await get('/me/player/recently-played', {
    limit: 50,
    after: lastSeen ? Date.parse(lastSeen) : undefined,
  });

  const items = page.items.filter((item) => isMusicTrack(item.track));
  let added = 0;
  let newest = lastSeen;

  transaction((d) => {
    const insert = d.prepare(
      "INSERT OR IGNORE INTO plays (played_at, track_id, source, spotify_played_at) VALUES (?, ?, 'recent', ?)",
    );
    for (const { track, played_at } of items) {
      const playedAt = new Date(played_at).toISOString();
      upsertTrack(d, track);
      if (!claimRecentPlay(d, track.id, playedAt, track.duration_ms)) {
        added += insert.run(playedAt, track.id, playedAt).changes;
      }
      if (!newest || playedAt > newest) newest = playedAt;
    }
  });

  if (newest) kvSet('lastPlayedAt', newest);
  // A full page means we may have missed plays since the last sync.
  const possibleGap = Boolean(lastSeen) && page.items.length === 50;
  return { added, possibleGap };
}

function historyFiles(target) {
  if (statSync(target).isFile()) return [target];
  return readdirSync(target)
    .filter((name) => /^Streaming_History_Audio.*\.json$/i.test(name))
    .map((name) => path.join(target, name));
}

/**
 * Imports Spotify's "Extended streaming history" export so stats start from your
 * real history. Only plays older than live tracking are imported, to avoid duplicates.
 */
export function importHistory(target) {
  const files = historyFiles(target);
  if (files.length === 0) {
    throw new Error(`No Streaming_History_Audio_*.json files found in ${target}`);
  }

  const d = getDb();
  const earliestLive = d.prepare("SELECT MIN(played_at) AS t FROM plays WHERE source IN ('recent', 'live')").get().t;
  let imported = 0;
  let skipped = 0;

  transaction(() => {
    // The export says how long each play lasted, so imported plays count as measured.
    const insertPlay = d.prepare(
      "INSERT OR IGNORE INTO plays (played_at, track_id, source, listened_ms) VALUES (?, ?, 'import', ?)",
    );
    const insertTrack = d.prepare(
      "INSERT OR IGNORE INTO tracks (id, name, artist_ids, artist_names) VALUES (?, ?, '[]', ?)",
    );
    for (const file of files) {
      for (const entry of JSON.parse(readFileSync(file, 'utf8'))) {
        const uri = entry.spotify_track_uri;
        if (!uri?.startsWith('spotify:track:') || entry.ms_played < MIN_IMPORT_MS) {
          skipped++;
          continue;
        }
        const playedAt = new Date(entry.ts).toISOString();
        if (earliestLive && playedAt >= earliestLive) {
          skipped++;
          continue;
        }
        const trackId = uri.slice('spotify:track:'.length);
        const artist = entry.master_metadata_album_artist_name;
        insertTrack.run(trackId, entry.master_metadata_track_name, JSON.stringify(artist ? [artist] : []));
        imported += insertPlay.run(playedAt, trackId, entry.ms_played).changes;
      }
    }
  });

  return { files: files.length, imported, skipped };
}

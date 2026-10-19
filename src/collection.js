import { getDb, transaction } from './db.js';
import { del } from './spotify.js';
import { LIKED } from './apply.js';

/** Never add this song automatically again (it stays wherever it already is). */
export function excludeTrack(trackId) {
  getDb()
    .prepare('INSERT OR IGNORE INTO excluded_tracks (track_id, excluded_at) VALUES (?, ?)')
    .run(trackId, new Date().toISOString());
}

export function allowTrack(trackId) {
  getDb().prepare('DELETE FROM excluded_tracks WHERE track_id = ?').run(trackId);
}

export function listExcluded() {
  return getDb()
    .prepare(`
      SELECT e.track_id AS id, e.excluded_at AS excludedAt, t.name, t.artist_names AS artistNames, t.image_url AS imageUrl
      FROM excluded_tracks e LEFT JOIN tracks t ON t.id = e.track_id
      ORDER BY e.excluded_at DESC
    `)
    .all()
    .map((r) => ({ ...r, artistNames: JSON.parse(r.artistNames || '[]') }));
}

/** Where PlaylistPilot has put this song: playlist IDs, plus LIKED for Liked Songs. */
export function placesAdded(trackId) {
  return getDb().prepare('SELECT playlist_id FROM auto_adds WHERE track_id = ?').all(trackId).map((r) => r.playlist_id);
}

/**
 * Takes a song back out of everywhere PlaylistPilot added it. The records in
 * auto_adds stay, so the same rules won't put it straight back.
 */
export async function removeFromCollection(trackId) {
  const uri = `spotify:track:${trackId}`;
  const places = placesAdded(trackId);
  for (const place of places) {
    if (place === LIKED) {
      await del('/me/library', { query: { uris: uri } });
    } else {
      await del(`/playlists/${place}/items`, { body: { items: [{ uri }] } });
    }
  }
  // Playlist contents changed; make the next apply re-read them.
  transaction((d) => {
    for (const place of places) d.prepare('DELETE FROM playlist_cache WHERE id = ?').run(place);
  });
  return places.length;
}

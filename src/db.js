import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS plays (
    played_at         TEXT NOT NULL,  -- ISO 8601, always toISOString() format
    track_id          TEXT NOT NULL,
    source            TEXT NOT NULL,  -- 'recent' (Spotify's recently played), 'live' (measured by the tracker) or 'import'
    listened_ms       INTEGER,        -- how much was actually heard; NULL when nobody measured it
    duration_ms       INTEGER,        -- song length at the time of the play
    spotify_played_at TEXT,           -- the timestamp Spotify reported, once this play shows up in recently played
    PRIMARY KEY (played_at, track_id)
  );
  CREATE INDEX IF NOT EXISTS plays_by_track ON plays (track_id);

  -- Songs you never want added automatically.
  CREATE TABLE IF NOT EXISTS excluded_tracks (
    track_id    TEXT PRIMARY KEY,
    excluded_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id           TEXT PRIMARY KEY,
    name         TEXT,
    artist_ids   TEXT,                -- JSON array; empty for imported tracks until looked up
    artist_names TEXT,                -- JSON array
    duration_ms  INTEGER,
    image_url    TEXT                 -- album cover, ~300px
  );

  CREATE TABLE IF NOT EXISTS artists (
    id         TEXT PRIMARY KEY,
    name       TEXT,
    genres     TEXT,                  -- JSON array
    fetched_at TEXT
  );

  -- Playlists PlaylistPilot created or adopted, keyed by the name in rules.json
  CREATE TABLE IF NOT EXISTS managed_playlists (
    name TEXT PRIMARY KEY,
    id   TEXT NOT NULL
  );

  -- Every track PlaylistPilot added. If you remove one by hand, it is never re-added.
  CREATE TABLE IF NOT EXISTS auto_adds (
    playlist_id TEXT NOT NULL,
    track_id    TEXT NOT NULL,
    rule        TEXT NOT NULL,
    added_at    TEXT NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
  );

  CREATE TABLE IF NOT EXISTS playlist_cache (
    id          TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL,
    track_ids   TEXT NOT NULL         -- JSON array
  );

  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`;

// Columns added after the first release. CREATE TABLE IF NOT EXISTS won't add them to an existing database.
function migrate(d) {
  const columns = (table) => d.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns('tracks').includes('image_url')) d.exec('ALTER TABLE tracks ADD COLUMN image_url TEXT');

  const playColumns = columns('plays');
  if (!playColumns.includes('listened_ms')) {
    d.exec(`
      ALTER TABLE plays ADD COLUMN listened_ms INTEGER;
      ALTER TABLE plays ADD COLUMN duration_ms INTEGER;
      ALTER TABLE plays ADD COLUMN spotify_played_at TEXT;
      UPDATE plays SET spotify_played_at = played_at WHERE source = 'recent';
    `);
  }
  d.exec('CREATE INDEX IF NOT EXISTS plays_by_spotify_time ON plays (track_id, spotify_played_at)');
}

let db;

export function getDb() {
  if (db) return db;
  mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export function kvGet(key) {
  const row = getDb().prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : undefined;
}

export function kvSet(key, value) {
  getDb()
    .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function transaction(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const result = fn(d);
    d.exec('COMMIT');
    return result;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

// Spotify lists covers largest first (640, 300, 64); 300px looks sharp at thumbnail size.
export function coverUrl(track) {
  const images = track.album?.images ?? [];
  return (images[1] ?? images[0])?.url ?? null;
}

export function upsertTrack(d, track) {
  d.prepare(`
    INSERT INTO tracks (id, name, artist_ids, artist_names, duration_ms, image_url) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, artist_ids = excluded.artist_ids, artist_names = excluded.artist_names,
      duration_ms = excluded.duration_ms, image_url = excluded.image_url
  `).run(
    track.id,
    track.name,
    JSON.stringify(track.artists.map((a) => a.id)),
    JSON.stringify(track.artists.map((a) => a.name)),
    track.duration_ms ?? null,
    coverUrl(track),
  );
  for (const artist of track.artists) {
    d.prepare('INSERT OR IGNORE INTO artists (id, name) VALUES (?, ?)').run(artist.id, artist.name);
  }
}

export function loadExcluded() {
  return new Set(getDb().prepare('SELECT track_id FROM excluded_tracks').all().map((r) => r.track_id));
}

export function loadTracks() {
  const tracks = new Map();
  for (const row of getDb().prepare('SELECT * FROM tracks').all()) {
    tracks.set(row.id, {
      id: row.id,
      name: row.name,
      artistIds: JSON.parse(row.artist_ids || '[]'),
      artistNames: JSON.parse(row.artist_names || '[]'),
      imageUrl: row.image_url,
      durationMs: row.duration_ms,
    });
  }
  return tracks;
}

export function loadPlays() {
  return getDb()
    .prepare(`
      SELECT p.track_id, p.played_at, p.listened_ms, COALESCE(p.duration_ms, t.duration_ms) AS duration_ms
      FROM plays p LEFT JOIN tracks t ON t.id = p.track_id
      ORDER BY p.played_at
    `)
    .all()
    .map((row) => ({
      trackId: row.track_id,
      playedAt: Date.parse(row.played_at),
      listenedMs: row.listened_ms,
      durationMs: row.duration_ms,
    }));
}

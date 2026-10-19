import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS plays (
    played_at TEXT NOT NULL,          -- ISO 8601, always toISOString() format
    track_id  TEXT NOT NULL,
    source    TEXT NOT NULL,          -- 'recent' (live tracking) or 'import' (Spotify data export)
    PRIMARY KEY (played_at, track_id)
  );
  CREATE INDEX IF NOT EXISTS plays_by_track ON plays (track_id);

  CREATE TABLE IF NOT EXISTS tracks (
    id           TEXT PRIMARY KEY,
    name         TEXT,
    artist_ids   TEXT,                -- JSON array; empty for imported tracks until looked up
    artist_names TEXT,                -- JSON array
    duration_ms  INTEGER
  );

  CREATE TABLE IF NOT EXISTS artists (
    id         TEXT PRIMARY KEY,
    name       TEXT,
    genres     TEXT,                  -- JSON array
    fetched_at TEXT
  );

  -- Playlists PlayPilot created or adopted, keyed by the name in rules.json
  CREATE TABLE IF NOT EXISTS managed_playlists (
    name TEXT PRIMARY KEY,
    id   TEXT NOT NULL
  );

  -- Every track PlayPilot added. If you remove one by hand, it is never re-added.
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

let db;

export function getDb() {
  if (db) return db;
  mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
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

export function upsertTrack(d, track) {
  d.prepare(`
    INSERT INTO tracks (id, name, artist_ids, artist_names, duration_ms) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, artist_ids = excluded.artist_ids,
      artist_names = excluded.artist_names, duration_ms = excluded.duration_ms
  `).run(
    track.id,
    track.name,
    JSON.stringify(track.artists.map((a) => a.id)),
    JSON.stringify(track.artists.map((a) => a.name)),
    track.duration_ms ?? null,
  );
  for (const artist of track.artists) {
    d.prepare('INSERT OR IGNORE INTO artists (id, name) VALUES (?, ?)').run(artist.id, artist.name);
  }
}

export function loadTracks() {
  const tracks = new Map();
  for (const row of getDb().prepare('SELECT * FROM tracks').all()) {
    tracks.set(row.id, {
      id: row.id,
      name: row.name,
      artistIds: JSON.parse(row.artist_ids || '[]'),
      artistNames: JSON.parse(row.artist_names || '[]'),
    });
  }
  return tracks;
}

export function loadPlays() {
  return getDb()
    .prepare('SELECT track_id, played_at FROM plays ORDER BY played_at')
    .all()
    .map((row) => ({ trackId: row.track_id, playedAt: Date.parse(row.played_at) }));
}

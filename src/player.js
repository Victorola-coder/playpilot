import { get, isMusicTrack } from './spotify.js';

/**
 * What's playing on your Spotify right now, or null when nothing is.
 * Podcasts and local files come back as null too, since PlaylistPilot only tracks songs.
 */
export async function getNowPlaying() {
  const playing = await get('/me/player/currently-playing');
  const track = playing?.item;
  if (!isMusicTrack(track)) return null;
  return {
    track,
    isPlaying: Boolean(playing.is_playing),
    progressMs: playing.progress_ms ?? 0,
    durationMs: track.duration_ms ?? 0,
  };
}

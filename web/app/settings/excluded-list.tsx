'use client';

import { useTransition } from 'react';
import type { ExcludedSong } from '@/lib/playpilot';
import { allowAction } from '../actions';
import { Cover, timeAgo } from '../ui';

export function ExcludedList({ songs }: { songs: ExcludedSong[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <section className="card">
      <div className="card-head">
        <h2>Never add</h2>
        <span className="muted small">
          {songs.length} song{songs.length === 1 ? '' : 's'}
        </span>
      </div>
      {songs.length === 0 ? (
        <p className="muted small">
          Songs you mark with &ldquo;Never add&rdquo; on the dashboard show up here. PlaylistPilot won&rsquo;t add them
          anywhere, however often you play them.
        </p>
      ) : (
        <ul className="excluded">
          {songs.map((song) => (
            <li key={song.id}>
              <Cover id={song.id} name={song.name} imageUrl={song.imageUrl} size={36} />
              <div className="song-info">
                <span className="song-name">{song.name}</span>
                <span className="muted small truncate">
                  {song.artists} · excluded {timeAgo(song.excludedAt).toLowerCase()}
                </span>
              </div>
              <button
                className="page-button"
                disabled={pending}
                onClick={() => startTransition(async () => void (await allowAction(song.id)))}
              >
                Allow again
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

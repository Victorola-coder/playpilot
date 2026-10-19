'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NowPlaying as NowPlayingData } from '@/lib/playpilot';
import { Cover, Icon, trackUrl } from './ui';

const POLL_MS = 15_000;

const clock = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export function NowPlaying() {
  const [data, setData] = useState<NowPlayingData | null>(null);
  // Where the song was when we last asked Spotify, so the bar can move between polls.
  const [fetchedAt, setFetchedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/now-playing', { cache: 'no-store' });
      setData(await res.json());
      setFetchedAt(Date.now());
    } catch {
      // Network blip: keep showing the last known state until the next poll.
    }
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(poll);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const playing = data?.status === 'playing' && data.isPlaying;
  useEffect(() => {
    if (!playing) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [playing]);

  const progress =
    data?.status === 'playing'
      ? Math.min(data.durationMs, data.progressMs + (data.isPlaying ? now - fetchedAt : 0))
      : 0;

  // Check again as soon as the song should have ended, instead of waiting for the next poll.
  const ended = data?.status === 'playing' && data.isPlaying && data.durationMs > 0 && progress >= data.durationMs;
  useEffect(() => {
    if (ended) refresh();
  }, [ended, refresh]);

  if (!data) {
    return <section className="card now-playing loading" aria-busy="true" />;
  }
  if (data.status === 'disconnected') return null;

  if (data.status === 'needs-permission') {
    return (
      <section className="card now-playing compact">
        <span className="now-icon">
          <Icon name="play" size={16} />
        </span>
        <p className="now-text">Reconnect Spotify once so PlayPilot can show what you&rsquo;re playing right now.</p>
        <a className="button primary small-button" href="/api/auth/login">
          Reconnect
        </a>
      </section>
    );
  }

  if (data.status === 'idle' || data.status === 'error') {
    return (
      <section className="card now-playing compact">
        <span className="now-icon">
          <Icon name={data.status === 'error' ? 'alert' : 'play'} size={16} />
        </span>
        <p className="now-text muted">
          {data.status === 'error' ? `Couldn’t check what’s playing: ${data.message}` : 'Nothing playing on Spotify right now.'}
        </p>
      </section>
    );
  }

  const { song, isPlaying, durationMs, plays, bestStreak } = data;
  const percent = durationMs ? (progress / durationMs) * 100 : 0;

  return (
    <section className="card now-playing">
      <Cover id={song.id} name={song.name} imageUrl={song.imageUrl} size={84} />
      <div className="now-main">
        <span className={isPlaying ? 'now-label' : 'now-label paused'}>
          {isPlaying ? (
            <span className="eq" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          ) : null}
          {isPlaying ? 'Now playing' : 'Paused'}
        </span>
        <a href={trackUrl(song.id)} target="_blank" rel="noreferrer" className="now-title">
          {song.name}
        </a>
        <span className="muted truncate">{song.artists}</span>
        <div className="now-progress">
          <span className="small muted">{clock(progress)}</span>
          <span className="bar">
            <span style={{ width: `${percent}%` }} />
          </span>
          <span className="small muted">{clock(durationMs)}</span>
        </div>
      </div>
      <div className="now-stats">
        {plays > 0 ? (
          <>
            <div>
              <span className="stat-value">{plays}</span>
              <span className="muted small">play{plays === 1 ? '' : 's'} recorded</span>
            </div>
            {bestStreak >= 2 && (
              <span className="badge">
                <Icon name="repeat" size={12} /> best {bestStreak}× in a row
              </span>
            )}
          </>
        ) : (
          <span className="muted small">New to PlayPilot. It&rsquo;ll be counted on the next sync.</span>
        )}
      </div>
    </section>
  );
}

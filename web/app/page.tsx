import { getOverview, getPlaylists, getRules, getTopSongs, isLoggedIn } from '@/lib/playpilot';
import Link from 'next/link';
import { ActionsPanel } from './actions-panel';
import { NowPlaying } from './now-playing';
import { Topbar } from './topbar';
import { Cover, Icon, timeAgo, trackUrl, type IconName } from './ui';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string; page?: string }> }) {
  const { error, page } = await searchParams;
  const loggedIn = isLoggedIn();
  const overview = getOverview();
  const { rules, error: rulesError } = getRules();
  const { songs, total, page: currentPage, pages, maxPlays } = getTopSongs(Number(page) || 1);
  const playlists = getPlaylists();

  return (
    <>
      <Topbar current="dashboard" />

      <main className="page">
        {error && (
          <div className="alert" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
            <a href="/" className="alert-close">
              Dismiss
            </a>
          </div>
        )}

        <section className="hero">
          <h1>Your repeats, saved automatically.</h1>
          <p className="lead">
            PlayPilot keeps an eye on what you play on Spotify. Songs you keep coming back to go into playlists, so you
            never lose one because you forgot to save it.
          </p>
        </section>

        {loggedIn && <NowPlaying />}

        {!loggedIn && (
          <section className="card onboarding">
            <h2>Get started</h2>
            <ol className="steps">
              <Step n={1} title="Connect Spotify" text="So PlayPilot can see your recent plays and manage its playlists." />
              <Step n={2} title="Sync your plays" text="Spotify only shares your last 50, so keep PlayPilot running to build up history." />
              <Step n={3} title="Preview, then apply" text="See exactly which songs each rule would add before anything changes." />
            </ol>
            <a className="button primary" href="/api/auth/login">
              <Icon name="logo" size={16} /> Connect Spotify
            </a>
          </section>
        )}

        <section className="stats">
          <Stat icon="play" label="Plays recorded" value={overview.plays.toLocaleString()} />
          <Stat icon="list" label="Different songs" value={overview.songs.toLocaleString()} />
          <Stat icon="bolt" label="Songs auto-saved" value={overview.autoAdded.toLocaleString()} accent />
          <Stat icon="clock" label="Latest play" value={timeAgo(overview.latestPlay)} />
        </section>

        <ActionsPanel disabled={!loggedIn} />

        <div className="columns">
          <div className="stack">
            <section className="card">
              <div className="card-head">
                <h2>Your rules</h2>
                <Link href="/settings" className="text-link small">
                  Edit rules
                </Link>
              </div>
              {rulesError ? (
                <p className="alert">{rulesError}</p>
              ) : (
                <ul className="rules">
                  {rules.map((rule) => (
                    <li key={rule.name} className="rule">
                      <span className={`rule-icon rule-${rule.icon}`}>
                        <Icon name={rule.icon} size={18} />
                      </span>
                      <div className="rule-body">
                        <strong>{rule.playlist}</strong>
                        <p className="muted small">{rule.description}</p>
                        <div className="chips">
                          {rule.chips.map((chip) => (
                            <span key={chip} className="chip">
                              {chip}
                            </span>
                          ))}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Your PlayPilot playlists</h2>
              </div>
              {playlists.length === 0 ? (
                <p className="muted small">They&rsquo;ll show up here after you apply your rules for the first time.</p>
              ) : (
                <ul className="playlists">
                  {playlists.map((p) => (
                    <li key={p.id}>
                      <a href={p.url} target="_blank" rel="noreferrer" className="playlist-link">
                        <span className="playlist-name">{p.name}</span>
                        <span className="muted small">
                          {p.songsAdded} added <Icon name="external" size={13} />
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="card" id="most-played">
            <div className="card-head">
              <h2>Most played</h2>
              <span className="muted small">
                {total.toLocaleString()} song{total === 1 ? '' : 's'}, all time
              </span>
            </div>
            {songs.length === 0 ? (
              <div className="empty">
                <Icon name="play" size={28} />
                <p>No plays yet.</p>
                <p className="muted small">Connect Spotify and press Sync plays to start counting.</p>
              </div>
            ) : (
              <ol className="songs">
                {songs.map((song) => (
                  <li key={song.id} className="song-row">
                    <span className="rank">{song.rank}</span>
                    <Cover id={song.id} name={song.name} imageUrl={song.imageUrl} />
                    <div className="song-info">
                      <a href={trackUrl(song.id)} target="_blank" rel="noreferrer" className="song-name">
                        {song.name}
                      </a>
                      <span className="muted small truncate">{song.artists}</span>
                    </div>
                    <div className="song-meta">
                      {song.bestStreak >= 3 && (
                        <span className="badge" title={`Played ${song.bestStreak} times in a row`}>
                          <Icon name="repeat" size={12} /> {song.bestStreak}×
                        </span>
                      )}
                      <div className="plays" title={`${song.last30Days} plays in the last 30 days`}>
                        <span className="plays-count">{song.plays}</span>
                        <span className="bar">
                          <span style={{ width: `${(song.plays / maxPlays) * 100}%` }} />
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {pages > 1 && <Pagination page={currentPage} pages={pages} />}
          </section>
        </div>
      </main>
    </>
  );
}

function Stat({ icon, label, value, accent }: { icon: IconName; label: string; value: string; accent?: boolean }) {
  return (
    <div className={accent ? 'stat stat-accent' : 'stat'}>
      <span className="stat-icon">
        <Icon name={icon} size={16} />
      </span>
      <span className="stat-value">{value}</span>
      <span className="muted small">{label}</span>
    </div>
  );
}

function Step({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <li className="step">
      <span className="step-n">{n}</span>
      <div>
        <strong>{title}</strong>
        <p className="muted small">{text}</p>
      </div>
    </li>
  );
}

function Pagination({ page, pages }: { page: number; pages: number }) {
  // scroll={false} keeps you at the list instead of jumping to the top.
  const href = (p: number) => (p === 1 ? '/' : `/?page=${p}`);
  return (
    <nav className="pagination" aria-label="Most played pages">
      {page > 1 ? (
        <Link href={href(page - 1)} className="page-button" scroll={false}>
          Previous
        </Link>
      ) : (
        <span className="page-button disabled">Previous</span>
      )}
      <span className="muted small">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className="page-button" scroll={false}>
          Next
        </Link>
      ) : (
        <span className="page-button disabled">Next</span>
      )}
    </nav>
  );
}

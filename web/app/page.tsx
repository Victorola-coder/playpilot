import { getOverview, getRules, getTopSongs, isLoggedIn } from '@/lib/playpilot';
import { logoutAction } from './actions';
import { ActionsPanel } from './actions-panel';

export const dynamic = 'force-dynamic';

function formatTime(iso: string | null) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const loggedIn = isLoggedIn();
  const overview = getOverview();
  const { rules, error: rulesError } = getRules();
  const songs = getTopSongs();

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1>PlayPilot</h1>
          <p className="muted">Saves the songs you keep replaying, so you don&rsquo;t have to.</p>
        </div>
        {loggedIn ? (
          <form action={logoutAction} className="account">
            <span className="badge">Connected to Spotify</span>
            <button className="link-button" type="submit">Disconnect</button>
          </form>
        ) : (
          <a className="button primary" href="/api/auth/login">Connect Spotify</a>
        )}
      </header>

      {error && <p className="alert">{error}</p>}

      <section className="overview">
        <Stat label="Plays recorded" value={overview.plays.toLocaleString()} />
        <Stat label="Different songs" value={overview.songs.toLocaleString()} />
        <Stat label="Songs auto-saved" value={overview.autoAdded.toLocaleString()} />
        <Stat label="Latest play" value={formatTime(overview.latestPlay)} small />
      </section>

      <ActionsPanel disabled={!loggedIn} />

      <div className="columns">
        <section className="card">
          <h2>Your rules</h2>
          <p className="muted small">Edit these in <code>rules.json</code>.</p>
          {rulesError ? (
            <p className="alert">{rulesError}</p>
          ) : (
            <ul className="rules">
              {rules.map((rule) => (
                <li key={rule.name}>
                  <strong>{rule.playlist}</strong>
                  <span>{rule.description}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Most played</h2>
          {songs.length === 0 ? (
            <p className="muted">No plays yet. Connect Spotify and press <em>Sync plays</em>.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Song</th>
                    <th className="num">Plays</th>
                    <th className="num" title="Most plays back to back">In a row</th>
                    <th className="num">30 days</th>
                  </tr>
                </thead>
                <tbody>
                  {songs.map((song) => (
                    <tr key={song.id}>
                      <td>
                        <div className="song">{song.name}</div>
                        <div className="muted small">{song.artists}</div>
                      </td>
                      <td className="num">{song.plays}</td>
                      <td className="num">{song.bestStreak}</td>
                      <td className="num">{song.last30Days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="stat">
      <span className="muted small">{label}</span>
      <span className={small ? 'stat-value small-value' : 'stat-value'}>{value}</span>
    </div>
  );
}

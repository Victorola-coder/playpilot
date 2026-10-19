import Link from 'next/link';
import { isLoggedIn } from '@/lib/playpilot';
import { logoutAction } from './actions';
import { Icon } from './ui';

export function Topbar({ current }: { current: 'dashboard' | 'settings' }) {
  const loggedIn = isLoggedIn();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-left">
          <Link href="/" className="brand">
            <span className="logo">
              <Icon name="logo" size={18} />
            </span>
            PlaylistPilot
          </Link>
          <nav className="nav">
            <Link href="/" className={current === 'dashboard' ? 'nav-link active' : 'nav-link'}>
              Dashboard
            </Link>
            <Link href="/settings" className={current === 'settings' ? 'nav-link active' : 'nav-link'}>
              Settings
            </Link>
          </nav>
        </div>
        {loggedIn ? (
          <form action={logoutAction} className="account">
            <span className="pill">
              <span className="dot" /> Connected to Spotify
            </span>
            <button className="link-button" type="submit">
              Disconnect
            </button>
          </form>
        ) : (
          <a className="button primary small-button" href="/api/auth/login">
            Connect Spotify
          </a>
        )}
      </div>
    </header>
  );
}

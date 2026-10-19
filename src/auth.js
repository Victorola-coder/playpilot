import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { config, requireClientId } from './config.js';
import { kvGet, kvSet } from './db.js';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SCOPES = [
  'user-read-recently-played',
  'user-read-currently-playing',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
];

const base64url = (buf) => buf.toString('base64url');

async function requestToken(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: requireClientId(), ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Spotify token request failed (${res.status}): ${body.error_description || body.error || 'unknown error'}`);
  }
  const previous = kvGet('auth') || {};
  const auth = {
    accessToken: body.access_token,
    // Spotify may or may not rotate the refresh token; keep the old one if not.
    refreshToken: body.refresh_token || previous.refreshToken,
    expiresAt: Date.now() + body.expires_in * 1000,
    // Space-separated permissions the user actually granted; kept across refreshes.
    scope: body.scope ?? previous.scope ?? '',
  };
  kvSet('auth', auth);
  return auth;
}

export async function getAccessToken() {
  const auth = kvGet('auth');
  if (!auth?.refreshToken) {
    throw new Error('Not logged in. Run `npm run login` first.');
  }
  if (auth.expiresAt - Date.now() > 60_000) return auth.accessToken;
  const refreshed = await requestToken({ grant_type: 'refresh_token', refresh_token: auth.refreshToken });
  return refreshed.accessToken;
}

export const isLoggedIn = () => Boolean(kvGet('auth')?.refreshToken);

/** False when the account was connected before PlaylistPilot asked for this permission. */
export const hasScope = (scope) => (kvGet('auth')?.scope ?? '').split(' ').includes(scope);

/** Builds the Spotify consent URL. Keep `verifier` and `state` until the callback. */
export function startLogin(redirectUri = config.redirectUri) {
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));

  const url = new URL('https://accounts.spotify.com/authorize');
  url.search = new URLSearchParams({
    client_id: requireClientId(),
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  return { url: url.toString(), verifier, state };
}

export function finishLogin({ code, verifier, redirectUri = config.redirectUri }) {
  return requestToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
}

/** Runs the Authorization Code + PKCE flow through a one-shot local web server. */
export function login() {
  const redirect = new URL(config.redirectUri);
  const { url: authorizeUrl, verifier, state } = startLogin();

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, config.redirectUri);
      if (url.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      const finish = (status, message, err) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>PlaylistPilot</title>
          <body style="font-family:system-ui;padding:3rem;max-width:32rem;margin:auto">
          <h1>PlaylistPilot</h1><p>${message}</p></body>`);
        server.close();
        err ? reject(err) : resolve();
      };

      if (url.searchParams.get('state') !== state) {
        return finish(400, 'Login failed: state mismatch. Run the login command again.', new Error('State mismatch'));
      }
      const error = url.searchParams.get('error');
      if (error) return finish(400, `Login was cancelled (${error}).`, new Error(`Spotify returned: ${error}`));

      try {
        await finishLogin({ code: url.searchParams.get('code'), verifier });
        finish(200, 'You are logged in. You can close this tab and go back to the terminal.');
      } catch (err) {
        finish(500, 'Login failed. Check the terminal for details.', err);
      }
    });

    server.on('error', reject);
    server.listen(Number(redirect.port) || 80, redirect.hostname, () => {
      console.log('Opening Spotify in your browser. If it does not open, visit:\n');
      console.log(`  ${authorizeUrl}\n`);
      if (process.platform === 'darwin') execFile('open', [authorizeUrl.toString()], () => {});
    });
  });
}

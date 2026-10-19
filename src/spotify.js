import { getAccessToken } from './auth.js';

const API = 'https://api.spotify.com/v1';
const MAX_ATTEMPTS = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildUrl(pathOrUrl, query) {
  const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : API + pathOrUrl);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  return url;
}

export async function request(method, pathOrUrl, { query, body } = {}) {
  const url = buildUrl(pathOrUrl, query);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body && JSON.stringify(body),
    });

    if (res.ok) return res.status === 204 ? null : res.json();

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      await sleep(retryAfter ? retryAfter * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    const detail = await res.json().catch(() => null);
    throw new Error(`Spotify ${method} ${url.pathname} failed (${res.status}): ${detail?.error?.message || res.statusText}`);
  }
}

export const get = (path, query) => request('GET', path, { query });
export const post = (path, body) => request('POST', path, { body });

/** Yields every item across Spotify's paged responses. */
export async function* paginate(path, query) {
  let next = buildUrl(path, query).toString();
  while (next) {
    const page = await get(next);
    yield* page.items;
    next = page.next;
  }
}

// Spotify renamed playlist "tracks" to "items" in Feb 2026; accept both shapes.
export const entryTrack = (entry) => entry?.item ?? entry?.track ?? null;

export function isMusicTrack(track) {
  return track && track.type === 'track' && !track.is_local && track.id;
}

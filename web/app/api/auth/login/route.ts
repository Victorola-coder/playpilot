import type { NextRequest } from 'next/server';
import { LOGIN_COOKIE, redirectTo, requestOrigin, startLogin } from '@/lib/playpilot';

export function GET(request: NextRequest) {
  const origin = requestOrigin(request.headers);
  const redirectUri = new URL('/api/auth/callback', origin).toString();
  try {
    const { url, verifier, state } = startLogin(redirectUri);
    const response = redirectTo(url);
    response.cookies.set(LOGIN_COOKIE, JSON.stringify({ verifier, state }), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 600,
    });
    return response;
  } catch (err) {
    const home = new URL('/', origin);
    home.searchParams.set('error', (err as Error).message);
    return redirectTo(home);
  }
}

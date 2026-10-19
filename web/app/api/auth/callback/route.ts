import type { NextRequest } from 'next/server';
import { LOGIN_COOKIE, redirectTo, finishLogin, requestOrigin } from '@/lib/playpilot';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = requestOrigin(request.headers);
  const home = new URL('/', origin);
  const saved = request.cookies.get(LOGIN_COOKIE)?.value;
  const pending = saved ? (JSON.parse(saved) as { verifier: string; state: string }) : null;

  let error: string | null = searchParams.get('error');
  if (!error && (!pending || pending.state !== searchParams.get('state'))) {
    error = 'Login expired or did not match. Please try again.';
  }
  if (!error) {
    try {
      await finishLogin({
        code: searchParams.get('code'),
        verifier: pending!.verifier,
        redirectUri: new URL('/api/auth/callback', origin).toString(),
      });
    } catch (err) {
      error = (err as Error).message;
    }
  }

  if (error) home.searchParams.set('error', error);
  const response = redirectTo(home);
  response.cookies.delete({ name: LOGIN_COOKIE, path: '/api/auth' });
  return response;
}

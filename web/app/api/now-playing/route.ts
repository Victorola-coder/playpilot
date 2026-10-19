import { getNowPlayingInfo } from '@/lib/playpilot';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await getNowPlayingInfo(), { headers: { 'Cache-Control': 'no-store' } });
}

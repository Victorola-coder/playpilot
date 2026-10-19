// Runs once when the Next.js server starts: keep measuring listens and applying
// rules in the background, so the web app works without a separate `npm start`.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.PLAYLISTPILOT_BACKGROUND === 'off') return;
  const { startBackground } = await import('../src/background.js');
  startBackground();
}

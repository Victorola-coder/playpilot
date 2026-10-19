import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The web app bundles this file, which breaks import.meta.url, so it passes the root in.
export const ROOT = process.env.PLAYPILOT_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const config = {
  clientId: process.env.SPOTIFY_CLIENT_ID?.trim(),
  redirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback',
  dbPath: path.resolve(ROOT, process.env.PLAYPILOT_DB || 'data/playpilot.db'),
  rulesPath: path.resolve(ROOT, process.env.PLAYPILOT_RULES || 'rules.json'),
  syncMinutes: Number(process.env.SYNC_MINUTES || 15),
  applyMinutes: Number(process.env.APPLY_MINUTES || 60),
};

export function requireClientId() {
  if (!config.clientId) {
    throw new Error(
      'SPOTIFY_CLIENT_ID is not set. Copy .env.example to .env and paste your app\'s Client ID.',
    );
  }
  return config.clientId;
}

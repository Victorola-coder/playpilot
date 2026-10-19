import path from 'node:path';
import type { NextConfig } from 'next';

// The PlayPilot engine (../src) lives one level up and shares its .env, rules.json and database.
const root = path.resolve(process.cwd(), '..');

const nextConfig: NextConfig = {
  env: { PLAYPILOT_ROOT: root },
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default nextConfig;

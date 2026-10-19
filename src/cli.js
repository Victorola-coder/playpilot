#!/usr/bin/env node
import { config } from './config.js';
import { login } from './auth.js';
import { importHistory, syncRecentPlays } from './sync.js';
import { applyRules } from './apply.js';
import { computeTrackStats, playsWithinDays } from './stats.js';
import { loadPlays, loadTracks } from './db.js';
import { startBackground } from './background.js';

const HELP = `PlaylistPilot - auto-save the songs you keep replaying

Usage: node src/cli.js <command>

  login              Connect your Spotify account
  sync               Record your latest plays (Spotify only keeps the last 50)
  import <path>      Load your Spotify "Extended streaming history" export
  apply [--dry-run]  Run rules.json and add matching songs to playlists
  stats              Show your most-played songs
  run                Keep running: measure listens, sync every ${config.syncMinutes} min, apply every ${config.applyMinutes} min
`;

const stamp = () => new Date().toLocaleTimeString();

async function sync() {
  const { added, possibleGap } = await syncRecentPlays();
  console.log(`[${stamp()}] Recorded ${added} new play${added === 1 ? '' : 's'}.`);
  if (possibleGap) console.log('  Note: got a full page of 50, so some older plays may have been missed. Sync more often.');
}

function showStats() {
  const tracks = loadTracks();
  const stats = [...computeTrackStats(loadPlays()).values()].sort((a, b) => b.plays - a.plays).slice(0, 25);
  if (stats.length === 0) return console.log('No plays recorded yet.');
  console.log('Plays  Streak  30 days  Song');
  for (const s of stats) {
    const t = tracks.get(s.trackId);
    const label = t ? `${t.name} - ${t.artistNames.join(', ')}` : s.trackId;
    console.log(`${String(s.plays).padStart(5)}  ${String(s.bestStreak).padStart(6)}  ${String(playsWithinDays(s, 30)).padStart(7)}  ${label}`);
  }
}

function runForever() {
  console.log('PlaylistPilot is running. It measures what you play and applies your rules. Press Ctrl+C to stop.');
  startBackground({ log: (line) => console.log(`[${stamp()}] ${line}`) });
}

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case 'login':
      await login();
      console.log('Logged in. Next: `npm run sync`.');
      break;
    case 'sync':
      await sync();
      break;
    case 'import': {
      if (!args[0]) throw new Error('Give the path to your export folder, e.g. `node src/cli.js import ~/Downloads/Spotify`');
      const { files, imported, skipped } = importHistory(args[0]);
      console.log(`Imported ${imported} plays from ${files} file(s). Skipped ${skipped} (short plays, podcasts, or duplicates).`);
      break;
    }
    case 'apply':
      await applyRules({ dryRun: args.includes('--dry-run') });
      break;
    case 'stats':
      showStats();
      break;
    case 'run':
      runForever();
      break;
    default:
      console.log(HELP);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
}

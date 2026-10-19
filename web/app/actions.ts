'use server';

import { revalidatePath } from 'next/cache';
import {
  allowTrack,
  applyRules,
  excludeTrack,
  getSongs,
  logout,
  removeFromCollection,
  saveRawRules,
  syncRecentPlays,
  type Song,
} from '@/lib/playpilot';
import type { RawFile } from '@/lib/rules-draft';

// How many songs to show per playlist in the results; the rest are counted.
const SONGS_PER_GROUP = 6;

export type ResultGroup = { playlist: string; rule: string; total: number; songs: Song[] };

export type ActionResult = {
  ok: boolean;
  kind: 'sync' | 'preview' | 'apply';
  message: string;
  groups: ResultGroup[];
};

type Summary = { rule: string; playlist: string; added: string[] }[];

async function run(kind: ActionResult['kind'], fn: () => Promise<Omit<ActionResult, 'ok' | 'kind'>>): Promise<ActionResult> {
  try {
    return { ok: true, kind, ...(await fn()) };
  } catch (err) {
    return { ok: false, kind, message: (err as Error).message, groups: [] };
  } finally {
    revalidatePath('/');
  }
}

function toGroups(summary: Summary): ResultGroup[] {
  return summary
    .filter((r) => r.added.length > 0)
    .map((r) => ({
      playlist: r.playlist,
      rule: r.rule,
      total: r.added.length,
      songs: getSongs(r.added.slice(0, SONGS_PER_GROUP)),
    }));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const quiet = () => {};

export async function syncAction() {
  return run('sync', async () => {
    const { added, possibleGap } = await syncRecentPlays();
    let message = added ? `Recorded ${plural(added, 'new play')}.` : 'No new plays since the last sync.';
    if (possibleGap) message += ' Some older plays may have been missed, so sync more often.';
    return { message, groups: [] };
  });
}

export async function previewAction() {
  return run('preview', async () => {
    const groups = toGroups((await applyRules({ dryRun: true, log: quiet })) as Summary);
    const songs = groups.reduce((n, g) => n + g.total, 0);
    return {
      message: songs
        ? `${plural(songs, 'song')} would be added to ${plural(groups.length, 'playlist')}. Nothing has changed yet.`
        : 'No songs match your rules right now.',
      groups,
    };
  });
}

export async function applyAction() {
  return run('apply', async () => {
    const groups = toGroups((await applyRules({ log: quiet })) as Summary);
    const songs = groups.reduce((n, g) => n + g.total, 0);
    return {
      message: songs ? `Added ${plural(songs, 'song')} to ${plural(groups.length, 'playlist')}.` : 'Everything is already up to date.',
      groups,
    };
  });
}

export async function saveRulesAction(raw: RawFile): Promise<{ ok: boolean; message: string }> {
  try {
    saveRawRules(raw);
    revalidatePath('/');
    revalidatePath('/settings');
    return { ok: true, message: 'Saved. PlaylistPilot will use these from now on.' };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

type SongResult = { ok: boolean; message: string };

async function songAction(fn: () => Promise<string>): Promise<SongResult> {
  try {
    return { ok: true, message: await fn() };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  } finally {
    revalidatePath('/');
    revalidatePath('/settings');
  }
}

/** Never add this song automatically again. */
export async function excludeAction(trackId: string) {
  return songAction(async () => {
    excludeTrack(trackId);
    return 'This song won\u2019t be added automatically again.';
  });
}

export async function allowAction(trackId: string) {
  return songAction(async () => {
    allowTrack(trackId);
    return 'This song can be added automatically again.';
  });
}

/** Take a song back out of everywhere PlaylistPilot put it. */
export async function removeAction(trackId: string) {
  return songAction(async () => {
    const places = await removeFromCollection(trackId);
    return places ? `Removed from ${plural(places, 'place')} PlaylistPilot added it.` : 'PlaylistPilot hadn\u2019t added this song anywhere.';
  });
}

export async function logoutAction() {
  logout();
  revalidatePath('/');
}

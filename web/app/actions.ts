'use server';

import { revalidatePath } from 'next/cache';
import { applyRules, logout, syncRecentPlays } from '@/lib/playpilot';

export type ActionResult = { ok: boolean; lines: string[] };

async function run(fn: (log: (line: string) => void) => Promise<void>): Promise<ActionResult> {
  const lines: string[] = [];
  try {
    await fn((line) => lines.push(line));
    return { ok: true, lines };
  } catch (err) {
    return { ok: false, lines: [...lines, (err as Error).message] };
  } finally {
    revalidatePath('/');
  }
}

export async function syncAction() {
  return run(async (log) => {
    const { added, possibleGap } = await syncRecentPlays();
    log(`Recorded ${added} new play${added === 1 ? '' : 's'}.`);
    if (possibleGap) log('Got a full page of 50 plays, so some older ones may have been missed.');
  });
}

export async function previewAction() {
  return run(async (log) => {
    await applyRules({ dryRun: true, log });
  });
}

export async function applyAction() {
  return run(async (log) => {
    await applyRules({ log });
  });
}

export async function logoutAction() {
  logout();
  revalidatePath('/');
}

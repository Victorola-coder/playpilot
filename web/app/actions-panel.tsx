'use client';

import { useState, useTransition } from 'react';
import { applyAction, previewAction, syncAction, type ActionResult } from './actions';

const ACTIONS = [
  { label: 'Sync plays', run: syncAction, hint: 'Record your latest plays from Spotify' },
  { label: 'Preview', run: previewAction, hint: 'See what your rules would add, without changing anything' },
  { label: 'Apply rules', run: applyAction, hint: 'Add matching songs to your playlists', primary: true },
];

export function ActionsPanel({ disabled }: { disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <section className="card">
      <div className="actions">
        {ACTIONS.map((action) => (
          <button
            key={action.label}
            className={action.primary ? 'button primary' : 'button'}
            title={action.hint}
            disabled={disabled || pending}
            onClick={() => {
              setRunning(action.label);
              startTransition(async () => setResult(await action.run()));
            }}
          >
            {pending && running === action.label ? 'Working…' : action.label}
          </button>
        ))}
      </div>
      {disabled && <p className="muted small">Connect Spotify to use these.</p>}
      {result && (
        <pre className={result.ok ? 'output' : 'output error'}>
          {result.lines.join('\n') || 'Done.'}
        </pre>
      )}
    </section>
  );
}

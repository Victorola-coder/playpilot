'use client';

import { useState, useTransition } from 'react';
import { applyAction, previewAction, syncAction, type ActionResult } from './actions';
import { Cover, Icon, trackUrl, type IconName } from './ui';

type Action = {
  kind: ActionResult['kind'];
  label: string;
  hint: string;
  icon: IconName;
  run: () => Promise<ActionResult>;
  primary?: boolean;
};

const ACTIONS: Action[] = [
  { kind: 'sync', label: 'Sync plays', hint: 'Record your latest plays', icon: 'sync', run: syncAction },
  { kind: 'preview', label: 'Preview', hint: 'See what would be added', icon: 'eye', run: previewAction },
  { kind: 'apply', label: 'Apply rules', hint: 'Add songs to playlists', icon: 'check', run: applyAction, primary: true },
];

export function ActionsPanel({ disabled }: { disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<Action['kind'] | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <section className="card">
      <div className="actions">
        {ACTIONS.map((action) => {
          const busy = pending && running === action.kind;
          return (
            <button
              key={action.kind}
              className={action.primary ? 'action action-primary' : 'action'}
              disabled={disabled || pending}
              onClick={() => {
                setRunning(action.kind);
                startTransition(async () => setResult(await action.run()));
              }}
            >
              <span className="action-icon">
                <Icon name={action.icon} size={18} className={busy ? 'spin' : undefined} />
              </span>
              <span className="action-text">
                <strong>{busy ? 'Working…' : action.label}</strong>
                <span className="small">{action.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {disabled && <p className="muted small">Connect Spotify to use these.</p>}

      {result && (
        <div className="result" aria-live="polite">
          <p className={result.ok ? 'result-message' : 'result-message error'}>
            <Icon name={result.ok ? 'check' : 'alert'} size={16} />
            {result.message}
          </p>
          {result.groups.length > 0 && (
            <div className="result-groups">
              {result.groups.map((group) => (
                <div key={group.playlist} className="result-group">
                  <div className="result-group-head">
                    <strong>{group.playlist}</strong>
                    <span className="muted small">
                      {result.kind === 'preview' ? '+' : ''}
                      {group.total} song{group.total === 1 ? '' : 's'}
                    </span>
                  </div>
                  <ul>
                    {group.songs.map((song) => (
                      <li key={song.id}>
                        <Cover id={song.id} name={song.name} imageUrl={song.imageUrl} size={32} />
                        <div className="song-info">
                          <a href={trackUrl(song.id)} target="_blank" rel="noreferrer" className="song-name">
                            {song.name}
                          </a>
                          <span className="muted small truncate">{song.artists}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {group.total > group.songs.length && (
                    <p className="muted small">and {group.total - group.songs.length} more</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

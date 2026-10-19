'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { allowAction, excludeAction, removeAction } from './actions';
import { Icon } from './ui';

/** The ⋯ menu on a song: take it back out, or stop PlaylistPilot adding it. */
export function SongMenu({ trackId, name, excluded, added }: { trackId: string; name: string; excluded: boolean; added: boolean }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message]);

  const run = (action: (id: string) => Promise<{ ok: boolean; message: string }>) =>
    startTransition(async () => {
      const result = await action(trackId);
      setMessage({ ok: result.ok, text: result.message });
      setOpen(false);
    });

  return (
    <div className="song-menu" ref={ref}>
      <button
        className="icon-button"
        aria-label={`Options for ${name}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
      >
        <Icon name="more" size={18} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {added && (
            <button
              role="menuitem"
              onClick={() => {
                if (confirm(`Take "${name}" out of every playlist PlaylistPilot added it to?`)) run(removeAction);
              }}
            >
              <Icon name="minus" size={15} /> Remove from my collection
            </button>
          )}
          {excluded ? (
            <button role="menuitem" onClick={() => run(allowAction)}>
              <Icon name="check" size={15} /> Allow adding again
            </button>
          ) : (
            <button role="menuitem" onClick={() => run(excludeAction)}>
              <Icon name="ban" size={15} /> Never add this song
            </button>
          )}
        </div>
      )}
      {message && <span className={message.ok ? 'toast' : 'toast error'}>{message.text}</span>}
    </div>
  );
}

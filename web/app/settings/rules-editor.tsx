'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { saveRulesAction } from '../actions';
import { Icon } from '../ui';
import {
  emptyCondition,
  fromDrafts,
  newRuleDraft,
  toDrafts,
  type ConditionDraft,
  type RawRule,
  type RuleDraft,
} from '@/lib/rules-draft';

export function RulesEditor({ initialRules, isExample }: { initialRules: RawRule[]; isExample: boolean }) {
  const [drafts, setDrafts] = useState(() => toDrafts(initialRules));
  const [savedRules, setSavedRules] = useState(initialRules);
  const [baseline, setBaseline] = useState(() => (isExample ? null : JSON.stringify(fromDrafts(toDrafts(initialRules)))));
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, startSaving] = useTransition();

  const serialized = useMemo(() => JSON.stringify(fromDrafts(drafts)), [drafts]);
  const dirty = serialized !== baseline;

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (key: string, patch: Partial<RuleDraft>) => {
    setDrafts((all) => all.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    setStatus(null);
  };

  const save = () =>
    startSaving(async () => {
      const result = await saveRulesAction(fromDrafts(drafts));
      setStatus(result);
      if (result.ok) {
        setBaseline(serialized);
        setSavedRules(fromDrafts(drafts).rules);
      }
    });

  // Let a success message fade out; keep errors until the next edit.
  useEffect(() => {
    if (!status?.ok) return;
    const timer = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(timer);
  }, [status]);

  const discard = () => {
    setDrafts(toDrafts(savedRules));
    setStatus(null);
  };

  return (
    <div className="editor">
      {isExample && baseline === null && (
        <p className="notice">
          You don&rsquo;t have a <code>rules.json</code> yet, so these are the example rules. Save to start using them.
        </p>
      )}

      <div className="card-head">
        <h2>Rules</h2>
        <span className="muted small">
          {drafts.filter((d) => d.enabled).length} of {drafts.length} on
        </span>
      </div>

      {drafts.length === 0 && (
        <div className="card empty">
          <p>No rules yet.</p>
          <p className="muted small">Add one to start saving songs automatically.</p>
        </div>
      )}

      {drafts.map((draft) => (
        <RuleCard
          key={draft.key}
          draft={draft}
          onChange={(patch) => update(draft.key, patch)}
          onDelete={() => {
            if (confirm(`Delete "${draft.name || 'this rule'}"? Its playlist stays in Spotify.`)) {
              setDrafts((all) => all.filter((d) => d.key !== draft.key));
              setStatus(null);
            }
          }}
        />
      ))}

      <button className="add-rule" onClick={() => setDrafts((all) => [...all, newRuleDraft(all)])}>
        + Add a rule
      </button>

      <div className={dirty || status ? 'savebar visible' : 'savebar'} aria-live="polite">
        <div className="savebar-inner">
          <span className={status && !status.ok ? 'savebar-text error' : 'savebar-text'}>
            {status ? (
              <>
                <Icon name={status.ok ? 'check' : 'alert'} size={16} /> {status.message}
              </>
            ) : (
              'You have unsaved changes.'
            )}
          </span>
          {dirty && (
            <div className="savebar-buttons">
              {baseline !== null && (
                <button className="button" onClick={discard} disabled={saving}>
                  Discard
                </button>
              )}
              <button className="button primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RuleCard({
  draft,
  onChange,
  onDelete,
}: {
  draft: RuleDraft;
  onChange: (patch: Partial<RuleDraft>) => void;
  onDelete: () => void;
}) {
  const setCondition = (index: number, patch: Partial<ConditionDraft>) =>
    onChange({ conditions: draft.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) });

  return (
    <section className={draft.enabled ? 'card rule-card' : 'card rule-card off'}>
      <div className="rule-card-head">
        <label className="switch" title={draft.enabled ? 'Rule is on' : 'Rule is off'}>
          <input type="checkbox" checked={draft.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          <span className="switch-track" />
          <span className="sr-only">Rule on</span>
        </label>
        <input
          className="rule-name-input"
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Rule name"
          aria-label="Rule name"
        />
        <button className="link-button danger" onClick={onDelete}>
          Delete
        </button>
      </div>

      <Field label="Playlist name" hint={draft.groupBy ? `Use {group} where the ${draft.groupBy} name should go.` : 'Renaming creates a new playlist next time rules are applied.'}>
        <input value={draft.playlist} onChange={(e) => onChange({ playlist: e.target.value })} />
      </Field>

      <div className="field">
        <span className="field-label">Save songs that</span>
        <div className="conditions">
          {draft.conditions.map((condition, i) => (
            <div key={i} className="condition-wrap">
              {i > 0 && <span className="or">or</span>}
              <div className="condition">
                <div className="condition-grid">
                  <NumberField
                    label="Played at least"
                    suffix="times"
                    value={condition.minPlays}
                    onChange={(minPlays) => setCondition(i, { minPlays })}
                  />
                  <NumberField
                    label="Within the last"
                    suffix="days"
                    placeholder="All time"
                    value={condition.withinDays}
                    disabled={!condition.minPlays}
                    onChange={(withinDays) => setCondition(i, { withinDays })}
                  />
                  <NumberField
                    label="In a row at least"
                    suffix="times"
                    value={condition.minStreak}
                    onChange={(minStreak) => setCondition(i, { minStreak })}
                  />
                </div>
                <div className="condition-grid two">
                  <Field label="By artists" hint="Comma-separated. Leave blank for any artist.">
                    <input
                      value={condition.artists}
                      placeholder="Burna Boy, Tems"
                      onChange={(e) => setCondition(i, { artists: e.target.value })}
                    />
                  </Field>
                  <Field label="In genres" hint="Partial matches count: “afro” matches “afrobeats”.">
                    <input
                      value={condition.genres}
                      placeholder="afrobeats, alte"
                      onChange={(e) => setCondition(i, { genres: e.target.value })}
                    />
                  </Field>
                </div>
                {draft.conditions.length > 1 && (
                  <button
                    className="link-button"
                    onClick={() => onChange({ conditions: draft.conditions.filter((_, j) => j !== i) })}
                  >
                    Remove this condition
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            className="link-button add-condition"
            onClick={() => onChange({ conditions: [...draft.conditions, emptyCondition()] })}
          >
            + Add another way to match (or)
          </button>
        </div>
      </div>

      <div className="options">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.onlyUnsaved}
            onChange={(e) => onChange({ onlyUnsaved: e.target.checked })}
          />
          Skip songs already in Liked Songs or my playlists
        </label>

        <div className="condition-grid">
          <Field label="Split into playlists by">
            <select
              value={draft.groupBy}
              onChange={(e) => {
                const groupBy = e.target.value as RuleDraft['groupBy'];
                const playlist =
                  groupBy && !draft.playlist.includes('{group}') ? `${draft.playlist} · {group}` : draft.playlist;
                onChange({ groupBy, playlist });
              }}
            >
              <option value="">Don&rsquo;t split</option>
              <option value="genre">Genre</option>
              <option value="artist">Artist</option>
            </select>
          </Field>
          {draft.groupBy && (
            <NumberField
              label="Smallest playlist"
              suffix="songs"
              placeholder="1"
              value={draft.minGroupSize}
              onChange={(minGroupSize) => onChange({ minGroupSize })}
            />
          )}
          <NumberField
            label="Keep at most"
            suffix="songs"
            placeholder="No limit"
            value={draft.maxTracks}
            onChange={(maxTracks) => onChange({ maxTracks })}
          />
        </div>
      </div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

function NumberField({
  label,
  suffix,
  value,
  onChange,
  placeholder = '–',
  disabled,
}: {
  label: string;
  suffix: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="number-input">
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="muted small">{suffix}</span>
      </span>
    </label>
  );
}

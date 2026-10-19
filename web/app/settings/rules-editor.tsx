'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { saveRulesAction } from '../actions';
import { Icon } from '../ui';
import {
  emptyCondition,
  fromDrafts,
  newRuleDraft,
  toDrafts,
  toSettingsDraft,
  type ConditionDraft,
  type RawRule,
  type RawSettings,
  type RuleDraft,
  type SettingsDraft,
} from '@/lib/rules-draft';

type Props = {
  initialRules: RawRule[];
  initialSettings: RawSettings;
  isExample: boolean;
  unmeasured: { total: number; unmeasured: number };
};

export function RulesEditor({ initialRules, initialSettings, isExample, unmeasured }: Props) {
  const [drafts, setDrafts] = useState(() => toDrafts(initialRules));
  const [settings, setSettings] = useState(() => toSettingsDraft(initialSettings));
  const [saved, setSaved] = useState({ rules: initialRules, settings: initialSettings });
  const [baseline, setBaseline] = useState(() =>
    isExample ? null : JSON.stringify(fromDrafts(toDrafts(initialRules), toSettingsDraft(initialSettings))),
  );
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, startSaving] = useTransition();

  const serialized = useMemo(() => JSON.stringify(fromDrafts(drafts, settings)), [drafts, settings]);
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
  const updateSettings = (patch: Partial<SettingsDraft>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setStatus(null);
  };

  const save = () =>
    startSaving(async () => {
      const file = fromDrafts(drafts, settings);
      const result = await saveRulesAction(file);
      setStatus(result);
      if (result.ok) {
        setBaseline(serialized);
        setSaved({ rules: file.rules, settings: file.settings ?? {} });
      }
    });

  // Let a success message fade out; keep errors until the next edit.
  useEffect(() => {
    if (!status?.ok) return;
    const timer = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(timer);
  }, [status]);

  const discard = () => {
    setDrafts(toDrafts(saved.rules));
    setSettings(toSettingsDraft(saved.settings));
    setStatus(null);
  };

  return (
    <div className="editor">
      {isExample && baseline === null && (
        <p className="notice">
          You don&rsquo;t have a <code>rules.json</code> yet, so these are the example rules. Save to start using them.
        </p>
      )}

      <ListeningSettings settings={settings} onChange={updateSettings} unmeasured={unmeasured} />

      <div className="card-head section-head">
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

function ListeningSettings({
  settings,
  onChange,
  unmeasured,
}: {
  settings: SettingsDraft;
  onChange: (patch: Partial<SettingsDraft>) => void;
  unmeasured: Props['unmeasured'];
}) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Listening</h2>
      </div>
      <p className="muted small">
        PlaylistPilot watches what&rsquo;s playing while it&rsquo;s running and measures how much of each song you hear.
        These settings apply to every rule.
      </p>

      <div className="condition-grid two">
        <NumberField
          label="New session after"
          suffix="minutes apart"
          value={settings.sessionGapMinutes}
          placeholder="60"
          hint="Listens of the same song closer together than this are one session."
          onChange={(sessionGapMinutes) => onChange({ sessionGapMinutes })}
        />
        <Field
          label="Plays PlaylistPilot couldn’t measure"
          hint={
            unmeasured.total
              ? `${unmeasured.unmeasured} of your ${unmeasured.total} plays weren’t measured (for example, you played on your phone while PlaylistPilot was off). This only matters for rules with a minimum % listened.`
              : 'For example, songs you played on your phone while PlaylistPilot was off. This only matters for rules with a minimum % listened.'
          }
        >
          <select
            value={settings.unmeasuredPlays}
            onChange={(e) => onChange({ unmeasuredPlays: e.target.value as SettingsDraft['unmeasuredPlays'] })}
          >
            <option value="ignore">Don&rsquo;t count them</option>
            <option value="count">Count them as full listens</option>
          </select>
        </Field>
      </div>

      <label className="checkbox">
        <input type="checkbox" checked={settings.autoApply} onChange={(e) => onChange({ autoApply: e.target.checked })} />
        Add songs automatically as soon as they qualify (checked every hour)
      </label>
    </section>
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
  const liked = draft.saveTo === 'liked';

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

      <div className="condition-grid destination">
        <Field label="Save songs to">
          <select
            value={draft.saveTo}
            onChange={(e) => {
              const saveTo = e.target.value as RuleDraft['saveTo'];
              onChange(saveTo === 'liked' ? { saveTo, groupBy: '' } : { saveTo });
            }}
          >
            <option value="playlist">A PlaylistPilot playlist</option>
            <option value="liked">Liked Songs</option>
          </select>
        </Field>
        {!liked && (
          <Field
            label="Playlist name"
            hint={
              draft.groupBy
                ? `Use {group} where the ${draft.groupBy} name should go.`
                : 'Renaming creates a new playlist next time rules are applied.'
            }
          >
            <input value={draft.playlist} onChange={(e) => onChange({ playlist: e.target.value })} />
          </Field>
        )}
      </div>

      <div className="field">
        <span className="field-label">Save songs that</span>
        <div className="conditions">
          {draft.conditions.map((condition, i) => {
            const counts = Boolean(condition.minPlays.trim() || condition.minSessions.trim());
            return (
              <div key={i} className="condition-wrap">
                {i > 0 && <span className="or">or</span>}
                <div className="condition">
                  <span className="condition-group-label">How much you listened</span>
                  <div className="condition-grid">
                    <NumberField
                      label="Listened at least"
                      suffix="times"
                      value={condition.minPlays}
                      onChange={(minPlays) => setCondition(i, { minPlays })}
                    />
                    <NumberField
                      label="Each time hearing"
                      suffix="% or more"
                      placeholder="Any"
                      value={condition.minCompletion}
                      disabled={!counts}
                      max={100}
                      onChange={(minCompletion) => setCondition(i, { minCompletion })}
                    />
                    <NumberField
                      label="Within the last"
                      suffix="days"
                      placeholder="All time"
                      value={condition.withinDays}
                      disabled={!counts}
                      onChange={(withinDays) => setCondition(i, { withinDays })}
                    />
                  </div>

                  <span className="condition-group-label">Spread over time</span>
                  <div className="condition-grid">
                    <NumberField
                      label="Across at least"
                      suffix="sessions"
                      placeholder="Any"
                      value={condition.minSessions}
                      hint="Stops one long sitting from counting as a favourite."
                      onChange={(minSessions) => setCondition(i, { minSessions })}
                    />
                    <NumberField
                      label="Count at most"
                      suffix="per session"
                      placeholder="No limit"
                      value={condition.maxPerSession}
                      disabled={!counts}
                      hint="Plays beyond this in one sitting are ignored."
                      onChange={(maxPerSession) => setCondition(i, { maxPerSession })}
                    />
                    <NumberField
                      label="In a row at least"
                      suffix="times"
                      placeholder="Any"
                      value={condition.minStreak}
                      onChange={(minStreak) => setCondition(i, { minStreak })}
                    />
                  </div>

                  <span className="condition-group-label">Which songs</span>
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
            );
          })}
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
          {!liked && (
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
          )}
          {draft.groupBy && !liked && (
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
  hint,
  max,
}: {
  label: string;
  suffix: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
  max?: number;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="number-input">
        <input
          type="number"
          min={1}
          max={max}
          step={1}
          inputMode="numeric"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="muted small">{suffix}</span>
      </span>
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

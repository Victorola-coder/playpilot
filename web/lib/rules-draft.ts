// Converts between rules.json and the shape the settings form edits.
// Form fields are strings so half-typed values ("12", "Burna Boy, ") survive re-renders.

export type RawCondition = {
  minPlays?: number;
  withinDays?: number;
  minCompletion?: number;
  minSessions?: number;
  maxPerSession?: number;
  minStreak?: number;
  artists?: string[];
  genres?: string[];
};

export type RawRule = {
  name: string;
  playlist?: string;
  saveTo?: 'playlist' | 'liked';
  enabled?: boolean;
  match: RawCondition | RawCondition[];
  onlyUnsaved?: boolean;
  groupBy?: 'genre' | 'artist';
  minGroupSize?: number;
  maxTracks?: number;
};

export type RawSettings = {
  sessionGapMinutes?: number;
  unmeasuredPlays?: 'ignore' | 'count';
  autoApply?: boolean;
};

export type RawFile = { settings?: RawSettings; rules: RawRule[] };

export type ConditionDraft = {
  minPlays: string;
  withinDays: string;
  minCompletion: string;
  minSessions: string;
  maxPerSession: string;
  minStreak: string;
  artists: string;
  genres: string;
};

export type SettingsDraft = { sessionGapMinutes: string; unmeasuredPlays: 'ignore' | 'count'; autoApply: boolean };

export type RuleDraft = {
  key: string;
  name: string;
  playlist: string;
  saveTo: 'playlist' | 'liked';
  enabled: boolean;
  conditions: ConditionDraft[];
  onlyUnsaved: boolean;
  groupBy: '' | 'genre' | 'artist';
  minGroupSize: string;
  maxTracks: string;
};

let nextKey = 0;
const newKey = () => `rule-${Date.now()}-${nextKey++}`;

const str = (n: number | undefined) => (n === undefined ? '' : String(n));

export const emptyCondition = (): ConditionDraft => ({
  minPlays: '',
  withinDays: '',
  minCompletion: '',
  minSessions: '',
  maxPerSession: '',
  minStreak: '',
  artists: '',
  genres: '',
});

// Mirrors DEFAULT_SETTINGS in src/rules.js.
export function toSettingsDraft(raw: RawSettings = {}): SettingsDraft {
  return {
    sessionGapMinutes: str(raw.sessionGapMinutes ?? 60),
    unmeasuredPlays: raw.unmeasuredPlays ?? 'ignore',
    autoApply: raw.autoApply ?? true,
  };
}

export function newRuleDraft(existing: RuleDraft[]): RuleDraft {
  let n = existing.length + 1;
  while (existing.some((r) => r.name === `Rule ${n}`)) n++;
  return {
    key: newKey(),
    name: `Rule ${n}`,
    playlist: `PlaylistPilot · Rule ${n}`,
    saveTo: 'playlist',
    enabled: true,
    conditions: [{ ...emptyCondition(), minPlays: '7', minCompletion: '80', minSessions: '2' }],
    onlyUnsaved: true,
    groupBy: '',
    minGroupSize: '',
    maxTracks: '',
  };
}

export function toDrafts(rules: RawRule[]): RuleDraft[] {
  return rules.map((rule) => ({
    key: newKey(),
    name: rule.name ?? '',
    playlist: rule.playlist ?? '',
    saveTo: rule.saveTo ?? 'playlist',
    enabled: rule.enabled !== false,
    conditions: (Array.isArray(rule.match) ? rule.match : [rule.match ?? {}]).map((c) => ({
      minPlays: str(c.minPlays),
      withinDays: str(c.withinDays),
      minCompletion: str(c.minCompletion),
      minSessions: str(c.minSessions),
      maxPerSession: str(c.maxPerSession),
      minStreak: str(c.minStreak),
      artists: (c.artists ?? []).join(', '),
      genres: (c.genres ?? []).join(', '),
    })),
    onlyUnsaved: rule.onlyUnsaved ?? true,
    groupBy: rule.groupBy ?? '',
    minGroupSize: str(rule.minGroupSize),
    maxTracks: str(rule.maxTracks),
  }));
}

/** Blank numbers are left out. Anything that isn't a whole number is kept as-is so validation can name it. */
function num(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return Number(trimmed);
}

const list = (value: string) => {
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
};

export function fromDrafts(drafts: RuleDraft[], settings: SettingsDraft): RawFile {
  return {
    settings: {
      sessionGapMinutes: num(settings.sessionGapMinutes) ?? 60,
      unmeasuredPlays: settings.unmeasuredPlays,
      autoApply: settings.autoApply,
    },
    rules: drafts.map((d) => {
      const conditions = d.conditions.map((c) => {
        // These only mean something alongside a listen count or a session count.
        const counts = Boolean(c.minPlays.trim() || c.minSessions.trim());
        const out: RawCondition = {
          minPlays: num(c.minPlays),
          withinDays: counts ? num(c.withinDays) : undefined,
          minCompletion: counts ? num(c.minCompletion) : undefined,
          minSessions: num(c.minSessions),
          maxPerSession: counts ? num(c.maxPerSession) : undefined,
          minStreak: num(c.minStreak),
          artists: list(c.artists),
          genres: list(c.genres),
        };
        return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as RawCondition;
      });
      const liked = d.saveTo === 'liked';
      const rule: RawRule = {
        name: d.name.trim(),
        ...(liked ? { saveTo: 'liked' as const } : { playlist: d.playlist.trim() }),
        match: conditions.length === 1 ? conditions[0] : conditions,
        onlyUnsaved: d.onlyUnsaved,
      };
      if (!d.enabled) rule.enabled = false;
      if (d.groupBy && !liked) {
        rule.groupBy = d.groupBy;
        const minGroupSize = num(d.minGroupSize);
        if (minGroupSize !== undefined) rule.minGroupSize = minGroupSize;
      }
      const maxTracks = num(d.maxTracks);
      if (maxTracks !== undefined) rule.maxTracks = maxTracks;
      return rule;
    }),
  };
}

// Pure tmux-session-naming logic, split out of extension.ts so `node --test`
// can exercise it without importing `vscode`. These functions touch no VS Code
// or child-process API — they are pure transformations over strings and the
// plain `TmuxSession` shape — so the collision behavior below can be tested
// directly (Node 24 strips the types when the JS test suite requires this file).

export interface TmuxSession {
  name: string;
  windows: number;
  attached: boolean;
}

/** Minimal profile shape `profileSuffix` reads; `TmuxProfile` satisfies it. */
export interface ProfileSuffixInput {
  label: string;
  sessionSuffix?: string;
}

/**
 * Separator between a base session name and any suffix (numeric extra, or a
 * profile slug). Doubled on purpose: `sanitizeSessionName` collapses every run
 * of `-` to a single one, so a base name can never contain `--`. That keeps
 * `<base>--<suffix>` unambiguous — the workspace folder `foo` and its extras
 * (`foo--2`, `foo--claude`) can't be confused with the unrelated workspace
 * `foo-bar` (whose base is `foo-bar`, not `foo--bar`), and `foo`'s second
 * session `foo--2` no longer collides with the base of a workspace named
 * `foo-2`. tmux accepts `--` in a session name (it only rewrites `:` and `.`).
 */
export const SESSION_SEPARATOR = '--';

/**
 * Base session name used when a workspace folder's name sanitizes to nothing
 * (all-non-ASCII or all-symbol names, e.g. a Japanese folder like
 * `プロジェクト`). Kept distinct from `profileSuffix`'s `'profile'` fallback:
 * a base and a profile slug carry different meanings, so they don't share a
 * default. Without this the empty base propagated as `undefined` through
 * `currentBaseName` and every caller `if (!baseName)`-returned, so no tmux
 * session was ever created for such a folder (Issue #11 regression).
 */
export const DEFAULT_BASE_NAME = 'session';

/**
 * Derive a non-empty tmux base name from a workspace folder name. Sanitizes,
 * then falls back to `DEFAULT_BASE_NAME` when nothing usable remains so callers
 * can always attach. The caller decides "no workspace folder at all" (→
 * undefined) before reaching here; this only turns a present-but-empty
 * sanitization into a usable base.
 */
export function sessionBaseName(folderName: string): string {
  return sanitizeSessionName(folderName) || DEFAULT_BASE_NAME;
}

/**
 * Fold an arbitrary name into a tmux-safe base: non-`[A-Za-z0-9_-]` becomes
 * `-`, then every run of `-` collapses to one and leading/trailing `-` are
 * dropped. The collapse is what guarantees the result never contains `--`, so
 * it can't be mistaken for the `SESSION_SEPARATOR`.
 */
export function sanitizeSessionName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Whether a session name belongs to `baseName`: the base itself, or anything
 * under its `<base>--…` namespace. The `--` boundary is why `foo-bar` and
 * `foo-2` are *not* related to `foo` while `foo` and `foo--2` are. Exposed for
 * the background bell poller (#20), which filters bare session names straight
 * from `list-windows` without building `TmuxSession` objects.
 */
export function isRelatedSession(baseName: string, name: string): boolean {
  return name === baseName || name.startsWith(`${baseName}${SESSION_SEPARATOR}`);
}

/**
 * Sessions belonging to `baseName`: the base itself, plus anything under its
 * `<base>--…` namespace. The `--` boundary is why `relatedSessions('foo', …)`
 * excludes `foo-bar` and `foo-bar--2` while still matching `foo` and `foo--2`.
 */
export function relatedSessions(baseName: string, sessions: TmuxSession[]): TmuxSession[] {
  return sessions
    .filter((s) => isRelatedSession(baseName, s.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/**
 * `<base>`, then `<base>--2`, `<base>--3`… A profile narrows this to its own
 * namespace (`<base>--claude`, `<base>--claude--2`), so profile sessions never
 * consume the plain numbering and stay recognizable in the list.
 */
export function nextSessionName(baseName: string, sessions: TmuxSession[], suffix?: string): string {
  const taken = new Set(sessions.map((s) => s.name));
  const prefix = suffix ? `${baseName}${SESSION_SEPARATOR}${suffix}` : baseName;
  if (!taken.has(prefix)) {
    return prefix;
  }
  let n = 2;
  while (taken.has(`${prefix}${SESSION_SEPARATOR}${n}`)) {
    n += 1;
  }
  return `${prefix}${SESSION_SEPARATOR}${n}`;
}

/**
 * Session-name suffix for a profile: explicit `sessionSuffix`, else a slug of
 * the label. `sanitizeSessionName` already collapses runs and trims, so the
 * slug can never introduce a stray `--`.
 */
export function profileSuffix(profile: ProfileSuffixInput): string {
  const explicit = profile.sessionSuffix?.trim();
  const slug = sanitizeSessionName(explicit || profile.label).toLowerCase();
  return slug || 'profile';
}

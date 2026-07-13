// Pure statusline-bridge logic, split out of extension.ts so `node --test` can
// exercise it without importing the VS Code API or touching the filesystem. The
// bridge is the opt-in path from design #39: a user's Claude Code statusline
// script writes an excerpt JSON keyed by tmux session name into the cache dir,
// and `notifyBell` reads it on a bell to append the session's context%/cost to
// the toast. Everything here is a pure transformation over plain values — path
// and safe-name derivation, mtime freshness, JSON parsing, and detail
// composition — so the FS-touching wrapper in extension.ts stays thin and the
// four acceptance cases (context+cost / cost-only / stale / parse-failure) are
// testable directly (Node 24 strips the types when the JS test suite requires
// this file, exactly like session-name.ts and bell-notify.ts).

/**
 * How recent the bridge file must be for its data to be used, in ms. A bell
 * usually rings right after a Claude Code turn, when the statusline was just
 * refreshed, so a 30s window captures the fresh case while data left stale by
 * an idle session degrades safely back to the plain toast. Mirrors design #39.
 */
export const STATUS_FRESHNESS_MS = 30_000;

/**
 * Bell-reason sound (Issue #47). When Claude Code's Stop and Notification hooks
 * both fire for the same turn (Notification also rings on completion), their two
 * reason files can land within a few ms of each other. `BELL_COFIRE_MS` is the
 * window inside which a co-firing stop+ask is treated as one completion event
 * and resolved to `'stop'` (see `resolveBellReason`), so a completion never
 * mis-plays the ask preset. Only when the two are farther apart than this does
 * the newer mtime decide — a genuinely separate ask that arrived on its own.
 */
export const BELL_COFIRE_MS = 3_000;

/**
 * How long `notifyBell` waits, once at least one reason file is already fresh,
 * before re-reading them and picking the preset. The hooks write the reason file
 * *before* emitting the BEL, but the co-firing sibling (Stop vs Notification) may
 * still be in flight, so a short settle lets both land before we choose. Kept
 * tiny so the notification is not perceptibly delayed; a bell with no fresh
 * reason file (a user without the hooks) skips the wait entirely.
 */
export const BELL_SETTLE_MS = 250;

/** The two bell reasons a hook can write. */
export type BellReason = 'stop' | 'ask';

/**
 * The l10n source keys for the appended detail. These are *both* the English
 * text and the lookup keys (source-keyed l10n — see CLAUDE.md), so the ja bundle
 * `l10n/bundle.l10n.ja.json` carries the exact same strings. Split in two so the
 * context=null branch (cost only) is expressible without an empty context slot.
 */
export const DETAIL_CONTEXT_COST = ' (context {0}%, cost ${1})';
export const DETAIL_COST_ONLY = ' (cost ${0})';

/**
 * The l10n source keys for the bell toast message, one per bell state (Issue
 * #64, design #64 论点 C1). Source-keyed like the detail constants (the English
 * text *is* the lookup key — see CLAUDE.md), so `l10n/bundle.l10n.ja.json`
 * carries the exact same three strings. `TOAST_DEFAULT` is the hook-less path
 * (no fresh reason file) and stays the pre-#64 neutral wording; a fresh reason
 * splits into the stop (completion) and ask (waiting-for-input) wordings.
 */
export const TOAST_DEFAULT = 'Session "{0}" needs attention.';
export const TOAST_STOP = 'Session "{0}" has finished.';
export const TOAST_ASK = 'Session "{0}" is waiting for your input.';

/**
 * Pick the toast message key from the resolved bell state (Issue #64). Three
 * states, matching the sound path's structure:
 *   - `anyFresh` false        -> `TOAST_DEFAULT` (no reason file: a user without
 *                                the bell-reason hook keeps the old neutral toast)
 *   - fresh `reason === 'ask'` -> `TOAST_ASK` (waiting for input)
 *   - fresh, anything else     -> `TOAST_STOP` (completion; unknown reasons fall
 *                                back here, mirroring `selectPreset`)
 * Pure so it can be unit-tested; the FS reads and `vscode.l10n.t` lookup stay in
 * extension.ts.
 */
export function selectToastMessageKey(
  anyFresh: boolean,
  reason: BellReason | string,
): string {
  if (!anyFresh) {
    return TOAST_DEFAULT;
  }
  return reason === 'ask' ? TOAST_ASK : TOAST_STOP;
}

/** `(message, ...args) => string`, matching `vscode.l10n.t`'s shape. */
export type Translate = (message: string, ...args: (string | number)[]) => string;

/**
 * Substitutes `{0}`, `{1}`… positionally — the English/default path when no
 * `vscode.l10n.t` is injected (tests, and the untranslated locale). Uses a
 * replacer function so a `$` inside an argument is never treated as a special
 * replacement pattern.
 */
function defaultTranslate(message: string, ...args: (string | number)[]): string {
  return message.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ''));
}

/**
 * Normalize a tmux session name into the bridge file's `<safe>` segment. This
 * regex is a binding contract with the reference statusline script's
 * `tr -c 'A-Za-z0-9_-' '_'` — both sides must agree so writer and reader land on
 * the same file (design #39 decision table).
 */
export function safeSessionName(sessionName: string): string {
  return sessionName.replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * The `tmux-opener` cache dir: `${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener`.
 * Shared by every bridge file (statusline and bell-reason) so writer and reader
 * derive the directory one way. Pure over an injected env map and home dir so it
 * needs no `process`/`os` at test time.
 */
function cacheDir(env: { XDG_CACHE_HOME?: string }, home: string): string {
  const xdg = env.XDG_CACHE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : `${home}/.cache`;
  return `${base}/tmux-opener`;
}

/**
 * Build the statusline bridge file path:
 * `${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener/status-<safe>.json`. Pure over an
 * injected env map and home dir so it needs no `process`/`os` at test time.
 */
export function statusFilePath(
  sessionName: string,
  env: { XDG_CACHE_HOME?: string },
  home: string,
): string {
  return `${cacheDir(env, home)}/status-${safeSessionName(sessionName)}.json`;
}

/**
 * Build the bell-reason bridge file path (Issue #47):
 * `${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener/bell-<safe>.<reason>.json`. Stop
 * and Notification hooks write separate files (`.stop.json` / `.ask.json`) so a
 * co-firing pair never overwrites the other; the reader picks between them via
 * `resolveBellReason`. Shares `cacheDir`/`safeSessionName` with `statusFilePath`
 * so the reference script and the reader agree on the path.
 */
export function bellReasonFilePath(
  sessionName: string,
  reason: BellReason,
  env: { XDG_CACHE_HOME?: string },
  home: string,
): string {
  return `${cacheDir(env, home)}/bell-${safeSessionName(sessionName)}.${reason}.json`;
}

/**
 * Decide which reason a bell represents from the two reason files' mtimes
 * (`undefined` = file absent). Pure; the FS stats live in extension.ts. Rules
 * (design #45 / Issue #47):
 *   ① neither fresh              -> 'stop' (safe fallback)
 *   ② exactly one fresh          -> that reason
 *   ③ both fresh, |Δmtime| ≤ cofire -> 'stop' (a co-firing completion; stop wins)
 *   ④ both fresh, |Δmtime| > cofire -> the reason with the newer mtime
 */
export function resolveBellReason({
  stopMtime,
  askMtime,
  now,
  freshnessMs = STATUS_FRESHNESS_MS,
  cofireMs = BELL_COFIRE_MS,
}: {
  stopMtime: number | undefined;
  askMtime: number | undefined;
  now: number;
  freshnessMs?: number;
  cofireMs?: number;
}): BellReason {
  const stopFresh = typeof stopMtime === 'number' && isFresh(stopMtime, now, freshnessMs);
  const askFresh = typeof askMtime === 'number' && isFresh(askMtime, now, freshnessMs);
  if (!stopFresh && !askFresh) {
    return 'stop';
  }
  if (stopFresh && !askFresh) {
    return 'stop';
  }
  if (askFresh && !stopFresh) {
    return 'ask';
  }
  // Both fresh: stop and ask are guaranteed numbers here.
  if (Math.abs((stopMtime as number) - (askMtime as number)) <= cofireMs) {
    return 'stop';
  }
  return (stopMtime as number) >= (askMtime as number) ? 'stop' : 'ask';
}

/**
 * Map a resolved reason to a sound preset id. `'ask'` uses the ask preset
 * (`tmuxOpener.notifySoundPresetOnAsk`); everything else — `'stop'` and any
 * unknown value — uses the stop preset (`tmuxOpener.notifySoundPreset`), so the
 * default/completion path is unchanged for users without the hooks.
 */
export function selectPreset(
  reason: BellReason | string,
  stopPreset: string,
  askPreset: string,
): string {
  return reason === 'ask' ? askPreset : stopPreset;
}

/** True when the file's mtime is within the freshness window at `now`. */
export function isFresh(
  mtimeMs: number,
  now: number,
  freshnessMs: number = STATUS_FRESHNESS_MS,
): boolean {
  return now - mtimeMs <= freshnessMs;
}

/** True for a real, finite JS number (rejects NaN/Infinity and non-numbers). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Compose the toast detail suffix from already-parsed bridge data, or
 * `undefined` to fall back to the plain toast. `cost_usd` must be a finite
 * number (it's the minimum the detail needs); `context_used_percentage` is
 * optional (null/absent drops to the cost-only key). Rounds context to an
 * integer and formats cost to two decimals, matching the reference script.
 */
export function composeDetail(
  data: unknown,
  translate: Translate = defaultTranslate,
): string | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  const cost = record.cost_usd;
  if (!isFiniteNumber(cost)) {
    return undefined;
  }
  const costStr = cost.toFixed(2);
  const ctx = record.context_used_percentage;
  if (isFiniteNumber(ctx)) {
    return translate(DETAIL_CONTEXT_COST, Math.round(ctx), costStr);
  }
  return translate(DETAIL_COST_ONLY, costStr);
}

/**
 * End-to-end pure step: given the raw file content, its mtime, and `now`,
 * return the detail suffix or `undefined`. Folds together the freshness gate,
 * the parse (a malformed/partial read throws and is swallowed as `undefined`),
 * and detail composition. The FS reads themselves live in extension.ts.
 */
export function detailFromBridge(
  rawContent: string,
  mtimeMs: number,
  now: number,
  translate: Translate = defaultTranslate,
  freshnessMs: number = STATUS_FRESHNESS_MS,
): string | undefined {
  if (!isFresh(mtimeMs, now, freshnessMs)) {
    return undefined;
  }
  let data: unknown;
  try {
    data = JSON.parse(rawContent);
  } catch {
    return undefined;
  }
  return composeDetail(data, translate);
}

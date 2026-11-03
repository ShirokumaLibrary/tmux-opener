/**
 * The tmux options the view sets on the server it attaches to, and the pure
 * decision of which of them still need setting. `vscode`-free so `node --test`
 * drives it directly.
 *
 * Why this is not "set once and raise a flag": the first attach to a machine
 * with no tmux server runs `pty.spawn('tmux new-session …')` and the
 * `set-option` calls right after it, before that client has brought the server
 * up. Those calls fail with `error connecting to <socket>` (or `no server
 * running on <socket>`), and a flag raised before the call meant they were
 * never tried again. An option is therefore only done once tmux accepted it; a
 * failure because no server is reachable yet stays pending and is retried; a
 * failure for any other reason (tmux rejecting the option, e.g. an old tmux
 * without `allow-passthrough`) is final, so it is not retried forever.
 */

/** One `tmux set-option …` the view applies; `key` identifies it in the state. */
export interface TmuxOption {
  readonly key: string;
  readonly args: readonly string[];
}

export const TMUX_OPTIONS: readonly TmuxOption[] = [
  // Background bell detection (#16): a global window option, inherited by
  // windows created later.
  { key: 'monitor-bell', args: ['set-option', '-wg', 'monitor-bell', 'on'] },
  // An application's OSC 52 wrapped in DCS passthrough (`ESC P tmux; … ESC \`,
  // how a TUI that sees `TMUX` sends it) reaches this view's clipboard addon
  // only with this on. tmux forwards the payload without interpreting it, so
  // it never answers an OSC 52 read itself; `set-clipboard` is deliberately
  // left at the user's value.
  { key: 'allow-passthrough', args: ['set-option', '-wg', 'allow-passthrough', 'on'] },
];

/** Result of one attempt: accepted, no server yet (retry), or rejected (final). */
export type TmuxOptionOutcome = 'ok' | 'no-server' | 'rejected';

/** Classify a failed tmux invocation by its stderr. */
export function classifyTmuxFailure(stderr: string): Exclude<TmuxOptionOutcome, 'ok'> {
  return /error connecting to|no server running on/.test(stderr) ? 'no-server' : 'rejected';
}

/** Upper bound on attempts per option before a "no server" failure is final. */
export const TMUX_OPTION_MAX_ATTEMPTS = 10;
/** Delay between retries while no server is reachable. */
export const TMUX_OPTION_RETRY_MS = 200;

export interface TmuxOptionState {
  /** Keys still to try. */
  readonly pending: readonly string[];
  /** Attempts made so far, per key. */
  readonly attempts: Readonly<Record<string, number>>;
  /** Keys that will not be retried, with why. */
  readonly failed: Readonly<Record<string, 'rejected' | 'no-server'>>;
}

export function initialTmuxOptionState(options: readonly TmuxOption[] = TMUX_OPTIONS): TmuxOptionState {
  return { pending: options.map((o) => o.key), attempts: {}, failed: {} };
}

/**
 * State at the start of an attach. Always every option pending again: a server
 * can end between attaches (`exit-empty on` after the last session is killed)
 * and the next one starts with the options off, while `set-option` is
 * idempotent on a server that already has them.
 */
export function tmuxOptionStateForAttach(): TmuxOptionState {
  return initialTmuxOptionState();
}

/** Fold one round of outcomes (for the keys that were pending) into the state. */
export function nextTmuxOptionState(
  state: TmuxOptionState,
  outcomes: Readonly<Record<string, TmuxOptionOutcome>>,
  maxAttempts: number = TMUX_OPTION_MAX_ATTEMPTS,
): TmuxOptionState {
  const pending: string[] = [];
  const attempts: Record<string, number> = { ...state.attempts };
  const failed: Record<string, 'rejected' | 'no-server'> = { ...state.failed };
  for (const key of state.pending) {
    const outcome = outcomes[key];
    if (outcome === undefined) {
      pending.push(key);
      continue;
    }
    attempts[key] = (attempts[key] ?? 0) + 1;
    if (outcome === 'ok') {
      continue;
    }
    if (outcome === 'rejected' || attempts[key] >= maxAttempts) {
      failed[key] = outcome;
      continue;
    }
    pending.push(key);
  }
  return { pending, attempts, failed };
}

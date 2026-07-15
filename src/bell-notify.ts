// Pure bell-notification logic, split out of extension.ts so `node --test` can
// exercise it without importing the VS Code API. Two consumers rely on it (#16,
// adopted design A): the front-of-house xterm `onBell` (the one attached, live
// session) and the background poller that reads tmux's `window_bell_flag` for
// the detached sessions. Both funnel through the same per-session cooldown here;
// the poller additionally does 0->1 edge detection so a still-set flag doesn't
// re-notify every cycle. These functions touch no VS Code or child-process API —
// they are pure transformations over plain values and the `BellState` shape — so
// the edge/cooldown behavior can be tested directly (Node 24 strips the types
// when the JS test suite requires this file, exactly like session-name.ts).

/**
 * Shared, serializable state for both notification paths.
 *
 * - `active` is the set of sessions whose bell flag was set on the *previous*
 *   background poll — the memory the 0->1 edge detector compares against.
 *   `null` means "no poll has happened yet", so the first poll only seeds and
 *   never notifies (a flag already standing when the extension starts is not a
 *   fresh event). `shouldNotifySession` (the front path) leaves it untouched.
 * - `lastNotifiedAt` maps a session to the `now` at which it was last notified,
 *   feeding the cooldown for *both* paths — so a front `onBell` and a background
 *   edge for the same session throttle each other rather than double-firing.
 */
export interface BellState {
  active: string[] | null;
  lastNotifiedAt: Record<string, number>;
}

/** Default per-session cooldown (ms). Callers may override; see design #16. */
export const DEFAULT_COOLDOWN_MS = 5000;

/** A fresh, un-seeded state with no notification history. */
export function initialBellState(): BellState {
  return { active: null, lastNotifiedAt: {} };
}

/** Order-preserving de-duplication of a poll's session names. */
function unique(sessions: readonly string[]): string[] {
  return [...new Set(sessions)];
}

/**
 * Parse `tmux list-windows -a -F '#{session_name}\t#{window_bell_flag}'` output
 * into the session names with at least one window whose bell flag is set. One
 * line per window, so a session with several windows appears more than once —
 * the result de-duplicates it (order-preserving) so a multi-window session
 * notifies once. Only the literal `1` counts as set (`window_bell_flag` is 0/1),
 * so a stray value can't be read as a bell. Pure over the raw string so the
 * poller's parsing can be tested under `node --test` without tmux.
 */
export function parseBellingSessions(listWindowsOutput: string): string[] {
  const belling: string[] = [];
  for (const line of listWindowsOutput.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) {
      continue; // blank line or a malformed record with no flag column.
    }
    if (line.slice(tab + 1).trim() === '1') {
      belling.push(line.slice(0, tab));
    }
  }
  return unique(belling);
}

/** True when `session` is outside its cooldown window at time `now`. */
function cooledDown(
  lastNotifiedAt: Record<string, number>,
  session: string,
  now: number,
  cooldownMs: number,
): boolean {
  const last = lastNotifiedAt[session];
  return last === undefined || now - last >= cooldownMs;
}

/**
 * Background poller step: given the sessions whose bell flag is set this cycle,
 * return the ones to notify (a 0->1 edge that also clears its cooldown) and the
 * next state. The first call (or a `null`/`undefined` prior state) only seeds
 * `active` and notifies nothing. `lastNotifiedAt` is intentionally *not* pruned
 * when a session stops ringing, so the cooldown still spans a 1->0->1 gap.
 */
export function detectBellEdges(
  state: BellState | null | undefined,
  polled: readonly string[],
  now: number,
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
): { toNotify: string[]; nextState: BellState } {
  const prev = state ?? initialBellState();
  const active = unique(polled);

  // Not yet seeded: remember what is ringing, notify nothing.
  if (prev.active === null) {
    return { toNotify: [], nextState: { active, lastNotifiedAt: { ...prev.lastNotifiedAt } } };
  }

  const wasActive = new Set(prev.active);
  const lastNotifiedAt = { ...prev.lastNotifiedAt };
  const toNotify: string[] = [];

  for (const session of active) {
    if (wasActive.has(session)) {
      continue; // 1->1: sustained flag, not a fresh event.
    }
    // 0->1 edge — notify only if the cooldown has elapsed.
    if (cooledDown(lastNotifiedAt, session, now, cooldownMs)) {
      toNotify.push(session);
      lastNotifiedAt[session] = now;
    }
  }

  return { toNotify, nextState: { active, lastNotifiedAt } };
}

/**
 * Whether a bell that has cleared the cooldown gate will actually surface
 * anything — true iff at least one output channel (sound or toast) is enabled.
 * The per-session cooldown (`bellState.lastNotifiedAt`) must advance only when
 * this holds: a bell throttled to silence (both channels off, yet `notifyOnBell`
 * still on) must leave the state untouched, so it can't suppress a later,
 * audible bell via a "notification" that never surfaced. Pure over the two
 * toggles so the invariant is testable without the VS Code API.
 */
export function bellNotificationSurfaces(notifySound: boolean, notifyToast: boolean): boolean {
  return notifySound || notifyToast;
}

/**
 * Every verdict a bell can end on. Declared as a value (not just a type) so the
 * test suite can sweep it exhaustively and *stay* exhaustive: `SoundOutcome` is
 * derived from this array, so a new outcome cannot be added to the type without
 * appearing in the array the sweep iterates. Written the other way round — a
 * hand-kept array beside a hand-written union — the types vanish at runtime and
 * the sweep silently stops covering the new value.
 */
export const SOUND_OUTCOMES = [
  'played',
  'blocked',
  'unavailable',
  'resume-rejected',
  'unknown',
] as const;

/**
 * What the webview reported about one bell it was asked to play (#81, design
 * #78). The webview posts exactly one conclusive `soundResult` per `playSound`
 * id, so this is a positive statement, not an inference from timing:
 *
 * - `played` — it rang (the context was `running`, or its resume landed inside
 *   `RESUME_GRACE_MS`).
 * - `blocked` — the resume parked and never landed. This is the autoplay case a
 *   real gesture fixes, and the *only* one that earns an action.
 * - `unavailable` — no Web Audio at all. A click cannot conjure it.
 * - `resume-rejected` — the context is `closed` or `interrupted`. A click cannot
 *   fix `closed` (offering one would loop forever), and the platform itself
 *   un-interrupts the other; the next bell re-judges.
 * - `unknown` — the webview said nothing in time. NOT the same as `blocked`:
 *   silence cannot distinguish "the resume parked" from "the link is slow or the
 *   renderer is busy", and the host cannot bound the latter (Remote-SSH puts a
 *   network between them — ADR #34). Undetermined, so we stay quiet.
 */
export type SoundOutcome = (typeof SOUND_OUTCOMES)[number];

/**
 * Fold one *conclusive* `soundResult` message into the outcome it means. This is
 * the whole wire-to-verdict mapping, kept pure so `node --test` can pin it
 * (`handleSoundResult` in extension.ts only owns the ack lifecycle around it).
 *
 * `played: true` wins outright — the webview only says so after scheduling the
 * sound. Otherwise the `reason` decides, and anything we don't recognize folds to
 * `unknown`, never to `blocked`: guessing `blocked` from an unfamiliar reason
 * would put a `Play Sound` button on a bell that may well have rung, and VS Code
 * cannot take an action off a toast it has already shown. `unknown` offers
 * nothing, which is the same fail-safe silence gets.
 *
 * `resume-pending` is deliberately not in the fold. It is the protocol's one
 * *intermediate* message (the webview parked; a verdict follows), so the host
 * acts on it — swapping deadlines — before it ever reaches here. Should a later
 * refactor route it in anyway, it lands in the `unknown` fail-safe rather than
 * being mistaken for a conclusion.
 */
export function soundOutcomeFor(played: boolean, reason?: string): SoundOutcome {
  if (played) {
    return 'played';
  }
  if (reason === 'grace-exceeded') {
    return 'blocked'; // The resume landed, but too late to still be news.
  }
  if (reason === 'resume-rejected' || reason === 'unavailable') {
    return reason;
  }
  return 'unknown';
}

/**
 * Whether a bell's outcome is worth waiting for — i.e. whether the three
 * surfaces the `Play Sound` action needs all exist (design #78 D6). Sound off —
 * nothing to unblock. Toast off — nothing to hang the action on. No view —
 * nobody to re-post the `playSound` to. With any of them missing the verdict
 * cannot change what the user sees, so the host doesn't track that bell's ack at
 * all (and the webview, told no id, doesn't answer).
 *
 * This is the single home of the three-surface rule: `shouldOfferSoundUnlock`
 * below is defined on top of it rather than repeating the conjunction, so the
 * gate that decides whether we *listen* for a verdict can't drift from the gate
 * that decides whether we *act* on one — a drift whose failure mode is silent
 * (every outcome resolving to `unknown`, so the action never appears again).
 */
export function shouldTrackSoundAck(
  notifySound: boolean,
  notifyToast: boolean,
  hasView: boolean,
): boolean {
  return notifySound && notifyToast && hasView;
}

/**
 * Whether a bell's toast should carry the `Play Sound` action: only for a bell
 * the webview positively reported as `blocked`, and only when all three surfaces
 * exist (`shouldTrackSoundAck`). Anything short of an outright `blocked`
 * (including `unknown`, i.e. silence) yields no action: a button on a bell that
 * did ring is a lie we cannot retract, since VS Code cannot remove an action from
 * a toast already shown.
 */
export function shouldOfferSoundUnlock(
  notifySound: boolean,
  notifyToast: boolean,
  hasView: boolean,
  outcome: SoundOutcome,
): boolean {
  return shouldTrackSoundAck(notifySound, notifyToast, hasView) && outcome === 'blocked';
}

/**
 * Decide the outcome of a toolbar toggle of `tmuxOpener.notifySound` (#127).
 * The next value is the negation of the current one; a one-shot confirmation
 * sound rings only on the OFF->ON edge — turning the sound *on* is exactly when
 * the user wants to learn the audio path actually works (the context may still
 * be suspended), whereas turning it *off* must itself stay silent. Pure over the
 * current boolean so the edge rule is testable without the VS Code API.
 */
export function decideNotifySoundToggle(current: boolean): {
  next: boolean;
  playConfirmation: boolean;
} {
  const next = !current;
  return { next, playConfirmation: next };
}

/** Which configuration scope a toolbar toggle writes back to (#127). */
export type NotifySoundToggleScope = 'workspaceFolder' | 'workspace' | 'global';

/**
 * Which scope a toolbar toggle of `tmuxOpener.notifySound` must write to for the
 * flip to actually change the *effective* value (#127). The toolbar reads the
 * effective value (workspace/folder overrides included) and negates it, so it has
 * to write the negation to whichever scope currently *wins* — the highest-priority
 * scope that already has a value set — falling back to Global when only the
 * default applies. Writing to Global while a workspace/folder override stands
 * would leave the effective value unchanged: `onDidChangeConfiguration` never
 * fires, the button never echoes, and the toggle is a stuck no-op (the exact
 * failure a `.vscode/settings.json` "tmuxOpener.notifySound": false reproduces).
 * VS Code resolves in the order folder > workspace > global > default, so the
 * winning scope is the first defined one in that order. Pure over the `inspect()`
 * shape so the rule is testable without the VS Code API; the caller maps the
 * token to a `ConfigurationTarget`.
 */
export function resolveNotifySoundToggleScope(
  inspect:
    | {
        globalValue?: boolean;
        workspaceValue?: boolean;
        workspaceFolderValue?: boolean;
      }
    | undefined,
): NotifySoundToggleScope {
  if (inspect?.workspaceFolderValue !== undefined) {
    return 'workspaceFolder';
  }
  if (inspect?.workspaceValue !== undefined) {
    return 'workspace';
  }
  return 'global';
}

/**
 * Front path (xterm `onBell`, single session): cooldown only, no edge
 * detection — a live terminal fires `onBell` per event, so a bare cooldown is
 * enough to keep bursts from flooding. Returns whether to notify and the next
 * state, sharing `lastNotifiedAt` (and leaving `active` as-is) with the poller.
 */
export function shouldNotifySession(
  state: BellState,
  session: string,
  now: number,
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
): { notify: boolean; nextState: BellState } {
  if (!cooledDown(state.lastNotifiedAt, session, now, cooldownMs)) {
    return { notify: false, nextState: state };
  }
  return {
    notify: true,
    nextState: {
      active: state.active,
      lastNotifiedAt: { ...state.lastNotifiedAt, [session]: now },
    },
  };
}

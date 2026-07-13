import * as vscode from 'vscode';
import { execFile, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import * as fs from 'node:fs';
import * as pty from 'node-pty';
import {
  detailFromBridge,
  statusFilePath,
  bellReasonFilePath,
  resolveBellReason,
  selectPreset,
  selectToastMessageKey,
  isFresh,
  BELL_SETTLE_MS,
  type BellReason,
} from './status-bridge.js';
import {
  isRelatedSession,
  nextSessionName,
  profileSuffix,
  relatedSessions,
  sessionBaseName,
  type TmuxSession,
} from './session-name.js';
import {
  bellNotificationSurfaces,
  detectBellEdges,
  initialBellState,
  parseBellingSessions,
  shouldNotifySession,
  shouldOfferSoundUnlock,
  shouldTrackSoundAck,
  soundOutcomeFor,
  type BellState,
  type SoundOutcome,
} from './bell-notify.js';

/**
 * Background bell poll interval (ms). Design #16 recommends 2–3s; 2500ms keeps
 * the worst-case latency for a background session's bell under ~2.5s while
 * running `tmux list-windows` only when the view is visible and there is at
 * least one background session to watch (see `updateBellPolling`).
 */
const BELL_POLL_INTERVAL_MS = 2500;

/**
 * How long to wait for the webview's *first* word about a bell we posted (#81,
 * design #78 D2). This is a liveness probe, not a measurement of anything about
 * audio: by contract the webview answers synchronously from its `message`
 * handler, so the first word costs about one round trip (the message crosses the
 * link twice — out and back — which is 1 RTT) plus whatever queueing the renderer
 * adds. The moment it says `resume-pending` this timer is cleared and replaced by
 * `RESUME_LANDING_WINDOW_MS`, so it only ever expires when the webview says
 * *nothing* — it is dead, unreachable, or badly stalled.
 *
 * The two errors cost wildly different things, so the value sits at the high end
 * of the band:
 *
 * - Too short is the expensive one: the feature disappears silently. Under
 *   Remote-SSH the extension host is remote and the webview local (ADR #34), so
 *   that round trip crosses the network, and bells typically ring while a burst
 *   of pty output is flowing down the same connection (head-of-line blocking).
 *   Give up early and every bell on that link resolves to `unknown` -> no action;
 *   the late ack that finally arrives is dropped, because its id is gone from
 *   `pendingSoundAcks`. The feature would be absent exactly for the users who
 *   need it most, and would not self-heal.
 * - Too long only delays a toast, and only when the webview really isn't
 *   answering. Neither live path reaches this timer: a healthy bell replies in
 *   1 RTT, and a blocked one switches to the landing window.
 *
 * The ceiling is not latency but the per-session cooldown (`DEFAULT_COOLDOWN_MS`
 * = 5000, `bell-notify.ts`): the worst-case toast delay is BELL_SETTLE_MS (250)
 * + this = 3250ms, and staying under 5000 is what keeps at most one bell per
 * session undecided — a late toast can never overtake the next bell. 3000
 * swallows an intercontinental RTT plus a jammed renderer and still clears that.
 */
const SOUND_ACK_TIMEOUT_MS = 3000;

/**
 * How long to wait for the webview's *correction* after it told us a bell's
 * resume had parked (#81). Derived as `RESUME_GRACE_MS` (250, the webview's own
 * deadline for a landing resume) + 150ms of one-way jitter. Only jitter, not RTT:
 * the two messages (`resume-pending`, then `played`/`grace-exceeded`) travel the
 * same direction back to back, so any delay they share — RTT, head-of-line
 * blocking behind pty output — cancels out in the gap between them.
 *
 * Expiring this window means "conclude blocked", and that is *usually* the same
 * verdict the late message would have carried: a resume that takes longer than
 * the webview's own 250ms grace is dropped there and reported `grace-exceeded`,
 * which is blocked as well. It is not, however, a guarantee, and the exact shape
 * of the exception is what fixes this constant's value:
 *
 * - False positives are possible. A resume that lands *inside* the grace rings
 *   the bell and reports `played`, but that message still has to reach us. It
 *   travels the same direction as `resume-pending`, so their shared delay cancels
 *   out — what does not cancel is the *jitter between the two*, and the pty output
 *   they queue behind (head-of-line blocking, again) can produce exactly that. Let
 *   the gap between the two messages exceed 150ms and the window has already
 *   expired, the id is gone, `played` is dropped on arrival, and a bell that rang
 *   gets a `Play Sound` button — the one lie this design says it cannot retract.
 * - So the 150ms is the safety margin against that, not spare change. **Do not
 *   shrink this window** (250 + 50, say) on the theory that a late message is
 *   blocked anyway: it is not, and shrinking it buys nothing but lying buttons.
 * - And if false positives are ever *observed*, do not widen it either — that
 *   only trades the lie for a slower toast and still leaves the tail uncovered.
 *   Move to a pull model instead (design #78, option G): let the toast ask the
 *   webview for the bell's state when it is about to show, rather than racing a
 *   deadline against the answer.
 *
 * This window and SOUND_ACK_TIMEOUT_MS never run at the same time; receiving
 * `resume-pending` clears the first and arms this one. Running both would let the
 * 3000ms probe fire first on a high-RTT link and overwrite this window's verdict
 * (`blocked`) with `unknown` (no action) — so the correctness of the judgement
 * would depend on the relative values of two constants. Switching makes it not.
 */
const RESUME_LANDING_WINDOW_MS = 400;

/** The value side of a `tmuxOpener.profiles` entry. `null` hides the profile. */
interface TmuxProfileConfig {
  command: string;
  description?: string;
  sessionSuffix?: string;
}

/** A profile resolved for display: its settings key becomes the label. */
interface TmuxProfile extends TmuxProfileConfig {
  label: string;
}

/**
 * Shipped profiles, merged under the user's `tmuxOpener.profiles`. Following
 * `terminal.integrated.profiles.*`, a key set to `null` in settings removes
 * the profile from the menu, and any other key adds or overrides one.
 */
const DEFAULT_PROFILES: Record<string, TmuxProfileConfig> = {
  'Claude Code': { command: 'claude' },
  Codex: { command: 'codex' },
  Gemini: { command: 'gemini' },
  Cursor: { command: 'cursor-agent' },
  Grok: { command: 'grok' },
};

/**
 * The `+ ⌄` dropdown is drawn by the webview, which reads profiles at runtime.
 * The Command Palette can't: its entries are static, so each shipped profile
 * also gets a command, keyed here from its settings key, plus a
 * `tmuxOpener.profileHidden.<id>` context key that hides it when disabled.
 * Custom profiles reach the palette through the "New Session With Profile..."
 * picker instead.
 *
 * The context key is negative on purpose: keys only exist once the extension
 * has activated, and an unset key reads as false. A positive `profileVisible`
 * would therefore hide every profile from the palette until the Tmux view had
 * been opened at least once.
 */
const BUILT_IN_PROFILE_IDS: Record<string, string> = {
  'Claude Code': 'claudeCode',
  Codex: 'codex',
  Gemini: 'gemini',
  Cursor: 'cursor',
  Grok: 'grok',
};

function profileByLabel(label: string): TmuxProfile | undefined {
  return readProfiles().find((p) => p.label === label);
}

/** Hides disabled profiles from the Command Palette. */
async function updateProfileContexts(): Promise<void> {
  const visible = new Set(readProfiles().map((p) => p.label));

  for (const [label, id] of Object.entries(BUILT_IN_PROFILE_IDS)) {
    await vscode.commands.executeCommand(
      'setContext',
      `tmuxOpener.profileHidden.${id}`,
      !visible.has(label),
    );
  }
}

/** Translations reach the webview's HTML, so they must not close an attribute. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readProfiles(): TmuxProfile[] {
  const overrides =
    vscode.workspace
      .getConfiguration('tmuxOpener')
      .get<Record<string, TmuxProfileConfig | null>>('profiles') ?? {};

  // Spread order matters: a user key shadows the shipped one, and an explicit
  // null shadows it with a value the filter drops.
  const merged: Record<string, TmuxProfileConfig | null> = { ...DEFAULT_PROFILES, ...overrides };

  return Object.entries(merged)
    .filter((entry): entry is [string, TmuxProfileConfig] => {
      const config = entry[1];
      return !!config && typeof config.command === 'string' && config.command.trim().length > 0;
    })
    .map(([label, config]) => ({ label, ...config }));
}

/**
 * Whether a profile's binary resolves on PATH. Used only to annotate the
 * picker — a profile is never hidden for being absent, since PATH inside the
 * pty (a login shell via tmux) can differ from the extension host's.
 */
function commandIsAvailable(command: string): boolean {
  const binary = command.trim().split(/\s+/)[0];
  if (!binary || binary.includes('/')) {
    return true;
  }
  try {
    execFileSync('which', [binary], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `tmux` is installed and runnable. The extension does nothing without
 * it, so a missing tmux is worth catching up front instead of letting
 * `pty.spawn` fail with a bare `spawn tmux ENOENT` in the terminal pane. We run
 * `tmux -V` rather than just probing PATH so a present-but-unrunnable binary
 * still counts as missing, and it runs in the extension host's environment,
 * which is the very environment `pty.spawn` inherits (resolvePtyEnv only
 * rewrites the locale), so this check can't disagree with the spawn it guards.
 */
function tmuxIsInstalled(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** A platform-appropriate one-liner for how to install tmux. */
function tmuxInstallHint(): string {
  if (process.platform === 'darwin') {
    return vscode.l10n.t('Install it with Homebrew: brew install tmux');
  }
  // tmux has no native Windows build — the extension spawns it directly, so the
  // only way it works on Windows is the WSL side, where the extension runs on
  // Linux and tmux is a package install like any other distro.
  if (process.platform === 'win32') {
    return vscode.l10n.t(
      'tmux does not run on native Windows. Reopen your project in WSL (Remote - WSL) and install tmux there.',
    );
  }
  return vscode.l10n.t('Install it with your package manager, e.g. sudo apt install tmux');
}

function listTmuxSessions(): TmuxSession[] {
  let output: string;
  try {
    output = execFileSync(
      'tmux',
      ['list-sessions', '-F', '#{session_name}\t#{session_windows}\t#{session_attached}'],
      { encoding: 'utf8' },
    );
  } catch {
    // No tmux server running yet, or tmux not installed.
    return [];
  }

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, windows, attached] = line.split('\t');
      return { name, windows: Number(windows) || 0, attached: attached === '1' };
    });
}

function currentBaseName(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return sessionBaseName(folders[0].name);
}

function currentCwd(): string {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : homedir();
}

/**
 * Extension host processes often only inherit a bare `LANG=C.UTF-8` (no
 * region), which some libc builds pair with an incomplete East Asian Width
 * table. tmux uses the pty's locale to decide how many columns a character
 * occupies, so a mismatch here — rather than anything in xterm.js — is what
 * was causing wide (CJK) characters to render shifted by a column after
 * scrolling. VS Code's own integrated terminal doesn't hit this because it
 * launches the user's login shell, which typically fixes the locale via
 * .profile/.bashrc before tmux ever starts; we spawn tmux directly, so nothing
 * does that for us. Fall back through a short list of full locales that are
 * actually installed rather than assuming a specific one exists.
 */
function resolvePtyEnv(): { [key: string]: string } {
  const env = { ...(process.env as { [key: string]: string }) };
  const current = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
  if (/\.(utf-?8)$/i.test(current) && !/^c(\.|$)/i.test(current)) {
    return env;
  }

  let installed: string[] = [];
  try {
    installed = execFileSync('locale', ['-a'], { encoding: 'utf8' }).split('\n');
  } catch {
    // `locale` unavailable; leave env untouched below.
  }

  const preferred = ['en_US.utf8', 'en_US.UTF-8', 'C.UTF-8'];
  const match = preferred.find((name) => installed.includes(name));
  if (match) {
    env.LANG = match;
    env.LC_ALL = match;
  }
  return env;
}

function getTerminalFontConfig(): { fontFamily: string; fontSize: number } {
  const config = vscode.workspace.getConfiguration('tmuxOpener.terminal');
  const editorConfig = vscode.workspace.getConfiguration('editor');

  const fontFamily =
    config.get<string>('fontFamily', '') ||
    editorConfig.get<string>('fontFamily', 'Menlo, Monaco, "Courier New", monospace');
  const fontSize = config.get<number | null>('fontSize', null) ?? editorConfig.get<number>('fontSize', 14);

  return { fontFamily, fontSize };
}

/**
 * Hosts a single node-pty-backed `tmux` client inside a WebviewView (xterm.js
 * on the frontend), instead of VS Code's built-in Terminal panel. Only one
 * session can be attached at a time: opening a different session kills the
 * previous pty (a plain tmux client exit — the tmux session itself survives
 * on the server) and starts a new one.
 */
class TmuxTerminalViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private resolveView!: (view: vscode.WebviewView) => void;
  private readonly viewReady: Promise<vscode.WebviewView>;
  private ptyProcess?: pty.IPty;
  private currentSession?: string;
  // Shared per-session bell cooldown for both the front-of-house `onBell` path
  // (here) and the background poller (#20), so the two throttle each other.
  private bellState: BellState = initialBellState();
  // The background poller's timer, running only while the view is visible and a
  // background session exists (#20). `undefined` means paused.
  private pollTimer?: ReturnType<typeof setInterval>;
  /**
   * Bells posted to the webview whose outcome we are still waiting on (#81).
   * Keyed by a monotonic id so a `soundResult` can be matched to the bell that
   * caused it. Entries exist only for bells whose toast could actually carry the
   * action (`notifySound && notifyToast && this.view`); anything else is posted
   * without an entry, and its reply is discarded as an unknown id.
   *
   * The rules that keep this from leaking or lying:
   * - resolve-once. `resume-pending` is an intermediate record — it re-arms the
   *   timer and flips `parked`, it never resolves.
   * - both the resolve path and the timeout path `delete` the entry and
   *   `clearTimeout` its timer, so no timer outlives its bell.
   * - a `soundResult` for an id we don't hold is dropped (a late ack for a bell
   *   we already gave up on, or an untracked one).
   * - `dispose()` and the view's `onDidDispose` settle every entry as `unknown`,
   *   so no timer outlives the provider (same discipline as `pollTimer`).
   */
  private readonly pendingSoundAcks = new Map<
    number,
    {
      resolve: (outcome: SoundOutcome) => void;
      timer: ReturnType<typeof setTimeout>;
      parked: boolean;
    }
  >();
  private nextSoundId = 1;
  // `set-option -wg monitor-bell on` is best-effort and idempotent; run it once
  // on the first successful attach (a session — hence a tmux server — exists by
  // then, so it can't spawn an empty server just to hold the option).
  private monitorBellEnabled = false;
  private lastCols = 80;
  private lastRows = 24;
  /**
   * Command each profile session was created with. `tmux new-session -A`
   * ignores the command when the session already exists, so replaying it on
   * re-attach is harmless — and it means a profile session that was killed
   * outside VS Code comes back as its profile rather than a bare shell.
   * Extension-host lifetime only; tmux is still the source of truth.
   */
  private readonly sessionCommands = new Map<string, string>();
  /**
   * Guards the missing-tmux notification so the passive attach on view-open
   * pops it at most once per activation (a window reload shouldn't nag);
   * explicit user actions always get one. Reset after a session starts, so a
   * tmux that later disappears warns afresh.
   */
  private warnedTmuxMissing = false;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.viewReady = new Promise((resolve) => {
      this.resolveView = resolve;
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    // Pause the background poller while the view is hidden and resume it when it
    // comes back — a hidden view has nothing to notify about, so there's no
    // point running `tmux list-windows` every few seconds behind it.
    webviewView.onDidChangeVisibility(() => this.updateBellPolling());
    webviewView.onDidDispose(() => {
      this.view = undefined;
      this.updateBellPolling();
      // Nothing can answer a pending bell any more; let its toast go out plain
      // rather than sit on a timer belonging to a view that is gone.
      this.settleAllSoundAcks();
    });
    this.resolveView(webviewView);
  }

  private handleMessage(message: {
    type: string;
    data?: string;
    cols?: number;
    rows?: number;
    name?: string;
    uri?: string;
    profile?: string;
    visible?: boolean;
    text?: string;
    id?: number;
    played?: boolean;
    reason?: string;
  }): void {
    if (message.type === 'input' && message.data !== undefined) {
      this.ptyProcess?.write(message.data);
    } else if (message.type === 'resize' && message.cols && message.rows) {
      this.lastCols = message.cols;
      this.lastRows = message.rows;
      this.ptyProcess?.resize(message.cols, message.rows);
    } else if (message.type === 'ready') {
      this.pushL10n();
      this.pushFontConfig();
      this.pushProfiles();
      this.pushSessions();
      void this.attachInitialSession();
    } else if (message.type === 'switchSession' && message.name) {
      void this.openSession(message.name);
    } else if (message.type === 'newSession') {
      void this.openNewSession(message.profile ? profileByLabel(message.profile) : undefined);
    } else if (message.type === 'openProfileSettings') {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'tmuxOpener.profiles');
    } else if (message.type === 'killCurrentSession') {
      void this.killCurrentSession();
    } else if (message.type === 'openSettings') {
      void vscode.commands.executeCommand('tmux-opener.openSettings');
    } else if (message.type === 'killSession' && message.name) {
      void this.killSession(message.name);
    } else if (message.type === 'copy' && message.text) {
      // The webview's own clipboard access needs transient user activation,
      // which an OSC 52 sequence arriving from the pty never has.
      void vscode.env.clipboard.writeText(message.text);
    } else if (message.type === 'paste') {
      // Back to the webview rather than straight into the pty: term.paste()
      // wraps the text in bracketed-paste markers when the application asked
      // for them, so a multi-line paste isn't executed line by line.
      void vscode.env.clipboard.readText().then(
        (text) => {
          if (text) {
            this.view?.webview.postMessage({ type: 'pasteText', text });
          }
        },
        // A clipboard the host refuses to read (headless, remote) should paste
        // nothing, not raise an unhandled rejection in the extension host.
        (err) => console.error('Failed to read the clipboard', err),
      );
    } else if (message.type === 'openLink' && message.uri) {
      void vscode.env.openExternal(vscode.Uri.parse(message.uri));
    } else if (message.type === 'bell') {
      if (this.currentSession) {
        this.notifyBell(this.currentSession).catch((err) =>
          console.error('Failed to notify on bell', err),
        );
      }
    } else if (message.type === 'soundResult' && typeof message.id === 'number') {
      this.handleSoundResult(message.id, message.played === true, message.reason);
    }
  }

  /**
   * The webview's verdict on one bell (#81). Every branch below is driven by
   * something the webview *said*; the host never infers a verdict from silence
   * (that is `unknown`, and it offers no action).
   */
  private handleSoundResult(id: number, played: boolean, reason?: string): void {
    const pending = this.pendingSoundAcks.get(id);
    if (!pending) {
      return; // A late ack for a bell we already settled, or one we never tracked.
    }
    // `resume-pending` is the protocol's one *intermediate* message, so it is
    // handled here rather than folded into an outcome: it doesn't resolve the
    // bell, it swaps which deadline the bell is under. Everything else is a
    // conclusion, and `soundOutcomeFor` (pure, tested) owns that mapping.
    if (!played && reason === 'resume-pending') {
      if (pending.parked) {
        // Unreachable as the protocol stands — `playNotifySound` posts at most one
        // `resume-pending` per id, and ids are never reused. Kept because the cost
        // of being wrong is asymmetric: a second one arriving would otherwise
        // re-arm the landing window and could hold the toast open indefinitely.
        return;
      }
      // Switch deadlines rather than run both: this message proves the webview is
      // alive, which is the only question SOUND_ACK_TIMEOUT_MS was asking.
      clearTimeout(pending.timer);
      pending.parked = true;
      pending.timer = setTimeout(
        () => this.settleSoundAck(id, 'blocked'),
        RESUME_LANDING_WINDOW_MS,
      );
      return;
    }
    this.settleSoundAck(id, soundOutcomeFor(played, reason));
  }

  /**
   * Post `playSound` for a bell and, when its outcome could actually change the
   * toast, wait for the webview to conclude. Returns the verdict; `unknown` when
   * we aren't tracking this bell (nothing the answer could change) or the webview
   * never answers.
   *
   * Every `playSound` on the wire is built here — including the `Play Sound`
   * replay, which passes `userInitiated` — so the message shape and the id
   * counter have one home. The id is the ack's key, so an *untracked* bell is
   * posted without one: we would hold no entry to match a reply against and would
   * drop it on arrival, and the webview reads the missing id as "don't answer"
   * (`postSoundResult`), which keeps 1-2 pointless messages per bell off a link
   * that under Remote-SSH is already carrying the pty. Track and id travel
   * together: never send one without the other.
   */
  private postPlaySound(
    preset: string,
    track: boolean,
    userInitiated = false,
  ): Promise<SoundOutcome> {
    if (!track) {
      void this.view?.webview.postMessage({ type: 'playSound', preset, userInitiated });
      return Promise.resolve('unknown');
    }
    const id = this.nextSoundId++;
    const outcome = new Promise<SoundOutcome>((resolve) => {
      const timer = setTimeout(() => this.settleSoundAck(id, 'unknown'), SOUND_ACK_TIMEOUT_MS);
      this.pendingSoundAcks.set(id, { resolve, timer, parked: false });
    });
    void this.view?.webview.postMessage({ type: 'playSound', preset, id, userInitiated });
    return outcome;
  }

  /** Resolve one pending bell, clearing its timer and dropping the entry. */
  private settleSoundAck(id: number, outcome: SoundOutcome): void {
    const pending = this.pendingSoundAcks.get(id);
    if (!pending) {
      return;
    }
    this.pendingSoundAcks.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(outcome);
  }

  /** Settle every pending bell as `unknown` (view or provider going away). */
  private settleAllSoundAcks(): void {
    for (const id of [...this.pendingSoundAcks.keys()]) {
      this.settleSoundAck(id, 'unknown');
    }
  }

  /**
   * A bell from the live (front-of-house) session: throttle it through the
   * shared per-session cooldown, then — when `tmuxOpener.notifyOnBell` is on —
   * raise a native notification whose one action re-reveals the session.
   */
  private async notifyBell(sessionName: string): Promise<void> {
    // Gate on the setting *before* touching the shared cooldown: the cooldown
    // must advance only when a notification actually fires. The background
    // poller (#20) shares `bellState`, and it relies on `lastNotifiedAt`
    // meaning "we notified", so a suppressed bell must leave the state alone.
    const notifyOnBell = vscode.workspace
      .getConfiguration('tmuxOpener')
      .get<boolean>('notifyOnBell', true);
    if (!notifyOnBell) {
      return;
    }

    const { notify, nextState } = shouldNotifySession(
      this.bellState,
      sessionName,
      Date.now(),
    );
    if (!notify) {
      return;
    }

    // The bell reason drives both the sound preset (#47) and the toast wording
    // (#64), so resolve it once and share it. Read the reason files only when at
    // least one consumer is on. The opt-in bell-reason hook writes
    // `.stop.json` / `.ask.json` *before* emitting the BEL, so an initial read
    // tells us whether this bell carries a reason. No fresh reason file -> a
    // user without the hooks: keep the zero-latency path (no settle) and fall
    // back to the plain preset / neutral toast (behavior unchanged). At least
    // one fresh -> the co-firing sibling (Stop vs Notification) may still be in
    // flight, so settle briefly, re-read, then resolve the reason.
    const notifyToast = vscode.workspace
      .getConfiguration('tmuxOpener')
      .get<boolean>('notifyToast', true);
    const notifySound = vscode.workspace
      .getConfiguration('tmuxOpener')
      .get<boolean>('notifySound', true);

    // Commit the shared cooldown only now that we know something will surface.
    // With both channels off (yet `notifyOnBell` on) nothing plays or shows, so
    // advancing `bellState` here would throttle a later, audible bell behind a
    // notification that never happened — the invariant guarded above. The commit
    // still lands before any settle, so a co-firing sibling can't double-notify.
    if (!bellNotificationSurfaces(notifySound, notifyToast)) {
      return;
    }
    this.bellState = nextState;

    // The surfaces gate above already returned when both channels are off, so
    // by here at least one will surface — resolve the reason unconditionally.
    let reason: BellReason = 'stop';
    const initial = this.readBellReasons(sessionName);
    const now = Date.now();
    const anyFresh =
      (initial.stopMtime !== undefined && isFresh(initial.stopMtime, now)) ||
      (initial.askMtime !== undefined && isFresh(initial.askMtime, now));
    if (anyFresh) {
      await new Promise((resolve) => setTimeout(resolve, BELL_SETTLE_MS));
      const settled = this.readBellReasons(sessionName);
      reason = resolveBellReason({
        stopMtime: settled.stopMtime,
        askMtime: settled.askMtime,
        now: Date.now(),
      });
    }

    // Play a sound alongside the toast (opt-out via `notifySound`). The webview
    // owns the synthesis — it always runs on the local machine, so this is heard
    // at the keyboard even when the extension host is remote (Remote-SSH). The
    // host only forwards the chosen preset id; it doesn't know what it sounds
    // like. Sent before the awaited toast so the sound isn't delayed by it. With
    // no fresh reason `reason` stays 'stop', so `selectPreset` yields the plain
    // preset — the hook-less path is unchanged.
    //
    // The webview answers with one conclusive `soundResult` per bell (#81), and
    // we wait for it only when the answer could change what the toast shows —
    // `notifySound && notifyToast && this.view` (design #78 D6). The sound is
    // still posted first and is never delayed by the wait; what the wait delays
    // is the toast (by ~1 RTT when healthy, which under Remote-SSH is a real
    // cost, accepted and recorded in CLAUDE.md).
    let preset = '';
    let soundAck: Promise<SoundOutcome> | undefined;
    if (notifySound) {
      const config = vscode.workspace.getConfiguration('tmuxOpener');
      const stopPreset = config.get<string>('notifySoundPreset', 'classic');
      const askPreset = config.get<string>('notifySoundPresetOnAsk', 'siren');
      preset = selectPreset(reason, stopPreset, askPreset);
      // Track the ack only when the answer could change what the user sees — the
      // same three-surface rule `shouldOfferSoundUnlock` applies below, called
      // through the one predicate both derive from so they cannot drift apart.
      soundAck = this.postPlaySound(
        preset,
        shouldTrackSoundAck(notifySound, notifyToast, this.view !== undefined),
      );
    }

    // The toast itself (opt-out via `notifyToast`; full stop is `notifyOnBell`).
    // Gate everything toast-related — including the optional statusline detail —
    // behind it: with the toast off there is nothing to append to.
    if (notifyToast) {
      // Opt-in statusline bridge (#41, design #39): a user's Claude Code
      // statusline script drops an excerpt JSON keyed by session name into the
      // cache dir; if it exists and is fresh, append its context%/cost to the
      // toast. Writer (the script) and reader (here) always run on the same
      // machine/FS/clock — the extension host spawned the tmux this statusline
      // runs under (so mtime freshness and the shared path are sound, even under
      // Remote-SSH). Every failure (no file, stale, parse error, wrong types)
      // falls back to the plain toast; the whole read is wrapped in try/catch.
      let detail = '';
      const notifyBridgeStatusline = vscode.workspace
        .getConfiguration('tmuxOpener')
        .get<boolean>('notifyBridgeStatusline', true);
      if (notifyBridgeStatusline) {
        detail = this.readBridgeDetail(sessionName) ?? '';
      }

      // The bell we posted above may not have been heard: with no sticky
      // activation the webview's `resume()` parks forever and the sound is
      // dropped (#70/#73). It says so, and only then does the toast carry
      // `Play Sound` — a click on it is a real gesture on the workbench's top
      // frame, which arms the Window's sticky activation and, through the
      // iframe's `allow="autoplay"`, lets the webview's context start.
      const soundOutcome: SoundOutcome = soundAck ? await soundAck : 'unknown';
      const offerSound = shouldOfferSoundUnlock(
        notifySound,
        notifyToast,
        this.view !== undefined,
        soundOutcome,
      );

      // Wording splits on the resolved reason (#64): completion vs
      // waiting-for-input when a fresh reason file exists, else the neutral
      // default. The key is passed to `vscode.l10n.t` for ja translation.
      const open = vscode.l10n.t('Open');
      const playSound = vscode.l10n.t('Play Sound');
      // `Open` stays first (D5). `showInformationMessage` returns only the one
      // action the user picked, so these are mutually exclusive — which is
      // harmless: either click is a real gesture, so picking `Open` still arms
      // sticky activation and every bell after it rings. Only the replay of this
      // one missed bell is lost.
      const actions = offerSound ? [open, playSound] : [open];
      const messageKey = selectToastMessageKey(anyFresh, reason);
      const choice = await vscode.window.showInformationMessage(
        vscode.l10n.t(messageKey, sessionName) + detail,
        ...actions,
      );
      if (choice === open) {
        void vscode.commands.executeCommand('tmux-opener.openSpecificSession', sessionName);
      } else if (choice === playSound) {
        // Same message type, same preset, same builder — no new protocol and no
        // hand-rolled message for the retry. The sound playing *is* the proof that
        // it worked. `userInitiated` exempts this one bell from the webview's grace
        // window: a sound the user asked for is not a "now" signal, so arriving a
        // moment late is fine. It stays scoped to this single message and is never
        // applied to real bells (that would reopen the #70 pile-up). Untracked
        // (`track: false`): no toast follows it, so there is no verdict to act on —
        // and so it goes out without an id and the webview stays quiet about it.
        void this.postPlaySound(preset, false, true);
      }
    }
  }

  /**
   * Read the statusline bridge file for `sessionName` and return the toast
   * detail suffix (e.g. ` (context 82%, cost $0.45)`), or `undefined` to keep the
   * plain toast. All I/O lives here; the path/freshness/parse/compose decisions
   * are the pure `status-bridge` module. Anything going wrong — the file is
   * missing, stale, half-written, malformed, or mistyped — is swallowed so a
   * bell never fails to notify because of the optional bridge.
   */
  private readBridgeDetail(sessionName: string): string | undefined {
    try {
      const path = statusFilePath(sessionName, process.env, homedir());
      const raw = fs.readFileSync(path, 'utf8');
      const mtimeMs = fs.statSync(path).mtimeMs;
      return detailFromBridge(raw, mtimeMs, Date.now(), (message, ...args) =>
        vscode.l10n.t(message, ...args),
      );
    } catch {
      return undefined;
    }
  }

  /**
   * Stat the two bell-reason bridge files for `sessionName` and return their
   * mtimes (Issue #47), `undefined` where a file is absent. All I/O lives here;
   * the reason decision is the pure `resolveBellReason`. Each stat is guarded
   * independently so a missing `.ask.json` doesn't hide a present `.stop.json`.
   * Writer (the hook script) and reader run on the same machine/FS/clock — the
   * extension host spawned the tmux the hooks run under — so the mtimes are
   * comparable even under Remote-SSH (mirrors `readBridgeDetail`).
   */
  private readBellReasons(sessionName: string): {
    stopMtime: number | undefined;
    askMtime: number | undefined;
  } {
    const statMtime = (reason: 'stop' | 'ask'): number | undefined => {
      try {
        const path = bellReasonFilePath(sessionName, reason, process.env, homedir());
        return fs.statSync(path).mtimeMs;
      } catch {
        return undefined;
      }
    };
    return { stopMtime: statMtime('stop'), askMtime: statMtime('ask') };
  }

  /**
   * Best-effort, idempotent `tmux set-option -wg monitor-bell on` so a bell in
   * any window — existing or created later by an AI CLI — sets
   * `window_bell_flag`, which the background poller reads (#16, design A). A
   * *global window option*: windows leave `monitor-bell` unset locally and
   * inherit it, so future windows follow without re-running this. Run once, on
   * the first attach, when a tmux server is known to exist (so it can't spawn an
   * empty one). Failure is swallowed — the front-of-house `onBell` path (a) is
   * independent of it; only background detection (b) depends on the flag.
   */
  private enableMonitorBell(): void {
    if (this.monitorBellEnabled) {
      return;
    }
    this.monitorBellEnabled = true;
    try {
      execFileSync('tmux', ['set-option', '-wg', 'monitor-bell', 'on'], { stdio: 'ignore' });
    } catch {
      // best-effort; leave background detection degraded rather than crashing.
    }
  }

  /**
   * Start or stop the background poller to match the current state: run it only
   * while the view is visible and at least one *background* (non-current)
   * related session exists. The front session is the live-pty `onBell`'s job, so
   * with nothing but it around the poller has nothing to watch. Called on every
   * session-set change (`pushSessions`) and visibility change.
   */
  private updateBellPolling(): void {
    const baseName = currentBaseName();
    const visible = this.view?.visible ?? false;
    const background = baseName
      ? relatedSessions(baseName, listTmuxSessions()).filter((s) => s.name !== this.currentSession)
      : [];
    if (visible && background.length > 0) {
      if (!this.pollTimer) {
        this.pollTimer = setInterval(() => this.pollBackgroundBells(), BELL_POLL_INTERVAL_MS);
      }
    } else if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /**
   * One poll cycle: read every window's bell flag asynchronously (never the
   * synchronous `execFileSync` — this runs on a timer and must not block the
   * extension host), keep the related sessions that are ringing *except* the
   * current one (front-of-house owns that, so excluding it prevents a double
   * notification), and notify on the `0->1` edges. `detectBellEdges` advances
   * the edge memory (`active`); `notifyBell` owns the cooldown (`lastNotifiedAt`)
   * — so only the edge memory is reflected here, and `notifyBell` re-gates on the
   * same prior cooldown before firing (reflecting the edge detector's cooldown
   * too would make `notifyBell` see the window as just-notified and suppress it).
   */
  private pollBackgroundBells(): void {
    const baseName = currentBaseName();
    if (!baseName) {
      return;
    }
    execFile(
      'tmux',
      ['list-windows', '-a', '-F', '#{session_name}\t#{window_bell_flag}'],
      { encoding: 'utf8' },
      (err, stdout) => {
        if (err) {
          // No tmux server, or tmux vanished — let the next cycle retry rather
          // than tearing the poller down.
          return;
        }
        const belling = parseBellingSessions(stdout).filter(
          (name) => name !== this.currentSession && isRelatedSession(baseName, name),
        );
        const { toNotify, nextState } = detectBellEdges(this.bellState, belling, Date.now());
        // Take only the advanced edge memory; keep the existing cooldown so
        // notifyBell (the single owner of lastNotifiedAt) decides and records it.
        this.bellState = { active: nextState.active, lastNotifiedAt: this.bellState.lastNotifiedAt };
        for (const session of toNotify) {
          this.notifyBell(session).catch((e) => console.error('Failed to notify on bell', e));
        }
      },
    );
  }

  pushFontConfig(): void {
    this.view?.webview.postMessage({ type: 'config', ...getTerminalFontConfig() });
  }

  /**
   * The webview builds DOM at runtime, so it can't use `%key%` placeholders and
   * has no access to `vscode.l10n`. Ship it the handful of strings it renders.
   */
  pushL10n(): void {
    this.view?.webview.postMessage({
      type: 'l10n',
      strings: {
        noSession: vscode.l10n.t('No session'),
        newSession: vscode.l10n.t('New Session'),
        // The default view shown when no session is running.
        noActiveSession: vscode.l10n.t('No active session'),
        startNewSessionHint: vscode.l10n.t('Start a tmux session to get going.'),
        configureProfiles: vscode.l10n.t('Configure Profiles...'),
        killSession: vscode.l10n.t('Kill session'),
        // {0} is a session name.
        attachedElsewhere: vscode.l10n.t('{0} (attached elsewhere)', '{0}'),
        // {0} is a shell command.
        notFoundOnPath: vscode.l10n.t('"{0}" was not found on PATH', '{0}'),
      },
    });
  }

  /** The webview draws the profile dropdown, so it needs the resolved list. */
  pushProfiles(): void {
    this.view?.webview.postMessage({
      type: 'profiles',
      profiles: readProfiles().map((p) => ({
        label: p.label,
        command: p.command,
        available: commandIsAvailable(p.command),
      })),
    });
  }

  async toggleSidebar(): Promise<void> {
    await vscode.commands.executeCommand('tmuxOpener.terminal.focus');
    const view = this.view ?? (await this.viewReady);
    view.webview.postMessage({ type: 'toggleSidebar' });
  }

  pushSessions(): void {
    const baseName = currentBaseName();
    if (baseName && this.view) {
      const related = relatedSessions(baseName, listTmuxSessions());
      this.view.webview.postMessage({
        type: 'sessions',
        sessions: related.map((s) => ({ name: s.name, attached: s.attached, current: s.name === this.currentSession })),
      });
    }
    // The session set or current session may have just changed, so re-evaluate
    // whether the background poller should be running.
    this.updateBellPolling();
  }

  /**
   * Topmost session in the sidebar list, i.e. the first related one.
   * `exclude` skips a session we are leaving: a client that exits via a tmux
   * detach leaves the session alive, and we must not immediately re-attach to
   * the very session the user just stepped out of.
   */
  private firstRelatedSession(exclude?: string): string | undefined {
    const baseName = currentBaseName();
    if (!baseName) {
      return undefined;
    }
    return relatedSessions(baseName, listTmuxSessions()).find((s) => s.name !== exclude)?.name;
  }

  /**
   * Move off `name` onto whatever is now at the top of the list. Nothing left
   * means nothing to attach to — never recreate the session we just left, or
   * killing/exiting the last session would be impossible. With no session
   * left, show the default view (carrying the kill/end notice) rather than
   * silently auto-spawning a fresh one.
   */
  private async attachNextAfter(name: string, verb: 'killed' | 'ended'): Promise<void> {
    if (!this.view) {
      return;
    }
    const next = this.firstRelatedSession(name);
    if (next) {
      await this.attachSession(next);
      return;
    }
    const text =
      verb === 'killed'
        ? vscode.l10n.t('Session "{0}" killed.', name)
        : vscode.l10n.t('Session "{0}" ended.', name);
    this.showDefaultView(text);
    this.pushSessions();
  }

  /**
   * Ask the webview to swap the terminal out for its own default screen (a
   * "no session" message plus a New Session button). Never reveals or focuses
   * the view — it is neither an attach nor a focus move, so it can't steal
   * focus from the editor. `notice` optionally carries a kill/end line to show
   * above the message.
   */
  private showDefaultView(notice?: string): void {
    this.view?.webview.postMessage({ type: 'defaultView', notice });
  }

  /**
   * Called when the webview signals it is ready. Attaches to whatever the
   * sidebar shows at the top, so opening the view lands you in a terminal
   * instead of an empty pane. `currentSession` survives a webview reload
   * while the extension host stays alive, so prefer it when set. With no
   * related session at all we do NOT fall back to the base name (that silently
   * spawned a session on every open) — we show the default view instead.
   */
  private async attachInitialSession(): Promise<void> {
    const baseName = currentBaseName();
    if (!baseName) {
      return;
    }
    const target = this.currentSession ?? this.firstRelatedSession();
    if (target) {
      await this.attachSession(target);
      return;
    }
    // No session to attach to. If tmux itself is missing, say so — a default
    // view offering a New Session button that can't work would mislead.
    // Otherwise show the default view instead of auto-creating a session.
    if (!tmuxIsInstalled()) {
      await this.reportTmuxMissing(false);
      return;
    }
    this.showDefaultView();
  }

  async openNewSession(profile?: TmuxProfile): Promise<void> {
    const baseName = currentBaseName();
    if (!baseName) {
      vscode.window.showErrorMessage(vscode.l10n.t('Tmux Opener: open a folder or workspace first.'));
      return;
    }
    const suffix = profile ? profileSuffix(profile) : undefined;
    await this.openSession(nextSessionName(baseName, listTmuxSessions(), suffix), profile?.command);
  }

  /** The `⌄` next to `+`: pick a profile, then create a session running it. */
  async openNewSessionWithProfile(): Promise<void> {
    const defaultItem: vscode.QuickPickItem = {
      label: `$(add) ${vscode.l10n.t('New Session')}`,
      description: vscode.l10n.t('Default shell'),
    };
    const separator: vscode.QuickPickItem = {
      label: vscode.l10n.t('Profiles'),
      kind: vscode.QuickPickItemKind.Separator,
    };
    const profileItems = readProfiles().map((profile) => {
      const available = commandIsAvailable(profile.command);
      return {
        label: `${available ? '$(terminal)' : '$(warning)'} ${profile.label}`,
        description: profile.description ?? profile.command,
        detail: available
          ? undefined
          : vscode.l10n.t('"{0}" was not found on PATH', profile.command),
        profile,
      };
    });
    const configureItem: vscode.QuickPickItem = {
      label: `$(gear) ${vscode.l10n.t('Configure Profiles...')}`,
    };

    type PickItem = vscode.QuickPickItem & { profile?: TmuxProfile };
    const items: PickItem[] = [defaultItem];
    if (profileItems.length > 0) {
      items.push(separator, ...profileItems);
    }
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator }, configureItem);

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: vscode.l10n.t('Select a tmux session profile'),
    });
    if (!picked || picked === configureItem) {
      if (picked === configureItem) {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'tmuxOpener.profiles');
      }
      return;
    }
    await this.openNewSession(picked.profile);
  }

  /** Reveal the view, then attach. For user-initiated switches. */
  async openSession(sessionName: string, command?: string): Promise<void> {
    await vscode.commands.executeCommand('tmuxOpener.terminal.focus');
    const view = this.view ?? (await this.viewReady);
    view.show?.(true);
    await this.attachSession(sessionName, command, true);
  }

  /**
   * tmux is required and absent. Explain it in the terminal pane (always), and
   * raise a notification with install guidance — every time for an explicit
   * user action, but only once per activation for the automatic attach on
   * view-open, so reloading the window doesn't nag.
   */
  private async reportTmuxMissing(interactive: boolean): Promise<void> {
    const view = this.view ?? (await this.viewReady);
    this.currentSession = undefined;
    view.webview.postMessage({
      type: 'info',
      text: `${vscode.l10n.t('tmux was not found on your PATH. Install tmux and reopen this view.')}\r\n`,
    });
    this.pushSessions();

    if (!interactive && this.warnedTmuxMissing) {
      return;
    }
    this.warnedTmuxMissing = true;

    const learnMore = vscode.l10n.t('Install Instructions');
    const choice = await vscode.window.showErrorMessage(
      vscode.l10n.t('Tmux Opener: tmux is not installed or not on your PATH. {0}', tmuxInstallHint()),
      learnMore,
    );
    if (choice === learnMore) {
      void vscode.env.openExternal(vscode.Uri.parse('https://github.com/tmux/tmux/wiki/Installing'));
    }
  }

  /**
   * Attach without revealing/focusing the view. Used when the view attaches
   * itself on open, and when a kill falls back to the next session — in both
   * cases stealing focus from the editor would be wrong.
   */
  private async attachSession(sessionName: string, command?: string, interactive = false): Promise<void> {
    const view = this.view ?? (await this.viewReady);

    // Nothing here works without tmux. Catch it before pty.spawn so the pane
    // explains itself (and, when the user asked, a notification points at how
    // to install it) instead of surfacing a bare `spawn tmux ENOENT`.
    if (!tmuxIsInstalled()) {
      await this.reportTmuxMissing(interactive);
      return;
    }

    // Detach the old client (the tmux session survives server-side). Clearing
    // the field first neutralizes its onExit — we are replacing it, not
    // reacting to it.
    const previous = this.ptyProcess;
    this.ptyProcess = undefined;
    previous?.kill();

    if (command) {
      this.sessionCommands.set(sessionName, command);
    }
    const shellCommand = command ?? this.sessionCommands.get(sessionName);

    this.currentSession = sessionName;
    view.webview.postMessage({
      type: 'info',
      text: `${vscode.l10n.t('Starting tmux session "{0}"...', sessionName)}\r\n`,
    });
    this.pushSessions();

    // A trailing shell-command makes tmux run it as the session's only
    // process instead of a login shell, so quitting the tool ends the
    // session. `-A` still wins when the session already exists: tmux attaches
    // and drops the command.
    const args = ['new-session', '-A', '-s', sessionName];
    if (shellCommand) {
      args.push(shellCommand);
    }

    let proc: pty.IPty;
    try {
      proc = pty.spawn('tmux', args, {
        name: 'xterm-256color',
        cols: this.lastCols,
        rows: this.lastRows,
        cwd: currentCwd(),
        env: resolvePtyEnv(),
      });
    } catch (err) {
      // The view attaches on open now, so a missing tmux must not surface as
      // an unhandled rejection from a background attach.
      this.currentSession = undefined;
      const reason = err instanceof Error ? err.message : String(err);
      view.webview.postMessage({
        type: 'info',
        text: `${vscode.l10n.t('Failed to start tmux: {0}', reason)}\r\n`,
      });
      this.pushSessions();
      return;
    }
    this.ptyProcess = proc;
    // A session started, so tmux is present now; let a future disappearance warn.
    this.warnedTmuxMissing = false;
    // A tmux server exists now — enable bell monitoring so background windows
    // set window_bell_flag for the poller to read (once; idempotent).
    this.enableMonitorBell();

    // The webview's last known fit may be stale (first load, or the panel
    // was resized while a different session was showing) — ask it to
    // re-measure and report back so the pty gets an accurate resize.
    view.webview.postMessage({ type: 'requestResize' });

    // Mirrors VS Code's own TerminalDataBufferer: coalesce pty output over a
    // short window into a single write instead of relaying every raw
    // node-pty chunk as its own postMessage/term.write() call. Firing one
    // write per OS-level pty read can split an escape sequence (or a
    // synchronized-output block) across writes in a way that's fine
    // in-process but isn't safe across the extension-host <-> webview
    // postMessage hop, which was the likely cause of stray leftover glyphs.
    let outputBuffer: string[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flushOutput = () => {
      flushTimer = undefined;
      if (outputBuffer.length === 0) {
        return;
      }
      const data = outputBuffer.join('');
      outputBuffer = [];
      if (this.ptyProcess === proc) {
        this.view?.webview.postMessage({ type: 'output', data });
      }
    };

    proc.onData((data) => {
      outputBuffer.push(data);
      if (!flushTimer) {
        flushTimer = setTimeout(flushOutput, 5);
      }
    });
    proc.onExit(() => {
      if (flushTimer) {
        clearTimeout(flushTimer);
      }
      flushOutput();
      // Only the pty still installed may act on its own exit. Anything else
      // means we tore it down deliberately — switching sessions, killing, or
      // disposing — and the code that did so owns what happens next. Without
      // this the teardown kill() would bounce back through attachNextAfter
      // and respawn the session we were trying to leave. Identity, not name:
      // re-attaching to the same session reuses the name.
      if (this.ptyProcess !== proc) {
        return;
      }
      this.ptyProcess = undefined;
      if (this.currentSession === sessionName) {
        this.currentSession = undefined;
      }
      // The client exited on its own: `exit` in the last tmux window, an
      // external kill-session, or a detach. Land on the next session rather
      // than leaving a frozen, dead pane.
      void this.attachNextAfter(sessionName, 'ended');
    });

    setTimeout(() => this.pushSessions(), 300);
  }

  getCurrentSession(): string | undefined {
    return this.currentSession;
  }

  async killCurrentSession(): Promise<void> {
    if (!this.currentSession) {
      vscode.window.showInformationMessage(vscode.l10n.t('Tmux Opener: no active session to kill.'));
      return;
    }
    await this.killSession(this.currentSession);
  }

  async killSession(name: string): Promise<void> {
    const kill = vscode.l10n.t('Kill Session');
    const confirmed = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'Kill tmux session "{0}"? This ends the session entirely, not just this view.',
        name,
      ),
      { modal: true },
      kill,
    );
    if (confirmed !== kill) {
      return;
    }

    try {
      execFileSync('tmux', ['kill-session', '-t', name]);
    } catch {
      // Session may already be gone.
    }

    if (this.currentSession !== name) {
      this.pushSessions();
      return;
    }

    // Detach this pty ourselves and drive the fallback from here. Clearing
    // ptyProcess first makes the resulting onExit a no-op, so the fallback
    // runs exactly once.
    const dead = this.ptyProcess;
    this.ptyProcess = undefined;
    this.currentSession = undefined;
    dead?.kill();

    await this.attachNextAfter(name, 'killed');
  }

  dispose(): void {
    // Stop the background bell poller so its timer can't outlive the provider.
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    // Same discipline for the bell-outcome timers (#81): settle every pending
    // bell as `unknown` so none of them survives the provider.
    this.settleAllSoundAcks();
    // Clear the field before killing: onExit only acts on the pty still
    // installed, so this stops the exit from being mistaken for a session
    // ending on its own and respawning tmux as the extension shuts down.
    const dead = this.ptyProcess;
    this.ptyProcess = undefined;
    dead?.kill();
  }

  private getHtml(webview: vscode.Webview): string {
    const mediaXterm = (name: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'xterm', name));
    const xtermCss = mediaXterm('xterm.css');
    const xtermJs = mediaXterm('xterm.js');
    const addonFitJs = mediaXterm('addon-fit.js');
    const addonWebLinksJs = mediaXterm('addon-web-links.js');
    const addonUnicode11Js = mediaXterm('addon-unicode11.js');
    const addonSearchJs = mediaXterm('addon-search.js');
    const addonWebglJs = mediaXterm('addon-webgl.js');
    const addonClipboardJs = mediaXterm('addon-clipboard.js');
    const keymapUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'webview-keymap.js'));
    const soundUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'webview-sound.js'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'webview-terminal.js'));
    const codiconCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'codicons', 'codicon.css'),
    );
    const t = (message: string) => escapeAttribute(vscode.l10n.t(message));

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; font-src ${webview.cspSource};">
<link rel="stylesheet" href="${xtermCss}">
<link rel="stylesheet" href="${codiconCss}">
<style>
  html { height: 100%; margin: 0; padding: 0; overflow: hidden; }
  body {
    height: 100%; margin: 0; padding: 0; overflow: hidden;
    display: flex;
    flex-direction: column;
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
  }
  #main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: row;
  }

  /* A toolbar of our own across the top of the view: the workbench title bar
     above it can't host a split button (see the .split-button rules below). */
  #toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    height: 26px;
    padding: 0 4px 0 8px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
    color: var(--vscode-icon-foreground, var(--vscode-foreground));
    user-select: none;
  }
  .toolbar-action {
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 2px;
    border-radius: 5px;
  }
  .toolbar-action:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.2)); }
  #toolbar .codicon { font-size: 16px; line-height: 16px; }
  #session-title {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: var(--vscode-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #session-title.empty { opacity: 0.6; font-style: italic; }

  /* Mirrors terminal.integrated.tabs.location default ('right') and the
     tab list's actual constraints from VS Code's SplitView: default 120px,
     min 46px (icon-only), max 500px. */
  #sidebar {
    width: 120px;
    min-width: 46px;
    max-width: 500px;
    flex-shrink: 0;
    overflow: hidden;
    border-left: 1px solid var(--vscode-panel-border, transparent);
    background: var(--vscode-sideBar-background, transparent);
    display: flex;
    flex-direction: column;
  }
  #session-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  /* Mirrors .monaco-dropdown-with-default: the primary action and the chevron
     are separate hit targets inside one container that owns the hover rect. */
  .split-button {
    display: flex;
    flex-direction: row;
    border-radius: 5px;
  }
  .split-button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.2)); }
  .split-button > .primary,
  .split-button > .dropdown {
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 2px;
    border-radius: 5px;
  }
  /* Layers over the container's own hover, so the half under the cursor reads
     brighter than its sibling — the two-tone look of the built-in button. */
  .split-button > .primary:hover,
  .split-button > .dropdown:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.2));
  }
  /* Upstream shrinks the chevron to 12px and pulls it 3px toward the primary. */
  .split-button > .dropdown .codicon {
    font-size: 12px;
    line-height: 16px;
    margin-left: -3px;
  }

  #context-menu {
    display: none;
    position: absolute;
    z-index: 20;
    min-width: 150px;
    padding: 4px 0;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-menu-border, var(--vscode-editorWidget-border, transparent));
    border-radius: 5px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.36);
    font-size: 13px;
    user-select: none;
  }
  #context-menu.visible { display: block; }
  #context-menu .menu-item {
    display: flex;
    align-items: center;
    height: 22px;
    padding: 0 26px 0 12px;
    white-space: nowrap;
    cursor: pointer;
  }
  #context-menu .menu-item:hover {
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
    color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
  }
  #context-menu .menu-item.unavailable { opacity: 0.6; }
  #context-menu .menu-separator {
    height: 0;
    margin: 4px 0;
    border-bottom: 1px solid var(--vscode-menu-separatorBackground, rgba(128,128,128,0.35));
  }
  #resizer {
    width: 4px;
    flex-shrink: 0;
    cursor: col-resize;
    background: transparent;
  }
  #resizer:hover, #resizer.dragging { background: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder, #007fd4)); }

  .session-item {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 8px;
    box-sizing: border-box;
    font-size: 12px;
    color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    user-select: none;
  }
  .session-item .icon { flex-shrink: 0; opacity: 0.8; }
  .session-item .label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  /* Label hides below ~63px width, matching MidpointViewWidth in terminalTabsList.ts */
  #sidebar.icon-only .session-item .label { display: none; }
  .session-item:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.1)); }
  .session-item.active {
    background: var(--vscode-list-activeSelectionBackground, rgba(128,128,128,0.2));
    color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
  }
  .session-item .close {
    flex-shrink: 0;
    opacity: 0;
    border-radius: 3px;
    padding: 0 3px;
    line-height: 16px;
  }
  .session-item:hover .close { opacity: 0.7; }
  .session-item .close:hover {
    opacity: 1 !important;
    background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.3));
  }
  /* Action (close) button hides below ~105px width, matching ActionbarMinimumWidth */
  #sidebar.compact .session-item .close { display: none; }

  #terminal-wrap {
    flex: 1;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 4px 0 0 4px;
    box-sizing: border-box;
  }
  /* xterm.js sizes its own .xterm root element via inline styles computed
     from rows/cols -- it doesn't need help from us here. An earlier attempt
     to additionally pin it with position: absolute; inset: 0 turned out
     to fight that internal sizing (most likely cause of stray leftover
     glyphs after scrolling) and has been removed; #terminal just needs to
     be an unpadded box with a real height for FitAddon to measure. */
  #terminal { flex: 1; min-height: 0; min-width: 0; }

  /* Shown in place of the terminal when no session is running. Exclusive with
     #terminal (JS toggles display), so the terminal instance keeps existing
     for the next attach — this is just what fills the pane meanwhile. Simple,
     centered, VS Code welcome-view tone; deliberately undecorated. */
  #default-view {
    display: none;
    flex: 1;
    min-height: 0;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 12px;
    padding: 16px;
    box-sizing: border-box;
  }
  #default-view.visible { display: flex; }
  #default-view .notice {
    margin: 0;
    max-width: 280px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground, var(--vscode-foreground));
  }
  #default-view .message {
    margin: 0;
    max-width: 280px;
    color: var(--vscode-foreground);
  }
  #default-view .hint {
    margin: 0;
    max-width: 280px;
    font-size: 12px;
    opacity: 0.8;
    color: var(--vscode-descriptionForeground, var(--vscode-foreground));
  }
  #default-view-new {
    font-family: inherit;
    font-size: 13px;
    line-height: 18px;
    padding: 4px 14px;
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 2px;
    color: var(--vscode-button-foreground, #ffffff);
    background: var(--vscode-button-background, #0e639c);
    cursor: pointer;
  }
  #default-view-new:hover {
    background: var(--vscode-button-hoverBackground, var(--vscode-button-background, #1177bb));
  }
  #default-view-new:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 2px;
  }

  #boot-error {
    display: none;
    padding: 8px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    color: var(--vscode-errorForeground, #f14c4c);
    white-space: pre-wrap;
  }

  #findbar {
    display: none;
    align-items: center;
    gap: 4px;
    position: absolute;
    top: 4px;
    right: 8px;
    z-index: 10;
    padding: 4px 6px;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, transparent));
    border-radius: 3px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  }
  #findbar.visible { display: flex; }
  #findbar input {
    width: 120px;
    font-size: 12px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    padding: 2px 4px;
  }
  #findbar button {
    background: transparent;
    color: inherit;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 2px;
  }
  #findbar button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.2)); }
</style>
</head>
<body>
<div id="toolbar">
  <span id="session-title" class="empty">${t('No session')}</span>
  <div class="split-button">
    <div class="primary" id="newSession" title="${t('New Session')}">
      <span class="codicon codicon-add"></span>
    </div>
    <div class="dropdown" id="newSessionMenu" title="${t('New Session With Profile...')}">
      <span class="codicon codicon-chevron-down"></span>
    </div>
  </div>
  <div class="toolbar-action" id="toggleSidebar" title="${t('Toggle Session List')}">
    <span class="codicon codicon-list-selection"></span>
  </div>
  <div class="toolbar-action" id="killSession" title="${t('Kill Current Session')}">
    <span class="codicon codicon-trash"></span>
  </div>
  <div class="toolbar-action" id="openSettings" title="${t('Open Settings')}">
    <span class="codicon codicon-gear"></span>
  </div>
</div>
<div id="main">
<div id="terminal-wrap">
  <div id="terminal"></div>
  <div id="default-view">
    <p id="default-view-notice" class="notice"></p>
    <p id="default-view-message" class="message">${t('No active session')}</p>
    <button id="default-view-new" type="button">${t('New Session')}</button>
    <p id="default-view-hint" class="hint">${t('Start a tmux session to get going.')}</p>
  </div>
  <div id="boot-error"></div>
  <div id="findbar">
    <input id="findInput" type="text" placeholder="${t('Find')}">
    <button id="findPrev" title="${t('Previous match')}">↑</button>
    <button id="findNext" title="${t('Next match')}">↓</button>
    <button id="findClose" title="${t('Close')}">×</button>
  </div>
</div>
<div id="resizer"></div>
<div id="sidebar">
  <div id="session-list"></div>
</div>
</div>
<div id="context-menu"></div>
<script src="${xtermJs}"></script>
<script src="${addonFitJs}"></script>
<script src="${addonWebLinksJs}"></script>
<script src="${addonUnicode11Js}"></script>
<script src="${addonSearchJs}"></script>
<script src="${addonWebglJs}"></script>
<script src="${addonClipboardJs}"></script>
<script src="${keymapUri}"></script>
<script src="${soundUri}"></script>
<script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

async function pickAndOpenSession(terminalProvider: TmuxTerminalViewProvider): Promise<void> {
  const baseName = currentBaseName();
  if (!baseName) {
    vscode.window.showErrorMessage(vscode.l10n.t('Tmux Opener: open a folder or workspace first.'));
    return;
  }

  const sessions = listTmuxSessions();
  const related = relatedSessions(baseName, sessions);
  const newSessionName = nextSessionName(baseName, sessions);

  const newItem: vscode.QuickPickItem = {
    label: `$(add) ${vscode.l10n.t('New session ({0})', newSessionName)}`,
    alwaysShow: true,
  };
  const existingItems: vscode.QuickPickItem[] = related.map((s) => ({
    label: `$(terminal) ${s.name}`,
    description: `${s.windows} window${s.windows === 1 ? '' : 's'}${s.attached ? ' • attached' : ''}`,
  }));

  const picked = await vscode.window.showQuickPick([newItem, ...existingItems], {
    placeHolder: vscode.l10n.t('Tmux sessions for "{0}"', baseName),
  });

  if (!picked) {
    return;
  }

  if (picked === newItem) {
    await terminalProvider.openSession(newSessionName);
    return;
  }

  const sessionName = related.find((s) => `$(terminal) ${s.name}` === picked.label)?.name;
  if (sessionName) {
    await terminalProvider.openSession(sessionName);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const terminalProvider = new TmuxTerminalViewProvider(context.extensionUri);

  const openSessionCmd = vscode.commands.registerCommand('tmux-opener.openSession', () =>
    pickAndOpenSession(terminalProvider),
  );
  const openSpecificCmd = vscode.commands.registerCommand(
    'tmux-opener.openSpecificSession',
    (sessionName: string) => terminalProvider.openSession(sessionName),
  );
  const newSessionCmd = vscode.commands.registerCommand('tmux-opener.newSession', () =>
    terminalProvider.openNewSession(),
  );
  const newSessionWithProfileCmd = vscode.commands.registerCommand(
    'tmux-opener.newSessionWithProfile',
    () => terminalProvider.openNewSessionWithProfile(),
  );
  // One command per shipped profile, since package.json menus are static.
  // The label is the settings key, so a user override of that key changes what
  // the menu entry runs without changing the entry itself.
  const builtInProfileCmds = Object.entries(BUILT_IN_PROFILE_IDS).map(([label, id]) =>
    vscode.commands.registerCommand(`tmux-opener.newSession.${id}`, () => {
      const profile = profileByLabel(label);
      if (!profile) {
        vscode.window.showWarningMessage(
          vscode.l10n.t('Tmux Opener: profile "{0}" is disabled.', label),
        );
        return undefined;
      }
      return terminalProvider.openNewSession(profile);
    }),
  );
  const openProfileSettingsCmd = vscode.commands.registerCommand(
    'tmux-opener.openProfileSettings',
    () => vscode.commands.executeCommand('workbench.action.openSettings', 'tmuxOpener.profiles'),
  );
  const killCurrentCmd = vscode.commands.registerCommand('tmux-opener.killCurrentSession', () =>
    terminalProvider.killCurrentSession(),
  );
  const toggleSidebarCmd = vscode.commands.registerCommand('tmux-opener.toggleSidebar', () =>
    terminalProvider.toggleSidebar(),
  );
  const openSettingsCmd = vscode.commands.registerCommand('tmux-opener.openSettings', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`),
  );

  const terminalViewRegistration = vscode.window.registerWebviewViewProvider(
    'tmuxOpener.terminal',
    terminalProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('tmuxOpener.terminal')) {
      terminalProvider.pushFontConfig();
    }
    if (e.affectsConfiguration('tmuxOpener.profiles')) {
      void updateProfileContexts();
      terminalProvider.pushProfiles();
    }
  });

  void updateProfileContexts();

  context.subscriptions.push(
    openSessionCmd,
    openSpecificCmd,
    newSessionCmd,
    newSessionWithProfileCmd,
    ...builtInProfileCmds,
    openProfileSettingsCmd,
    killCurrentCmd,
    toggleSidebarCmd,
    openSettingsCmd,
    terminalViewRegistration,
    terminalProvider,
    configListener,
  );
}

export function deactivate(): void {}

import * as vscode from 'vscode';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import * as pty from 'node-pty';

interface TmuxSession {
  name: string;
  windows: number;
  attached: boolean;
}

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

function sanitizeSessionName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-');
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

/** Session-name suffix for a profile: explicit, else a slug of the label. */
function profileSuffix(profile: TmuxProfile): string {
  const explicit = profile.sessionSuffix?.trim();
  const slug = sanitizeSessionName(explicit || profile.label)
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return slug || 'profile';
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

function relatedSessions(baseName: string, sessions: TmuxSession[]): TmuxSession[] {
  return sessions
    .filter((s) => s.name === baseName || s.name.startsWith(`${baseName}-`))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/**
 * `<base>`, then `<base>-2`, `<base>-3`… A profile narrows this to its own
 * namespace (`<base>-claude`, `<base>-claude-2`), so profile sessions never
 * consume the plain numbering and stay recognizable in the list.
 */
function nextSessionName(baseName: string, sessions: TmuxSession[], suffix?: string): string {
  const taken = new Set(sessions.map((s) => s.name));
  const prefix = suffix ? `${baseName}-${suffix}` : baseName;
  if (!taken.has(prefix)) {
    return prefix;
  }
  let n = 2;
  while (taken.has(`${prefix}-${n}`)) {
    n += 1;
  }
  return `${prefix}-${n}`;
}

function currentBaseName(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return sanitizeSessionName(folders[0].name);
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
    webviewView.onDidDispose(() => {
      this.view = undefined;
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
    }
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
    if (!baseName || !this.view) {
      return;
    }
    const related = relatedSessions(baseName, listTmuxSessions());
    this.view.webview.postMessage({
      type: 'sessions',
      sessions: related.map((s) => ({ name: s.name, attached: s.attached, current: s.name === this.currentSession })),
    });
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
   * killing/exiting the last session would be impossible.
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
    this.view.webview.postMessage({ type: 'info', text: `${text}\r\n` });
    this.pushSessions();
  }

  /**
   * Called when the webview signals it is ready. Attaches to whatever the
   * sidebar shows at the top, so opening the view lands you in a terminal
   * instead of an empty pane. `currentSession` survives a webview reload
   * while the extension host stays alive, so prefer it when set.
   */
  private async attachInitialSession(): Promise<void> {
    const baseName = currentBaseName();
    if (!baseName) {
      return;
    }
    await this.attachSession(this.currentSession ?? this.firstRelatedSession() ?? baseName);
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

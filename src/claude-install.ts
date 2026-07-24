// Pure logic for the "install the Claude Code scripts" nudge, split out of
// extension.ts so `node --test` can exercise it without importing the VS Code
// API or touching the real filesystem (same pattern as bell-notify.ts /
// session-name.ts — Issue #18). The extension host only detects (a few
// `fs.existsSync` calls) and copies a command / opens the README; it never
// writes to `~/.claude`, runs the installer, or edits `settings.json` (design
// #160, adopted plan A). These two functions are the whole of the decision: is
// it installed, and what command should the user paste. Node 24 strips the
// types when the JS test suite requires this file.

/**
 * The four files `scripts/install-claude.sh` writes into `~/.claude`, as paths
 * *relative to* `~/.claude` (`tmux-opener-statusline.sh` at the root, the rest
 * under `hooks/`). These are the **canonical** (current) names: ADR #166 renamed
 * the three generically-named scripts to a `tmux-opener-` prefix so a shared
 * `~/.claude` cannot collide with another tool's `statusline.sh` /
 * `session-state.sh` (`tmux-opener-bell.sh` already had the prefix and did not
 * move). This list is the extension-side mirror of `claude/manifest.txt` (the
 * installer's own canonical list, which the http(s) remote-install path reads)
 * — keep the two in sync: adding or removing a script under `claude/` means
 * updating `claude/manifest.txt` *and* this constant, or the detection here
 * drifts (worst case: a nudge shown to an already-installed user, or one
 * suppressed for a not-yet-installed one). See CLAUDE.md "The Claude Code
 * scripts (`claude/`)".
 */
export const CLAUDE_INSTALL_FILES = [
  'tmux-opener-statusline.sh',
  'hooks/tmux-opener-session-state.sh',
  'hooks/tmux-opener-subagent-idle-gate.sh',
  'hooks/tmux-opener-bell.sh',
] as const;

/**
 * Pre-#166 names, kept as **migration-only compatibility aliases** keyed by the
 * canonical name that replaced each. ADR #166 migration is non-destructive (case
 * b): the installer writes only the new names and never deletes the old ones, so
 * an existing user who installed before the rename still has the generic names
 * wired in `settings.json` and working. During the migration window the extension
 * must treat a file as present when *either* the canonical name or its legacy
 * alias exists, or those users would be misdetected as not-installed and nudged.
 * `tmux-opener-bell.sh` has no alias — it never had a generic name. When the
 * migration window closes, drop this map and `classifyInstallState` reverts to a
 * plain canonical-name check.
 */
export const CLAUDE_INSTALL_LEGACY_ALIASES: Readonly<Record<string, string>> = {
  'tmux-opener-statusline.sh': 'statusline.sh',
  'hooks/tmux-opener-session-state.sh': 'hooks/session-state.sh',
  'hooks/tmux-opener-subagent-idle-gate.sh': 'hooks/subagent-idle-gate.sh',
};

/** Whether the reference scripts are all present, some, or none. */
export type InstallState = 'installed' | 'partial' | 'absent';

/**
 * Classify the install state from an injected existence predicate. The predicate
 * receives a path relative to `~/.claude` and answers whether it exists; keeping
 * the I/O out of this function is what lets the test drive all three branches
 * without a real home directory. The host wires it as
 * `(rel) => fs.existsSync(join(homedir(), '.claude', rel))`, which follows
 * symlinks — matching the installer's respect for a dotfiles-managed destination
 * (design D2).
 *
 * Per ADR #166 each canonical file counts as present when its **new name OR its
 * legacy alias** exists: the new name is checked first, and only if it is absent
 * is the pre-rename alias probed (short-circuit, so a fully-migrated install
 * queries each file exactly once). This is what keeps a user who installed before
 * the rename — still on the generic names — reading as `installed`, not nudged.
 */
export function classifyInstallState(exists: (relPath: string) => boolean): InstallState {
  const present = CLAUDE_INSTALL_FILES.filter((rel) => {
    if (exists(rel)) {
      return true;
    }
    const legacy = CLAUDE_INSTALL_LEGACY_ALIASES[rel];
    return legacy !== undefined && exists(legacy);
  }).length;
  if (present === CLAUDE_INSTALL_FILES.length) {
    return 'installed';
  }
  if (present === 0) {
    return 'absent';
  }
  return 'partial';
}

/**
 * Decide whether the view-open passive nudge (#163) should pop. It fires only
 * when the scripts are not fully present (`absent`/`partial`), at most once per
 * activation (`warnedThisActivation` mirrors the `warnedTmuxMissing` flag so a
 * window reload doesn't nag), and never once the user chose "Don't Show Again"
 * (`permanentlyDismissed`, read from `globalState` — `~/.claude` is a user-global
 * concern, so the dismiss is global, not per-workspace). Keeping the three gates
 * pure lets the test drive them without a `vscode` Memento or a real home dir;
 * the host reads the flags and owns the notification / globalState write. The
 * persistent `installClaudeScripts` command deliberately does NOT use this — it
 * always shows (an explicit user action is never suppressed), same asymmetry as
 * `reportTmuxMissing`'s `interactive` path.
 */
export function shouldShowInstallNudge(
  state: InstallState,
  flags: { warnedThisActivation: boolean; permanentlyDismissed: boolean },
): boolean {
  if (flags.permanentlyDismissed || flags.warnedThisActivation) {
    return false;
  }
  return state === 'absent' || state === 'partial';
}

/**
 * Derive `{owner}/{repo}` from a `package.json` `repository.url` and build the
 * two-line clone-less remote install command README documents (L233-234). The
 * `{owner}/{repo}` comes from the URL so the value is not held twice (design
 * D5). Tolerates the `.git` suffix, a `git+` prefix, a trailing slash, and the
 * `git@github.com:owner/repo` SSH form (plan risk table).
 */
export function buildInstallCommand(repositoryUrl: string): string {
  const { owner, repo } = parseOwnerRepo(repositoryUrl);
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/main`;
  return (
    `curl -fsSL ${base}/scripts/install-claude.sh -o install-claude.sh\n` +
    `bash install-claude.sh --src ${base}/claude`
  );
}

/**
 * Build the README anchor URL the "Open Instructions" action opens, from the
 * same `repository.url` parse `buildInstallCommand` uses. Deriving `{owner}/{repo}`
 * from the URL (design D5) keeps the value in one place: the action follows the
 * repository the extension actually ships from instead of a second hardcoded owner.
 */
export function buildReadmeUrl(repositoryUrl: string): string {
  const { owner, repo } = parseOwnerRepo(repositoryUrl);
  return `https://github.com/${owner}/${repo}#readme`;
}

function parseOwnerRepo(repositoryUrl: string): { owner: string; repo: string } {
  // Strip the trailing slash *before* the `.git` suffix so a `repo.git/` URL
  // reduces to `repo` (the slash would otherwise leave `.git` un-anchored). A
  // second trailing-slash strip after `.git` removal is unreachable for any
  // GitHub URL form, so there is only one.
  const slug = repositoryUrl
    .trim()
    .replace(/^git\+/, '')
    .replace(/^git@github\.com:/, '')
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  const parts = slug.split('/');
  const repo = parts.pop() ?? '';
  const owner = parts.pop() ?? '';
  return { owner, repo };
}

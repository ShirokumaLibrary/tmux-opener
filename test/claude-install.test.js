// Behavioral tests for the pure claude-scripts install-detection logic. Node 24
// strips the types from the required `.ts` module, so this plain-JS suite runs
// it under `node --test` with no build step and no `vscode` import (same pattern
// as test/bell-notify.test.js — Issue #18). This is a *different* concern from
// test/install-claude-snippet.test.js, which checks the installer's printed
// settings.json snippet; here we cover the extension-side detection and the
// remote-install command string it copies to the clipboard.
const { test } = require('node:test');
const assert = require('node:assert');

const {
  CLAUDE_INSTALL_FILES,
  CLAUDE_INSTALL_LEGACY_ALIASES,
  classifyInstallState,
  buildInstallCommand,
  buildReadmeUrl,
  shouldShowInstallNudge,
} = require('../src/claude-install.ts');

// The exact two lines README.md documents (L233-234) as the clone-less remote
// install. buildInstallCommand must reproduce these verbatim for the canonical
// repository.url, so the copied command a user pastes matches the README.
const README_REMOTE_INSTALL =
  'curl -fsSL https://raw.githubusercontent.com/ShirokumaLibrary/tmux-opener/main/scripts/install-claude.sh -o install-claude.sh\n' +
  'bash install-claude.sh --src https://raw.githubusercontent.com/ShirokumaLibrary/tmux-opener/main/claude';

test('CLAUDE_INSTALL_FILES is the installer\'s canonical (post-#166) four-file layout', () => {
  assert.deepStrictEqual(CLAUDE_INSTALL_FILES, [
    'tmux-opener-statusline.sh',
    'hooks/tmux-opener-session-state.sh',
    'hooks/tmux-opener-subagent-idle-gate.sh',
    'hooks/tmux-opener-bell.sh',
  ]);
});

test('CLAUDE_INSTALL_LEGACY_ALIASES maps each renamed file to its pre-#166 name', () => {
  // The bell already had the prefix and never moved, so it has no alias.
  assert.deepStrictEqual(CLAUDE_INSTALL_LEGACY_ALIASES, {
    'tmux-opener-statusline.sh': 'statusline.sh',
    'hooks/tmux-opener-session-state.sh': 'hooks/session-state.sh',
    'hooks/tmux-opener-subagent-idle-gate.sh': 'hooks/subagent-idle-gate.sh',
  });
  assert.ok(
    !('hooks/tmux-opener-bell.sh' in CLAUDE_INSTALL_LEGACY_ALIASES),
    'tmux-opener-bell.sh must have no legacy alias',
  );
});

test('classifyInstallState: all four present under the NEW names -> installed', () => {
  const state = classifyInstallState(() => true);
  assert.strictEqual(state, 'installed');
});

test('classifyInstallState: none present -> absent', () => {
  const state = classifyInstallState(() => false);
  assert.strictEqual(state, 'absent');
});

// ADR #166 migration case b: a user who installed before the rename still has the
// generic names wired and working. They must read as installed, never nudged.
test('classifyInstallState: all four present under the OLD names only -> installed', () => {
  const legacyOnly = new Set([
    'statusline.sh',
    'hooks/session-state.sh',
    'hooks/subagent-idle-gate.sh',
    'hooks/tmux-opener-bell.sh', // unchanged: same name in both eras
  ]);
  const state = classifyInstallState((rel) => legacyOnly.has(rel));
  assert.strictEqual(state, 'installed');
});

// A migration in progress: the three prefixed copies just landed, the pre-rename
// files linger beside them. Either name satisfying a file still means installed.
test('classifyInstallState: mixed new + old names -> installed', () => {
  const present = new Set([
    'tmux-opener-statusline.sh', // new
    'hooks/session-state.sh', // still old
    'hooks/tmux-opener-subagent-idle-gate.sh', // new
    'hooks/tmux-opener-bell.sh', // unchanged
  ]);
  const state = classifyInstallState((rel) => present.has(rel));
  assert.strictEqual(state, 'installed');
});

test('classifyInstallState: only the old statusline present -> partial', () => {
  // The pre-rename statusline.sh exists; the three hooks are missing entirely.
  const state = classifyInstallState((rel) => rel === 'statusline.sh');
  assert.strictEqual(state, 'partial');
});

test('classifyInstallState: exactly one hook missing (new names) -> partial', () => {
  const state = classifyInstallState((rel) => rel !== 'hooks/tmux-opener-bell.sh');
  assert.strictEqual(state, 'partial');
});

test('classifyInstallState queries each canonical file once when the new name is present', () => {
  // A fully-migrated install: the canonical name matches first, so the legacy
  // alias is never probed (short-circuit) and each file is queried exactly once.
  const queried = [];
  classifyInstallState((rel) => {
    queried.push(rel);
    return true;
  });
  assert.deepStrictEqual(queried, CLAUDE_INSTALL_FILES);
});

test('classifyInstallState falls back to the legacy alias only when the new name is absent', () => {
  const queried = [];
  classifyInstallState((rel) => {
    queried.push(rel);
    return false; // nothing exists, so every alias is probed too
  });
  // Each renamed file is queried as new-name then legacy-alias; the bell (no
  // alias) is queried once.
  assert.deepStrictEqual(queried, [
    'tmux-opener-statusline.sh',
    'statusline.sh',
    'hooks/tmux-opener-session-state.sh',
    'hooks/session-state.sh',
    'hooks/tmux-opener-subagent-idle-gate.sh',
    'hooks/subagent-idle-gate.sh',
    'hooks/tmux-opener-bell.sh',
  ]);
});

// The passive nudge decision (#163): view-open shows the install nudge at most
// once per activation, only when the scripts are not fully present, and never
// after the user chose "Don't Show Again" (globalState-backed permanent
// dismiss). These are the exact three gates, driven by injected flags so the
// side-effecting extension host (the fs probe, the notification, the
// globalState write) can stay untested — same split as classifyInstallState.

test('shouldShowInstallNudge: absent, first attach, not dismissed -> shows', () => {
  assert.strictEqual(
    shouldShowInstallNudge('absent', { warnedThisActivation: false, permanentlyDismissed: false }),
    true,
  );
});

test('shouldShowInstallNudge: partial, first attach, not dismissed -> shows', () => {
  assert.strictEqual(
    shouldShowInstallNudge('partial', { warnedThisActivation: false, permanentlyDismissed: false }),
    true,
  );
});

test('shouldShowInstallNudge: installed -> never shows', () => {
  assert.strictEqual(
    shouldShowInstallNudge('installed', { warnedThisActivation: false, permanentlyDismissed: false }),
    false,
  );
});

test('shouldShowInstallNudge: already warned this activation -> suppressed (once per activation)', () => {
  assert.strictEqual(
    shouldShowInstallNudge('absent', { warnedThisActivation: true, permanentlyDismissed: false }),
    false,
  );
});

test('shouldShowInstallNudge: permanently dismissed -> suppressed even on first attach', () => {
  assert.strictEqual(
    shouldShowInstallNudge('absent', { warnedThisActivation: false, permanentlyDismissed: true }),
    false,
  );
  assert.strictEqual(
    shouldShowInstallNudge('partial', { warnedThisActivation: false, permanentlyDismissed: true }),
    false,
  );
});

test('shouldShowInstallNudge: permanent dismiss wins over an unwarned installed-adjacent state', () => {
  // Dismiss short-circuits regardless of the other two inputs.
  assert.strictEqual(
    shouldShowInstallNudge('installed', { warnedThisActivation: false, permanentlyDismissed: true }),
    false,
  );
});

test('buildInstallCommand: canonical repository.url -> README 2-line command', () => {
  const cmd = buildInstallCommand('https://github.com/ShirokumaLibrary/tmux-opener.git');
  assert.strictEqual(cmd, README_REMOTE_INSTALL);
});

test('buildInstallCommand derives {owner}/{repo} from the URL', () => {
  const cmd = buildInstallCommand('https://github.com/acme/widgets.git');
  assert.strictEqual(
    cmd,
    'curl -fsSL https://raw.githubusercontent.com/acme/widgets/main/scripts/install-claude.sh -o install-claude.sh\n' +
      'bash install-claude.sh --src https://raw.githubusercontent.com/acme/widgets/main/claude',
  );
});

test('buildInstallCommand tolerates a URL with no .git suffix', () => {
  const cmd = buildInstallCommand('https://github.com/ShirokumaLibrary/tmux-opener');
  assert.strictEqual(cmd, README_REMOTE_INSTALL);
});

test('buildInstallCommand tolerates a git+ prefix and a trailing slash', () => {
  const cmd = buildInstallCommand('git+https://github.com/ShirokumaLibrary/tmux-opener.git/');
  assert.strictEqual(cmd, README_REMOTE_INSTALL);
});

test('buildInstallCommand tolerates the SSH remote form', () => {
  const cmd = buildInstallCommand('git@github.com:ShirokumaLibrary/tmux-opener.git');
  assert.strictEqual(cmd, README_REMOTE_INSTALL);
});

// The "Open Instructions" README URL is derived from the same repository.url parse
// as the install command, so its {owner}/{repo} is not hardcoded a second time.
test('buildReadmeUrl derives the README anchor from repository.url', () => {
  assert.strictEqual(
    buildReadmeUrl('https://github.com/ShirokumaLibrary/tmux-opener.git'),
    'https://github.com/ShirokumaLibrary/tmux-opener#readme',
  );
});

test('buildReadmeUrl follows a different owner/repo instead of a hardcoded one', () => {
  assert.strictEqual(
    buildReadmeUrl('git@github.com:acme/widgets.git'),
    'https://github.com/acme/widgets#readme',
  );
});

test('buildReadmeUrl tolerates the same URL variants as buildInstallCommand', () => {
  assert.strictEqual(
    buildReadmeUrl('git+https://github.com/ShirokumaLibrary/tmux-opener.git/'),
    'https://github.com/ShirokumaLibrary/tmux-opener#readme',
  );
});

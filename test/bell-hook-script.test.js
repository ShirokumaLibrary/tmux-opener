// Behavioral tests for the reference bell hook `claude/hooks/tmux-opener-bell.sh`
// (Issue #116). Unlike the pure-logic suites, this drives the *actual shell
// script* with spawnSync — the same flavor as test/install-claude-snippet.test.js
// running the installer — so the jq parsing that extracts `notification_type`
// from the Notification hook's stdin JSON is verified against the real script,
// not a model of it.
//
// The pty/BEL half of the script is deliberately NOT exercised: writing BEL to a
// pane's `#{pane_tty}` needs a real tmux server and a real tty, and CLAUDE.md's
// "Verifying the bell" section is explicit that a bell cannot be confirmed from a
// captured shell at all. So a fake `tmux` on PATH answers `display-message`:
// `#S` -> a session name (so the reason file IS written), `#{pane_tty}` -> empty
// (so the script falls to a harmless `printf '\a'` to stdout, entering no pty).
// What this suite checks is exactly the reason-file WRITE — the field the TS
// reader (`readBellReasons`) later trusts.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'claude', 'hooks', 'tmux-opener-bell.sh');
const SESSION = 'testsession';

/**
 * Run tmux-opener-bell.sh with a fake tmux on PATH and the given stdin, then
 * return the parsed reason file it wrote (or `undefined` if none was written).
 * A throwaway HOME/XDG_CACHE_HOME keeps every write inside a temp dir.
 */
function runHook(reason, stdin) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bell-hook-'));
  const binDir = path.join(tmpRoot, 'bin');
  const cacheDir = path.join(tmpRoot, 'cache');
  fs.mkdirSync(binDir);

  // Minimal fake tmux: names a session so the reason file is written, and reports
  // an empty pane_tty so the BEL path falls back to stdout and touches no pty.
  const fakeTmux = path.join(binDir, 'tmux');
  fs.writeFileSync(
    fakeTmux,
    [
      '#!/usr/bin/env bash',
      'case "$*" in',
      `  "display-message -p #S") echo "${SESSION}" ;;`,
      '  "display-message -p #{pane_tty}") echo "" ;;',
      '  *) exit 0 ;;',
      'esac',
      '',
    ].join('\n'),
  );
  fs.chmodSync(fakeTmux, 0o755);

  const res = spawnSync('bash', [SCRIPT, reason], {
    input: stdin,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      TMUX: '/fake/tmux,1234,0', // non-empty so the script takes the tmux branch
      HOME: tmpRoot,
      XDG_CACHE_HOME: cacheDir,
    },
  });
  assert.strictEqual(res.status, 0, `hook exited nonzero: ${res.stderr}`);

  const file = path.join(cacheDir, 'tmux-opener', `bell-${SESSION}.${reason}.json`);
  if (!fs.existsSync(file)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('ask hook records notification_type from stdin JSON', () => {
  for (const type of ['permission_prompt', 'agent_needs_input', 'elicitation_dialog']) {
    const written = runHook('ask', JSON.stringify({ notification_type: type, message: 'x' }));
    assert.strictEqual(written.session, SESSION);
    assert.strictEqual(written.reason, 'ask');
    assert.strictEqual(written.notification_type, type);
  }
});

test('ask hook omits notification_type when stdin has none', () => {
  // A stdin JSON without the field must not leave an empty `notification_type`:
  // an empty string would be read as "typed" and mis-trusted. The field is absent.
  const written = runHook('ask', JSON.stringify({ message: 'x' }));
  assert.strictEqual(written.reason, 'ask');
  assert.ok(!('notification_type' in written), 'notification_type must be absent');
});

test('ask hook omits notification_type on empty / non-JSON stdin', () => {
  for (const stdin of ['', 'not json at all']) {
    const written = runHook('ask', stdin);
    assert.strictEqual(written.reason, 'ask');
    assert.ok(!('notification_type' in written), 'notification_type must be absent');
  }
});

test('stop hook writes no notification_type and discards its stdin', () => {
  // The Stop path carries no notification_type; the reason file stays the plain
  // {session, reason} shape even if stdin happens to contain the field.
  const written = runHook('stop', JSON.stringify({ notification_type: 'permission_prompt' }));
  assert.strictEqual(written.session, SESSION);
  assert.strictEqual(written.reason, 'stop');
  assert.ok(!('notification_type' in written), 'stop must not record a type');
});

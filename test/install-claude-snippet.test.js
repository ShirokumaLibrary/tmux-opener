// Behavioral tests for the settings snippet `scripts/install-claude.sh` prints
// (Issue #108, S2).
//
// The installer never writes ~/.claude/settings.json — it prints the JSON to
// paste (CLAUDE.md: no install is worth an irreversible edit to a file holding
// unrelated config). That makes the *printed text* the deliverable, and the only
// place the Notification wiring is stated. So it is what gets tested: the snippet
// is captured from a `--dry-run` against a throwaway HOME (nothing is written)
// and parsed as JSON.
//
// What the Notification block pins is S2 and the #75 invariant it must not undo:
//
//   1. The matcher lists exactly the three notification types that mean **a human
//      is being waited on** (permission_prompt / agent_needs_input /
//      elicitation_dialog). A Notification hook with no matcher — the wiring
//      before #108 — matches all eight types, so auth_success, an MCP
//      elicitation_complete and an agent_completed each rang the "waiting for
//      your input" bell. That is the whole of the S2 bug.
//   2. `idle_prompt` is NOT among them, and neither is `agent_completed`. The
//      idle bell has exactly one owner — Stop -> subagent-idle-gate.sh main-stop,
//      which defers it while a subagent marker stands (#75/#79). Wiring
//      idle_prompt here would ring a second, ungated bell for the same event:
//      #75 all over again. The bell script appears under no hook event other than
//      Notification, which is that ownership stated as a test.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const INSTALLER = path.join(__dirname, '..', 'scripts', 'install-claude.sh');

// The three types that mean a human is being waited on — and nothing else. This
// list is the single source of truth `ASK_NOTIFICATION_TYPES` (src/status-bridge.ts),
// which `resolveBellReason` trusts to override the co-fire tie-break (#116); the
// matcher checked below must equal it, so the shell matcher and the TS constant
// cannot drift (a type in one but not the other silently breaks one path).
const { ASK_NOTIFICATION_TYPES } = require('../src/status-bridge.ts');
const ASK_TYPES = [...ASK_NOTIFICATION_TYPES];
// Types that must never reach the "waiting for your input" bell. The first two are
// completion signals the gate already owns (#75); the rest are the ones the Issue
// names outright (an authentication succeeding is not a request for input).
const SILENT_TYPES = [
  'idle_prompt',
  'agent_completed',
  'auth_success',
  'elicitation_complete',
  'elicitation_response',
];

/**
 * Run the installer in --dry-run against a throwaway HOME and return its stdout.
 *
 * The install *source* is pinned to this clone's claude/, and pinned twice over,
 * because the installer takes it from the environment as well as the command line
 * (`TMUX_OPENER_CLAUDE_SRC` / `TMUX_OPENER_CLAUDE_GH_REF`, install-claude.sh:66-67)
 * and inheriting process.env would hand it whatever a developer happens to have
 * exported. With a gh:/https: source even --dry-run fetches, so a shell that had
 * once exported one of them made `npm test` — and with it the `npm run vsix:all`
 * release gate — fail for a reason that has nothing to do with the code. What this
 * suite checks is the *printed snippet*, which is the same whatever it installs
 * from, so fixing the source costs nothing.
 *
 * Both mechanisms are closed, deliberately: deleting the variables is what makes
 * the run hermetic (--src overrides only the source, never the ref), and passing
 * --src states in the test what the dry-run installs from instead of leaving it to
 * a default resolved elsewhere.
 */
function runInstaller() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-install-'));
  const env = { ...process.env, HOME: home };
  delete env.TMUX_OPENER_CLAUDE_SRC;
  delete env.TMUX_OPENER_CLAUDE_GH_REF;
  const src = path.join(__dirname, '..', 'claude');
  try {
    const res = spawnSync('bash', [INSTALLER, '--dry-run', '--src', src], {
      env,
      encoding: 'utf8',
    });
    assert.strictEqual(res.status, 0, `installer --dry-run failed: ${res.stderr}`);
    // --dry-run's one promise: it writes nothing. If it wrote here, every other
    // assertion below would be running against a side effect.
    assert.strictEqual(fs.existsSync(path.join(home, '.claude')), false,
      '--dry-run must not create anything under HOME');
    return res.stdout;
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Cut the printed snippet out of the installer's output and parse it. The snippet
 * is a *fragment* of settings.json (the keys to paste), so it is wrapped in braces
 * before parsing — which is also the test that it is pasteable at all.
 */
function parseSnippet(stdout) {
  const lines = stdout.split('\n');
  const start = lines.findIndex((l) => l.includes('"statusLine"'));
  assert.ok(start >= 0, 'installer printed no settings snippet');
  const end = lines.findIndex((l, i) => i > start && l.startsWith('With the gate wired'));
  assert.ok(end > start, 'could not find the end of the printed snippet');
  const body = lines.slice(start, end).join('\n');
  return JSON.parse(`{\n${body}\n}`);
}

/** Every hook command the snippet wires, as [event, command] pairs. */
function hookCommands(settings) {
  const out = [];
  for (const [event, matchers] of Object.entries(settings.hooks)) {
    for (const m of matchers) {
      for (const h of m.hooks) out.push([event, h.command]);
    }
  }
  return out;
}

describe('install-claude.sh: the settings snippet it prints', () => {
  const stdout = runInstaller();
  const settings = parseSnippet(stdout);

  test('is valid, pasteable JSON', () => {
    // parseSnippet already threw if not. Pin the shape callers paste for.
    assert.strictEqual(settings.statusLine.type, 'command');
    assert.strictEqual(settings.statusLine.refreshInterval, 1);
    assert.ok(settings.hooks, 'snippet must wire hooks');
  });

  test('rings the ask bell for exactly the three "waiting on a human" types', () => {
    const notification = settings.hooks.Notification;
    assert.strictEqual(notification.length, 1, 'one Notification entry');
    const [entry] = notification;
    assert.ok(entry.matcher, 'Notification MUST carry a matcher — without one it matches all eight notification types (S2)');
    const types = entry.matcher.split('|');
    assert.deepStrictEqual([...types].sort(), [...ASK_TYPES].sort());
    assert.strictEqual(entry.hooks.length, 1);
    assert.match(entry.hooks[0].command, /tmux-opener-bell\.sh ask$/);
  });

  for (const type of SILENT_TYPES) {
    test(`does not ring for ${type}`, () => {
      const [entry] = settings.hooks.Notification;
      assert.ok(!entry.matcher.split('|').includes(type),
        `${type} must not reach the ask bell`);
    });
  }

  test('leaves the idle bell to the gate, and the gate alone (#75)', () => {
    const commands = hookCommands(settings);
    // The bell script is called from Notification and nowhere else: the gate rings
    // the idle bell itself, once the session is truly idle.
    const bellEvents = commands.filter(([, c]) => c.includes('tmux-opener-bell.sh')).map(([e]) => e);
    assert.deepStrictEqual(bellEvents, ['Notification']);

    const stop = commands.filter(([e]) => e === 'Stop').map(([, c]) => c);
    assert.ok(stop.some((c) => c.endsWith('subagent-idle-gate.sh main-stop')),
      'Stop must call the gate');
    assert.ok(!stop.some((c) => c.includes('tmux-opener-bell.sh')),
      'Stop must NOT call the bell directly — the gate owns that decision');
  });

  test('says out loud why idle_prompt is not wired', () => {
    // The next person to read this snippet will want to add idle_prompt (it is,
    // after all, "Claude is waiting for you"). The reason not to has to be next to
    // the snippet, or it will be added and #75 comes back.
    assert.match(stdout, /idle_prompt/);
    assert.match(stdout, /#75/);
  });
});

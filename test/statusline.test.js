// Behavioral tests for claude/statusline.sh — subagent accounting (Issue #89) and
// the display layer (Issue #92: bar glyphs, working spinner, branch status,
// elapsed units, and the segments that were removed).
//
// Unlike the other suites here, the unit under test is a shell script, so it is
// driven the way Claude Code drives it: the statusline JSON on stdin, the cache
// redirected with XDG_CACHE_HOME, and the rendered lines read off stdout. The
// script needs `jq` (see its header); without it the whole suite is skipped
// rather than failing for an unrelated reason.
//
// What the subagent block pins is the invariant of #75/#79 as it applies *inside*
// the statusline, in the two claims that survive #92's removal of the
// `🏃 N subagent(s)` badge:
//
//   1. A stopped main turn with markers still standing renders **working**, not
//      idle. The gate defers the bell in exactly that state, and a statusline that
//      said "idle" beside a bell that hasn't rung would be contradicting it.
//   2. The marker dir is listed **exactly once** per render. #89's bug was two
//      `ls` calls whose snapshots could disagree; the badge (the second reader) is
//      gone, but the rule that produced the bug must not come back with the next
//      reader, so the count is pinned at one read.
//
// Together these are the substance of what #89 fixed — the badge assertion it used
// to make ("indicator and badge never disagree") is unrepresentable now that there
// is nothing to disagree with. The `ls` shim below is what makes claim 2 testable:
// a second listing that would report a different marker set is served, and the
// script must never ask for it.
//
// The indicator assertions match the *working state*, never a particular frame:
// which of the ten braille glyphs is on screen is picked off the wall clock, so
// pinning one of them would be pinning something the script is required not to
// promise. WORKING below is "any of the ten frames, followed by ` working`" —
// exactly the claim, and deterministic.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STATUSLINE = path.join(__dirname, '..', 'claude', 'statusline.sh');
const SID = 'e5f8a1c2-0000-4000-8000-000000000089';
const SAFE_SID = SID; // the tr -c 'A-Za-z0-9_-' '_' mapping is the identity for a UUID

const hasJq = spawnSync('jq', ['--version']).status === 0;
const hasGit = spawnSync('git', ['--version']).status === 0;

// Colors are real ESC bytes (the script prints with '%s' and never '%b'), so the
// assertions below compare against text with the SGR sequences taken back out.
// Built from a variable so the control byte never appears in a regex literal.
const ESC = String.fromCharCode(27);
const stripAnsi = (s) => s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

// The ten braille frames the running indicator cycles through, one per second.
const SPIN_FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const WORKING = new RegExp(`[${SPIN_FRAMES}] working`);
const IDLE = /✅ idle/;

/** Lay out a cache dir with a session state file and `markers` subagent markers. */
function makeCache({ state = 'stopped', markers = 0, subDir = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-test-'));
  const stateDir = path.join(root, 'cache', 'claude-code-state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, `${SAFE_SID}.json`), JSON.stringify({ state }));
  if (subDir) {
    const dir = path.join(root, 'cache', 'tmux-opener', `subagents-${SAFE_SID}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < markers; i++) fs.writeFileSync(path.join(dir, `agent-${i}`), '');
  }
  return root;
}

/**
 * Install an `ls` earlier on PATH than the real one. It only answers for the
 * marker dir (everything else is delegated), and `mode` picks what it simulates:
 *   'race' — first listing sees 2 markers, every later one sees none (a subagent
 *            finishing between two reads).
 *   'gone' — the dir was removed after the -d test: exit non-zero, print nothing.
 */
function makeLsShim(root, mode) {
  const dir = path.join(root, 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const counter = path.join(root, 'ls-calls');
  fs.writeFileSync(
    path.join(dir, 'ls'),
    [
      '#!/usr/bin/env bash',
      'for target; do :; done',      // last argument = the dir being listed
      'case "$target" in',
      '  *subagents-*) ;;',
      `  *) exec /bin/ls "$@" ;;`,
      'esac',
      `n=0; [ -f '${counter}' ] && n=$(cat '${counter}')`,
      `n=$((n + 1)); printf '%s' "$n" > '${counter}'`,
      mode === 'gone'
        ? 'exit 2'
        : "if [ \"$n\" -eq 1 ]; then printf 'agent-a\\nagent-b\\n'; fi\nexit 0",
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  return { binDir: dir, callsFile: counter };
}

/**
 * Run the statusline over `root`'s cache and return its stripped stdout.
 * `json` is merged into the stdin payload, `cwd` overrides the reported
 * workspace dir (the git segment reads it), `env` adds environment.
 */
function runStatusline(root, { binDir, json = {}, cwd = root, env: extraEnv = {}, raw = false } = {}) {
  const env = {
    PATH: binDir ? `${binDir}:${process.env.PATH}` : process.env.PATH,
    HOME: root,
    XDG_CACHE_HOME: path.join(root, 'cache'),
    // TMUX deliberately unset by default: the bridge write at the end of the
    // script must not touch the developer's real cache. The one test that does
    // exercise it passes TMUX *and* keeps XDG_CACHE_HOME pointed at `root`.
    ...extraEnv,
  };
  const input = JSON.stringify({
    session_id: SID,
    model: { display_name: 'Claude' },
    workspace: { current_dir: cwd },
    cost: { total_cost_usd: 0.42, total_duration_ms: 1000 },
    ...json,
  });
  const out = execFileSync('bash', [STATUSLINE], { input, env, encoding: 'utf8' });
  // `raw` keeps the SGR sequences, which is the only way to assert on the *colors* —
  // and on the bar's background not leaking past its reset.
  return raw ? out : stripAnsi(out);
}

describe('claude/statusline.sh subagent accounting', { skip: hasJq ? false : 'jq not installed' }, () => {
  // @testdoc An empty marker set on a stopped main turn is the idle case: the
  // indicator reads idle, which is exactly when the gate fires the bell.
  test('no markers: idle', () => {
    const out = runStatusline(makeCache({ state: 'stopped', markers: 0 }));
    assert.match(out, IDLE);
  });

  // @testdoc Same, when the marker dir does not exist at all (hooks never ran).
  test('no marker dir: idle', () => {
    const out = runStatusline(makeCache({ state: 'stopped', subDir: false }));
    assert.match(out, IDLE);
  });

  // @testdoc Claim 1, the load-bearing half of the count: a non-empty marker set
  // suppresses idle even though the main turn stopped. This is what the gate does
  // with the same marker set (defer the idle bell), and the statusline must not say
  // "idle" while the bell is being held back. Deleting the badge (#92 B-5) must not
  // take this with it — it is the whole reason the count still exists.
  test('stopped + 2 markers: renders working, not idle', () => {
    const out = runStatusline(makeCache({ state: 'stopped', markers: 2 }));
    assert.match(out, WORKING);
    assert.doesNotMatch(out, IDLE);
  });

  // @testdoc One marker suppresses idle just as two do — the test is the set being
  // non-empty, not its size (nothing renders the size any more).
  test('stopped + 1 marker: renders working, not idle', () => {
    const out = runStatusline(makeCache({ state: 'stopped', markers: 1 }));
    assert.match(out, WORKING);
    assert.doesNotMatch(out, IDLE);
  });

  // @testdoc The badge is gone (#92 B-5): Claude Code already reports its own
  // subagents, and the statusline was repeating it. Nothing about the running
  // subagents renders — only the suppression above survives.
  test('running subagents render no badge', () => {
    const out = runStatusline(makeCache({ state: 'stopped', markers: 2 }));
    assert.doesNotMatch(out, /🏃/);
    assert.doesNotMatch(out, /subagent/i);
  });

  // @testdoc Claim 2, the structural rule behind #89: the marker dir is listed
  // exactly once per render. The shim serves a *different* set on any second
  // listing, so a script that counted twice would be reading two snapshots — the
  // bug #89 fixed. One read cannot race a read that does not exist.
  test('the marker dir is listed exactly once per render', () => {
    const root = makeCache({ state: 'stopped', markers: 2 });
    const { binDir, callsFile } = makeLsShim(root, 'race');
    runStatusline(root, { binDir });
    assert.strictEqual(fs.readFileSync(callsFile, 'utf8'), '1');
  });

  // @testdoc And the one read is the one the suppression consumes: with the shim
  // reporting an empty set on every listing after the first, the indicator still
  // reads working — it settled on the snapshot it took, and never went back.
  test('a marker set that changes between reads cannot flip the indicator', () => {
    const root = makeCache({ state: 'stopped', markers: 2 });
    const { binDir } = makeLsShim(root, 'race');
    const out = runStatusline(root, { binDir });
    assert.match(out, WORKING);
    assert.doesNotMatch(out, IDLE);
  });

  // @testdoc TOCTOU: a concurrent idle-gate reset can remove the dir between the
  // -d test and the listing. Under `set -e` + pipefail that failing exit status
  // would abort the whole statusline, so it must be swallowed: the script still
  // renders (exit 0), counting 0.
  test('marker dir removed mid-count: still renders, counts 0', () => {
    const root = makeCache({ state: 'stopped', markers: 2 });
    const { binDir } = makeLsShim(root, 'gone');
    const out = runStatusline(root, { binDir });
    assert.match(out, /🤖 Claude/); // the rest of the statusline survived
    assert.match(out, IDLE);
  });

  // @testdoc A running main turn shows working regardless of the marker set.
  test('running main turn: working', () => {
    const out = runStatusline(makeCache({ state: 'running', markers: 0 }));
    assert.match(out, WORKING);
  });
});

describe('claude/statusline.sh working spinner', { skip: hasJq ? false : 'jq not installed' }, () => {
  // @testdoc The spinner is gated on real hook state, not on the clock: it turns
  // *while running*, and a stopped session with no subagents shows none of the
  // frames at all. That gating is the whole reason it means anything (#92 A-3).
  test('running renders one of the ten braille frames; idle renders none', () => {
    const running = runStatusline(makeCache({ state: 'running' }));
    assert.match(running, WORKING);

    const idle = runStatusline(makeCache({ state: 'stopped', markers: 0 }));
    assert.match(idle, IDLE);
    assert.doesNotMatch(idle, new RegExp(`[${SPIN_FRAMES}]`));
  });

  // @testdoc The frame is picked with a bash *array* index, not a substring
  // slice: `${str:i:1}` counts characters only in a UTF-8 locale and bytes under
  // LC_ALL=C, which would cut a 3-byte braille glyph into a mojibake fragment.
  // The array indexes elements, so the frame survives any locale.
  test('a non-UTF-8 locale does not corrupt the frame', () => {
    const out = runStatusline(makeCache({ state: 'running' }), {
      env: { LC_ALL: 'C', LANG: 'C' },
    });
    assert.match(out, WORKING);
  });
});

// The bar is 10 cells of EIGHTHS, not 10 cells of one bit each (#92 A-1). Ten steps
// turned out to be too coarse on a real machine: 3% and 7% both drew ten empty cells,
// and everything from 40% to 49% drew the same picture. The partial block glyphs
// ▏▎▍▌▋▊▉ give each cell eight levels, so the bar has 80 steps (1.25% each) in the
// same ten columns.
//
// The groove is a bright-black BACKGROUND, not a ░ glyph — and the empty cells are
// therefore spaces. ░ made the bar look broken: a partial cell inks only its left
// fraction, so `██████▎░░░` read as solid, then a gap of bare terminal background,
// then dots. Painting the track as a background means the unlit part of the partial
// cell matches the empty cells beside it and the bar is continuous. Everything below
// pins the consequences: the glyphs, the spaces, and — most of all — that the
// background is CLOSED at the end of the bar. A leaked background does not fail
// quietly; it paints the rest of the line.
const BAR_CELLS = '[█▏▎▍▌▋▊▉ ]{10}'; // the ten cells, whatever they are on the day
describe('claude/statusline.sh bars', { skip: hasJq ? false : 'jq not installed' }, () => {
  // @testdoc The context bar draws in block glyphs, not ASCII. Safe because the
  // sanitizer strips only C0 controls (bytes >= 0x80 pass through) and the bar is
  // internally generated anyway — it never crosses the sanitize path (#92 A-1).
  test('the context bar is drawn with █ over a space groove', () => {
    const out = runStatusline(makeCache(), {
      json: { context_window: { used_percentage: 50 } },
    });
    assert.match(out, /🧠 █████ {5} 50%/);
    assert.doesNotMatch(out, /#{2,}-{2,}/);
    assert.doesNotMatch(out, /▓/); // the old half-tone glyph
    assert.doesNotMatch(out, /░/); // and the old groove glyph: both gone
  });

  // @testdoc The eighths. Each case is `pct → bar`, computed as
  // floor(pct * 10 * 8 / 100) eighths: full cells, then the one partial cell, then
  // spaces (the bare groove) to the end. The two ends are the load-bearing ones — a
  // rounding bug that let an 81st eighth exist would leave 100% one cell short, and
  // one that rounded up would put a ▏ on a 0% bar.
  const cases = [
    ['0% is bare groove', 0, '          '],
    ['3% is a sliver that ten steps could not show at all', 3, '▎         '],
    ['7% still fits inside the first cell', 7, '▋         '],
    ['23%', 23, '██▎       '],
    ['42%', 42, '████▏     '],
    ['58%', 58, '█████▊    '],
    ['63%', 63, '██████▎   '],
    ['88%', 88, '████████▊ '],
    ['99% is not yet full', 99, '█████████▉'],
    ['100% is all block, with no partial cell left over', 100, '██████████'],
  ];
  for (const [name, pct, bar] of cases) {
    test(`the context bar at ${name}`, () => {
      const out = runStatusline(makeCache(), {
        json: { context_window: { used_percentage: pct } },
      });
      assert.match(out, new RegExp(`🧠 ${bar} ${pct}%`));
    });
  }

  // @testdoc THE one that matters: the bar's background must be closed before the
  // text after it. If it isn't, the terminal paints the groove color across the cost,
  // the timer and the rest of the line.
  //
  // The loop below is the ONE guard, and it is sufficient on its own: it walks every
  // SGR that opens the groove (`<fg>;100m`) and requires exactly ten cells and then a
  // reset immediately after it. There is nowhere for a leak to hide — a bar that
  // failed to close would not be followed by `[0m`, and the assertion is anchored
  // (`^`) at the character right after the open.
  //
  // It has to run on the RAW output: a stripped one has no SGR left in it and cannot
  // show a leak at all. It is also verified to actually fire — deleting the closing
  // `[0m` from render_bar makes it fail. That check is not decoration: this test used
  // to carry a second, "belt and braces" assertion
  // (`doesNotMatch(raw, /;100m[^ESC]*$/)`) that was pure theatre. Without the `m`
  // flag its `$` only ever matched the very end of the whole output, so it passed
  // even against a bar with its reset removed and a background leaking to end of
  // line. It was deleted rather than repaired: the loop already covers the property
  // completely, and a second assertion that *looks* like a safety net while catching
  // nothing is worse than no second assertion — it invites you to trust it.
  test('the groove background never leaks past the bar', () => {
    const raw = runStatusline(makeCache(), {
      raw: true,
      json: {
        context_window: { used_percentage: 42 },
        rate_limits: { five_hour: { used_percentage: 42 }, seven_day: { used_percentage: 80 } },
      },
    });

    const opens = [...raw.matchAll(new RegExp(`${ESC}\\[\\d+;100m`, 'g'))];
    assert.strictEqual(opens.length, 3); // context + 5h + 7d, and nothing else
    for (const open of opens) {
      const after = raw.slice(open.index + open[0].length);
      assert.match(after, new RegExp(`^${BAR_CELLS}${ESC}\\[0m`));
    }
  });

  // @testdoc The fill colors stay asymmetric, over one shared groove. The context bar
  // colors its own fill by usage (pct_color: 32/33/31); the rate-limit bars keep a
  // flat blue fill (34) and let their percentage carry the green/yellow/red, so they
  // don't visually compete with it. The `;100m` groove is common to both — the track
  // means the same thing everywhere, only the level differs.
  test('fill color: context self-colors, rate-limit is flat blue; groove is shared', () => {
    const low = runStatusline(makeCache(), {
      raw: true,
      json: {
        context_window: { used_percentage: 42 },
        rate_limits: { five_hour: { used_percentage: 42 } },
      },
    });
    assert.ok(low.includes(`${ESC}[32;100m`)); // context at 42% is green
    assert.ok(low.includes(`${ESC}[34;100m`)); // 5h is blue whatever its value
    assert.ok(low.includes(`${ESC}[32m42%`)); // ...and the *percentage* carries green

    const high = runStatusline(makeCache(), {
      raw: true,
      json: {
        context_window: { used_percentage: 90 },
        rate_limits: { five_hour: { used_percentage: 90 } },
      },
    });
    assert.ok(high.includes(`${ESC}[31;100m`)); // context at 90% is red
    assert.ok(high.includes(`${ESC}[34;100m`)); // 5h bar is *still* blue
    assert.ok(high.includes(`${ESC}[31m90%`)); // and the percentage went red
  });

  // @testdoc render_bar is the one implementation behind both bars, so the rate-limit
  // bars get the eighths and the groove too. (#92 A-2: the Issue reported a
  // `render_bar_fixed()` as "missing", but no such function was ever in this tree —
  // only in the old ~/.claude copy. render_bar has always taken the color as an
  // argument, which is how the rate-limit bars stay flat blue while the context bar
  // colors itself. There is nothing to restore; restoring it would split the one
  // implementation in two.)
  test('the rate-limit bars use the same cells, including the partial one', () => {
    const out = runStatusline(makeCache(), {
      json: { rate_limits: { five_hour: { used_percentage: 42 }, seven_day: { used_percentage: 80 } } },
    });
    assert.match(out, /⏳ 5h ████▏ {5} 42%/);
    assert.match(out, /📅 7d ████████ {2} 80%/);
    assert.doesNotMatch(out, /░/);
  });

  // @testdoc The 0% and 100% ends hold on the rate-limit bars as well — they are a
  // property of render_bar, and there is only one of it. 0% draws no partial cell.
  test('the rate-limit bars hold both ends', () => {
    const out = runStatusline(makeCache(), {
      json: { rate_limits: { five_hour: { used_percentage: 0 }, seven_day: { used_percentage: 100 } } },
    });
    // 12 spaces: the one separating `5h` from the bar, the ten bare-groove cells,
    // and the one before the percentage.
    assert.match(out, /⏳ 5h {12}0%/);
    assert.match(out, /📅 7d ██████████ 100%/);
    assert.doesNotMatch(out, /[▏▎▍▌▋▊▉]/); // neither end has a partial cell
  });

  // @testdoc The partial glyph is picked out of a bash *array*, like the spinner
  // frames: `${str:i:1}` counts characters only in a UTF-8 locale and bytes under
  // LC_ALL=C, which would cut a 3-byte block glyph into mojibake. Indexing an array
  // is the same operation in every locale.
  test('a non-UTF-8 locale does not corrupt the partial cell', () => {
    const out = runStatusline(makeCache(), {
      json: { context_window: { used_percentage: 42 } },
      env: { LC_ALL: 'C', LANG: 'C' },
    });
    assert.match(out, /🧠 ████▏ {5} 42%/);
  });
});

describe('claude/statusline.sh elapsed time', { skip: hasJq ? false : 'jq not installed' }, () => {
  // @testdoc Elapsed time switches unit with magnitude — a long session used to
  // read `⏱️ 7384s`, which nobody converts in their head (#92 B-4).
  //
  // The hour+minute form carries a space (`2h 3m`), so the two units read as two
  // and not as one run-on token. The single-unit forms have nothing to separate and
  // are unchanged, and a whole hour stays `1h` rather than becoming `1h 0m`.
  const cases = [
    ['zero', 0, /⏱️ 0s/],
    ['seconds below a minute', 45_000, /⏱️ 45s/],
    ['the last second below a minute', 59_000, /⏱️ 59s/],
    ['exactly one minute', 60_000, /⏱️ 1m/],
    ['minutes below an hour', 720_000, /⏱️ 12m/],
    ['the last minute below an hour', 3_599_000, /⏱️ 59m/],
    ['hours with minutes are spaced', 7_384_000, /⏱️ 2h 3m/],
    ['one hour and one minute', 3_660_000, /⏱️ 1h 1m/],
    ['a whole hour drops the minutes', 3_600_000, /⏱️ 1h(?![\s\d])/],
  ];
  for (const [name, ms, expected] of cases) {
    test(name, () => {
      const out = runStatusline(makeCache(), {
        json: { cost: { total_cost_usd: 0.42, total_duration_ms: ms } },
      });
      assert.match(out, expected);
    });
  }
});

describe('claude/statusline.sh removed segments', { skip: hasJq ? false : 'jq not installed' }, () => {
  // @testdoc `exceeds_200k_tokens` said nothing the context bar doesn't already
  // say, and the PR is already visible elsewhere. Both are gone — including their
  // reads — so neither renders even when the schema reports them (#92 B-1 / B-2).
  test('exceeds_200k_tokens and the PR are not rendered', () => {
    const out = runStatusline(makeCache(), {
      json: {
        exceeds_200k_tokens: true,
        pr: { number: 92, review_state: 'approved' },
        vim: { mode: 'INSERT' },
      },
    });
    assert.doesNotMatch(out, /200k/);
    assert.doesNotMatch(out, /🔀/);
    assert.doesNotMatch(out, /#92/);
    assert.match(out, /⌨️ INSERT/); // the line those two shared still renders
  });
});

describe('claude/statusline.sh line-end clear (#100)', { skip: hasJq ? false : 'jq not installed' }, () => {
  // Erase-to-end-of-line control. `[` opens a char class in a RegExp, so it is
  // escaped when a pattern is needed; `endsWith`/`split` take it as a plain string.
  const CLEAR = `${ESC}[K`;
  const CLEAR_RE = `${ESC}\\[K`;

  // @testdoc Every rendered line ends with ESC[K, so a frame shorter than the last
  // one leaves no tail of the previous frame on screen (#100: the terminal
  // over-writes cells but never erases the ones the new line doesn't reach). The
  // two always-present lines (model, cost) carry it, and nowhere else does —
  // exactly one clear per line, at its end.
  test('the two always-present lines each end with ESC[K, once', () => {
    const raw = runStatusline(makeCache(), { raw: true });
    const lines = raw.split('\n');
    assert.strictEqual(lines.length, 2);
    for (const line of lines) assert.ok(line.endsWith(CLEAR), `line does not end with ESC[K: ${JSON.stringify(line)}`);
    assert.strictEqual(raw.split(CLEAR).length - 1, 2); // one per line, no more
  });

  // @testdoc When lines 3 (rate limits) and 4 (thinking/vim) render, they get the
  // clear too — the erase is on every present line, not just the always-on pair.
  test('lines 3 and 4, when present, also end with ESC[K', () => {
    const raw = runStatusline(makeCache(), {
      raw: true,
      json: {
        rate_limits: { five_hour: { used_percentage: 42 } },
        thinking: { enabled: true },
        vim: { mode: 'INSERT' },
      },
    });
    const lines = raw.split('\n');
    assert.strictEqual(lines.length, 4);
    for (const line of lines) assert.ok(line.endsWith(CLEAR), `line does not end with ESC[K: ${JSON.stringify(line)}`);
    assert.strictEqual(raw.split(CLEAR).length - 1, 4);
  });

  // @testdoc THE acceptance criterion: the clear runs on the default background,
  // never a colored one. Each colored line closes its SGR with `[0m` *before* the
  // ESC[K, so the erase paints cleared cells in the default background and does not
  // drag a fill color (e.g. the bar's `;100m` groove) across them. Verified two
  // ways: the reset sits immediately before the clear on the colored lines, and no
  // groove open reaches a clear without a reset between them. Delete the `[0m`
  // ordering (or the reset) and both fail.
  test('the clear follows a color reset, never an open background', () => {
    const raw = runStatusline(makeCache(), {
      raw: true,
      json: {
        rate_limits: { five_hour: { used_percentage: 42 } }, // line 3 ends `…%[0m`
        thinking: { enabled: true },                                       // line 4 ends `ON[0m`
      },
    });
    const lines = raw.split('\n');
    assert.strictEqual(lines.length, 4);
    assert.ok(lines[2].endsWith(`${ESC}[0m${CLEAR}`)); // rate-limit line
    assert.ok(lines[3].endsWith(`${ESC}[0m${CLEAR}`)); // thinking line
    // No groove background (`<fg>;100m`) ever runs up to a clear with no reset
    // between them: after the bar's cells comes the ESC of `[0m`, which the
    // negated class stops at, so this must not match.
    assert.doesNotMatch(raw, new RegExp(`;100m[^${ESC}]*${CLEAR_RE}`));
  });
});

/** A git repo whose branch tracks a local bare "remote", so ahead/behind are real. */
function makeRepo(root) {
  const gitEnv = {
    ...process.env,
    HOME: root,
    GIT_CONFIG_NOSYSTEM: '1',
    // Not implied by HOME: git reads $XDG_CONFIG_HOME/git/config as global config
    // independently of it, so a developer with XDG_CONFIG_HOME set and
    // `commit.gpgsign = true` (or core.hooksPath, or gpg.format = ssh with no key)
    // would have every `git commit` here fail — and these eight tests would go red
    // for a reason that has nothing to do with the statusline. Point global config
    // at /dev/null and the repo is built from git's own defaults.
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com',
  };
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { env: gitEnv, stdio: 'pipe' });

  fs.mkdirSync(remote, { recursive: true });
  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { env: gitEnv, stdio: 'pipe' });
  fs.mkdirSync(work, { recursive: true });
  execFileSync('git', ['init', '-b', 'main', work], { env: gitEnv, stdio: 'pipe' });
  fs.writeFileSync(path.join(work, 'f.txt'), 'one\n');
  git(work, 'add', 'f.txt');
  git(work, 'commit', '-m', 'c1');
  git(work, 'remote', 'add', 'origin', remote);
  git(work, 'push', '-u', 'origin', 'main');

  const commit = (text) => {
    fs.writeFileSync(path.join(work, 'f.txt'), text);
    git(work, 'commit', '-am', `c-${text.trim()}`);
  };
  return {
    work,
    git: (...args) => git(work, ...args),
    commit,
    // Like git(), but returns the exit status instead of throwing — for commands
    // that are *expected* to fail, i.e. the conflicting merge below. It must run
    // under the same gitEnv: without the GIT_AUTHOR/COMMITTER identity a merge
    // fails before it can conflict, which looks the same from the outside (non-zero
    // exit) while leaving the worktree clean.
    tryGit: (...args) => spawnSync('git', ['-C', work, ...args], { env: gitEnv, stdio: 'pipe' }).status,
    // dirty() edits a *tracked* file; untracked() adds a file git has never seen.
    // The two are deliberately separate: the script reports them with different
    // markers, so a test that wants one must not accidentally produce the other.
    dirty: () => fs.writeFileSync(path.join(work, 'f.txt'), 'dirty\n'),
    untracked: () => fs.writeFileSync(path.join(work, 'new.txt'), 'new\n'),
  };
}

describe('claude/statusline.sh branch status', { skip: hasJq && hasGit ? false : 'jq or git not installed' }, () => {
  // @testdoc A clean branch level with its upstream shows the name alone — no
  // markers invented for "nothing to report" (the show-nothing-rather-than-
  // something-wrong rule applies to the git segment too).
  test('clean and in sync: the branch name alone', () => {
    const root = makeCache();
    const repo = makeRepo(root);
    const out = runStatusline(root, { cwd: repo.work });
    assert.match(out, /🌿 main(?! ?[↑↓✚…])/);
  });

  // @testdoc Ahead of the upstream, with an unstaged change to a tracked file:
  // ↑N and the dirty marker (#92 B-3).
  test('ahead + dirty: ↑2 ✚', () => {
    const root = makeCache();
    const repo = makeRepo(root);
    repo.commit('two\n');
    repo.commit('three\n');
    repo.dirty();
    const out = runStatusline(root, { cwd: repo.work });
    assert.match(out, /🌿 main ↑2 ✚/);
  });

  // @testdoc Behind the upstream and clean: ↓N, no dirty marker.
  test('behind + clean: ↓1', () => {
    const root = makeCache();
    const repo = makeRepo(root);
    repo.commit('two\n');
    repo.git('push', 'origin', 'main');
    repo.git('reset', '--hard', 'HEAD~1');
    const out = runStatusline(root, { cwd: repo.work });
    assert.match(out, /🌿 main ↓1(?! ?[✚…])/);
  });

  // @testdoc Diverged: both counts, ahead first.
  test('diverged: ↑1↓1', () => {
    const root = makeCache();
    const repo = makeRepo(root);
    repo.commit('two\n');
    repo.git('push', 'origin', 'main');
    repo.git('reset', '--hard', 'HEAD~1');
    repo.commit('other\n');
    const out = runStatusline(root, { cwd: repo.work });
    assert.match(out, /🌿 main ↑1↓1/);
  });

  // @testdoc No upstream: `branch.ab` is simply absent from the porcelain, so
  // there is no ahead/behind to show and none is shown.
  test('no upstream: the name alone', () => {
    const root = makeCache();
    const repo = makeRepo(root);
    repo.git('checkout', '-b', 'fix/92-statusline');
    const out = runStatusline(root, { cwd: repo.work });
    assert.match(out, /🌿 fix\/92-statusline(?! ?[↑↓])/);
  });

  // @testdoc Detached HEAD: `branch.head` reads `(detached)`, which is not a name
  // anyone can act on, so it falls back to the short commit id.
  test('detached HEAD: the short commit id', () => {
    const root = makeCache();
    const repo = makeRepo(root);
    repo.commit('two\n');
    const sha = execFileSync('git', ['-C', repo.work, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
    repo.git('checkout', '--detach', 'HEAD');
    const out = runStatusline(root, { cwd: repo.work });
    assert.match(out, new RegExp(`🌿 ${sha}`));
    assert.doesNotMatch(out, /detached/);
  });

  // @testdoc Outside a repo (or with no git at all) the segment is absent, not
  // an error line: the git call is best-effort like every other read here.
  test('outside a repo: no branch segment', () => {
    const out = runStatusline(makeCache());
    assert.doesNotMatch(out, /🌿/);
  });

  // @testdoc The load-bearing constraint of #92 B-3: the ahead/behind and dirty
  // markers are *display*, and must not reach the bridge JSON the script writes to
  // status-<session>.json — an on-disk format this repo's README documents, so its
  // `branch` must stay a branch name. Nothing in this tree parses that key today
  // (src/status-bridge.ts reads only cost_usd and context_used_percentage), which
  // is why this test exists: a grep for consumers finds none, and the separation
  // looks obsolete right up until a decorated `main ↑1 ✚` is what the file
  // publishes. This pins the format, not a caller.
  test('the bridge JSON carries the raw branch name, never the decoration', () => {
    const root = makeCache();
    const repo = makeRepo(root);
    repo.commit('two\n');
    repo.dirty();

    // A `tmux` that reports a session name, so the bridge write runs — against
    // this test's XDG_CACHE_HOME, never the developer's real cache.
    const binDir = path.join(root, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(
      path.join(binDir, 'tmux'),
      '#!/usr/bin/env bash\nprintf \'%s\\n\' bridge-test\n',
      { mode: 0o755 },
    );

    const out = runStatusline(root, { binDir, cwd: repo.work, env: { TMUX: '/dev/null,1,0' } });
    assert.match(out, /🌿 main ↑1 ✚/); // the display *is* decorated

    const bridge = JSON.parse(
      fs.readFileSync(path.join(root, 'cache', 'tmux-opener', 'status-bridge-test.json'), 'utf8'),
    );
    assert.strictEqual(bridge.branch, 'main');
    assert.strictEqual(bridge.session, 'bridge-test');
  });
});

// Untracked files get their own marker, and the reason they are not folded into ✚
// is that folding them in kills the signal. This repository keeps an intentionally
// untracked `.shirokuma/notes/`, so a ✚ that also meant "untracked" would be lit
// permanently — a marker that is always on reports nothing. The two states also
// call for different actions: tracked changes are work you have to commit, stray
// untracked files usually are not. So `✚` stays "you have uncommitted work" and
// `…` is "there are files git has never seen".
//
// The porcelain=v2 entry types decide it, and each one is pinned below:
//   `1 ` changed, `2 ` renamed, `u ` unmerged  -> ✚
//   `? ` untracked                             -> …
// The old `?*) dirty=1` catch-all ("any line that isn't a header means dirty")
// could not tell them apart, which is why it had to go.
describe('claude/statusline.sh untracked files', { skip: hasJq && hasGit ? false : 'jq or git not installed' }, () => {
  // @testdoc Untracked files alone: the … marker, and NOT ✚. Under the old
  // --untracked-files=no this worktree read as fully clean (no marker at all), so
  // this is the behavior change the switch to =normal buys.
  test('untracked only: … and no ✚', () => {
    const root = makeCache();
    const repo = makeRepo(root);
    repo.untracked();
    const out = runStatusline(root, { cwd: repo.work });
    assert.match(out, /🌿 main …/);
    assert.doesNotMatch(out, /✚/);
  });

  // @testdoc A tracked edit alone still means ✚ and nothing else: the new marker
  // must not start appearing on worktrees that have no untracked file in them.
  test('tracked change only: ✚ and no …', () => {
    const root = makeCache();
    const repo = makeRepo(root);
    repo.dirty();
    const out = runStatusline(root, { cwd: repo.work });
    assert.match(out, /🌿 main ✚(?! ?…)/);
    assert.doesNotMatch(out, /…/);
  });

  // @testdoc Both at once: both markers, ✚ first (the one that calls for action).
  test('tracked change + untracked: ✚ …', () => {
    const root = makeCache();
    const repo = makeRepo(root);
    repo.dirty();
    repo.untracked();
    const out = runStatusline(root, { cwd: repo.work });
    assert.match(out, /🌿 main ✚ …/);
  });

  // @testdoc A staged-but-uncommitted new file is a `1 ` entry, not a `? ` one —
  // git tracks it the moment it is added — so it reads as ✚, not …. This is the
  // line between the two markers, drawn where git draws it.
  test('a staged new file is tracked work: ✚, not …', () => {
    const root = makeCache();
    const repo = makeRepo(root);
    repo.untracked();
    repo.git('add', 'new.txt');
    const out = runStatusline(root, { cwd: repo.work });
    assert.match(out, /🌿 main ✚/);
    assert.doesNotMatch(out, /…/);
  });

  // @testdoc An unmerged (conflicted) path is a `u ` entry and counts as ✚: a
  // worktree in the middle of a conflict is dirty by any definition.
  test('an unmerged path counts as ✚', () => {
    const root = makeCache();
    const repo = makeRepo(root);
    repo.git('checkout', '-b', 'side');
    repo.commit('side\n');
    repo.git('checkout', 'main');
    repo.commit('mainline\n');
    // The merge must actually conflict, or the test asserts nothing.
    assert.notStrictEqual(repo.tryGit('merge', 'side'), 0);
    assert.ok(fs.existsSync(path.join(repo.work, '.git', 'MERGE_HEAD')));

    const out = runStatusline(root, { cwd: repo.work });
    assert.match(out, /✚/);
  });

  // @testdoc The markers compose with ahead/behind, in the documented order:
  // ↑N↓M first, then ✚, then ….
  test('ahead + tracked change + untracked: ↑2 ✚ …', () => {
    const root = makeCache();
    const repo = makeRepo(root);
    repo.commit('two\n');
    repo.commit('three\n');
    repo.dirty();
    repo.untracked();
    const out = runStatusline(root, { cwd: repo.work });
    assert.match(out, /🌿 main ↑2 ✚ …/);
  });

  // @testdoc The … is display, like ✚ and ↑N before it: the bridge JSON's `branch`
  // stays a bare branch name (the same format constraint the ✚ test above pins —
  // restated for the new marker, because the trap is the marker, not the count).
  test('the bridge JSON is unaffected by the untracked marker', () => {
    const root = makeCache();
    const repo = makeRepo(root);
    repo.untracked();

    const binDir = path.join(root, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(
      path.join(binDir, 'tmux'),
      '#!/usr/bin/env bash\nprintf \'%s\\n\' bridge-test\n',
      { mode: 0o755 },
    );

    const out = runStatusline(root, { binDir, cwd: repo.work, env: { TMUX: '/dev/null,1,0' } });
    assert.match(out, /🌿 main …/);

    const bridge = JSON.parse(
      fs.readFileSync(path.join(root, 'cache', 'tmux-opener', 'status-bridge-test.json'), 'utf8'),
    );
    assert.strictEqual(bridge.branch, 'main');
  });

  // @testdoc Switching to =normal means attacker-influenced text — file names — now
  // reaches the porcelain parser, so pin what makes that safe. Three properties, and
  // none of them is "we escape it":
  //
  //   1. A path name never lands in a variable at all. The `? `/`1 ` arms set a flag
  //      (`untracked=1`), so the path is read and dropped; only `# branch.*` lines
  //      are ever bound to anything. Nothing to inject into, nothing to print.
  //   2. A newline in a path cannot split a line into a forged header, because git
  //      C-quotes any path containing one (and " and non-ASCII, unless core.quotePath
  //      is off) — the porcelain line stays a single line.
  //   3. A file *named* `# branch.ab +9 -9` does not become a header: the entry line
  //      begins with `? `, so it lands in the untracked arm. The `'# branch.ab '*`
  //      pattern is anchored at the start of the line, which the path is not.
  //
  // The assertion is therefore the strong one: no fragment of any of these names
  // appears anywhere in the rendered output, and the counts stay real.
  test('adversarial untracked file names cannot reach the output', () => {
    const root = makeCache();
    const repo = makeRepo(root);
    const hostile = [
      'a file with spaces.txt',
      'quote".txt',
      'new\nline.txt',            // the line-splitting attempt
      '# branch.ab +9 -9',        // a file named like a porcelain header
      '# branch.head evil',       // ...and like the header the branch name comes from
      '日本語のファイル.txt',       // non-ASCII: quoted by git, must not corrupt anything
      '$(touch pwned).txt',       // command substitution, if a path were ever eval'd
      '../escape.txt'.replace('/', '_'), // a plain odd name; no traversal is attempted
    ];
    for (const name of hostile) fs.writeFileSync(path.join(repo.work, name), 'x\n');

    const out = runStatusline(root, { cwd: repo.work });

    // The untracked marker fires — the files were seen...
    assert.match(out, /🌿 main …/);
    // ...and nothing they carry is echoed: no path text, no forged header, and the
    // ahead/behind counts are not the +9 -9 the file name tried to supply.
    for (const fragment of ['spaces', 'quote', 'line.txt', 'evil', '日本語', 'pwned', 'escape', 'branch.']) {
      assert.doesNotMatch(out, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.doesNotMatch(out, /↑9|↓9/);
    assert.doesNotMatch(out, /[↑↓]/); // no upstream divergence exists, so no arrow at all
    assert.ok(!fs.existsSync(path.join(repo.work, 'pwned')));
  });
});

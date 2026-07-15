// Behavioral tests for the pure statusline-bridge logic. Node 24 strips the
// types from the required `.ts` module, so this plain-JS suite runs it under
// `node --test` with no build step and no `vscode` import (same pattern as
// test/bell-notify.test.js and test/session-name.test.js — Issue #41).
//
// The four acceptance cases (design #39 / plan #40): context+cost rendered
// together, context=null falling back to cost only (`($0.45)`), a stale mtime
// past the freshness window yielding no detail, and a parse failure yielding no
// detail. Everything under test is pure — path/name derivation, freshness, and
// detail composition — so the FS-touching wrapper in extension.ts stays thin.
const { test } = require('node:test');
const assert = require('node:assert');

const {
  STATUS_FRESHNESS_MS,
  BELL_COFIRE_MS,
  BELL_SETTLE_MS,
  safeSessionName,
  statusFilePath,
  bellReasonFilePath,
  resolveBellReason,
  ASK_NOTIFICATION_TYPES,
  isApprovalNotificationType,
  shouldSettleBell,
  selectPreset,
  selectToastMessageKey,
  TOAST_DEFAULT,
  TOAST_STOP,
  TOAST_ASK,
  DETAIL_CONTEXT_COST,
  DETAIL_COST_ONLY,
  isFresh,
  composeDetail,
  detailFromBridge,
} = require('../src/status-bridge.ts');

test('STATUS_FRESHNESS_MS is 30 seconds', () => {
  assert.strictEqual(STATUS_FRESHNESS_MS, 30_000);
});

test('safeSessionName replaces every non [A-Za-z0-9_-] char with _', () => {
  assert.strictEqual(safeSessionName('my-project_2'), 'my-project_2');
  assert.strictEqual(safeSessionName('feat/foo bar.baz'), 'feat_foo_bar_baz');
  assert.strictEqual(safeSessionName('a.b:c'), 'a_b_c');
});

test('statusFilePath honors XDG_CACHE_HOME when set', () => {
  const p = statusFilePath('my proj', { XDG_CACHE_HOME: '/xdg' }, '/home/u');
  assert.strictEqual(p, '/xdg/tmux-opener/status-my_proj.json');
});

test('statusFilePath falls back to $HOME/.cache when XDG unset or empty', () => {
  assert.strictEqual(
    statusFilePath('proj', {}, '/home/u'),
    '/home/u/.cache/tmux-opener/status-proj.json',
  );
  assert.strictEqual(
    statusFilePath('proj', { XDG_CACHE_HOME: '' }, '/home/u'),
    '/home/u/.cache/tmux-opener/status-proj.json',
  );
});

test('isFresh: at or under 30s is fresh, over 30s is stale', () => {
  const now = 1_000_000;
  assert.strictEqual(isFresh(now, now), true); // 0ms old
  assert.strictEqual(isFresh(now - 30_000, now), true); // exactly at the window
  assert.strictEqual(isFresh(now - 30_001, now), false); // just past the window
});

test('composeDetail renders context and cost together', () => {
  const detail = composeDetail({ context_used_percentage: 82, cost_usd: 0.45 });
  assert.strictEqual(detail, ' (context 82%, cost $0.45)');
});

test('composeDetail falls back to cost only when context is null', () => {
  assert.strictEqual(
    composeDetail({ context_used_percentage: null, cost_usd: 0.45 }),
    ' (cost $0.45)',
  );
});

test('composeDetail returns undefined without a numeric cost', () => {
  assert.strictEqual(composeDetail({ context_used_percentage: 82 }), undefined);
  assert.strictEqual(composeDetail({ cost_usd: 'nope' }), undefined);
  assert.strictEqual(composeDetail(null), undefined);
});

test('detailFromBridge: fresh file with context+cost', () => {
  const now = 1_000_000;
  const raw = JSON.stringify({ context_used_percentage: 82, cost_usd: 0.45 });
  assert.strictEqual(detailFromBridge(raw, now, now), ' (context 82%, cost $0.45)');
});

test('detailFromBridge: context=null yields cost only (cost $0.45)', () => {
  const now = 1_000_000;
  const raw = JSON.stringify({ context_used_percentage: null, cost_usd: 0.45 });
  assert.strictEqual(detailFromBridge(raw, now, now), ' (cost $0.45)');
});

test('detailFromBridge: mtime past 30s yields undefined', () => {
  const now = 1_000_000;
  const raw = JSON.stringify({ context_used_percentage: 82, cost_usd: 0.45 });
  assert.strictEqual(detailFromBridge(raw, now - 30_001, now), undefined);
});

test('detailFromBridge: parse failure yields undefined', () => {
  const now = 1_000_000;
  assert.strictEqual(detailFromBridge('{ not json', now, now), undefined);
});

test('detailFromBridge honors an injected translator (l10n)', () => {
  const now = 1_000_000;
  const raw = JSON.stringify({ context_used_percentage: 82, cost_usd: 0.45 });
  const detail = detailFromBridge(raw, now, now, () => ' translated');
  assert.strictEqual(detail, ' translated');
});

// --- bell-reason sound (Issue #47) ---------------------------------------

test('BELL_COFIRE_MS is 3 seconds and BELL_SETTLE_MS is 250ms', () => {
  assert.strictEqual(BELL_COFIRE_MS, 3_000);
  assert.strictEqual(BELL_SETTLE_MS, 250);
});

test('bellReasonFilePath builds bell-<safe>.<reason>.json under the cache dir', () => {
  assert.strictEqual(
    bellReasonFilePath('my proj', 'ask', { XDG_CACHE_HOME: '/xdg' }, '/home/u'),
    '/xdg/tmux-opener/bell-my_proj.ask.json',
  );
  assert.strictEqual(
    bellReasonFilePath('proj', 'stop', {}, '/home/u'),
    '/home/u/.cache/tmux-opener/bell-proj.stop.json',
  );
});

test('resolveBellReason ①: neither fresh falls back to stop', () => {
  const now = 1_000_000;
  const stale = now - STATUS_FRESHNESS_MS - 1;
  assert.strictEqual(
    resolveBellReason({ stopMtime: stale, askMtime: stale, now }),
    'stop',
  );
  assert.strictEqual(
    resolveBellReason({ stopMtime: undefined, askMtime: undefined, now }),
    'stop',
  );
});

test('resolveBellReason ②: only one fresh yields that reason', () => {
  const now = 1_000_000;
  const stale = now - STATUS_FRESHNESS_MS - 1;
  assert.strictEqual(
    resolveBellReason({ stopMtime: now, askMtime: undefined, now }),
    'stop',
  );
  assert.strictEqual(
    resolveBellReason({ stopMtime: stale, askMtime: now, now }),
    'ask',
  );
});

test('resolveBellReason ③: both fresh within cofire window prefers stop', () => {
  const now = 1_000_000;
  // ask newer than stop but within BELL_COFIRE_MS -> stop still wins
  assert.strictEqual(
    resolveBellReason({ stopMtime: now - BELL_COFIRE_MS, askMtime: now, now }),
    'stop',
  );
  assert.strictEqual(
    resolveBellReason({ stopMtime: now, askMtime: now, now }),
    'stop',
  );
});

test('resolveBellReason ④: both fresh beyond cofire uses the newer mtime', () => {
  const now = 1_000_000;
  // ask clearly newer, gap > cofire -> ask
  assert.strictEqual(
    resolveBellReason({ stopMtime: now - BELL_COFIRE_MS - 1, askMtime: now, now }),
    'ask',
  );
  // stop newer, gap > cofire -> stop
  assert.strictEqual(
    resolveBellReason({ stopMtime: now, askMtime: now - BELL_COFIRE_MS - 1, now }),
    'stop',
  );
});

test('ASK_NOTIFICATION_TYPES is exactly the #108 matcher set', () => {
  // The single source of truth for the "a human is waiting" notification types.
  // MUST stay identical to the Notification matcher printed by
  // scripts/install-claude.sh (`permission_prompt|agent_needs_input|elicitation_dialog`);
  // the drift guard that ties this array to the actual printed matcher lives in
  // test/install-claude-snippet.test.js.
  assert.deepStrictEqual(ASK_NOTIFICATION_TYPES, [
    'permission_prompt',
    'agent_needs_input',
    'elicitation_dialog',
  ]);
});

test('isApprovalNotificationType recognizes only the human-waiting types', () => {
  for (const t of ASK_NOTIFICATION_TYPES) {
    assert.strictEqual(isApprovalNotificationType(t), true);
  }
  // Completion / non-waiting types and anything absent are not approval prompts.
  for (const t of ['agent_completed', 'elicitation_complete', 'idle_prompt', 'auth_success', '']) {
    assert.strictEqual(isApprovalNotificationType(t), false);
  }
  assert.strictEqual(isApprovalNotificationType(undefined), false);
});

test('resolveBellReason #116: a fresh, typed approval ask beats the co-fire tie-break', () => {
  const now = 1_000_000;
  // stop and ask land within BELL_COFIRE_MS of each other. Rule ③ alone (mtime
  // only) would return 'stop' — the bug #116 fixes. With askType a recognizable
  // approval type, ask is trusted instead, anywhere inside the co-fire window
  // including identical mtimes. (Beyond the window the newer mtime decides — see
  // the F-1 tests below.)
  for (const askType of ASK_NOTIFICATION_TYPES) {
    assert.strictEqual(
      resolveBellReason({ stopMtime: now, askMtime: now - 2_500, now, askType }),
      'ask',
    );
    assert.strictEqual(
      resolveBellReason({ stopMtime: now, askMtime: now, now, askType }),
      'ask',
    );
  }
});

test('resolveBellReason #116: an unrecognized / absent type falls back to the mtime tie-break', () => {
  const now = 1_000_000;
  // A completion-type Notification (a matcher-less legacy wiring can still write
  // one) or a missing type is NOT trusted, so the original rule ③ still wins for
  // legacy users — their #75 protection is unchanged.
  assert.strictEqual(
    resolveBellReason({ stopMtime: now, askMtime: now - 2_500, now, askType: 'agent_completed' }),
    'stop',
  );
  assert.strictEqual(
    resolveBellReason({ stopMtime: now, askMtime: now - 2_500, now, askType: undefined }),
    'stop',
  );
  assert.strictEqual(
    resolveBellReason({ stopMtime: now, askMtime: now - 2_500, now }),
    'stop',
  );
});

test('resolveBellReason #116: type cannot rescue an ask that is no longer fresh', () => {
  const now = 1_000_000;
  const stale = now - STATUS_FRESHNESS_MS - 1;
  // The freshness gate stays load-bearing: a stale ask, even a genuinely typed
  // approval prompt, is too old to be "now" — it does not override a fresh stop.
  assert.strictEqual(
    resolveBellReason({ stopMtime: now, askMtime: stale, now, askType: 'permission_prompt' }),
    'stop',
  );
  // And with neither fresh, it still falls back to the safe 'stop', type or not.
  assert.strictEqual(
    resolveBellReason({ stopMtime: stale, askMtime: stale, now, askType: 'permission_prompt' }),
    'stop',
  );
});

test('resolveBellReason #116 (F-1): a typed ask far older than a newer stop yields stop', () => {
  const now = 1_000_000;
  // The regression F-1 fixes. A real approval prompt rang at t=0 (ask file typed),
  // the human approved, and the *same* turn completed 25s later (a fresh stop).
  // At that completion bell the ask file is still fresh (25s < 30s) and still
  // carries `permission_prompt` — but the stop is 25s NEWER, far beyond the
  // co-fire window, so the human clearly resolved the prompt. Trusting the type
  // here would mis-play "waiting for your input" on a turn that just finished.
  // The type is honored only *inside* the co-fire window; beyond it the newer
  // mtime decides (rule ④), so this resolves 'stop'.
  assert.strictEqual(
    resolveBellReason({ stopMtime: now, askMtime: now - 25_000, now, askType: 'permission_prompt' }),
    'stop',
  );
});

test('resolveBellReason #116 (F-1): a typed ask newer than an old stop, beyond cofire, still wins', () => {
  const now = 1_000_000;
  // The mirror case: the newer-mtime rule ④ resolves a genuinely separate ask on
  // its own, without needing the type branch at all. stop is 10s old, the typed
  // ask is now — gap > cofire, ask newer -> 'ask'.
  assert.strictEqual(
    resolveBellReason({ stopMtime: now - 10_000, askMtime: now, now, askType: 'permission_prompt' }),
    'ask',
  );
});

test('selectPreset returns the ask preset for ask, else the stop preset', () => {
  assert.strictEqual(selectPreset('ask', 'classic', 'siren'), 'siren');
  assert.strictEqual(selectPreset('stop', 'classic', 'siren'), 'classic');
  assert.strictEqual(selectPreset('weird', 'classic', 'siren'), 'classic');
});

// --- toast wording (Issue #64 论点 C1) ------------------------------------

// @testdoc The detail suffix now carries a `cost` label (论点 e), so the two
// source-keyed l10n constants must be the labelled English strings the ja
// bundle mirrors. Guards against a silent revert of the label.
test('DETAIL constants carry the cost label', () => {
  assert.strictEqual(DETAIL_CONTEXT_COST, ' (context {0}%, cost ${1})');
  assert.strictEqual(DETAIL_COST_ONLY, ' (cost ${0})');
});

// @testdoc The three toast source keys are stable English strings (they are
// also the l10n lookup keys), so the ja bundle and any caller stay in sync.
test('TOAST message keys are the three source strings', () => {
  assert.strictEqual(TOAST_DEFAULT, 'Session "{0}" needs attention.');
  assert.strictEqual(TOAST_STOP, 'Session "{0}" has finished.');
  assert.strictEqual(TOAST_ASK, 'Session "{0}" is waiting for your input.');
});

// @testdoc No fresh reason file (anyFresh false) keeps the neutral default
// wording, so a user without the bell-reason hook sees exactly the old toast
// regardless of the (unused) reason argument.
test('selectToastMessageKey: not fresh yields the neutral default', () => {
  assert.strictEqual(selectToastMessageKey(false, 'stop'), TOAST_DEFAULT);
  assert.strictEqual(selectToastMessageKey(false, 'ask'), TOAST_DEFAULT);
});

// @testdoc A fresh reason splits the wording: 'stop' -> completion,
// 'ask' -> waiting-for-input, and any unknown reason falls back to stop
// (mirrors selectPreset's safe default).
test('selectToastMessageKey: fresh reason picks stop/ask wording', () => {
  assert.strictEqual(selectToastMessageKey(true, 'stop'), TOAST_STOP);
  assert.strictEqual(selectToastMessageKey(true, 'ask'), TOAST_ASK);
  assert.strictEqual(selectToastMessageKey(true, 'weird'), TOAST_STOP);
});

// @testdoc shouldSettleBell decides whether notifyBell waits BELL_SETTLE_MS and
// re-reads the reason files (Issue #113). The gate is *existence*, not freshness:
// the hooks only ever overwrite the reason files and never delete them, so a file
// that exists at all — even one long past STATUS_FRESHNESS_MS — is a stable signal
// that this session is bell-hook-wired, and settling for it lets a fresh reason the
// hook writes around the BEL land before the reason is chosen. This is the cold
// case the old freshness gate missed: a session idle past 30s whose approval
// prompt's reason arrives milliseconds after a reason-less BEL.
test('shouldSettleBell is true when either reason file exists, however stale', () => {
  // A file's mtime is a number the moment the file exists; freshness is not tested
  // here on purpose — a stale mtime (0, an epoch away from any plausible `now`)
  // still means "the hook has written this session at least once".
  assert.strictEqual(shouldSettleBell({ stopMtime: 0, askMtime: undefined }), true);
  assert.strictEqual(shouldSettleBell({ stopMtime: undefined, askMtime: 0 }), true);
  assert.strictEqual(shouldSettleBell({ stopMtime: 123, askMtime: 456 }), true);
});

test('shouldSettleBell is false only when neither reason file has ever existed', () => {
  // The zero-latency invariant: a user without the bell-reason hooks (both mtimes
  // undefined) — and the very first bell of any session, before any hook has
  // written — must skip the settle entirely and keep the plain preset / neutral
  // toast. This is the case #113 must NOT regress.
  assert.strictEqual(shouldSettleBell({ stopMtime: undefined, askMtime: undefined }), false);
});

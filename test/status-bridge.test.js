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

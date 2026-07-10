'use strict';

// Regression tests for the terminal copy/paste key chords. These guard the two
// bugs that shipped in 90bcfdc (fixed in 12a97bb) and went unnoticed because
// there was no test suite:
//   1. Ctrl+C failed to clear the selection after copying, so SIGINT could
//      never be sent again while a selection lingered.
//   2. Ctrl+Shift+V omitted preventDefault(), so Chromium's native paste and
//      the extension's own postMessage path both ran — pasting twice.
//
// The logic under test is a pure function; every effect is injected through a
// ctx, so no browser / xterm.js / pty is needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideTerminalKeyEvent } = require('../media/webview-keymap.js');

// Builds a keydown-ish event object with sensible defaults.
function keyEvent(overrides = {}) {
  return {
    type: 'keydown',
    key: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

// Builds a ctx that records which effects fired and how often.
function makeCtx(overrides = {}) {
  const calls = {
    openFind: 0,
    closeFind: 0,
    copySelection: 0,
    clearSelection: 0,
    preventDefault: 0,
    paste: 0,
  };
  const ctx = {
    isMac: false,
    hasSelection: false,
    findbarVisible: false,
    openFind: () => { calls.openFind++; },
    closeFind: () => { calls.closeFind++; },
    copySelection: () => { calls.copySelection++; },
    clearSelection: () => { calls.clearSelection++; },
    preventDefault: () => { calls.preventDefault++; },
    paste: () => { calls.paste++; },
    ...overrides,
  };
  return { ctx, calls };
}

test('non-keydown events pass straight through untouched', () => {
  const { ctx, calls } = makeCtx({ hasSelection: true });
  const result = decideTerminalKeyEvent(keyEvent({ type: 'keyup', key: 'c', ctrlKey: true }), ctx);
  assert.equal(result, true);
  assert.equal(calls.copySelection, 0);
  assert.equal(calls.clearSelection, 0);
});

test('Bug 1 (Linux): Ctrl+C with a selection copies, clears the selection, and swallows the key', () => {
  const { ctx, calls } = makeCtx({ isMac: false, hasSelection: true });
  const result = decideTerminalKeyEvent(keyEvent({ key: 'c', ctrlKey: true }), ctx);
  assert.equal(result, false, 'should return false so xterm swallows the copy chord');
  assert.equal(calls.copySelection, 1);
  assert.equal(calls.clearSelection, 1, 'must clear the selection so the next Ctrl+C is SIGINT again');
});

test('Bug 1 (macOS): Cmd+C with a selection copies and clears the selection', () => {
  const { ctx, calls } = makeCtx({ isMac: true, hasSelection: true });
  const result = decideTerminalKeyEvent(keyEvent({ key: 'c', metaKey: true }), ctx);
  assert.equal(result, false);
  assert.equal(calls.copySelection, 1);
  assert.equal(calls.clearSelection, 1);
});

test('Ctrl+C with no selection is left alone so SIGINT reaches the shell', () => {
  const { ctx, calls } = makeCtx({ isMac: false, hasSelection: false });
  const result = decideTerminalKeyEvent(keyEvent({ key: 'c', ctrlKey: true }), ctx);
  assert.equal(result, true, 'must return true so the shell receives SIGINT');
  assert.equal(calls.copySelection, 0);
  assert.equal(calls.clearSelection, 0);
});

test('Cmd+C with no selection is left alone on macOS', () => {
  const { ctx, calls } = makeCtx({ isMac: true, hasSelection: false });
  const result = decideTerminalKeyEvent(keyEvent({ key: 'c', metaKey: true }), ctx);
  assert.equal(result, true);
  assert.equal(calls.copySelection, 0);
});

test('Ctrl+Shift+C copies everywhere, including macOS', () => {
  const { ctx, calls } = makeCtx({ isMac: true, hasSelection: true });
  const result = decideTerminalKeyEvent(keyEvent({ key: 'c', ctrlKey: true, shiftKey: true }), ctx);
  assert.equal(result, false);
  assert.equal(calls.copySelection, 1);
  assert.equal(calls.clearSelection, 1);
});

test('Ctrl+C on macOS (not the copy chord) reaches the shell even with a selection', () => {
  // On macOS the copy chord is Cmd, so a bare Ctrl+C must still be SIGINT.
  const { ctx, calls } = makeCtx({ isMac: true, hasSelection: true });
  const result = decideTerminalKeyEvent(keyEvent({ key: 'c', ctrlKey: true }), ctx);
  assert.equal(result, true);
  assert.equal(calls.copySelection, 0);
});

test('Bug 2: Ctrl+Shift+V calls preventDefault and requests exactly one paste', () => {
  const { ctx, calls } = makeCtx();
  const result = decideTerminalKeyEvent(keyEvent({ key: 'v', ctrlKey: true, shiftKey: true }), ctx);
  assert.equal(result, false);
  assert.equal(calls.preventDefault, 1, 'must preventDefault so Chromium does not also native-paste');
  assert.equal(calls.paste, 1, 'exactly one paste request');
});

test('Cmd+V is left to the native paste path (handler does not intervene)', () => {
  const { ctx, calls } = makeCtx({ isMac: true });
  const result = decideTerminalKeyEvent(keyEvent({ key: 'v', metaKey: true }), ctx);
  assert.equal(result, true);
  assert.equal(calls.paste, 0);
  assert.equal(calls.preventDefault, 0);
});

test('Ctrl+V (without Shift) is left to the native paste path', () => {
  const { ctx, calls } = makeCtx({ isMac: false });
  const result = decideTerminalKeyEvent(keyEvent({ key: 'v', ctrlKey: true }), ctx);
  assert.equal(result, true);
  assert.equal(calls.paste, 0);
  assert.equal(calls.preventDefault, 0);
});

test('Ctrl+F opens the find bar and swallows the key', () => {
  const { ctx, calls } = makeCtx();
  const result = decideTerminalKeyEvent(keyEvent({ key: 'f', ctrlKey: true }), ctx);
  assert.equal(result, false);
  assert.equal(calls.openFind, 1);
});

test('Cmd+F opens the find bar on macOS', () => {
  const { ctx, calls } = makeCtx({ isMac: true });
  const result = decideTerminalKeyEvent(keyEvent({ key: 'f', metaKey: true }), ctx);
  assert.equal(result, false);
  assert.equal(calls.openFind, 1);
});

test('Escape closes the find bar only when it is visible', () => {
  const visible = makeCtx({ findbarVisible: true });
  assert.equal(decideTerminalKeyEvent(keyEvent({ key: 'Escape' }), visible.ctx), false);
  assert.equal(visible.calls.closeFind, 1);

  const hidden = makeCtx({ findbarVisible: false });
  assert.equal(decideTerminalKeyEvent(keyEvent({ key: 'Escape' }), hidden.ctx), true);
  assert.equal(hidden.calls.closeFind, 0);
});

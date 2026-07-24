'use strict';

// #194: terminal font resolution falls back to `terminal.integrated.font*`
// (not `editor.font*`) when the extension's own settings are unset. These
// drive the pure resolver in `src/terminal-font.ts` (compiled to `out/`).

const test = require('node:test');
const assert = require('node:assert');

const {
  resolveTerminalFontConfig,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
} = require('../src/terminal-font.ts');

const base = {
  tmuxFontFamily: '',
  tmuxFontSize: null,
  terminalFontFamily: '',
  terminalFontSize: undefined,
  editorFontSize: undefined,
};

test('tmux fontFamily wins when set', () => {
  const { fontFamily } = resolveTerminalFontConfig({
    ...base,
    tmuxFontFamily: '"Fira Code", monospace',
    terminalFontFamily: 'Consolas, monospace',
  });
  assert.strictEqual(fontFamily, '"Fira Code", monospace');
});

test('falls back to terminal.integrated.fontFamily when tmux unset', () => {
  const { fontFamily } = resolveTerminalFontConfig({
    ...base,
    terminalFontFamily: 'Consolas, monospace',
  });
  assert.strictEqual(fontFamily, 'Consolas, monospace');
});

test('both unset -> hardcoded monospace fallback (no editor serif leak)', () => {
  const { fontFamily } = resolveTerminalFontConfig({ ...base });
  assert.strictEqual(fontFamily, DEFAULT_FONT_FAMILY);
});

test('tmux fontSize wins when set', () => {
  const { fontSize } = resolveTerminalFontConfig({
    ...base,
    tmuxFontSize: 18,
    terminalFontSize: 16,
    editorFontSize: 12,
  });
  assert.strictEqual(fontSize, 18);
});

test('explicit terminal.integrated.fontSize wins over editor.fontSize', () => {
  const { fontSize } = resolveTerminalFontConfig({
    ...base,
    terminalFontSize: 16,
    editorFontSize: 12,
  });
  assert.strictEqual(fontSize, 16);
});

test('editor.fontSize used when terminal size not explicitly set', () => {
  const { fontSize } = resolveTerminalFontConfig({
    ...base,
    terminalFontSize: undefined,
    editorFontSize: 12,
  });
  assert.strictEqual(fontSize, 12);
});

test('no size source -> hardcoded default', () => {
  const { fontSize } = resolveTerminalFontConfig({ ...base });
  assert.strictEqual(fontSize, DEFAULT_FONT_SIZE);
});

test('tmux fontSize 0 is honoured (nullish, not falsy, coalescing)', () => {
  const { fontSize } = resolveTerminalFontConfig({
    ...base,
    tmuxFontSize: 0,
    editorFontSize: 12,
  });
  assert.strictEqual(fontSize, 0);
});

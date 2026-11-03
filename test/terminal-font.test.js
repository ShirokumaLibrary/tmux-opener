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

// ---------------------------------------------------------------------------
// `editor.fontFamily` must not be named in the user-facing documents (#308).
//
// The resolver above has read `terminal.integrated.fontFamily` since #194, and
// never `editor.fontFamily` — deliberately, so an editor face that is
// proportional or serif can't leak into a terminal. The documents kept saying
// "follows `editor.fontFamily` when empty" for four releases, and one of them
// is the settings UI a user reads while choosing the value.
//
// This is a BAN, not a mirror. It does not re-derive the fallback chain (the
// behavioural tests above own that, and a check that recomputes the formula
// agrees with a wrong formula). It asserts one thing the documents have no
// legitimate reason to do: name a setting this resolver does not read.
//
// WHAT IS BOUND, AND WHAT IS NOT:
//
//   * BOUND: the four documents in `NO_EDITOR_FAMILY_DOCS` — the two READMEs
//     and both `package.nls*.json`. Together these are every user-facing
//     description of `tmuxOpener.terminal.fontFamily`: the Marketplace page,
//     its Japanese counterpart, and the settings UI in both locales.
//   * NOT BOUND, on purpose:
//     - `src/terminal-font.ts` itself, whose header comment names
//       `editor.fontFamily` to explain WHY it is not read. That is the one
//       legitimate mention in the repo, and banning it would delete the
//       reasoning this test exists to protect.
//     - `CLAUDE.md`. It is a maintainer document, not user-facing, and it
//       states the same fact in prose a reviewer reads. #308 fixes its stale
//       line, but a future maintainer note may legitimately name the setting.
//     - `editor.fontSize`, which the resolver DOES read (as the last explicit
//       source). Only the FAMILY is banned; banning both would be false.
//
// If a document ever needs to say "this does NOT follow `editor.fontFamily`",
// that is a deliberate change and this list is where it gets recorded — the
// test goes red first, which is the point.
const fs = require('node:fs');
const path = require('node:path');

const NO_EDITOR_FAMILY_DOCS = [
  'README.md',
  'README.ja.md',
  'package.nls.json',
  'package.nls.ja.json',
];

for (const rel of NO_EDITOR_FAMILY_DOCS) {
  test(`${rel} does not claim the terminal font follows editor.fontFamily`, () => {
    const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    const hits = text
      .split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => line.includes('editor.fontFamily'));
    assert.deepStrictEqual(
      hits,
      [],
      `${rel} names editor.fontFamily, which the resolver never reads:\n` +
        hits.map(([n, line]) => `  ${n}: ${line.trim()}`).join('\n'),
    );
  });
}

test('the resolver never lets an editor value reach fontFamily', () => {
  // The ban above is about words; this is the fact behind it, stated without
  // referring to the resolver's expression. `editorFontSize` is the only
  // editor-sourced input the resolver takes, and no value of it may change the
  // family — including when every family source is empty.
  for (const editorFontSize of [undefined, 12, 32]) {
    const { fontFamily } = resolveTerminalFontConfig({ ...base, editorFontSize });
    assert.strictEqual(fontFamily, DEFAULT_FONT_FAMILY);
  }
});

test('tmux fontSize 0 is honoured (nullish, not falsy, coalescing)', () => {
  const { fontSize } = resolveTerminalFontConfig({
    ...base,
    tmuxFontSize: 0,
    editorFontSize: 12,
  });
  assert.strictEqual(fontSize, 0);
});

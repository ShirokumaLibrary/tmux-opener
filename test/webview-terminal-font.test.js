'use strict';

// Tests for the bundled-font selection predicate — the pure half of the async
// font path added in #175. `usesBundledFont` is what gates the
// `document.fonts.load` await in `resolveFontForMeasure` (webview-terminal.js):
// only a fontFamily that carries `BUNDLED_FAMILY` waits for the ~3.9MB bundled
// TTF (supplied by the font extension since #199) before the terminal measures
// its cell grid. Get this predicate wrong and
// the wait never fires, so the terminal measures against an OS font while the
// bundled glyphs paint a moment later — the metric drift the whole deferral
// exists to prevent (plan #173, #174 review).
//
// The async half (document.fonts) can't run under node --test (jsdom/node have
// no FontFaceSet), so only the pure predicate and the substring-integrity
// invariant are covered here — the same webview-pure-logic split as
// webview-keymap.js / webview-sound.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const {
  BUNDLED_FAMILY,
  usesBundledFont,
  normalizePrimaryFamily,
  fontFamilyMatchesCurrent,
  fontSizeMatchesCurrent,
  findFontFamilyOption,
  fontFamilyChipText,
  fontSizeChipText,
} = require('../media/webview-font.js');

test('BUNDLED_FAMILY is the font\'s original, unmodified family name', () => {
  // The TTF the font extension ships is unchanged (#174), so the @font-face family and this
  // constant are the font's real name. Pinning it guards the rename that would
  // silently break the .includes() match below.
  assert.equal(BUNDLED_FAMILY, 'M PLUS 1 Code');
});

test('the bundled enum value selects the bundled font', () => {
  // The exact string package.json puts in the fontFamily enum at index 1.
  assert.equal(usesBundledFont('"M PLUS 1 Code", monospace'), true);
});

test('a bare bundled family name (no fallback) still selects it', () => {
  assert.equal(usesBundledFont('M PLUS 1 Code'), true);
  assert.equal(usesBundledFont('"M PLUS 1 Code"'), true);
});

test('OS/editor-default families do not select the bundled font', () => {
  assert.equal(usesBundledFont(''), false);
  assert.equal(usesBundledFont('Menlo, monospace'), false);
  assert.equal(usesBundledFont('"Fira Code", monospace'), false);
  assert.equal(
    usesBundledFont(
      'var(--vscode-editor-font-family, Menlo, Monaco, "Courier New", monospace)',
    ),
    false,
  );
});

test('non-string input is safe and selects nothing', () => {
  // resolveFontForMeasure passes the raw config field, which may be absent.
  assert.equal(usesBundledFont(undefined), false);
  assert.equal(usesBundledFont(null), false);
  assert.equal(usesBundledFont(42), false);
});

test('package.json keeps BUNDLED_FAMILY a substring of the bundled enum + label', () => {
  // The drift trap the plan/CLAUDE.md flag: the enum value, the item label and
  // BUNDLED_FAMILY must all agree, or the .includes() gate above stops firing for
  // the option the user actually picked. Assert it against the real manifest so a
  // future edit to either side can't diverge unnoticed.
  const pkg = JSON.parse(
    readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
  );
  const cfg = pkg.contributes.configuration.properties['tmuxOpener.terminal.fontFamily'];

  // enum and enumItemLabels stay index-aligned and equal length.
  assert.equal(cfg.enum.length, cfg.enumItemLabels.length);

  const bundledEnum = cfg.enum.filter((v) => usesBundledFont(v));
  assert.equal(bundledEnum.length, 1, 'exactly one enum value is the bundled font');
  assert.ok(bundledEnum[0].includes(BUNDLED_FAMILY));

  // The label at that same index carries the family name too (for the human
  // reading the dropdown; not gate-critical, but kept in lockstep on purpose).
  const idx = cfg.enum.indexOf(bundledEnum[0]);
  assert.ok(cfg.enumItemLabels[idx].includes(BUNDLED_FAMILY));

  // enumDescriptions gained the bundled entry (index 1), so it has 2 entries.
  assert.equal(cfg.enumDescriptions.length, 2);
});

// --- Font picker check-mark matching (#210, plan #207 task 5, design #204 Low-2)

test('normalizePrimaryFamily strips quotes, collapses whitespace, lowercases', () => {
  assert.equal(normalizePrimaryFamily('"M PLUS 1 Code", monospace'), 'm plus 1 code');
  assert.equal(normalizePrimaryFamily("'M PLUS 1 Code'"), 'm plus 1 code');
  assert.equal(normalizePrimaryFamily('  Menlo ,  monospace '), 'menlo');
  assert.equal(normalizePrimaryFamily('M   PLUS   1   Code'), 'm plus 1 code');
  assert.equal(normalizePrimaryFamily(''), '');
});

test('normalizePrimaryFamily is safe against non-string input', () => {
  assert.equal(normalizePrimaryFamily(undefined), '');
  assert.equal(normalizePrimaryFamily(null), '');
  assert.equal(normalizePrimaryFamily(42), '');
});

test('fontFamilyMatchesCurrent matches the enum value against the effective family', () => {
  // The exact enum spelling matches itself.
  assert.equal(
    fontFamilyMatchesCurrent('"M PLUS 1 Code", monospace', '"M PLUS 1 Code", monospace'),
    true,
  );
  assert.equal(fontFamilyMatchesCurrent('Menlo, monospace', 'Menlo, monospace'), true);
});

test('fontFamilyMatchesCurrent survives hand-written settings.json drift (Low-2)', () => {
  const enumValue = '"M PLUS 1 Code", monospace';
  // Case, quote-style, whitespace and missing-fallback variants a user may type.
  assert.equal(fontFamilyMatchesCurrent(enumValue, "'m plus 1 code', monospace"), true);
  assert.equal(fontFamilyMatchesCurrent(enumValue, '  M PLUS 1 Code ,monospace'), true);
  assert.equal(fontFamilyMatchesCurrent(enumValue, 'M PLUS 1 Code'), true);
  assert.equal(fontFamilyMatchesCurrent(enumValue, '"M PLUS 1 CODE"'), true);
});

test('fontFamilyMatchesCurrent does not false-match on the shared generic', () => {
  // `monospace` appears in every stack; a substring test would wrongly check the
  // standalone `monospace` option against Menlo. Primary-token matching does not.
  assert.equal(fontFamilyMatchesCurrent('monospace', 'Menlo, monospace'), false);
  assert.equal(fontFamilyMatchesCurrent('Monaco, monospace', 'Menlo, monospace'), false);
  // The standalone monospace option matches only a monospace effective family.
  assert.equal(fontFamilyMatchesCurrent('monospace', 'monospace'), true);
});

test('fontSizeMatchesCurrent matches the concrete size and never the null option', () => {
  assert.equal(fontSizeMatchesCurrent(14, 14), true);
  assert.equal(fontSizeMatchesCurrent(16, 14), false);
  // The editor-default (null) option never carries the check — the payload's
  // currentSize is always a resolved concrete number.
  assert.equal(fontSizeMatchesCurrent(null, 14), false);
  assert.equal(fontSizeMatchesCurrent(undefined, 14), false);
});

// --- Split family/size chips (#222, plan #221, design #220)
//
// The 2nd toolbar row shows the effective family and size in TWO separate chips
// (a re-adoption of design #215's rejected option D, per the #219 user request).
// The pure decisions — which listed family option the family chip reflects, and
// the size chip's text — live here so they are covered without a DOM; the
// l10n-aware `fontFamilyLabel` closure stays in webview-terminal.js and is
// injected.

test('findFontFamilyOption returns the option whose value matches the effective family', () => {
  const families = [
    { value: '', bundled: false },
    { value: '"M PLUS 1 Code", monospace', bundled: true },
    { value: 'Menlo, monospace', bundled: false },
  ];
  assert.equal(findFontFamilyOption(families, 'Menlo, monospace'), families[2]);
  // Drift-tolerant via fontFamilyMatchesCurrent (hand-typed settings.json).
  assert.equal(findFontFamilyOption(families, 'M PLUS 1 Code'), families[1]);
});

test('findFontFamilyOption returns null when no option matches or input is malformed', () => {
  const families = [{ value: 'Menlo, monospace', bundled: false }];
  assert.equal(findFontFamilyOption(families, '"Fira Code", monospace'), null);
  assert.equal(findFontFamilyOption(undefined, 'Menlo'), null);
});

test('fontFamilyChipText returns the family label of the matched option (no size)', () => {
  const familyLabelOf = (opt) => (opt.bundled ? `${opt.value} (ext)` : opt.value.split(',')[0]);
  const fontOptions = {
    families: [
      { value: '"M PLUS 1 Code", monospace', bundled: true },
      { value: 'Menlo, monospace', bundled: false },
    ],
    currentFamily: 'Menlo, monospace',
    currentSize: 14,
  };
  // The size is now a separate chip, so the family chip text carries no ` · 14`.
  assert.equal(fontFamilyChipText(fontOptions, familyLabelOf), 'Menlo');
});

test('fontFamilyChipText falls back to a synthesized option when the effective family is unlisted', () => {
  // The effective family need not be a listed preset (an OS font the user set by
  // hand). The chip still spells its primary token via the injected label fn.
  const familyLabelOf = (opt) => opt.value.split(',')[0].replace(/["']/g, '').trim();
  const fontOptions = {
    families: [{ value: 'Menlo, monospace', bundled: false }],
    currentFamily: '"Fira Code", monospace',
    currentSize: 13,
  };
  assert.equal(fontFamilyChipText(fontOptions, familyLabelOf), 'Fira Code');
});

test('fontFamilyChipText returns empty string before the first fontOptions push', () => {
  assert.equal(fontFamilyChipText(null, () => 'x'), '');
});

test('fontSizeChipText returns the concrete size as a string', () => {
  const fontOptions = { families: [], currentFamily: 'Menlo, monospace', currentSize: 14 };
  assert.equal(fontSizeChipText(fontOptions), '14');
});

test('fontSizeChipText returns empty string before the first push or when size is null', () => {
  // Pre-push (fontOptions null) and a defensively-null currentSize both render ''.
  assert.equal(fontSizeChipText(null), '');
  assert.equal(fontSizeChipText({ families: [], currentFamily: 'Menlo', currentSize: null }), '');
});

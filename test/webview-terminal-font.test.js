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
  BUNDLED_FAMILIES,
  BUNDLED_FAMILY_NAMES,
  BUNDLED_FAMILY_ALIASES,
  bundledFamilyOf,
  usesBundledFont,
  normalizePrimaryFamily,
  fontFamilyMatchesCurrent,
  fontSizeMatchesCurrent,
  findFontFamilyOption,
  fontFamilyChipText,
  fontSizeChipText,
  buildFontStack,
} = require('../media/webview-font.js');
const { FONT_REGISTRY, registeredFamilyNames } = require('../src/font-registry.ts');

test('BUNDLED_FAMILY is the shipped TTF\'s own family name', () => {
  // The name table of the file the font extension actually ships — which since
  // #275 is a CONVERSION OUTPUT, not the upstream bytes: `scripts/font-fit/`
  // rewrites the name table along with the outlines, and this string was
  // re-measured off the converted TTF (design #271 R4). The @font-face family and
  // this constant must be that name. Pinning it guards the rename that would
  // silently break the .includes() match below.
  assert.equal(BUNDLED_FAMILY, 'M PLUS 1 Code Term');
});

test('the bundled enum value selects the bundled font', () => {
  // The exact string package.json puts in the fontFamily enum at index 1.
  assert.equal(usesBundledFont('"M PLUS 1 Code Term", monospace'), true);
});

test('a bare bundled family name (no fallback) still selects it', () => {
  assert.equal(usesBundledFont('M PLUS 1 Code Term'), true);
  assert.equal(usesBundledFont('"M PLUS 1 Code Term"'), true);
});

test('a pre-rename settings value still selects the bundled font', () => {
  // The value an untouched settings.json holds. It reaches the same bytes because
  // the old name is a registered alias and getHtml injects an alias-named
  // @font-face too (#275, design #271 R3) — so the load/check wait must fire for
  // it as well, or the terminal measures against an OS font.
  assert.equal(usesBundledFont('"M PLUS 1 Code", monospace'), true);
  assert.equal(usesBundledFont('M PLUS 1 Code'), true);
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

test('package.json keeps every bundled family a substring of its enum value + label', () => {
  // The drift trap the plan/CLAUDE.md flag: the enum value, the item label and
  // the BUNDLED_FAMILIES entry must all agree, or the .includes() gate above stops
  // firing for the option the user actually picked. Assert it against the real
  // manifest so a future edit to either side can't diverge unnoticed.
  const pkg = JSON.parse(
    readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
  );
  const cfg = pkg.contributes.configuration.properties['tmuxOpener.terminal.fontFamily'];

  // enum and enumItemLabels stay index-aligned and equal length.
  assert.equal(cfg.enum.length, cfg.enumItemLabels.length);

  const bundledEnum = cfg.enum.filter((v) => usesBundledFont(v));
  assert.equal(
    bundledEnum.length,
    BUNDLED_FAMILIES.length,
    'one enum value per bundled family',
  );

  // Every bundled family is represented exactly once, and the label at that same
  // index carries the family name too (for the human reading the dropdown; not
  // gate-critical, but kept in lockstep on purpose).
  const matched = bundledEnum.map((v) => bundledFamilyOf(v));
  assert.deepEqual([...matched].sort(), [...BUNDLED_FAMILIES].sort());
  for (const value of bundledEnum) {
    const family = bundledFamilyOf(value);
    const idx = cfg.enum.indexOf(value);
    assert.ok(value.includes(family), `${value} must carry ${family}`);
    assert.ok(
      cfg.enumItemLabels[idx].includes(family),
      `label for ${value} must carry ${family}`,
    );
  }

  // enumDescriptions covers the editor-default entry plus every bundled family
  // (they occupy the leading indexes; the plain OS families carry none).
  assert.equal(cfg.enumDescriptions.length, 1 + BUNDLED_FAMILIES.length);

  // ...and the POSITIONS are fixed, not just the count (#233 follow-up L1).
  // enumDescriptions is index-aligned with enum: VS Code shows description[i]
  // under enum[i]. A length-only assertion cannot see a reorder — move a bundled
  // enum value below an OS family, or swap two nls placeholders, and the settings
  // UI silently attaches the wrong explanation to a font while every existing
  // assertion stays green (the count is unchanged, and each family is still
  // present exactly once).
  //
  // Index 0 is the editor-default entry; indexes 1..N are the bundled families in
  // enum order, each one's %nls.key% placeholder matched to the family by name
  // (spaces/`+` stripped, case-insensitive) so the check is on the *pairing*, not
  // on a hand-copied key list that would need editing for every new family.
  assert.equal(cfg.enum[0], '', 'index 0 is the editor-default entry');
  assert.match(cfg.enumDescriptions[0], /^%.*%$/, 'index 0 description is an nls placeholder');
  // Both bundles, not just the English one (#236 review L-1). A key present in
  // package.nls.json and missing from package.nls.ja.json renders the literal
  // `%key%` in a Japanese UI — the exact silent failure that made renaming the
  // asymmetric `…fontFamily.bundled` key not worth it (#233 follow-up L4). The
  // family name is Latin in every bundle (the faces' own names), so the same
  // squashed containment test works for the Japanese prose unchanged.
  const bundles = ['package.nls.json', 'package.nls.ja.json'].map((f) => [
    f,
    JSON.parse(readFileSync(path.join(__dirname, '..', f), 'utf8')),
  ]);
  const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (let i = 1; i <= BUNDLED_FAMILIES.length; i += 1) {
    const value = cfg.enum[i];
    const family = bundledFamilyOf(value);
    assert.ok(family, `enum index ${i} (${JSON.stringify(value)}) must be a bundled family`);
    const placeholder = cfg.enumDescriptions[i];
    assert.match(placeholder, /^%.+%$/, `enumDescriptions[${i}] must be an nls placeholder`);
    const key = placeholder.slice(1, -1);
    for (const [bundleName, bundle] of bundles) {
      const text = bundle[key];
      assert.ok(text, `${bundleName} has no key ${key} (referenced at enumDescriptions[${i}])`);
      // The description text names the family it sits under. This is what a
      // reorder breaks: the placeholder at index i would resolve to another
      // family's prose.
      assert.ok(
        squash(text).includes(squash(family)),
        `${bundleName}'s ${key} (enumDescriptions[${i}]) must describe ${family}, but its text does not name it`,
      );
    }
    // The label at the same index names it too (already checked above for the
    // set; re-asserted here as the index-position invariant).
    assert.ok(cfg.enumItemLabels[i].includes(family), `enumItemLabels[${i}] must carry ${family}`);
  }
  // Nothing past the bundled block carries a description — the plain OS families
  // rely on their labels, so a description appearing there means the block moved.
  assert.equal(cfg.enumDescriptions.length, 1 + BUNDLED_FAMILIES.length);
  for (let i = 1 + BUNDLED_FAMILIES.length; i < cfg.enum.length; i += 1) {
    assert.equal(bundledFamilyOf(cfg.enum[i]), null, `enum index ${i} must not be a bundled family`);
  }
});

test('the webview bundled-family list matches FONT_REGISTRY exactly (R4 drift guard)', () => {
  // The webview is a plain <script> with no module system, so BUNDLED_FAMILIES is
  // a hand-kept copy of the host's FONT_REGISTRY families (design #229 rejected
  // pushing the registry over the message channel). A family present on one side
  // only is silent: the host would inject an @font-face the webview never waits
  // for (metric drift), or the webview would wait for a face nobody injects.
  assert.deepEqual(
    [...BUNDLED_FAMILIES].sort(),
    FONT_REGISTRY.map((e) => e.family).sort(),
  );
});

test('BUNDLED_FAMILY_NAMES mirrors the host match pool (canonical ∪ aliases) — R11', () => {
  // The second of the two constants R11 split apart (#274). `BUNDLED_FAMILIES` is
  // the canonical set and stays the stand-in for "how many bundled enum entries
  // there are" (the five checks above); `BUNDLED_FAMILY_NAMES` is the *matching
  // pool* `bundledFamilyOf` scans, which also carries the aliases. Widening
  // BUNDLED_FAMILIES itself would have broken all five of those enum-cardinality
  // checks, since aliases never appear in the settings enum.
  //
  // Same hand-copy hazard as the R4 guard above, one level wider: the webview has
  // no module system and cannot import the registry, so the pool is duplicated by
  // hand and held together mechanically. A name present on the host side only is
  // silent — the host injects an @font-face under a name the webview never waits
  // for (metric drift); the reverse waits for a face nobody injects.
  assert.deepEqual(
    [...BUNDLED_FAMILY_NAMES].sort(),
    [...registeredFamilyNames()].sort(),
  );
  // The alias half specifically — vacuous while the mechanism was alias-free
  // (#274), load-bearing since #275 declared the three pre-rename names — and the
  // canonical half is exactly BUNDLED_FAMILIES.
  assert.deepEqual(
    [...BUNDLED_FAMILY_ALIASES.map(([alias]) => alias)].sort(),
    FONT_REGISTRY.flatMap((e) => e.aliases ?? []).sort(),
  );
  for (const [alias, canonical] of BUNDLED_FAMILY_ALIASES) {
    assert.ok(BUNDLED_FAMILY_NAMES.includes(alias), `${alias} must be in the matching pool`);
    assert.ok(BUNDLED_FAMILIES.includes(canonical), `${canonical} must be a canonical family`);
    assert.equal(BUNDLED_FAMILIES.includes(alias), false, `${alias} must NOT be in the enum set`);
  }
});

test('bundledFamilyOf returns the matched POOL name, not the canonical — R11 asymmetry', () => {
  // Deliberately the opposite of the host's `matchRegisteredFamily`, which folds an
  // alias hit to the canonical family. The webview's return value is handed to
  // `document.fonts.load('12px "X"')` / `.check` (media/webview-terminal.js:148-149),
  // so it must name an @font-face that was actually injected — and for an old
  // settings value that is the ALIAS-named block. Folding here would wait on the
  // canonical face instead of the one CSS matches.
  //
  // The walk is over BUNDLED_FAMILY_ALIASES, so it held vacuously while there were
  // none (#274) and has pinned the asymmetry for real since #275 declared them.
  for (const [alias, canonical] of BUNDLED_FAMILY_ALIASES) {
    assert.equal(bundledFamilyOf(`"${alias}", monospace`), alias);
    assert.notEqual(bundledFamilyOf(`"${alias}", monospace`), canonical);
    assert.equal(bundledFamilyOf(`"${canonical}", monospace`), canonical);
  }
  // Every pool name — canonical or alias — is matched as itself.
  for (const name of BUNDLED_FAMILY_NAMES) {
    assert.equal(bundledFamilyOf(`"${name}", monospace`), name);
    assert.equal(bundledFamilyOf(name), name);
  }
});

test('fontFamilyMatchesCurrent folds an alias to its canonical — R12', () => {
  // The picker check-mark and the family chip compare primary tokens, so an old
  // settings value (`"Mgen+ 1mn", monospace`) and its renamed enum entry
  // (`"Mgen+ 1mn Term", monospace`) would compare unequal: the check-mark
  // disappears and the chip loses its "(font extension)" label. "The old value
  // still works" would then be false about the UI even while rendering is intact.
  //
  // Folding happens HERE and not inside `normalizePrimaryFamily`, which stays a
  // registry-free string normalizer (the tests above pin that meaning). And the
  // alias table is keyed through that same normalizer on BOTH sides — miss that
  // and the fold becomes a no-op with no symptom. The direct probes and the
  // lowercase one each fail independently if the keys are not normalized (measured
  // by mutation in the #274 review); what the lowercase probe additionally pins is
  // the drift-tolerance promise itself — that a hand-written value in the wrong
  // case still folds — so neither is redundant with the other.
  for (const [alias, canonical] of BUNDLED_FAMILY_ALIASES) {
    assert.equal(fontFamilyMatchesCurrent(`"${canonical}", monospace`, `"${alias}", monospace`), true);
    assert.equal(fontFamilyMatchesCurrent(`"${alias}", monospace`, `"${canonical}", monospace`), true);
    // Hand-written drift on the alias side (case, quotes, no fallback) still folds.
    assert.equal(fontFamilyMatchesCurrent(`"${canonical}", monospace`, alias.toLowerCase()), true);
  }
  // Unrelated families are still not each other, folding or not.
  assert.equal(fontFamilyMatchesCurrent('Menlo, monospace', 'Monaco, monospace'), false);
});

test('bundledFamilyOf resolves the longest matching family (Rounded is not Mgen+)', () => {
  // 'Mgen+ 1mn Term' is a substring of 'Rounded Mgen+ 1mn Term' (measured from the
  // converted TTFs' name tables, #275; the same relation held pre-rename, #232), so
  // a list-order scan would load/check the wrong face.
  assert.equal(bundledFamilyOf('"Rounded Mgen+ 1mn Term", monospace'), 'Rounded Mgen+ 1mn Term');
  assert.equal(bundledFamilyOf('Rounded Mgen+ 1mn Term'), 'Rounded Mgen+ 1mn Term');
  assert.equal(bundledFamilyOf('"Mgen+ 1mn Term", monospace'), 'Mgen+ 1mn Term');
  assert.equal(bundledFamilyOf('"M PLUS 1 Code Term", monospace'), 'M PLUS 1 Code Term');
  // The pre-rename values, whose pairwise substring relation survives the rename
  // AND now also sits inside the canonicals — four names in one containment chain.
  // Each must still be matched as ITSELF (the R11 asymmetry), so an old
  // `"Rounded Mgen+ 1mn"` may not degrade to `Mgen+ 1mn`, nor be promoted to a
  // canonical whose @font-face block is not the one CSS picked.
  assert.equal(bundledFamilyOf('"Rounded Mgen+ 1mn", monospace'), 'Rounded Mgen+ 1mn');
  assert.equal(bundledFamilyOf('Rounded Mgen+ 1mn'), 'Rounded Mgen+ 1mn');
  assert.equal(bundledFamilyOf('"Mgen+ 1mn", monospace'), 'Mgen+ 1mn');
  assert.equal(bundledFamilyOf('"M PLUS 1 Code", monospace'), 'M PLUS 1 Code');
});

test('bundledFamilyOf returns null for non-bundled and malformed values', () => {
  assert.equal(bundledFamilyOf(''), null);
  assert.equal(bundledFamilyOf('Menlo, monospace'), null);
  assert.equal(bundledFamilyOf(undefined), null);
  assert.equal(bundledFamilyOf(42), null);
});

test('the new bundled enum values select the bundled font path', () => {
  assert.equal(usesBundledFont('"Mgen+ 1mn Term", monospace'), true);
  assert.equal(usesBundledFont('"Rounded Mgen+ 1mn Term", monospace'), true);
  // …and so do the values they replaced.
  assert.equal(usesBundledFont('"Mgen+ 1mn", monospace'), true);
  assert.equal(usesBundledFont('"Rounded Mgen+ 1mn", monospace'), true);
});

test('BUNDLED_FAMILY stays the alias of the first bundled family', () => {
  // Kept for the pre-#233 call sites/tests; the list is the source of truth now.
  assert.equal(BUNDLED_FAMILY, BUNDLED_FAMILIES[0]);
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

// --- fontFallback composition (#290, plan #287 "方針 B")
//
// `tmuxOpener.terminal.fontFallback` names a second family for the characters the
// chosen one has no glyph for. The composition of the two into one CSS stack is
// `buildFontStack`, and it is the ONLY place they are joined — everything that
// judges family identity keeps seeing the primary value alone, which is what makes
// the longest-match mix-up unreachable rather than merely guarded. The tests below
// pin both halves: the function's own behaviour, and (by reading the sources) that
// the join really does happen in one place and nowhere else.

const webviewTerminalSource = readFileSync(
  path.join(__dirname, '..', 'media', 'webview-terminal.js'),
  'utf8',
);
const extensionSource = readFileSync(
  path.join(__dirname, '..', 'src', 'extension.ts'),
  'utf8',
);

// The webview's own DEFAULT_FONT_FAMILY, read out of the source rather than
// re-typed: it is the value `resolveFontForMeasure` returns when the primary face
// did not load, so it is one of the two inputs buildFontStack must handle, and a
// hand-copy here would silently stop testing the real one.
const WEBVIEW_DEFAULT_FONT_FAMILY = (() => {
  const m = webviewTerminalSource.match(
    /const DEFAULT_FONT_FAMILY\s*=\s*\n?\s*'([^']+)';/,
  );
  assert.ok(m, 'could not read DEFAULT_FONT_FAMILY out of media/webview-terminal.js');
  return m[1];
})();

// Values the composition has to survive: every enum spelling, both matcher inputs
// (canonical and alias), hand-written drift, and the two fallback-branch families.
const FAMILY_CORPUS = [
  '',
  'Menlo, monospace',
  'monospace',
  '"Fira Code", monospace',
  WEBVIEW_DEFAULT_FONT_FAMILY,
  'Menlo, Monaco, "Courier New", monospace',
  ...BUNDLED_FAMILY_NAMES.flatMap((name) => [`"${name}", monospace`, name]),
];

test('buildFontStack is the identity when no fallback is configured', () => {
  // The default is '', so this is the state of every user who does not touch the
  // setting: the string handed to xterm must be the one that was handed to it
  // before #290 existed, byte for byte, on every branch.
  for (const family of FAMILY_CORPUS) {
    for (const fallback of ['', '   ', undefined, null, 42, {}, ',', ' , ']) {
      assert.equal(
        buildFontStack(family, fallback),
        family,
        `family ${JSON.stringify(family)} + fallback ${JSON.stringify(fallback)} must pass through`,
      );
    }
  }
});

test('buildFontStack is the identity when the fallback names the primary family', () => {
  // Selecting the same family twice is a no-op, not a duplicated stack entry —
  // and it stays one through the drift `normalizePrimaryFamily` absorbs (quotes,
  // case, whitespace, a missing generic tail).
  assert.equal(
    buildFontStack('"Mgen+ 1mn Term", monospace', 'Mgen+ 1mn Term'),
    '"Mgen+ 1mn Term", monospace',
  );
  assert.equal(
    buildFontStack('"Mgen+ 1mn Term", monospace', '  "mgen+   1MN term" , monospace'),
    '"Mgen+ 1mn Term", monospace',
  );
  assert.equal(buildFontStack('Menlo, monospace', 'menlo'), 'Menlo, monospace');
});

test('buildFontStack inserts the fallback after the first family, before the generic', () => {
  // Position is the whole point: after the primary (so the primary still draws
  // every character it has) and before `monospace` (so a character the primary
  // lacks reaches the fallback rather than the OS's generic).
  assert.equal(
    buildFontStack('"M PLUS 1 Code Term", monospace', 'Mgen+ 1mn Term'),
    '"M PLUS 1 Code Term", "Mgen+ 1mn Term", monospace',
  );
  // A bare family with no generic tail: the fallback is appended.
  assert.equal(
    buildFontStack('M PLUS 1 Code Term', 'Mgen+ 1mn Term'),
    'M PLUS 1 Code Term, "Mgen+ 1mn Term"',
  );
  // Everything except the inserted token is untouched, including odd spacing.
  assert.equal(
    buildFontStack('"A" ,   B ,monospace', 'Mgen+ 1mn Term'),
    '"A" , "Mgen+ 1mn Term",   B ,monospace',
  );
});

test('buildFontStack quotes what must be quoted and leaves identifiers alone', () => {
  // A bundled family name holds a space (and `+`), so it has to be quoted or the
  // declaration is invalid. A bare CSS identifier must NOT be quoted: quoting
  // `monospace` would turn the generic keyword into a family name nobody has.
  assert.equal(
    buildFontStack('"A", monospace', 'Mgen+ 1mn Term'),
    '"A", "Mgen+ 1mn Term", monospace',
  );
  assert.equal(buildFontStack('"A", monospace', 'Menlo'), '"A", Menlo, monospace');
  assert.equal(buildFontStack('"A", monospace', 'monospace'), '"A", monospace, monospace');
  // Already quoted (either style) passes through as written.
  assert.equal(
    buildFontStack('"A", monospace', '"Mgen+ 1mn Term"'),
    '"A", "Mgen+ 1mn Term", monospace',
  );
  assert.equal(
    buildFontStack('"A", monospace', "'Mgen+ 1mn Term'"),
    '"A", \'Mgen+ 1mn Term\', monospace',
  );
  // A whole stack pasted into the fallback setting contributes its FIRST family
  // only — otherwise a second `monospace` would land mid-stack and swallow every
  // character before the real tail was reached.
  assert.equal(
    buildFontStack('"A", monospace', '"Mgen+ 1mn Term", monospace'),
    '"A", "Mgen+ 1mn Term", monospace',
  );
});

// Tokenize a composed stack the way a CSS parser does and hand back everything
// that lands OUTSIDE a quoted string. Those characters are the ones the parser
// reads as syntax; a `}` among them ends the rule block, a `;` ends the
// declaration, a `:` starts another one, `/*` starts a comment that can swallow the
// rest of the sheet.
//
// WHY A TOKENIZER AND NOT A CHARACTER SET. The first cut of this test defined
// "dangerous" as "holds a backslash or a C0/DEL control character" and asserted the
// composed stack held none. That predicate is true of the output and was measured —
// but it is NARROWER than the test's own name was, and `}` `;` `"` fall outside it,
// so it called `"A"} body{background:red} .x{"B"` safe while headless Chromium was
// painting the body red from it (2nd review round). The property that actually
// matters is positional, not character-wise: whatever the fallback contributes has
// to stay INSIDE its own token.
function cssResidue(stack) {
  let residue = '';
  let quote = null;
  for (const ch of stack) {
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    residue += ch;
  }
  return { residue, unterminated: quote !== null };
}

/**
 * '' when the stack keeps everything inside its tokens, else why it does not.
 * Control characters and backslashes are still checked — ANYWHERE, inside a string
 * too — because they are what changes the tokenization above: a raw newline ends a
 * CSS string early (bad-string), and a backslash escapes the closing quote.
 */
function leavesItsToken(stack) {
  const reasons = [];
  // eslint-disable-next-line no-control-regex -- the point is to detect them
  if (/[\\ -]/.test(stack)) {
    reasons.push('control character or backslash');
  }
  const { residue, unterminated } = cssResidue(stack);
  if (unterminated) {
    reasons.push('unterminated string');
  }
  // `(` and `)` are in this class for a case TODAY'S CODE CANNOT REACH: nothing
  // `buildFontStack` emits puts a paren outside a string, so adding them flips no
  // verdict this file reaches — the suite is 42/42 with BOTH halves in (these
  // parens and the `a)b(` payload below) and 42/42 with both out (measured, both
  // ways). Toggling this line ALONE is a different experiment and is not 42/42:
  // drop the parens here while leaving that payload and the run is 41/42 — see the
  // 2x2 below. They are here for the drift this guard exists to catch.
  // Widening the identifier branch to `[A-Za-z0-9_()-]*` — the natural change if
  // someone wants `var()` accepted as a fallback — lets `a)b(` through unquoted, and
  // Chromium then collapses the sheet from 3 rules to 1.
  //
  // WHAT THIS COSTS (measured, #290 review round 4). The class is a denylist, so
  // widening it can only make the predicate stricter — no new blind spot (0 misses
  // in 200k random payloads). What it CAN do is refuse something legitimate: run
  // this predicate over a composed stack whose PRIMARY is the DEFAULT family and it
  // reports `outside the strings: "()"`, because `var(--vscode-editor-font-family,
  // …)` carries real parens outside any quotes (measured). No caller does that
  // today — but NOT because the predicate only ever sees a fallback token: all four
  // call sites in this file hand it a whole STACK (hence the parameter name) —
  // `buildFontStack`'s output on three of them, the raw-splice counterfactual on the
  // fourth. What keeps them clear is that every one of them pins the PRIMARY at
  // `"A", monospace`, which carries no paren. The test that does use the DEFAULT
  // family as the primary — `buildFontStack treats the DEFAULT_FONT_FAMILY var() as
  // one token (fallback branch)`, named rather than cited by line number, because
  // the line number in this sentence went stale the moment anything above it grew —
  // would hit it if it were extended to run through here. That would be a false
  // alarm about correct output, not a real escape: fix the predicate to skip a
  // leading `var(…)` token, do not delete the parens from the class.
  //
  // IT TAKES BOTH HALVES, measured as a 2x2 with that mutation applied: with the
  // parens here but no paren payload below, the mutation stays GREEN (the payload
  // matrix had no row that could carry one); with the paren payload but no parens
  // here, the payload is inert when spliced raw, so the NEGATIVE CONTROL fails and
  // the file goes red on correct code too — a false alarm, not a catch. Only both
  // together are green on today's code and RED under the mutation, on the assertion
  // that names the reason (`outside the strings: ")("`).
  const meta = residue.match(/[{};:/*\\()]/g);
  if (meta) {
    reasons.push('outside the strings: ' + JSON.stringify([...new Set(meta)].join('')));
  }
  return reasons.join(' + ');
}

test('buildFontStack keeps the fallback inside one CSS token (Low-1)', () => {
  // #290 security review Low-1. The composed value reaches xterm's DOM renderer,
  // which builds a <style> element's text by STRING CONCATENATION (`_injectCss`:
  // `.xterm-rows span { font-family: ${rawOptions.fontFamily}; font-size: … }`),
  // and that renderer runs at least once every start — `term.open()` precedes the
  // WebGL addon's load — and permanently where WebGL is unavailable.
  //
  // There are THREE ways out of the quotes, not one, and each was measured in
  // headless Chromium (150.0.7871.128, `--headless=new`) against a <style> built in
  // the same shape, reading `sheet.cssRules` + `getComputedStyle(document.body)`:
  //
  //   raw newline .......  ends a CSS string early (bad-string), so the text after
  //                        it is outside the quotes and a `}` there closes the rule
  //   trailing backslash   escapes the closing quote and swallows the rules after it
  //   the quote itself ..  a value that CLOSES its own quote, writes CSS, and opens
  //                        a new one needs neither of the above — it carries no
  //                        control character at all, which is why the first two
  //                        rounds of this fix never produced it
  //
  // Baseline for the numbers below: an inert value yields 3 rules with exactly 1
  // declaration on rule 0 and `body` at rgba(0, 0, 0, 0).
  //
  // HOW THESE ARE COUNTED (an earlier revision of this comment got both numbers
  // wrong, so the rule is written down): the array below holds 25 payloads and the
  // loop runs over exactly those. THREE further values are pinned individually after
  // the loop; they are inert when spliced raw, so they would fail its negative
  // control — which is the correct verdict for them, not a hole — and they are never
  // included when a number here says "payloads".
  //
  // Before this fix, 8 of those 25 broke the baseline. Measured twice and the two
  // agree on the same 8: by `leavesItsToken` below against `buildFontStack` at
  // 2da9394, and independently in headless Chromium with a <style> built in
  // `_injectCss`'s shape. `"A"} body{background:red} .x{"B"` gave 5 rules with `body`
  // painted rgb(255, 0, 0); `"A"; color: red; font-family: "B"` gave 3 rules with 2
  // declarations on `.xterm-rows span` (the injected `color: red` landing on the
  // terminal's own selector). `"A""B""C"` is NOT among the 8 — it is one of the three
  // pinned after the loop, and it DROPS the declaration instead of injecting into the
  // sheet; counting it in is exactly how the earlier "9" arose. After the fix: 25 of
  // 25 back to the baseline.
  //
  // THE PAYLOAD SET IS DERIVED FROM A MATRIX, WRITTEN DOWN BEFORE THE PAYLOADS.
  // Two rounds of this fix were lost to a biased set — the first covered only
  // "value plus a control character", the second added the already-quoted branch but
  // still only WITH a control character in it, so the one shape that branch is
  // actually weak to (no control character at all) was never tried. The axes:
  //
  //   A. quoting of the value ... none / double / single
  //   B. inner quote ............ none / SAME kind / OTHER kind / unbalanced
  //   C. control character ...... none / LF / CR / NUL / DEL
  //                               ("none" is the value both earlier rounds skipped)
  //   D. CSS metacharacter ...... } / ; / : / { / /* / unbalanced ( )
  //   E. termination ............ closed / left open
  //   F. structure .............. single token / comma list / var() / empty
  //   G. backslash .............. none / trailing / interior
  //
  // Scope: only the FALLBACK token passes through `quoteFamilyName`. The primary
  // `family` is spliced in raw here as it always was, so
  // `tmuxOpener.terminal.fontFamily` keeps whatever exposure it had before #290 —
  // that one is a separate change, and this test does not cover it.
  const LF = String.fromCharCode(10);
  const CR = String.fromCharCode(13);
  const NUL = String.fromCharCode(0);
  const DEL = String.fromCharCode(127);
  const escaper = '} body{background:red} .x{';
  const payloads = [
    // B=same kind, C=none — the hole. All four were live escapes in Chromium.
    '"A"' + escaper + '"B"',
    "'A'" + escaper + "'B'",
    '"A"; color: red; font-family: "B"',
    "'A'; color: red; font-family: 'B'",
    // B=unbalanced / E=left open
    '"A' + escaper,
    '"A"' + escaper + '"',
    'A' + escaper + '"',
    // C=LF/CR/NUL/DEL (what the earlier rounds did cover — kept, not replaced)
    'X' + LF + escaper,
    '"X' + LF + escaper + '"',
    "'X" + CR + escaper + "'",
    'X' + NUL + escaper,
    'X' + DEL + escaper,
    // D=comment / colon / open brace
    '"A"/*',
    'A/*',
    '"A": url(x',
    '"A"{',
    // D=parens. Unreachable from today's branches — it is the paired half of the
    // `()` addition to the metacharacter class above, and the pair is what turns a
    // widened identifier branch RED.
    'a)b(',
    // G=backslash
    'X\\',
    '"X\\"',
    'Menlo\\',
    '"A\\"' + escaper + '"B"',
    // F=comma list / var(): the escape rides in the token actually spliced, and in
    // one that is dropped
    '"A"' + escaper + '"B", monospace',
    'Menlo, "A"' + escaper + '"B"',
    'var(--x, "A"' + escaper + '"B")',
    '"A" ' + escaper + ' "B"',
  ];
  for (const payload of payloads) {
    // NEGATIVE CONTROL. The counterfactual is the one that matters: the same value
    // spliced into the stack RAW, which is what a passthrough amounts to. Without
    // this the assertion below could pass because the payloads were inert to begin
    // with. (Wrapping the payload in a fresh pair of quotes instead would shift the
    // quote parity and make some of these look harmless — which is how a naive
    // negative control hides the very rows it is meant to prove.)
    assert.notEqual(
      leavesItsToken('"A", ' + payload + ', monospace'),
      '',
      `payload ${JSON.stringify(payload)} is inert even spliced raw — useless as a control`,
    );
    const stack = buildFontStack('"A", monospace', payload);
    assert.equal(
      leavesItsToken(stack),
      '',
      `composed stack ${JSON.stringify(stack)} leaves its token: ${leavesItsToken(stack)}`,
    );
  }
  // A value whose inner quote is the OTHER kind is one closed token already, so it
  // must still pass through untouched — the fix narrows the passthrough, it does not
  // delete it. (Not in the loop above: these are inert raw, so they would fail the
  // negative control, correctly.)
  assert.equal(buildFontStack('"A", monospace', '"O\'Hara Mono"'), '"A", "O\'Hara Mono", monospace');
  assert.equal(leavesItsToken(buildFontStack('"A", monospace', '"A\'} x{"')), '');
  // `"A""B""C"` is deliberately NOT in the loop: adjacent strings put nothing
  // outside a token, so it escapes nothing and would fail the negative control
  // above — but the old passthrough emitted it verbatim and Chromium dropped the
  // whole `font-family` declaration (0 declarations on the rule, measured). Losing
  // the font is a different failure from injecting into the sheet, and this test is
  // about the second; it is pinned here only so the distinction stays visible.
  assert.equal(buildFontStack('"A", monospace', '"A""B""C"'), '"A", "ABC", monospace');
  // Worked examples, pinned exactly. The first two are the ones headless Chromium
  // (150.0.7871.128, `--headless=new`, a <style> built in `_injectCss`'s shape,
  // reading `sheet.cssRules` + `getComputedStyle(document.body)`) measured BEFORE
  // this fix as 5 rules with `body` painted rgb(255, 0, 0), and as 3 rules with a
  // second declaration (`color: red`) on `.xterm-rows span`. After the fix: 3 rules,
  // 1 declaration, body rgba(0, 0, 0, 0) — for all 25 payloads above.
  assert.equal(
    buildFontStack('"A", monospace', '"A"' + escaper + '"B"'),
    '"A", "A} body{background:red} .x{B", monospace',
  );
  assert.equal(
    buildFontStack('"A", monospace', '"A"; color: red; font-family: "B"'),
    '"A", "A; color: red; font-family: B", monospace',
  );
  assert.equal(
    buildFontStack('"A", monospace', 'X' + LF + escaper),
    '"A", "X} body{background:red} .x{", monospace',
  );
  assert.equal(buildFontStack('"A", monospace', 'X\\'), '"A", X, monospace');
  // And an ordinary family is untouched by the sanitizing.
  assert.equal(
    buildFontStack('"A", monospace', 'Mgen+ 1mn Term'),
    '"A", "Mgen+ 1mn Term", monospace',
  );
});

test('buildFontStack treats the DEFAULT_FONT_FAMILY var() as one token (fallback branch)', () => {
  // `resolveFontForMeasure` returns this when the primary face did not load, and
  // the composition is applied to that verdict too — dropping the fallback there
  // would lose it in exactly the degraded case it is most wanted in.
  //
  // Every comma in the value belongs to `var()`'s fallback argument, so a naive
  // split(',') would splice our family INSIDE the parentheses, where it would
  // apply only when the custom property is unset. It goes after the closing paren.
  const composed = buildFontStack(WEBVIEW_DEFAULT_FONT_FAMILY, 'Mgen+ 1mn Term');
  assert.equal(composed, `${WEBVIEW_DEFAULT_FONT_FAMILY}, "Mgen+ 1mn Term"`);
  assert.ok(
    composed.startsWith('var(') && composed.indexOf(')') < composed.indexOf('"Mgen+'),
    'the fallback must sit outside the var() parentheses',
  );
  // MEASUREMENT NOTE (#290 T16, headless Chromium 150, 100px, one cell = 50.0px):
  // on this branch the fallback lands after the generic the var() expands to, so a
  // character the OS's own monospace happens to have is still drawn by that font
  // (`★` `⚠` stayed 60.2px), while one it lacks does reach the fallback (`①` `Ⓐ`
  // went 89.6/100.0 -> 50.0). Weaker than the primary branch, and still better
  // than dropping the fallback; the claim is bounded on purpose.
  //
  // Re-measured independently on Chromium 150.0.7871.128 (same numbers, same
  // ruler), because since the #290 review the SAME bound is stated in the
  // `config.terminal.fontFallback` setting description in both nls bundles — where
  // it used to promise `<Font Family>, <this>, monospace` unconditionally, which is
  // false on this branch. Change one and the other has to be re-measured, not
  // re-worded.
});

test('the longest-match trap is unreachable: matchers only ever see the primary', () => {
  // THE property this whole design exists for. `bundledFamilyOf` picks the
  // LONGEST registered family name inside the string it is given, and its answer
  // is what `resolveFontForMeasure` preloads and measures against. So for every
  // ordered pair of bundled names — including every pair where the fallback's name
  // is longer than the primary's — the value the matcher receives must still be
  // the primary alone.
  let longerFallbackPairs = 0;
  for (const primary of BUNDLED_FAMILY_NAMES) {
    for (const fallback of BUNDLED_FAMILY_NAMES) {
      if (primary === fallback) {
        continue;
      }
      if (fallback.length > primary.length) {
        longerFallbackPairs += 1;
      }
      const primaryValue = `"${primary}", monospace`;
      // What the host sends and every identity consumer reads.
      assert.equal(
        bundledFamilyOf(primaryValue),
        primary,
        `matching ${primaryValue} must yield ${primary}`,
      );
      // NEGATIVE CONTROL — without it the assertion above is vacuous. Had the
      // composed stack been what the matcher was handed (the rejected option (c):
      // compose in the host and overwrite config.fontFamily), a longer fallback
      // name would win outright, and a shorter one that CONTAINS the primary would
      // too. Assert the misbehaviour exists, so the test fails if someone
      // "simplifies" the pipeline into it.
      const composed = buildFontStack(primaryValue, fallback);
      assert.ok(composed.includes(fallback), 'the composed stack does carry the fallback name');
      if (fallback.length > primary.length && !primary.includes(fallback)) {
        assert.equal(
          bundledFamilyOf(composed),
          fallback,
          `matching the COMPOSED stack picks ${fallback} — which is why nothing may match it`,
        );
      }
    }
  }
  // The trap needs at least one pair to be about; `Mgen+ 1mn Term` (14) with
  // `Rounded Mgen+ 1mn Term` (22) is the worked example in plan #287.
  assert.ok(longerFallbackPairs > 0, 'the corpus must contain a longer-named fallback');
  assert.equal(
    bundledFamilyOf(buildFontStack('"Mgen+ 1mn Term", monospace', 'Rounded Mgen+ 1mn Term')),
    'Rounded Mgen+ 1mn Term',
  );
  assert.equal(bundledFamilyOf('"Mgen+ 1mn Term", monospace'), 'Mgen+ 1mn Term');
});

test('the webview composes at the verdict, on every branch including the fail-safe', () => {
  // The composition points are in webview-terminal.js, which needs a DOM and xterm
  // and so cannot be required here — the same limit the async half of this path has
  // always had. What IS checkable without a browser is the source: that the join
  // happens through the one helper, at each of the three places a font reaches
  // xterm, and that the pre-#290 shapes (which dropped the fallback) are gone.
  const sites = [
    // Runtime font swap (a `config` after the terminal is built).
    /term\.options\.fontFamily = fontStackForXterm\(/,
    // First init, verdict path — covers the DEFAULT_FONT_FAMILY verdict too,
    // because the composition is applied to whatever the verdict returned.
    /fontFamily: fontStackForXterm\(family, msg\.fontFallback, msg\.fontSize\)/,
    // Fail-safe path (`.catch`), which never reaches a verdict at all.
    /fontFamily: fontStackForXterm\(\s*msg\.fontFamily \|\| DEFAULT_FONT_FAMILY,/,
  ];
  for (const re of sites) {
    assert.match(webviewTerminalSource, re);
  }
  // The old fail-safe shape: `initTerminal(msg)` with the raw message, which would
  // silently render without the configured fallback (plan #287 review L1).
  assert.doesNotMatch(webviewTerminalSource, /initTerminal\(msg\);/);
  // And the measurement input stays the PRIMARY value: resolveFontForMeasure is
  // never handed a composed stack.
  assert.match(webviewTerminalSource, /resolveFontForMeasure\(msg\.fontFamily, msg\.fontSize\)/);
  assert.match(webviewTerminalSource, /resolveFontForMeasure\(config\.fontFamily, config\.fontSize\)/);
  assert.doesNotMatch(webviewTerminalSource, /resolveFontForMeasure\([^)]*fontFallback/);
});

// --- Reading src/extension.ts as CODE, not as text (#290 review M1b)
//
// The guard below is an ALLOWLIST over code lines, so it needs the comments out of
// the way: the file's docblocks discuss `fontFallback` at length on purpose, and a
// guard that forbade naming the thing it protects would delete its own
// documentation (#125's emoji test learned that the hard way).
//
// KNOWN LIMITS of this stripper, both measured rather than reasoned about (the 2nd
// review round found the note that used to sit here claiming more than was true).
// It does not track string literals, so `//`, `/*` and `*/` inside one are read as
// comment delimiters — and the two directions are NOT symmetric:
//
//   FALSE NEGATIVE (`//` in a string). The rest of that line is dropped, so a real
//   read of the setting placed after one is invisible to the allowlist below.
//   Measured: inserting `const s = 'x://' + …get<string>('fontFallback', '')` leaves
//   the allowlist unchanged and the test green. This is the limit the allowlist's
//   own wording has to be read against — see (2) at its use site.
//
//   FALSE POSITIVE (`/*` in a string). Everything from it to the next `*/` is
//   blanked, INCLUDING real code lines. Measured: one ordinary line
//   `const PATH_GLOB = 'a/*b';` inserted DIRECTLY ABOVE THE FUNCTION LINE
//   `function getTerminalFontFallback(): string {` blanks the two declaration
//   lines, the allowlist drops from 3 entries to 1, and the test goes red on code
//   that violates nothing. The position matters and "above the function" is not
//   precise enough: the same line placed above that function's DOCBLOCK leaves the
//   allowlist at 3 and reproduces nothing, because the docblock's own `*/` closes
//   the block the string opened before the declarations are reached (both measured).
//   Glob and regex strings are an everyday shape, so this is not a thought
//   experiment — if it fires, fix the stripper (or move the string), don't loosen
//   the allowlist.
//
// Today's file, measured. The `//` rule truncates exactly ONE line for a `//` that
// sits inside a string — `src/extension.ts:1667`,
// `vscode.Uri.parse('https://github.com/…')`, kept up to `'https:` — and it mentions
// no fallback, so it costs the allowlist nothing.
//
// The `/*` rule, by contrast, is NOT dormant: it is firing right now. `getHtml`'s
// template literal (`src/extension.ts:2295-2762`) is one long string holding the
// webview's CSS, and 27 of its lines carry `/*` or `*/` — 15 of each, balanced. The
// stripper reads those 15 pairs as real block comments and blanks 48 template-literal
// lines on the way through. What makes that harmless is POSITION, not absence: every
// line this guard reads sits ABOVE the template literal. The three allowlist entries
// are at :397, :400 and :1160, and the `config` message literal opens at :1158, while
// the first CSS `/*` is at :2318. Reaching the guarded lines needs THREE things at
// once, not any one of them (all eight combinations measured, #290 review round 4):
// (1) an unbalanced `/*` after the last `*/` — the 15 pairs in that CSS are balanced,
// so a `/*` added at the top or in the middle is closed again and blanks nothing;
// (2) a guarded line BELOW it — blanking only runs downward, and :397/:400/:1158/:1160
// all sit above :2318; (3) no `*/` in between. Any one of them alone leaves the
// allowlist at 3 entries and blanks nothing: moving `pushWebviewConfig` below
// `getHtml` on its own is inert, and so is an unbalanced `/*` on its own. (Moving
// `getTerminalFontFallback` alone turns the suite RED for an unrelated reason — the
// allowlist pins ORDER via deepEqual — while blanking nothing and keeping all 3
// entries. The docblock mechanism the FALSE POSITIVE paragraph above describes does
// NOT apply to a move on its own: with no unbalanced `/*` anywhere there is no open
// block for a `*/` to close first. It applies to the CONJUNCTION, and there it is
// what decides the outcome — add an unbalanced `/*` after the last `*/` and move the
// getter WITH its docblock and the allowlist is still 3, because that docblock's own
// `*/` closes the block before the declarations; move the function WITHOUT it and the
// allowlist drops 3 -> 1. Both measured.) So this is a live mechanism kept off by
// ordering — a weaker guarantee than "dormant", worth re-checking whenever the file
// is reorganized, but it takes a conjunction to break, not a disjunction. Re-measure
// with the one-liners rather than trusting these sentences; they are statements about
// a file that keeps changing:
//
//   sed -n '2295,2762p' src/extension.ts | grep -cE '/\*|\*/'     # -> 27
//   grep -n 'ontFallback' src/extension.ts                        # -> code lines above 2295
function stripComments(source) {
  const out = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) {
        out.push('');
        continue;
      }
      line = line.slice(end + 2);
      inBlock = false;
    }
    for (;;) {
      const start = line.indexOf('/*');
      if (start === -1) {
        break;
      }
      const end = line.indexOf('*/', start + 2);
      if (end === -1) {
        line = line.slice(0, start);
        inBlock = true;
        break;
      }
      line = line.slice(0, start) + line.slice(end + 2);
    }
    const lineComment = line.indexOf('//');
    out.push(lineComment === -1 ? line : line.slice(0, lineComment));
  }
  return out;
}

const extensionCodeLines = stripComments(extensionSource);

// The object literal of the `config` postMessage, extracted by brace balancing so
// the assertion is about the message's SHAPE rather than about a regex that happens
// to match today's formatting.
function configMessageLiteral(codeLines) {
  const code = codeLines.join('\n');
  const at = code.indexOf("type: 'config',");
  assert.ok(at > 0, 'could not find the `config` postMessage in src/extension.ts');
  assert.equal(
    code.indexOf("type: 'config',", at + 1),
    -1,
    'more than one `config` message literal — the guard below would only see the first',
  );
  const open = code.lastIndexOf('{', at);
  let depth = 0;
  let quote = null;
  for (let i = open; i < code.length; i += 1) {
    const ch = code.charAt(i);
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return code.slice(open + 1, i);
      }
    }
  }
  throw new Error('unbalanced braces while reading the `config` message literal');
}

/** The literal's top-level keys, in order; a spread is reported verbatim. */
function topLevelKeys(literal) {
  const keys = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  const push = (end) => {
    const entry = literal.slice(start, end).trim();
    if (entry.length === 0) {
      return;
    }
    if (entry.startsWith('...')) {
      keys.push(entry); // a spread has no key; report it verbatim
      return;
    }
    const colon = entry.indexOf(':');
    // A shorthand property (`notifySound`) is its own key.
    keys.push(colon === -1 ? entry : entry.slice(0, colon).trim());
  };
  for (let i = 0; i < literal.length; i += 1) {
    const ch = literal.charAt(i);
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '{' || ch === '(' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ')' || ch === ']') {
      depth -= 1;
    } else if (ch === ',' && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(literal.length);
  return keys;
}

test('the host sends the primary raw and the fallback as its own field', () => {
  // The contract plan #287 fixed: `config.fontFamily` stays the resolved PRIMARY
  // value. Compose it host-side and the fallback name flows into the nudge, the
  // picker, the chip and the webview's measurement target — every consumer the
  // separation protects.
  //
  // WHAT THIS GUARD CONSTRAINS, AND WHAT IT DOES NOT (#290 review M1b). The old
  // shape here was `assert.doesNotMatch(extensionSource, /buildFontStack\s*\(/)` —
  // a DENYLIST of one spelling, which the reviewer walked straight past: composing
  // inline (`fontFamily: getTerminalFontConfig().fontFamily + ', ' +
  // getTerminalFontFallback()`) names no helper and stayed green while the trap was
  // fully back. So the two things the design actually rests on are pinned
  // positively instead:
  //
  //   (1) the `config` message carries NO `fontFamily` key of its own — only the
  //       spread of `getTerminalFontConfig()` — so whatever the webview reads as
  //       `msg.fontFamily` is that function's output, unmodified, whatever
  //       expression someone writes;
  //   (2) the fallback is mentioned in exactly three places among the lines the
  //       stripper above leaves visible, all listed below — so it cannot be read,
  //       aliased or joined anywhere ELSE THAT THE STRIPPER CAN SEE.
  //
  // That qualifier is not hedging; it is the stripper's measured false negative
  // (see its KNOWN LIMITS note). A read hidden after a `//` that sits inside a
  // string literal on the same line passes this allowlist untouched — measured, and
  // the trap is fully back when it does. The bound this guard gives is therefore
  // "no read in plain sight", which is worth having and is not the same as "no read".
  //
  // NOT constrained either: what `getTerminalFontConfig` (or
  // `resolveTerminalFontConfig`, in another file) does INSIDE — it could still
  // concatenate a family name that is hard-coded rather than read from
  // `fontFallback`, and this test would not see it. Its return type is pinned below,
  // which is what keeps its three consumers honest, but the body is left to review.
  // Nothing here is a claim about the whole file.
  assert.deepEqual(topLevelKeys(configMessageLiteral(extensionCodeLines)), [
    'type',
    '...getTerminalFontConfig()',
    'fontFallback',
    'notifySound',
  ]);
  // (2) The allowlist. Comments are stripped first, so the docblocks that explain
  // the setting are free to name it as often as they need to.
  const fallbackCodeLines = extensionCodeLines
    .map((line) => line.trim())
    .filter((line) => /ontFallback/.test(line));
  assert.deepEqual(fallbackCodeLines, [
    // Declaration, body, and the single consumer — the postMessage field.
    'function getTerminalFontFallback(): string {',
    ".get<string>('fontFallback', '');",
    'fontFallback: getTerminalFontFallback(),',
  ]);
  // Kept from the pre-M1b shape: the named-helper spelling of the rejected option
  // (c) is still called out by name, because it is the one a reader is most likely
  // to reach for. The pattern is the CALL shape (a trailing paren), not the bare
  // name, so the contract comment at `pushWebviewConfig` can still point at the
  // function it is describing.
  assert.doesNotMatch(extensionSource, /buildFontStack\s*\(/);
  // The nudge and the picker still read getTerminalFontConfig, which knows nothing
  // about the fallback — assert the function's shape rather than its callers, since
  // that is what makes every caller safe at once.
  assert.match(
    extensionSource,
    /function getTerminalFontConfig\(\): \{ fontFamily: string; fontSize: number \}/,
  );
});

test('the config watcher gets no fontFallback branch of its own', () => {
  // `affectsConfiguration('tmuxOpener.terminal')` is a section PREFIX match, so it
  // is already true for `tmuxOpener.terminal.fontFallback`. A dedicated branch
  // would be true at the same time and push the config message twice per change.
  assert.doesNotMatch(extensionSource, /affectsConfiguration\('tmuxOpener\.terminal\.fontFallback'\)/);
  assert.match(extensionSource, /affectsConfiguration\('tmuxOpener\.terminal'\)/);
});

test('the fontFallback setting offers exactly the bundled families, with both bundles', () => {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const cfg = pkg.contributes.configuration.properties['tmuxOpener.terminal.fontFallback'];
  assert.equal(cfg.type, 'string');
  assert.equal(cfg.default, '', 'the default must be "no fallback" — the pre-#290 behaviour');
  // '' (no fallback) plus one entry per bundled family, in the same order the
  // fontFamily enum lists them, and spelled as bare family names (buildFontStack
  // quotes them) so the dropdown reads as a font list.
  assert.deepEqual(cfg.enum, ['', ...BUNDLED_FAMILIES]);
  assert.equal(cfg.enumItemLabels.length, cfg.enum.length);
  assert.equal(cfg.enumDescriptions.length, cfg.enum.length);
  for (let i = 1; i < cfg.enum.length; i += 1) {
    assert.ok(
      cfg.enumItemLabels[i].includes(cfg.enum[i]),
      `enumItemLabels[${i}] must carry ${cfg.enum[i]}`,
    );
    // Each enum value is a family the matcher recognizes — the value is what the
    // webview composes into the stack, so a typo here yields a font nobody has.
    assert.equal(bundledFamilyOf(cfg.enum[i]), cfg.enum[i]);
  }
  const bundles = ['package.nls.json', 'package.nls.ja.json'].map((f) => [
    f,
    JSON.parse(readFileSync(path.join(__dirname, '..', f), 'utf8')),
  ]);
  const keys = [cfg.description, ...cfg.enumDescriptions, ...cfg.enumItemLabels]
    .filter((s) => /^%.+%$/.test(s))
    .map((s) => s.slice(1, -1));
  assert.ok(keys.includes('config.terminal.fontFallback'), 'the setting has a description key');
  for (const key of keys) {
    for (const [bundleName, bundle] of bundles) {
      assert.ok(bundle[key], `${bundleName} has no key ${key}`);
    }
  }
});

test('the fontFallback description steers users away from a hand-written stack', () => {
  // Plan #287 review L4: a second family typed into `fontFamily` by hand is still
  // exposed to longest-match — that path's semantics are deliberately unchanged —
  // so the only defence is telling the user where to put it. Both bundles, because
  // a key that exists in one renders as a literal `%key%` in the other.
  for (const f of ['package.nls.json', 'package.nls.ja.json']) {
    const bundle = JSON.parse(readFileSync(path.join(__dirname, '..', f), 'utf8'));
    const text = bundle['config.terminal.fontFallback'];
    assert.ok(text.includes('Font Family') || text.includes('fontFamily'), `${f} names the other setting`);
    // The worked example of the trap (a longer second name) is spelled out.
    assert.ok(text.includes('Rounded Mgen+ 1mn Term'), `${f} shows the longer-name example`);
  }
});

test('the font settings descriptions carry no Markdown, because VS Code draws them raw', () => {
  // #290 review, new finding: `description` / `enumDescriptions` / `enumItemLabels`
  // are rendered as PLAIN TEXT. Only `markdownDescription` /
  // `markdownEnumDescriptions` are parsed, and the one property in this package
  // using either is `tmuxOpener.profiles`. So a `**bold**` written into these keys
  // reaches the settings UI with its asterisks — which is what the ja bundle did for
  // `config.terminal.fontFallback` and `config.terminal.fontFamily.bundled` until
  // this fix (the en bundle used capitals for the same emphasis, and both bundles
  // held zero `**` before #290).
  //
  // SCOPE: the keys reachable from the three `tmuxOpener.terminal.font*` properties
  // only — this file's remit. It is not a claim about the rest of either bundle.
  const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const props = pkg.contributes.configuration.properties;
  const keys = new Set();
  for (const name of [
    'tmuxOpener.terminal.fontFamily',
    'tmuxOpener.terminal.fontSize',
    'tmuxOpener.terminal.fontFallback',
  ]) {
    const prop = props[name];
    assert.ok(prop, `${name} must exist`);
    assert.ok(
      prop.markdownDescription === undefined && prop.markdownEnumDescriptions === undefined,
      `${name} is plain-text rendered; this test's premise breaks if it becomes markdown*`,
    );
    for (const s of [prop.description, ...(prop.enumDescriptions || []), ...(prop.enumItemLabels || [])]) {
      if (typeof s === 'string' && /^%.+%$/.test(s)) {
        keys.add(s.slice(1, -1));
      }
    }
  }
  assert.ok(keys.size > 0, 'the properties must reference nls keys at all');
  for (const f of ['package.nls.json', 'package.nls.ja.json']) {
    const bundle = JSON.parse(readFileSync(path.join(__dirname, '..', f), 'utf8'));
    for (const key of keys) {
      assert.ok(
        !bundle[key].includes('**'),
        `${f}'s ${key} holds Markdown emphasis, which renders as literal asterisks`,
      );
    }
  }
});

test('the M PLUS description says the refit adds no glyph and points at fontFallback', () => {
  // #286 C-2 / plan #287 T16. The refit fixes the OVERFLOW of glyphs the face has;
  // it does nothing for the 19 of this project's 26 sampled symbols the face does
  // not have (measured with scripts/font-fit/survey.py against the shipped TTFs).
  // The prose has to say so and point at the setting that does help. Wording is a
  // human review call; that the pointer exists in BOTH bundles is mechanical.
  for (const f of ['package.nls.json', 'package.nls.ja.json']) {
    const bundle = JSON.parse(readFileSync(path.join(__dirname, '..', f), 'utf8'));
    const text = bundle['config.terminal.fontFamily.bundled'];
    assert.ok(
      text.includes('tmuxOpener.terminal.fontFallback'),
      `${f}'s M PLUS description must point at tmuxOpener.terminal.fontFallback`,
    );
    assert.ok(text.includes('survey.py'), `${f} must name what measured the coverage`);
  }
});

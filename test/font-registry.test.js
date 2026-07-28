'use strict';

// Behavioral tests for the cross-extension font registry (#185, design #181
// case A). Node strips the types from the required `.ts` module, so this
// plain-JS suite runs the pure resolver under `node --test` with no build step
// and no `vscode` import (same split as session-name / status-bridge).
// `getExtension` is injected as a mock, so the registry lookup and the `none`
// resolution are exercised without VS Code.
//
// Since #199 the vendored fallback is gone: when no font extension supplies the
// face, the resolver returns `{ source: 'none' }` and getHtml injects no
// @font-face at all, so the terminal falls to the OS monospace.
//
// What is NOT covered here (by design): the actual webview render, the
// asWebviewUri rewrite, and the cross-extension font fetch under CSP — those
// are the manual on-device checks SUB-A (#183) already ran, and the URI work
// lives in src/extension.ts (which imports `vscode` and cannot load here).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, existsSync } = require('node:fs');
const path = require('node:path');

const {
  FONT_REGISTRY,
  BUNDLED_FONT_FAMILY,
  MPLUS1CODE_EXTENSION_ID,
  MGENPLUS_1MN_FAMILY,
  MGENPLUS_1MN_EXTENSION_ID,
  ROUNDED_MGENPLUS_1MN_FAMILY,
  ROUNDED_MGENPLUS_1MN_EXTENSION_ID,
  PLEMOLJP_CONSOLE_HS_FAMILY,
  PLEMOLJP_CONSOLE_EXTENSION_ID,
  SHIROKUMAGEN_TERM_FAMILY,
  SHIROKUMAGEN_EXTENSION_ID,
  matchRegisteredFamily,
  familyMatchPool,
  registeredFamilyNames,
  normalizeContractFaces,
  coversWeight400,
  resolveBundledFontSource,
  resolveExistingFontSource,
  isBundledFamilySelected,
  fontExtensionNudgeFamily,
  shouldNotifyFontExtensionMissing,
  buildFontFaceCss,
  INJECTABLE_FAMILY_NAME,
} = require('../src/font-registry.ts');

// The FLAT contract shape — `{ family, file, weight, license }` — as
// `font-mplus1code` declared it from #184 until #275, when the package became two
// static faces (design #271 R6). It is kept verbatim, name and all, because the
// flat shape stays supported permanently for third-party consumers and this is
// the fixture that covers it end to end; only `family` is updated to the current
// canonical, since the resolver keys off the REGISTRY's family and would
// otherwise be exercised through a name nothing registers. Do not read
// `weight: '100 700'` here as a claim about any shipped face — it is a
// single-face variable-font contract, which is what that shape was for.
const REAL_CONTRACT = {
  family: 'M PLUS 1 Code Term',
  file: 'fonts/MPLUS1Code.ttf',
  weight: '100 700',
  license: 'OFL-1.1',
};

function mockGetExtension(map) {
  return (id) => map[id];
}

test('the registry maps M PLUS 1 Code to the shipped font extension id', () => {
  const entry = FONT_REGISTRY.find((e) => e.family === BUNDLED_FONT_FAMILY);
  assert.ok(entry, 'M PLUS 1 Code must be in the registry');
  assert.equal(entry.extensionId, MPLUS1CODE_EXTENSION_ID);
  assert.equal(MPLUS1CODE_EXTENSION_ID, 'shirokuma-library.font-mplus1code');
});

test('resolves to the extension source when the font extension is installed', () => {
  const getExtension = mockGetExtension({
    [MPLUS1CODE_EXTENSION_ID]: {
      extensionUri: { fsPath: '/ext/mplus' },
      packageJSON: { providedFont: REAL_CONTRACT },
    },
  });
  const res = resolveBundledFontSource(BUNDLED_FONT_FAMILY, getExtension);
  assert.equal(res.source, 'extension');
  assert.equal(res.extensionId, MPLUS1CODE_EXTENSION_ID);
  // A flat contract normalizes to exactly one face (#247, design #245 §1).
  assert.equal(res.faces.length, 1);
  assert.equal(res.faces[0].file, 'fonts/MPLUS1Code.ttf');
  assert.equal(res.faces[0].weight, '100 700');
});

test('resolves to none when the font extension is NOT installed', () => {
  const res = resolveBundledFontSource(BUNDLED_FONT_FAMILY, mockGetExtension({}));
  assert.equal(res.source, 'none');
});

test('resolves to none when the extension declares no providedFont contract', () => {
  const getExtension = mockGetExtension({
    [MPLUS1CODE_EXTENSION_ID]: { extensionUri: {}, packageJSON: {} },
  });
  const res = resolveBundledFontSource(BUNDLED_FONT_FAMILY, getExtension);
  assert.equal(res.source, 'none');
});

test('resolves to none when the contract omits the file field', () => {
  const getExtension = mockGetExtension({
    [MPLUS1CODE_EXTENSION_ID]: {
      extensionUri: {},
      packageJSON: { providedFont: { family: 'M PLUS 1 Code Term', weight: '100 700' } },
    },
  });
  const res = resolveBundledFontSource(BUNDLED_FONT_FAMILY, getExtension);
  assert.equal(res.source, 'none');
});

test('defaults the weight to 100 700 when the contract omits weight', () => {
  // `DEFAULT_FONT_WEIGHT` — the axis the ORIGINAL variable M PLUS 1 Code declared
  // (fvar wght 100–700, #176), and the default the flat contract shape has carried
  // since. No SHIPPED face has that axis any more (#275 instanced it away), so this
  // pins the contract-format default, not a property of any bundled font: a
  // third-party variable font may still omit `weight` and get it.
  const getExtension = mockGetExtension({
    [MPLUS1CODE_EXTENSION_ID]: {
      extensionUri: {},
      packageJSON: { providedFont: { family: 'M PLUS 1 Code Term', file: 'fonts/x.ttf' } },
    },
  });
  const res = resolveBundledFontSource(BUNDLED_FONT_FAMILY, getExtension);
  assert.equal(res.source, 'extension');
  assert.deepEqual(res.faces, [{ file: 'fonts/x.ttf', weight: '100 700' }]);
});

test('an unknown family is not in the registry and resolves to none', () => {
  // The resolver keys off the bundled family; anything else has no registry
  // entry, so it never borrows and there is no supplying source.
  const getExtension = mockGetExtension({
    [MPLUS1CODE_EXTENSION_ID]: {
      extensionUri: {},
      packageJSON: { providedFont: REAL_CONTRACT },
    },
  });
  const res = resolveBundledFontSource('Some Other Font', getExtension);
  assert.equal(res.source, 'none');
});

test('getExtension is called with the registry id, not the family name', () => {
  const calls = [];
  resolveBundledFontSource(BUNDLED_FONT_FAMILY, (id) => {
    calls.push(id);
    return undefined;
  });
  assert.deepEqual(calls, [MPLUS1CODE_EXTENSION_ID]);
});

// --- File-existence-verified resolution (#208, plan #207 task 1) ---------
// resolveExistingFontSource composes resolveBundledFontSource with an injected
// fileExists predicate ((path) => boolean), so the borrow can be confirmed to
// point at a file that is actually on disk without this module importing `fs`.

const YES = () => true;
const NO = () => false;

test('resolveExistingFontSource keeps the extension source when the file exists', () => {
  const res = resolveExistingFontSource(BUNDLED_FONT_FAMILY, WITH_EXTENSION, YES);
  assert.equal(res.source, 'extension');
  assert.deepEqual(res.faces, [{ file: 'fonts/MPLUS1Code.ttf', weight: '100 700' }]);
});

test('resolveExistingFontSource downgrades a borrow to none when the file is absent', () => {
  // The extension is installed and declares a file, but the predicate reports
  // the file missing on disk — so there is no usable byte source and getHtml
  // must inject no dangling @font-face.
  const res = resolveExistingFontSource(BUNDLED_FONT_FAMILY, WITH_EXTENSION, NO);
  assert.equal(res.source, 'none');
});

test('resolveExistingFontSource returns none without calling fileExists when nothing borrows', () => {
  // resolveBundledFontSource already resolves to none (no extension); there is
  // no file to check, so the predicate must not be consulted.
  let called = 0;
  const res = resolveExistingFontSource(BUNDLED_FONT_FAMILY, NO_EXTENSION, () => {
    called += 1;
    return true;
  });
  assert.equal(res.source, 'none');
  assert.equal(called, 0);
});

test('resolveExistingFontSource passes the contract file path AND the supplying extension id', () => {
  // The second argument (#233, design #229 §4) is what lets the host closure stat
  // exactly one extension root instead of searching every font extension for the
  // relative name — a search that reports a false positive as soon as two font
  // extensions ship the same relative path.
  const seen = [];
  resolveExistingFontSource(BUNDLED_FONT_FAMILY, WITH_EXTENSION, (file, extensionId) => {
    seen.push([file, extensionId]);
    return true;
  });
  assert.deepEqual(seen, [['fonts/MPLUS1Code.ttf', MPLUS1CODE_EXTENSION_ID]]);
});

test('resolveExistingFontSource returns none for an unregistered family without checking files', () => {
  let called = 0;
  const res = resolveExistingFontSource('Some Other Font', WITH_EXTENSION, () => {
    called += 1;
    return true;
  });
  assert.equal(res.source, 'none');
  assert.equal(called, 0);
});

// --- Multi-face contracts (#247, design #245 §1–§3) ----------------------
//
// The `providedFont` contract carries an optional `faces: [{ file, weight }]`
// array; the flat `file`/`weight` pair stays supported forever as the shorthand
// for a single face. Both shapes go through ONE normalization
// (`normalizeContractFaces`), so every consumer — @font-face injection, the
// picker, the nudge — sees the same face list.
//
// The reading rule is deliberately asymmetric: a `faces` key that IS an array is
// authoritative even when it yields nothing, and the flat pair is read only when
// that key is absent. A malformed `faces` declaration therefore resolves to
// `none` (the nudge fires) instead of silently falling back to the flat face and
// dropping only the extra faces — "shows nothing rather than something wrong".
//
// Faces-only contracts do NOT occur in this repo's own font packages, which
// always keep the flat alias as the 400 face (skew ③ protection, design #245
// §1). They are legal for third-party consumers, so the branch is covered here
// with mock contracts rather than by a package on disk.

const FACES_ONLY_CONTRACT = {
  family: MGENPLUS_1MN_FAMILY,
  faces: [
    { file: 'fonts/regular.ttf', weight: '400' },
    { file: 'fonts/bold.ttf', weight: '700' },
  ],
  license: 'OFL-1.1',
};

/** A getExtension mock installing exactly the Mgen+ extension with `contract`. */
function withMgenContract(contract) {
  return mockGetExtension({
    [MGENPLUS_1MN_EXTENSION_ID]: {
      extensionUri: { fsPath: '/ext/mgen' },
      packageJSON: { providedFont: contract },
    },
  });
}

// @testdoc `coversWeight400` accepts a single 400 or a range spanning it, and
// nothing else — it is the declaration-stage predicate every consumer shares.
test('coversWeight400 accepts 400 and ranges spanning it, rejects the rest', () => {
  assert.equal(coversWeight400('400'), true);
  assert.equal(coversWeight400('100 700'), true);
  assert.equal(coversWeight400('400 700'), true);
  assert.equal(coversWeight400(' 400 '), true);
  assert.equal(coversWeight400('700'), false);
  assert.equal(coversWeight400('500 700'), false);
  assert.equal(coversWeight400('100 300'), false);
  assert.equal(coversWeight400(''), false);
  assert.equal(coversWeight400('bold'), false);
  assert.equal(coversWeight400('100 400 700'), false);
});

// @testdoc A flat contract (no `faces` key) normalizes to exactly one face, with
// the shipped axis substituted when `weight` is omitted.
test('normalization: a flat contract becomes a single face', () => {
  assert.deepEqual(normalizeContractFaces(REAL_CONTRACT), [
    { file: 'fonts/MPLUS1Code.ttf', weight: '100 700' },
  ]);
  assert.deepEqual(normalizeContractFaces({ family: 'x', file: 'fonts/x.ttf' }), [
    { file: 'fonts/x.ttf', weight: '100 700' },
  ]);
  assert.deepEqual(normalizeContractFaces({ family: 'x', weight: '400' }), []);
  assert.deepEqual(normalizeContractFaces(undefined), []);
});

// @testdoc A faces-only contract normalizes to its declared faces, in order.
test('normalization: a faces-only contract yields its declared faces', () => {
  assert.deepEqual(normalizeContractFaces(FACES_ONLY_CONTRACT), [
    { file: 'fonts/regular.ttf', weight: '400' },
    { file: 'fonts/bold.ttf', weight: '700' },
  ]);
  const res = resolveBundledFontSource(MGENPLUS_1MN_FAMILY, withMgenContract(FACES_ONLY_CONTRACT));
  assert.equal(res.source, 'extension');
  assert.deepEqual(res.faces, FACES_ONLY_CONTRACT.faces);
});

// @testdoc When both shapes are declared, `faces` is authoritative and the flat
// pair is ignored (it exists for older hosts, which read only the flat pair).
test('normalization: faces wins over the flat pair when both are declared', () => {
  const contract = {
    family: MGENPLUS_1MN_FAMILY,
    file: 'fonts/regular.ttf',
    weight: '400',
    faces: [
      { file: 'fonts/regular.ttf', weight: '400' },
      { file: 'fonts/bold.ttf', weight: '700' },
    ],
  };
  assert.deepEqual(normalizeContractFaces(contract), contract.faces);
});

// @testdoc Entries missing a `file` or a `weight` (or of the wrong type) are
// dropped; the surviving entries still resolve.
test('normalization: malformed face entries are dropped, valid ones survive', () => {
  const contract = {
    family: MGENPLUS_1MN_FAMILY,
    faces: [
      { file: 'fonts/regular.ttf', weight: '400' },
      { file: 'fonts/bold.ttf' },
      { weight: '700' },
      { file: '', weight: '700' },
      { file: 'fonts/x.ttf', weight: '' },
      null,
      'fonts/y.ttf',
    ],
  };
  assert.deepEqual(normalizeContractFaces(contract), [
    { file: 'fonts/regular.ttf', weight: '400' },
  ]);
  assert.equal(resolveBundledFontSource(MGENPLUS_1MN_FAMILY, withMgenContract(contract)).source, 'extension');
});

// @testdoc A `faces` key that is an array yielding no valid entry resolves to
// `none` even when a usable flat pair sits beside it — the array is
// authoritative, so a broken declaration is reported rather than papered over.
test('normalization: an empty/all-invalid faces array resolves to none, flat pair ignored', () => {
  for (const faces of [[], [{ file: '' }], [null]]) {
    const contract = {
      family: MGENPLUS_1MN_FAMILY,
      file: 'fonts/regular.ttf',
      weight: '400',
      faces,
    };
    assert.deepEqual(normalizeContractFaces(contract), []);
    assert.equal(
      resolveBundledFontSource(MGENPLUS_1MN_FAMILY, withMgenContract(contract)).source,
      'none',
      JSON.stringify(faces),
    );
  }
});

// @testdoc The declaration-stage 400-coverage check lives in
// `resolveBundledFontSource`, so the nudge, the picker and the injection all get
// the same answer for a contract that declares no face covering normal cells.
test('declaration stage: a contract with no 400-covering face resolves to none', () => {
  const boldOnly = {
    family: MGENPLUS_1MN_FAMILY,
    faces: [{ file: 'fonts/bold.ttf', weight: '700' }],
  };
  const getExtension = withMgenContract(boldOnly);
  assert.equal(resolveBundledFontSource(MGENPLUS_1MN_FAMILY, getExtension).source, 'none');
  // Same for a flat contract declaring only 700 …
  assert.equal(
    resolveBundledFontSource(
      MGENPLUS_1MN_FAMILY,
      withMgenContract({ family: MGENPLUS_1MN_FAMILY, file: 'fonts/bold.ttf', weight: '700' }),
    ).source,
    'none',
  );
  // … and the nudge (which reads this same stage) names the family, so the user
  // is told something is wrong instead of the family vanishing from the picker
  // in silence.
  assert.equal(
    fontExtensionNudgeFamily('"Mgen+ 1mn", monospace', getExtension, false),
    MGENPLUS_1MN_FAMILY,
  );
});

// @testdoc Existence stage, per-face drop: a bold face whose file is missing is
// dropped alone; the family keeps rendering with its regular face (which is
// exactly today's behaviour), instead of falling back to the OS monospace.
test('existence stage: a missing bold face drops that face only', () => {
  const res = resolveExistingFontSource(
    MGENPLUS_1MN_FAMILY,
    withMgenContract(FACES_ONLY_CONTRACT),
    (file) => file !== 'fonts/bold.ttf',
  );
  assert.equal(res.source, 'extension');
  assert.deepEqual(res.faces, [{ file: 'fonts/regular.ttf', weight: '400' }]);
});

// @testdoc Existence stage: losing the 400-covering face takes the whole family
// to `none` — the picker only ever offers families whose normal cells can be
// drawn with the borrowed face.
test('existence stage: a missing 400-covering face takes the family to none', () => {
  const res = resolveExistingFontSource(
    MGENPLUS_1MN_FAMILY,
    withMgenContract(FACES_ONLY_CONTRACT),
    (file) => file !== 'fonts/regular.ttf',
  );
  assert.equal(res.source, 'none');
});

// @testdoc The existence predicate is called once per declared face, each time
// with the supplying extension id.
test('existence stage: fileExists is consulted per face with the extension id', () => {
  const seen = [];
  resolveExistingFontSource(
    MGENPLUS_1MN_FAMILY,
    withMgenContract(FACES_ONLY_CONTRACT),
    (file, extensionId) => {
      seen.push([file, extensionId]);
      return true;
    },
  );
  assert.deepEqual(seen, [
    ['fonts/regular.ttf', MGENPLUS_1MN_EXTENSION_ID],
    ['fonts/bold.ttf', MGENPLUS_1MN_EXTENSION_ID],
  ]);
});

// --- Font-extension-missing nudge decision (#186) ------------------------

const WITH_EXTENSION = mockGetExtension({
  [MPLUS1CODE_EXTENSION_ID]: {
    extensionUri: { fsPath: '/ext/mplus' },
    packageJSON: { providedFont: REAL_CONTRACT },
  },
});
const NO_EXTENSION = mockGetExtension({});

test('isBundledFamilySelected matches the enum value and any custom value naming the family', () => {
  // The enum ships the bundled family as `"M PLUS 1 Code", monospace`; a user
  // may also type a custom settings.json value naming it. Both count as
  // selecting the bundled family.
  assert.equal(isBundledFamilySelected('"M PLUS 1 Code", monospace'), true);
  assert.equal(isBundledFamilySelected('M PLUS 1 Code'), true);
  assert.equal(isBundledFamilySelected('"M PLUS 1 Code", "Fira Code", monospace'), true);
});

test('isBundledFamilySelected is false for other families and the editor-default empty value', () => {
  assert.equal(isBundledFamilySelected(''), false);
  assert.equal(isBundledFamilySelected('Menlo, monospace'), false);
  assert.equal(isBundledFamilySelected('"Fira Code", monospace'), false);
});

test('nudge fires when the bundled family is selected and the font extension is absent', () => {
  assert.equal(
    shouldNotifyFontExtensionMissing('"M PLUS 1 Code", monospace', NO_EXTENSION, false),
    true,
  );
});

test('nudge does NOT fire when the font extension is installed (borrowed, not none)', () => {
  assert.equal(
    shouldNotifyFontExtensionMissing('"M PLUS 1 Code", monospace', WITH_EXTENSION, false),
    false,
  );
});

test('nudge does NOT fire when a non-bundled family is selected', () => {
  assert.equal(shouldNotifyFontExtensionMissing('Menlo, monospace', NO_EXTENSION, false), false);
  assert.equal(shouldNotifyFontExtensionMissing('', NO_EXTENSION, false), false);
});

test('nudge does NOT fire once already notified this session (guard)', () => {
  assert.equal(
    shouldNotifyFontExtensionMissing('"M PLUS 1 Code", monospace', NO_EXTENSION, true),
    false,
  );
});

// --- Multiple bundled families (#233, design #229 §4) --------------------

const MGEN_CONTRACT = {
  family: MGENPLUS_1MN_FAMILY,
  file: 'fonts/mgenplus-1mn-regular.ttf',
  weight: '400',
  license: 'OFL-1.1',
};
const ROUNDED_CONTRACT = {
  family: ROUNDED_MGENPLUS_1MN_FAMILY,
  file: 'fonts/rounded-mgenplus-1mn-regular.ttf',
  weight: '400',
  license: 'OFL-1.1',
};
const PLEMOLJP_CONSOLE_CONTRACT = {
  family: PLEMOLJP_CONSOLE_HS_FAMILY,
  file: 'fonts/PlemolJPConsoleHS-Regular.ttf',
  weight: '400',
  license: 'OFL-1.1',
};
// #289's package: two static faces, and the FLAT alias byte-equal to the 400 one,
// exactly as the repo convention requires. Declared here rather than reusing
// `MGEN_CONTRACT` so the 2^N matrix below distinguishes this extension's own
// files from another package's.
const SHIROKUMAGEN_CONTRACT = {
  family: SHIROKUMAGEN_TERM_FAMILY,
  file: 'fonts/ShirokumaGenTerm-Regular.ttf',
  weight: '400',
  faces: [
    { file: 'fonts/ShirokumaGenTerm-Regular.ttf', weight: '400' },
    { file: 'fonts/ShirokumaGenTerm-Bold.ttf', weight: '700' },
  ],
  license: 'OFL-1.1',
};
const WITH_MGEN_ONLY = mockGetExtension({
  [MGENPLUS_1MN_EXTENSION_ID]: {
    extensionUri: { fsPath: '/ext/mgen' },
    packageJSON: { providedFont: MGEN_CONTRACT },
  },
});
const WITH_ROUNDED_ONLY = mockGetExtension({
  [ROUNDED_MGENPLUS_1MN_EXTENSION_ID]: {
    extensionUri: { fsPath: '/ext/rounded' },
    packageJSON: { providedFont: ROUNDED_CONTRACT },
  },
});

test('the registry maps every bundled family to its own font extension', () => {
  const families = FONT_REGISTRY.map((e) => e.family);
  // `deepEqual` compares this as a SEQUENCE, so order matters *to this
  // assertion*: a family added to the registry belongs at the position it is
  // listed here. That is the whole of the claim — nothing else checks order.
  // The registry, the settings enum's bundled block and `BUNDLED_FAMILIES`
  // (media/webview-font.js) do happen to agree on it, but nothing asserts that
  // three-way agreement: both cross-checking guards in
  // test/webview-terminal-font.test.js compare sorted lists. (What that file
  // does check per index is alignment WITHIN package.json — enum[i] against
  // enumItemLabels[i] / enumDescriptions[i] / the nls prose.) The runtime does
  // not depend on the order either: `matchRegisteredFamily` and the webview's
  // `bundledFamilyOf` both sort longest-name-first before matching.
  assert.deepEqual(families, [
    BUNDLED_FONT_FAMILY,
    MGENPLUS_1MN_FAMILY,
    ROUNDED_MGENPLUS_1MN_FAMILY,
    PLEMOLJP_CONSOLE_HS_FAMILY,
    SHIROKUMAGEN_TERM_FAMILY,
  ]);
  // The family strings are the TTFs' own name-table values. For the three ` Term`
  // families #275 renamed, that means the CONVERTED files' name tables, re-measured in #275
  // (nameID 1, agreeing with nameID 16 where present) — the pre-#275 measurement
  // (#232) read the upstream bytes, which this repository no longer ships:
  // `scripts/font-fit/` rewrites the name table together with the outlines, so a
  // family string here is a claim about a conversion OUTPUT (design #271 R4).
  // `PlemolJP Console HS` is the one family still measured off upstream bytes
  // (#264: nameID 1 read off both shipped faces — they carry no nameID 16 — and
  // confirmed with fc-scan); that package is not converted.
  // `ShirokumaGen Term` (#289, renamed in #298) is conversion output too, so its
  // string is likewise the CONVERTED files' nameID 1, measured on both shipped
  // faces — and #298 re-baked those faces so that measurement stays a measurement:
  // the name table is what the rename edits, so a registry string moved without a
  // re-bake would be a claim about bytes that no longer say it.
  assert.equal(BUNDLED_FONT_FAMILY, 'M PLUS 1 Code Term');
  assert.equal(MGENPLUS_1MN_FAMILY, 'Mgen+ 1mn Term');
  assert.equal(ROUNDED_MGENPLUS_1MN_FAMILY, 'Rounded Mgen+ 1mn Term');
  assert.equal(PLEMOLJP_CONSOLE_HS_FAMILY, 'PlemolJP Console HS');
  assert.equal(SHIROKUMAGEN_TERM_FAMILY, 'ShirokumaGen Term');
  // The FORMER canonical names, pinned as their own values because they are what
  // users' settings.json files hold: an alias may never be re-spelled, only added
  // to. Each entry declares exactly the alias list the rename created — so the
  // two empty ones are the two families that were never RENAMED, which since #289
  // is not the same as the ones that were never CONVERTED.
  assert.deepEqual(
    FONT_REGISTRY.map((e) => e.aliases ?? []),
    [['M PLUS 1 Code'], ['Mgen+ 1mn'], ['Rounded Mgen+ 1mn'], [], []],
  );
  assert.equal(MGENPLUS_1MN_EXTENSION_ID, 'shirokuma-library.font-mgenplus-1mn');
  assert.equal(
    ROUNDED_MGENPLUS_1MN_EXTENSION_ID,
    'shirokuma-library.font-rounded-mgenplus-1mn',
  );
  assert.equal(PLEMOLJP_CONSOLE_EXTENSION_ID, 'shirokuma-library.font-plemoljp-console');
  assert.equal(SHIROKUMAGEN_EXTENSION_ID, 'shirokuma-library.font-shirokumagen');
  // Each family is supplied by exactly one extension, and no id is shared.
  assert.equal(new Set(FONT_REGISTRY.map((e) => e.extensionId)).size, FONT_REGISTRY.length);
});

test('every name in the match pool resolves to its own canonical family — R3 property', () => {
  // The match invariant, stated over the WHOLE pool (canonical names ∪ aliases)
  // instead of the four hand-listed families this replaced (#274, design #271 R3):
  //
  //   ∀ P ∈ pool: matchRegisteredFamily(`"${P}", monospace`) === canonicalOf(P)
  //
  // Written as a walk over `familyMatchPool()`, so a new registry entry — or a new
  // alias on an existing one — is covered the moment it is declared, with no test
  // edit. That is the point: the pre-#274 version enumerated the families, so it
  // could only ever check the data someone remembered to add to it.
  //
  // The old enumeration's claim survives inside this walk. 'Mgen+ 1mn' is a
  // substring of 'Rounded Mgen+ 1mn' (measured, #232), so a pool scan in
  // declaration order reports the Rounded selection as Mgen+ — resolving the wrong
  // extension and naming the wrong one in the nudge (R5, #233). Longest-first is
  // what the walk over the containing name proves. Substring relations are also
  // exactly what an alias may introduce (the #275 rename makes each old name a
  // proper substring of its Term canonical), which is why the invariant is pinned
  // over the pool rather than over the data that happens to be in it today.
  const pool = familyMatchPool();
  assert.ok(pool.length > 0, 'the match pool is not empty');
  // Non-vacuity of the longest-first half of the claim (#274 review follow-up L2).
  // The walk only EXERCISES longest-first while the pool actually contains a
  // substring pair; today it does (`Mgen+ 1mn` ⊂ `Rounded Mgen+ 1mn`), and a
  // mutation removing the sort fails this test. But that is a property of the data,
  // not of the walk: should the last such pair ever leave the pool, the walk would
  // go on passing while quietly testing nothing about the tie-break — the silent
  // weakening the literal enumeration this replaced could not suffer. So assert the
  // precondition itself, and fail loudly instead. (#275 makes each old name a
  // proper substring of its Term canonical, so this only gets stronger.)
  assert.ok(
    pool.some(({ name }) => pool.some((other) => other.name !== name && other.name.includes(name))),
    'the pool must contain at least one substring pair, or this walk stops testing longest-first',
  );
  for (const { name, canonical } of pool) {
    assert.equal(
      matchRegisteredFamily(`"${name}", monospace`),
      canonical,
      `pool name ${JSON.stringify(name)} must match as ${JSON.stringify(canonical)}`,
    );
    // The bare name (no CSS stack) is the hand-written settings.json shape and
    // must land on the same canonical.
    assert.equal(matchRegisteredFamily(name), canonical, `bare ${JSON.stringify(name)}`);
  }
  // Nothing in the pool is dropped on the way in: every canonical is present, and
  // the pool is exactly canonical ∪ aliases.
  assert.deepEqual(
    [...registeredFamilyNames()].sort(),
    FONT_REGISTRY.flatMap((e) => [e.family, ...(e.aliases ?? [])]).sort(),
  );
});

test('an entry with no aliases matches exactly as it did before the pool — R3 regression', () => {
  // `aliases` is optional and the mixed state (some entries with, some without) is
  // the steady one. `?? []` folds "absent" and "empty" together, so an entry that
  // declares none contributes only its canonical name and its match behaviour is
  // unchanged, bit for bit. PlemolJP Console HS is the designated never-aliased
  // entry (design #271: it is not converted, so it is never renamed).
  assert.equal(
    matchRegisteredFamily('"PlemolJP Console HS", monospace'),
    PLEMOLJP_CONSOLE_HS_FAMILY,
  );
  assert.equal(matchRegisteredFamily('PlemolJP Console HS'), PLEMOLJP_CONSOLE_HS_FAMILY);
  const entry = FONT_REGISTRY.find((e) => e.family === PLEMOLJP_CONSOLE_HS_FAMILY);
  assert.deepEqual(entry.aliases ?? [], []);
});

test('aliases are unique, disjoint from the canonical set, and injection-safe', () => {
  // Written as a walk over the declared aliases, so it holds vacuously while the
  // registry declares none (#274) and starts biting the moment #275 adds the old
  // family names. Three separate hazards:
  //
  //  (a) a duplicated alias would put two pool entries under one name, and which
  //      canonical wins would fall to sort stability — the implicit ordering
  //      dependency R5 exists to forbid;
  //  (b) an alias equal to some canonical would make the same string resolve two
  //      ways depending on pool order, and would also mean an "old name" that is
  //      still a live family;
  //  (c) the alias is interpolated into `@font-face { font-family: '<name>' }`
  //      (getHtml injects canonical AND alias names since #274), so it needs the
  //      same character guard the canonical names have.
  //
  // (c) is asserted by the character-guard test at the bottom of this file, which
  // walks `registeredFamilyNames()` (canonical ∪ aliases) against the exported
  // `INJECTABLE_FAMILY_NAME` — one guard, one pattern, both halves. It used to be
  // re-typed here as a second literal regex, and a rule written twice is one that
  // can be widened once: widening the canonical copy alone would leave aliases
  // rejecting a character their canonical accepts, for a name that is by
  // definition a former canonical.
  const canonical = new Set(FONT_REGISTRY.map((e) => e.family));
  const aliases = FONT_REGISTRY.flatMap((e) => e.aliases ?? []);
  assert.equal(new Set(aliases).size, aliases.length, 'no alias is declared twice');
  for (const alias of aliases) {
    assert.equal(canonical.has(alias), false, `alias ${JSON.stringify(alias)} is also a canonical family`);
  }
});

// --- buildFontFaceCss: the alias mechanism's ONE observable output -----------
//
// Extracted out of `getHtml` in the #274 review follow-up (M1). `src/extension.ts`
// imports `vscode`, so nothing in it can be loaded here — and the alias loop lived
// there, which made it the only part of the mechanism no test could reach: a
// mutation that emitted ONLY the canonical name (dropping every alias-named block)
// passed the entire suite. That failure is silent at runtime too — the webview's
// `document.fonts.check` finds no face for the old name and `resolveFontForMeasure`
// falls back to `DEFAULT_FONT_FAMILY`, taking the user's setting with it — so the
// suite was the only place it could ever have been caught.
//
// The resolver and the URI builder are injected, exactly as `getExtension` and
// `fileExists` are elsewhere in this module, so these assertions are about the CSS
// text and nothing else.

/** A `faceUri` stub: one deterministic URL per (extension, file). */
const stubFaceUri = (extensionId, file) => `https://webview/${extensionId}/${file}`;

/** A `resolve` stub: every family resolves to the given extension and faces. */
const stubResolve = (extensionId, faces) => () => ({ source: 'extension', extensionId, faces });

test('buildFontFaceCss emits the pre-alias output byte for byte for an entry with no aliases', () => {
  // #274 acceptance criterion 3, discharged mechanically. The criterion was
  // written as "the existing injection tests pass unchanged" — but no test of
  // getHtml's CSS output existed, so it could not be discharged as written. This
  // is that test: the expected string is a LITERAL, not a re-derivation, so a
  // change to the block's text (indentation, descriptor order, quoting,
  // `font-display`) fails here instead of shipping.
  //
  // It is a tripwire, not a freeze: if you changed the emitted CSS deliberately,
  // update this literal. What the failure asks is that the change be a decision —
  // `font-display` in particular is load-bearing (see buildFontFaceCss), and the
  // last link, that the face actually paints, is a human's eyes on a real window
  // ("Verifying a bundled font" in CLAUDE.md), not this assertion.
  const css = buildFontFaceCss(
    [{ family: 'PlemolJP Console HS', extensionId: 'pub.font-plemoljp-console' }],
    stubResolve('pub.font-plemoljp-console', [
      { file: 'fonts/Regular.ttf', weight: '400' },
      { file: 'fonts/Bold.ttf', weight: '700' },
    ]),
    stubFaceUri,
  );
  assert.equal(
    css,
    `  @font-face {
    font-family: 'PlemolJP Console HS';
    src: url(https://webview/pub.font-plemoljp-console/fonts/Regular.ttf) format('truetype');
    font-weight: 400;
    font-display: block;
  }
  @font-face {
    font-family: 'PlemolJP Console HS';
    src: url(https://webview/pub.font-plemoljp-console/fonts/Bold.ttf) format('truetype');
    font-weight: 700;
    font-display: block;
  }
`,
  );
  // The same entry with an explicitly EMPTY aliases array must be indistinguishable
  // — `?? []` folds "absent" and "empty" into one thing, and the mixed registry
  // (some entries aliased, some not) is the steady state.
  assert.equal(
    buildFontFaceCss(
      [{ family: 'PlemolJP Console HS', extensionId: 'pub.font-plemoljp-console', aliases: [] }],
      stubResolve('pub.font-plemoljp-console', [{ file: 'fonts/Regular.ttf', weight: '400' }]),
      stubFaceUri,
    ),
    buildFontFaceCss(
      [{ family: 'PlemolJP Console HS', extensionId: 'pub.font-plemoljp-console' }],
      stubResolve('pub.font-plemoljp-console', [{ file: 'fonts/Regular.ttf', weight: '400' }]),
      stubFaceUri,
    ),
  );
});

test('buildFontFaceCss emits a block under the canonical name AND under every alias', () => {
  // The #275 case, pinned before #275 lands. Every declared name must carry the
  // SAME src and weight: an alias is a second name for the same bytes, so an old
  // settings value renders from the current file. Dropping the alias-named blocks
  // — the mutation that used to pass — fails here.
  const faces = [
    { file: 'fonts/Regular.ttf', weight: '400' },
    { file: 'fonts/Bold.ttf', weight: '700' },
  ];
  const css = buildFontFaceCss(
    [
      {
        family: 'Mgen+ 1mn Term',
        extensionId: 'pub.font-mgenplus-1mn',
        aliases: ['Mgen+ 1mn', 'Mgen+ 1m'],
      },
    ],
    stubResolve('pub.font-mgenplus-1mn', faces),
    stubFaceUri,
  );
  const emitted = [...css.matchAll(/font-family: '([^']*)';/g)].map((m) => m[1]);
  // 3 names x 2 faces, and the canonical leads each face's group (a name is added,
  // never substituted).
  assert.deepEqual(emitted, [
    'Mgen+ 1mn Term',
    'Mgen+ 1mn',
    'Mgen+ 1m',
    'Mgen+ 1mn Term',
    'Mgen+ 1mn',
    'Mgen+ 1m',
  ]);
  for (const name of ['Mgen+ 1mn Term', 'Mgen+ 1mn', 'Mgen+ 1m']) {
    for (const face of faces) {
      assert.ok(
        css.includes(`  @font-face {
    font-family: '${name}';
    src: url(https://webview/pub.font-mgenplus-1mn/${face.file}) format('truetype');
    font-weight: ${face.weight};
    font-display: block;
  }
`),
        `no block for ${JSON.stringify(name)} at weight ${face.weight}`,
      );
    }
  }
});

test('buildFontFaceCss emits nothing for an unresolved family or an unavailable face', () => {
  const entries = [{ family: 'Ghost', extensionId: 'pub.font-ghost', aliases: ['Spectre'] }];
  // `source: 'none'` — no font extension supplies the family, so no @font-face at
  // all and the CSS stack falls to the OS monospace (#199).
  assert.equal(buildFontFaceCss(entries, () => ({ source: 'none' }), stubFaceUri), '');
  // A `faceUri` that cannot build a URL (the borrowed extension is not installed)
  // skips that face rather than emitting a block with `url(undefined)`.
  assert.equal(
    buildFontFaceCss(
      entries,
      stubResolve('pub.font-ghost', [{ file: 'fonts/Regular.ttf', weight: '400' }]),
      () => undefined,
    ),
    '',
  );
});

test('buildFontFaceCss refuses a name that would break out of the CSS string', () => {
  // The runtime half of the character guard (security review #274, Low 1). The
  // repository has no CI, so an invariant held only by a test is held only when a
  // person runs it; a name that terminates the `'…'` declaration early takes the
  // rest of the inline stylesheet — the whole webview layout — with it.
  //
  // This test deliberately does NOT reference INJECTABLE_FAMILY_NAME: it states
  // the BEHAVIOUR (these bytes never reach the output) so that widening the
  // constant fails here independently, rather than moving the goalposts with the
  // production value. That only works if the probes cover each way out of the
  // string, one character at a time — a probe set carrying only `'` and `}` left
  // a loosening that admits *just the backslash* undetected (#274 re-review L1).
  // Each entry below is one such route:
  const HOSTILE = [
    // The quote itself: closes the string, then a whole rule of the attacker's.
    "Evil'; } body { display: none } .x {",
    // The backslash alone. `font-family: 'Name\';` — CSS reads `\'` as an ESCAPED
    // quote, so the declaration does not end where it appears to; the parser runs
    // on into the following bytes looking for a close. No `'` needed.
    'Back\\slash',
    // Trailing backslash: the escape lands on the closing quote this code writes.
    'Trailing\\',
    // A raw newline. CSS strings may not contain one, so the parser drops the
    // malformed declaration — silently losing the family and, depending on the
    // recovery point, the block. (JS `$` without /m does not admit a trailing
    // newline, so the constant already rejects this; the probe pins that it must
    // keep doing so.)
    'New\nline',
    // The block delimiters on their own, for the same reason as the quote.
    'Brace}Name',
    'Semi;colon',
  ];
  for (const hostile of HOSTILE) {
    // As an alias: the offending NAME is skipped and its siblings still emit, so
    // one family falling to the OS monospace is the entire blast radius.
    const css = buildFontFaceCss(
      [{ family: 'Good Family', extensionId: 'pub.font-x', aliases: [hostile, 'Also Good'] }],
      stubResolve('pub.font-x', [{ file: 'fonts/Regular.ttf', weight: '400' }]),
      stubFaceUri,
    );
    assert.equal(
      css.includes(hostile),
      false,
      `hostile name ${JSON.stringify(hostile)} reached the stylesheet`,
    );
    assert.deepEqual(
      [...css.matchAll(/font-family: '([^']*)';/g)].map((m) => m[1]),
      ['Good Family', 'Also Good'],
      `siblings of ${JSON.stringify(hostile)} must still emit`,
    );
    // As the canonical: a canonical name is not privileged over an alias — the
    // guard is about what the CSS parser will do with the bytes, not about where
    // they came from. With the only name refused, the entry emits nothing at all.
    assert.equal(
      buildFontFaceCss(
        [{ family: hostile, extensionId: 'pub.font-x' }],
        stubResolve('pub.font-x', [{ file: 'fonts/Regular.ttf', weight: '400' }]),
        stubFaceUri,
      ),
      '',
      `hostile canonical ${JSON.stringify(hostile)} must emit nothing`,
    );
  }
});

test('buildFontFaceCss over the real registry emits every registered family', () => {
  // The production wiring, with only the vscode-side URI work stubbed: every entry
  // of FONT_REGISTRY reaches the output under its canonical name (and its aliases,
  // of which there are none today), so a family added to the registry cannot be
  // dropped from the injection without failing here.
  const css = buildFontFaceCss(
    FONT_REGISTRY,
    (family) => ({
      source: 'extension',
      extensionId: FONT_REGISTRY.find((e) => e.family === family).extensionId,
      faces: [{ file: 'fonts/Regular.ttf', weight: '400' }],
    }),
    stubFaceUri,
  );
  assert.deepEqual(
    [...css.matchAll(/font-family: '([^']*)';/g)].map((m) => m[1]),
    FONT_REGISTRY.flatMap((e) => [e.family, ...(e.aliases ?? [])]),
  );
});

test('matchRegisteredFamily keeps the substring semantics for hand-written values', () => {
  // A family named anywhere in the stack — including a fallback position — counts,
  // which is the pre-#233 behaviour `isBundledFamilySelected` documented.
  assert.equal(matchRegisteredFamily('"Fira Code", "Mgen+ 1mn", monospace'), MGENPLUS_1MN_FAMILY);
  assert.equal(matchRegisteredFamily(''), undefined);
  assert.equal(matchRegisteredFamily('Menlo, monospace'), undefined);
});

test('isBundledFamilySelected covers every registered family', () => {
  assert.equal(isBundledFamilySelected('"Mgen+ 1mn", monospace'), true);
  assert.equal(isBundledFamilySelected('"Rounded Mgen+ 1mn", monospace'), true);
});

test('each family resolves through its own extension, independently of the others', () => {
  // Design #229 §5: one installed / one missing is not a new branch — the resolver
  // keys off one registry entry at a time.
  assert.equal(resolveBundledFontSource(MGENPLUS_1MN_FAMILY, WITH_MGEN_ONLY).source, 'extension');
  assert.equal(
    resolveBundledFontSource(ROUNDED_MGENPLUS_1MN_FAMILY, WITH_MGEN_ONLY).source,
    'none',
  );
  const rounded = resolveBundledFontSource(ROUNDED_MGENPLUS_1MN_FAMILY, WITH_ROUNDED_ONLY);
  assert.equal(rounded.source, 'extension');
  assert.equal(rounded.extensionId, ROUNDED_MGENPLUS_1MN_EXTENSION_ID);
  assert.deepEqual(rounded.faces, [
    { file: 'fonts/rounded-mgenplus-1mn-regular.ttf', weight: '400' },
  ]);
});

test('fontExtensionNudgeFamily names the selected family, not a fixed one', () => {
  // The host substitutes this into the message, so a wrong name sends the user to
  // install the wrong extension.
  assert.equal(
    fontExtensionNudgeFamily('"Rounded Mgen+ 1mn", monospace', NO_EXTENSION, false),
    ROUNDED_MGENPLUS_1MN_FAMILY,
  );
  assert.equal(
    fontExtensionNudgeFamily('"Mgen+ 1mn", monospace', NO_EXTENSION, false),
    MGENPLUS_1MN_FAMILY,
  );
  assert.equal(
    fontExtensionNudgeFamily('"M PLUS 1 Code", monospace', NO_EXTENSION, false),
    BUNDLED_FONT_FAMILY,
  );
});

test('fontExtensionNudgeFamily is undefined when the selected family IS supplied', () => {
  // Only the selected family's own extension silences it: having Mgen+ installed
  // does not quiet the nudge for a Rounded selection.
  assert.equal(fontExtensionNudgeFamily('"Mgen+ 1mn", monospace', WITH_MGEN_ONLY, false), undefined);
  assert.equal(
    fontExtensionNudgeFamily('"Rounded Mgen+ 1mn", monospace', WITH_MGEN_ONLY, false),
    ROUNDED_MGENPLUS_1MN_FAMILY,
  );
  assert.equal(fontExtensionNudgeFamily('Menlo, monospace', NO_EXTENSION, false), undefined);
  assert.equal(
    fontExtensionNudgeFamily('"Mgen+ 1mn", monospace', NO_EXTENSION, true),
    undefined,
    'the already-notified guard still wins',
  );
});

test('shouldNotifyFontExtensionMissing agrees with the family-returning form', () => {
  for (const value of [
    '"M PLUS 1 Code", monospace',
    '"Mgen+ 1mn", monospace',
    '"Rounded Mgen+ 1mn", monospace',
    'Menlo, monospace',
    '',
  ]) {
    assert.equal(
      shouldNotifyFontExtensionMissing(value, NO_EXTENSION, false),
      fontExtensionNudgeFamily(value, NO_EXTENSION, false) !== undefined,
      value,
    );
  }
});

// --- Install-state matrix (design #229 §5, #236 item 5) ------------------
//
// The four states the design enumerates for the two Mgen+ families — and, with
// M PLUS 1 Code, PlemolJP Console HS and ShirokumaGen Term in the registry
// too, the full power set over every registered extension (2^5 = 32 states today). There is no new
// branch to test: `resolveExistingFontSource` keys off ONE registry entry at a
// time, so the matrix is an assertion that the families stay INDEPENDENT (an
// installed extension must not make an uninstalled family resolve, and a
// missing one must not suppress an installed family).

const CONTRACT_BY_ID = {
  [MPLUS1CODE_EXTENSION_ID]: REAL_CONTRACT,
  [MGENPLUS_1MN_EXTENSION_ID]: MGEN_CONTRACT,
  [ROUNDED_MGENPLUS_1MN_EXTENSION_ID]: ROUNDED_CONTRACT,
  [PLEMOLJP_CONSOLE_EXTENSION_ID]: PLEMOLJP_CONSOLE_CONTRACT,
  [SHIROKUMAGEN_EXTENSION_ID]: SHIROKUMAGEN_CONTRACT,
};

/** A getExtension mock in which exactly the given extension ids are installed. */
function installedSet(ids) {
  const map = {};
  for (const id of ids) {
    map[id] = {
      extensionUri: { fsPath: `/ext/${id}` },
      packageJSON: { providedFont: CONTRACT_BY_ID[id] },
    };
  }
  return mockGetExtension(map);
}

test('install-state matrix: every subset resolves exactly the installed families', () => {
  const ids = FONT_REGISTRY.map((e) => e.extensionId);
  // 2^N states over the registered extensions (2^5 = 32 today), covering the
  // design's four (both / neither / Mgen+ only / Rounded only) plus the
  // M PLUS 1 Code, PlemolJP Console HS and ShirokumaGen Term axes.
  for (let mask = 0; mask < 1 << ids.length; mask += 1) {
    const installed = ids.filter((_, i) => (mask & (1 << i)) !== 0);
    const getExtension = installedSet(installed);
    for (const entry of FONT_REGISTRY) {
      const expected = installed.includes(entry.extensionId) ? 'extension' : 'none';
      // The file-existence-verified resolver is the one both getHtml and
      // pushFontOptions use since #233 (design #229 R6), so the matrix is
      // asserted through it; `YES` stands in for "the extension ships the file".
      const res = resolveExistingFontSource(entry.family, getExtension, YES);
      assert.equal(
        res.source,
        expected,
        `state [${installed.join(', ') || 'none installed'}]: ${entry.family}`,
      );
      if (res.source === 'extension') {
        assert.equal(res.extensionId, entry.extensionId);
      }
      // The nudge follows the same per-family independence: it fires exactly
      // when the selected family has no supplying extension.
      assert.equal(
        fontExtensionNudgeFamily(`"${entry.family}", monospace`, getExtension, false),
        expected === 'none' ? entry.family : undefined,
        `nudge in state [${installed.join(', ') || 'none installed'}] for ${entry.family}`,
      );
      // …and so does every ALIAS of this family (#274, design #271 R3; #270
      // acceptance ⑤). A settings.json still naming the old family must reach the
      // SAME extension in every install state, not just in the all-installed one —
      // an alias that resolved elsewhere would send the user's old value to another
      // package's bytes, or to the OS monospace, silently. The loop is over
      // `aliases ?? []`, so it stayed vacuously true while the mechanism landed
      // alias-free (#274) and became load-bearing the moment #275 declared the
      // three old names — with no edit here. The two entries that were never
      // renamed (PlemolJP Console HS, and ShirokumaGen Term which is
      // conversion output but a NEW family — #298 changed its string while it was
      // still unpublished, which is a rename of a name nobody holds, so it adds no
      // alias either) still contribute zero iterations,
      // which is the optional field behaving as designed rather than a hole in
      // the matrix.
      for (const alias of entry.aliases ?? []) {
        assert.equal(
          matchRegisteredFamily(`"${alias}", monospace`),
          entry.family,
          `alias ${alias} must match as ${entry.family}`,
        );
        const viaAlias = resolveExistingFontSource(
          matchRegisteredFamily(`"${alias}", monospace`),
          getExtension,
          YES,
        );
        assert.equal(
          viaAlias.source,
          expected,
          `state [${installed.join(', ') || 'none installed'}]: alias ${alias}`,
        );
        if (viaAlias.source === 'extension') {
          assert.equal(viaAlias.extensionId, entry.extensionId);
        }
        assert.equal(
          fontExtensionNudgeFamily(`"${alias}", monospace`, getExtension, false),
          expected === 'none' ? entry.family : undefined,
          `nudge in state [${installed.join(', ') || 'none installed'}] for alias ${alias}`,
        );
      }
    }
  }
});

// --- providedFont contract vs the registry (plan #230 review H1) ----------

const FONT_PACKAGES_ROOT = path.join(__dirname, '..', 'font-packages');

/**
 * Every font package manifest on disk, keyed by the extension id the manifest
 * ITSELF spells (`${publisher}.${name}`) — the id
 * `vscode.extensions.getExtension` resolves at runtime, so a directory renamed
 * out of step with its manifest cannot satisfy a lookup by coincidence.
 * Directories with no package.json (e.g. one holding only a built .vsix) are
 * skipped.
 */
function scanFontPackages() {
  const byExtensionId = new Map();
  for (const dir of readdirSync(FONT_PACKAGES_ROOT, { withFileTypes: true })) {
    if (!dir.isDirectory()) {
      continue;
    }
    const manifest = path.join(FONT_PACKAGES_ROOT, dir.name, 'package.json');
    if (!existsSync(manifest)) {
      continue;
    }
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    if (typeof pkg.publisher !== 'string' || typeof pkg.name !== 'string') {
      continue;
    }
    byExtensionId.set(`${pkg.publisher}.${pkg.name}`, { dirName: dir.name, pkg });
  }
  return byExtensionId;
}

test('every font package that declares providedFont declares a REGISTERED family', () => {
  // The body never reads a contract's `family` — `resolveBundledFontSource` keys
  // off the registry (src/font-registry.ts) and only takes `file`/`weight` from the
  // contract. So a family typo in a font extension's package.json is a *silent*
  // drift: resolution, injection and rendering all still succeed, while the
  // @font-face name and the extension's declared name disagree.
  //
  // Direction is deliberately ⊆, not ≡: registered families whose extension package
  // does not exist yet (#234/#235 create them) must not fail this. The ≡ direction
  // — every registered family has a package — belongs to the post-merge check
  // (#236).
  const registered = new Set(FONT_REGISTRY.map((e) => e.family));
  const root = path.join(__dirname, '..', 'font-packages');
  const declared = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) {
      continue;
    }
    const manifest = path.join(root, dir.name, 'package.json');
    if (!existsSync(manifest)) {
      continue;
    }
    const providedFont = JSON.parse(readFileSync(manifest, 'utf8')).providedFont;
    if (!providedFont) {
      continue;
    }
    declared.push([dir.name, providedFont.family]);
  }
  assert.ok(declared.length > 0, 'at least one font package declares a providedFont contract');
  for (const [dirName, family] of declared) {
    assert.ok(
      registered.has(family),
      `font-packages/${dirName} declares providedFont.family ${JSON.stringify(family)}, which is not in FONT_REGISTRY`,
    );
  }
});

test('every REGISTERED family has a font package declaring it (≡ direction, #236)', () => {
  // The other half of the ⊆ check above, and the reason it is here rather than in
  // #233: ⊆ holds in every intermediate state (a registry entry whose extension
  // package does not exist yet passes it vacuously), so it stays green while the
  // families are being added one sub-issue at a time. ≡ can only hold once every
  // sub has landed — asserting it earlier would have failed on registry 3 vs
  // package 1.
  //
  // What ⊆ cannot catch and this does:
  //   (a) a registered family whose supplying extension's package.json is absent
  //       entirely (nothing to scan, so ⊆ never looks at it);
  //   (b) a supplying package that declares no providedFont contract at all — ⊆
  //       `continue`s past a package with no contract, so it passes vacuously.
  //       (A contract that is present but omits `family` is caught by BOTH:
  //       `registered.has(undefined)` is false. Verified by deliberate breakage.)
  // Both are silent at runtime: the body never reads a contract's `family`, so
  // resolution, @font-face injection and rendering all still succeed while the
  // extension's declared name and the injected one disagree.
  //
  // The lookup is keyed by the extension id the manifest ITSELF spells
  // (`${publisher}.${name}`), not by directory name — that is the id
  // `vscode.extensions.getExtension` resolves at runtime, so a directory renamed
  // out of step with the manifest cannot make this pass by coincidence.
  const byExtensionId = scanFontPackages();

  for (const { family, extensionId } of FONT_REGISTRY) {
    const found = byExtensionId.get(extensionId);
    assert.ok(
      found,
      `FONT_REGISTRY maps ${JSON.stringify(family)} to ${extensionId}, but no font-packages/*/package.json declares that publisher.name`,
    );
    const providedFont = found.pkg.providedFont;
    assert.ok(
      providedFont,
      `font-packages/${found.dirName} (${extensionId}) declares no providedFont contract for ${JSON.stringify(family)}`,
    );
    assert.equal(
      providedFont.family,
      family,
      `font-packages/${found.dirName} (${extensionId}) declares providedFont.family ${JSON.stringify(providedFont.family)}, but FONT_REGISTRY expects ${JSON.stringify(family)}`,
    );
    // The contract must also carry a usable `file` — the one contract field the
    // body DOES read. An absent/empty one silently downgrades the borrow to
    // `none` (OS monospace) with no error anywhere.
    assert.ok(
      typeof providedFont.file === 'string' && providedFont.file.length > 0,
      `font-packages/${found.dirName} declares no providedFont.file`,
    );
    assert.ok(
      existsSync(path.join(FONT_PACKAGES_ROOT, found.dirName, providedFont.file)),
      `font-packages/${found.dirName} declares providedFont.file ${JSON.stringify(providedFont.file)}, which is not on disk`,
    );
    // …and so must EVERY face the contract declares (#247, design #245 R9). The
    // two assertions above stay flat-only on purpose: this repo's own font
    // packages always keep the flat pair as the 400 face (skew ③ protection,
    // design #245 §1), so a faces-only manifest landing here is itself a
    // deviation this file should fail on. The per-face check below goes through
    // the runtime normalization instead, so a `faces` array's extra files are
    // covered by the same on-disk requirement.
    for (const face of normalizeContractFaces(providedFont)) {
      assert.ok(
        existsSync(path.join(FONT_PACKAGES_ROOT, found.dirName, face.file)),
        `font-packages/${found.dirName} declares a face file ${JSON.stringify(face.file)} (weight ${JSON.stringify(face.weight)}), which is not on disk`,
      );
    }
  }
});

test('a contract declaring faces keeps the flat pair equal to its 400 face', () => {
  // Drift guard for the double declaration (design #245 §1). The runtime reads
  // only ONE of the two shapes — `faces` when the key is present — so nothing at
  // runtime notices if the flat pair (which older hosts read, skew ③) points at a
  // different file or weight. Only a test can hold them together.
  //
  // Vacuously green while every shipped package is flat-only, which is the
  // intended intermediate state: it arms itself the moment a `faces` array
  // appears.
  const byExtensionId = scanFontPackages();
  for (const { extensionId } of FONT_REGISTRY) {
    const found = byExtensionId.get(extensionId);
    const providedFont = found?.pkg?.providedFont;
    if (!providedFont || !Array.isArray(providedFont.faces)) {
      continue;
    }
    const regular = providedFont.faces.filter(
      (f) => typeof f?.weight === 'string' && coversWeight400(f.weight),
    );
    assert.equal(
      regular.length,
      1,
      `font-packages/${found.dirName} must declare exactly one 400-covering face`,
    );
    assert.equal(
      providedFont.file,
      regular[0].file,
      `font-packages/${found.dirName} declares providedFont.file ${JSON.stringify(providedFont.file)}, which is not its 400 face ${JSON.stringify(regular[0].file)}`,
    );
    assert.equal(
      providedFont.weight,
      regular[0].weight,
      `font-packages/${found.dirName} declares providedFont.weight ${JSON.stringify(providedFont.weight)}, which is not its 400 face's weight ${JSON.stringify(regular[0].weight)}`,
    );
  }
});

// The face set each shipped contract must declare, keyed by the supplying
// extension id and written as the list of face weights, in declaration order.
// Deliberately per-extension rather than one rule: what a face may claim is a
// property of the FACE's bytes, not of the contract format.
//
//   font-mplus1code            ['400', '700']   Two STATIC faces since #275. It used
//                                               to be the one VARIABLE font here
//                                               (a single face declaring the whole
//                                               fvar wght 100–700 axis, #176), and
//                                               ['100 700'] was a TRUE statement
//                                               about those bytes. The conversion
//                                               (design #271 R6) instances it at 400
//                                               and 700 before refitting the
//                                               outlines — changing outlines on a
//                                               variable font would corrupt the gvar
//                                               deltas — so no fvar survives and the
//                                               range would now be a false claim,
//                                               i.e. the bold-suppressing trap below.
//   font-mgenplus-1mn          ['400', '700']   Two STATIC faces, each declaring its
//                                               own single weight (plan #246 / #249).
//   font-rounded-mgenplus-1mn  ['400', '700']   Two STATIC faces, each declaring its
//                                               own single weight (plan #246 / #250).
//   font-plemoljp-console      ['400', '700']   Two STATIC faces, each declaring its
//                                               own single weight (plan #263 / #264).
//
//   Every shipped family is static now, and they all follow the same rule (design
//   #229 R3): a real bold face is shipped, so 700 is covered by BYTES rather than
//   by a range claim, and no static face may widen its own declaration.
//   Order is the declaration order in `providedFont.faces` (regular first),
//   which this table compares with deepEqual.
//
// Why a STATIC face must never declare a range: `getHtml` injects each face's
// weight verbatim into `@font-face { font-weight: … }`, and a declared range is a
// CLAIM that the face covers those weights. In CSS font matching, a face whose
// descriptor covers the requested weight is selected as the real thing — so a
// static regular face declaring "100 700" is chosen for xterm's bold cells and
// paints them at regular weight. Covering 700 therefore obliges the package to
// ship a real 700 face (a second `faces[]` entry), which is what plan #246 adds
// for the Mgen+ families. (Measured on a Linux VM: a static face declaring
// "100 700" renders bold at ink ratio 1.000 — bold vanishes. That measurement is
// cited only for this direction; it says nothing about what any platform does
// when 700 is left uncovered, which is the open question behind #244.)
//
// The measured side is taken through the SAME normalization the runtime uses
// (`normalizeContractFaces`), not by reading `providedFont` fields directly: a
// direct read would quietly stop covering whichever shape the runtime happens to
// normalize differently.
//
// This is the machine-checkable half of design #229 R3 / #245 R9. What a machine
// cannot check is the painted pixels — the human observation CLAUDE.md's
// "Verifying a bundled font" section describes. Omitting `weight` on a flat
// contract is the range failure with an extra step: `DEFAULT_FONT_WEIGHT`
// ('100 700', the axis the ORIGINAL variable M PLUS 1 Code declared) is
// substituted — which since #275 no shipped face has, so no shipped contract may
// leave `weight` out.
const EXPECTED_CONTRACT_FACES = new Map([
  [MPLUS1CODE_EXTENSION_ID, ['400', '700']],
  [MGENPLUS_1MN_EXTENSION_ID, ['400', '700']],
  [ROUNDED_MGENPLUS_1MN_EXTENSION_ID, ['400', '700']],
  [PLEMOLJP_CONSOLE_EXTENSION_ID, ['400', '700']],
  [SHIROKUMAGEN_EXTENSION_ID, ['400', '700']],
]);

test('every shipped contract declares the faces its package actually has (#247, design #245 R9)', () => {
  const byExtensionId = scanFontPackages();
  // Every registered extension must have an entry in the table above, so adding a
  // font family (or a face to one) cannot skip this check by simply not being
  // listed.
  assert.deepEqual(
    [...EXPECTED_CONTRACT_FACES.keys()].sort(),
    FONT_REGISTRY.map((e) => e.extensionId).sort(),
    'EXPECTED_CONTRACT_FACES must name exactly the registered font extensions',
  );

  for (const { family, extensionId } of FONT_REGISTRY) {
    const found = byExtensionId.get(extensionId);
    assert.ok(found, `no font package manifest declares ${extensionId}`);
    const weights = normalizeContractFaces(found.pkg.providedFont).map((f) => f.weight);
    assert.deepEqual(
      weights,
      EXPECTED_CONTRACT_FACES.get(extensionId),
      `font-packages/${found.dirName} normalizes to face weights ${JSON.stringify(weights)} for ${JSON.stringify(family)} (see the comment above this test)`,
    );
  }
});

test('every injectable name — canonical and alias — stays within the guarded characters', () => {
  // #233 follow-up L3, widened to the whole pool in the #274 review follow-up. The
  // name is interpolated into the injected `@font-face { font-family: '<name>' }`
  // (buildFontFaceCss) and, for canonicals, into the settings enum, so a quote,
  // backslash, semicolon or brace would break out of the CSS declaration.
  //
  // Two things make this ONE guard rather than the two it used to be. The walk is
  // over `registeredFamilyNames()` (canonical ∪ aliases), so the alias half is no
  // longer a copy of this assertion living beside the alias uniqueness test. And
  // the pattern is the production constant `INJECTABLE_FAMILY_NAME`, not a literal
  // re-typed here — the same value `buildFontFaceCss` enforces at runtime, so
  // widening it deliberately (having checked the escaping at the injection site)
  // moves the test and the runtime guard together and cannot move only one.
  const names = registeredFamilyNames();
  assert.ok(names.length > 0, 'the match pool is not empty');
  for (const name of names) {
    assert.match(name, INJECTABLE_FAMILY_NAME, `unexpected characters in name ${JSON.stringify(name)}`);
  }
});

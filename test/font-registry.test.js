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

const {
  FONT_REGISTRY,
  BUNDLED_FONT_FAMILY,
  MPLUS1CODE_EXTENSION_ID,
  resolveBundledFontSource,
  resolveExistingFontSource,
  isBundledFamilySelected,
  shouldNotifyFontExtensionMissing,
} = require('../src/font-registry.ts');

// A contract matching what the shipped font extension declares (#184):
// { family, file, weight, license }.
const REAL_CONTRACT = {
  family: 'M PLUS 1 Code',
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
  assert.equal(res.file, 'fonts/MPLUS1Code.ttf');
  assert.equal(res.weight, '100 700');
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
      packageJSON: { providedFont: { family: 'M PLUS 1 Code', weight: '100 700' } },
    },
  });
  const res = resolveBundledFontSource(BUNDLED_FONT_FAMILY, getExtension);
  assert.equal(res.source, 'none');
});

test('defaults the weight to 100 700 when the contract omits weight', () => {
  // The shipped face declares fvar wght 100–700 (#176); when a font extension
  // supplies a `file` but omits `weight`, the resolver defaults to that axis so
  // the injected @font-face still declares the correct range.
  const getExtension = mockGetExtension({
    [MPLUS1CODE_EXTENSION_ID]: {
      extensionUri: {},
      packageJSON: { providedFont: { family: 'M PLUS 1 Code', file: 'fonts/x.ttf' } },
    },
  });
  const res = resolveBundledFontSource(BUNDLED_FONT_FAMILY, getExtension);
  assert.equal(res.source, 'extension');
  assert.equal(res.file, 'fonts/x.ttf');
  assert.equal(res.weight, '100 700');
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
  assert.equal(res.file, 'fonts/MPLUS1Code.ttf');
  assert.equal(res.weight, '100 700');
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

test('resolveExistingFontSource passes the contract file path to the predicate', () => {
  const seen = [];
  resolveExistingFontSource(BUNDLED_FONT_FAMILY, WITH_EXTENSION, (path) => {
    seen.push(path);
    return true;
  });
  assert.deepEqual(seen, ['fonts/MPLUS1Code.ttf']);
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

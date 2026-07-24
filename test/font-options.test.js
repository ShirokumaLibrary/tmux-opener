'use strict';

// Behavioral tests for the fontOptions payload builder (#209, plan #207 task 3).
// The host pushes this payload to the webview so a later UI (#210) can render a
// font picker. The builder is the one piece of decision logic in the wiring: it
// annotates the package.json fontFamily/fontSize enums against the registered
// bundled family names and an availability predicate, and includes only the
// bundled families the predicate reports available. Non-bundled (plain OS)
// families are always selectable.
//
// The registry data and the existence check are injected (the host backs the
// predicate with #208's `resolveExistingFontSource`), so this stays vscode-free
// and self-contained — no sibling `.ts` import — and `node --test` drives it with
// no build step. The host-side send/receive wiring in src/extension.ts imports
// `vscode` and is not exercised here (that half is covered by grep + check-types).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildFontOptions } = require('../src/font-options.ts');
const { BUNDLED_FONT_FAMILY } = require('../src/font-registry.ts');

// The bundled family ships in the enum as a CSS stack, not the bare family name.
const BUNDLED_ENUM_VALUE = '"M PLUS 1 Code", monospace';
const FAMILY_ENUM = ['', BUNDLED_ENUM_VALUE, 'Menlo, monospace', 'monospace'];
const SIZE_ENUM = [null, 12, 14, 16];
const REGISTERED = [BUNDLED_FONT_FAMILY];
const AVAILABLE = () => true;
const UNAVAILABLE = () => false;

test('includes the bundled family when the availability predicate confirms it', () => {
  const payload = buildFontOptions(FAMILY_ENUM, SIZE_ENUM, 'Menlo, monospace', 14, REGISTERED, AVAILABLE);
  const values = payload.families.map((f) => f.value);
  assert.ok(values.includes(BUNDLED_ENUM_VALUE), 'bundled family must be a candidate');
  const bundled = payload.families.find((f) => f.value === BUNDLED_ENUM_VALUE);
  assert.equal(bundled.bundled, true);
});

test('drops the bundled family when the predicate reports it unavailable', () => {
  const payload = buildFontOptions(FAMILY_ENUM, SIZE_ENUM, 'Menlo, monospace', 14, REGISTERED, UNAVAILABLE);
  const values = payload.families.map((f) => f.value);
  assert.ok(!values.includes(BUNDLED_ENUM_VALUE), 'unavailable bundled family is not a candidate');
});

test('always keeps non-bundled families and the empty editor-default option', () => {
  const payload = buildFontOptions(FAMILY_ENUM, SIZE_ENUM, '', 14, REGISTERED, UNAVAILABLE);
  const values = payload.families.map((f) => f.value);
  assert.ok(values.includes(''), 'editor-default option is kept');
  assert.ok(values.includes('Menlo, monospace'));
  assert.ok(values.includes('monospace'));
  for (const f of payload.families) {
    assert.equal(f.bundled, false);
  }
});

test('passes the fontSize enum through and echoes the current effective values', () => {
  const payload = buildFontOptions(FAMILY_ENUM, SIZE_ENUM, 'monospace', 16, REGISTERED, AVAILABLE);
  assert.deepEqual(payload.sizes, SIZE_ENUM);
  assert.equal(payload.currentFamily, 'monospace');
  assert.equal(payload.currentSize, 16);
});

test('checks availability only for a bundled family (predicate never called otherwise)', () => {
  let calls = 0;
  const spy = () => {
    calls += 1;
    return true;
  };
  buildFontOptions(['Menlo, monospace', 'monospace'], SIZE_ENUM, 'monospace', 14, REGISTERED, spy);
  assert.equal(calls, 0, 'no bundled family in the enum means no availability check');
});

test('matches the registered family as a substring of the CSS stack enum value', () => {
  const seen = [];
  buildFontOptions(FAMILY_ENUM, SIZE_ENUM, '', 14, REGISTERED, (family) => {
    seen.push(family);
    return true;
  });
  // The predicate is invoked with the bare registered family name, not the stack.
  assert.deepEqual(seen, [BUNDLED_FONT_FAMILY]);
});

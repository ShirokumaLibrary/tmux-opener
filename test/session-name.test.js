// Behavioral tests for the pure session-naming logic. Node 24 strips the types
// from the required `.ts` module, so this plain-JS suite runs it under
// `node --test` with no build step and no `vscode` import (Issue #11).
const { test } = require('node:test');
const assert = require('node:assert');

const {
  SESSION_SEPARATOR,
  DEFAULT_BASE_NAME,
  sanitizeSessionName,
  sessionBaseName,
  relatedSessions,
  isRelatedSession,
  nextSessionName,
  profileSuffix,
  resolveToolActions,
  updateSessionName,
} = require('../src/session-name.ts');

/** Profiles shaped like `DEFAULT_PROFILES` resolved to `TmuxProfile` objects. */
const toolProfiles = [
  { label: 'Claude Code', command: 'claude', updateCommand: 'claude update' },
  { label: 'Gemini', command: 'gemini' }, // no updateCommand — update stays off
  { label: 'Grok', command: 'grok', updateCommand: 'grok update' },
];

/** Terse `TmuxSession` factory — only `name` matters to the functions here. */
const s = (name) => ({ name, windows: 1, attached: false });

test('SESSION_SEPARATOR is the doubled dash', () => {
  assert.strictEqual(SESSION_SEPARATOR, '--');
});

test('sanitizeSessionName replaces disallowed characters with a dash', () => {
  assert.strictEqual(sanitizeSessionName('my project'), 'my-project');
  assert.strictEqual(sanitizeSessionName('a:b.c'), 'a-b-c');
  assert.strictEqual(sanitizeSessionName('keep_09-ok'), 'keep_09-ok');
});

test('sanitizeSessionName collapses runs of dashes so a base never holds "--"', () => {
  assert.strictEqual(sanitizeSessionName('foo--bar'), 'foo-bar');
  assert.strictEqual(sanitizeSessionName('a  b'), 'a-b');
  assert.strictEqual(sanitizeSessionName('x///y'), 'x-y');
  assert.ok(!sanitizeSessionName('a::b..c  d').includes('--'));
});

test('sanitizeSessionName trims leading and trailing dashes', () => {
  assert.strictEqual(sanitizeSessionName('-foo-'), 'foo');
  assert.strictEqual(sanitizeSessionName('  spaced  '), 'spaced');
  assert.strictEqual(sanitizeSessionName('!!!'), '');
});

test('sessionBaseName sanitizes an ordinary folder name', () => {
  assert.strictEqual(sessionBaseName('my project'), 'my-project');
  assert.strictEqual(sessionBaseName('foo-bar'), 'foo-bar');
});

test('sessionBaseName falls back to the default base when sanitizing empties out', () => {
  // A folder whose name is all non-ASCII/symbols sanitizes to '' — the base
  // must stay non-empty so attach still happens (Issue #11 regression).
  assert.strictEqual(DEFAULT_BASE_NAME, 'session');
  assert.strictEqual(sessionBaseName('プロジェクト'), 'session');
  assert.strictEqual(sessionBaseName('!!!'), 'session');
  assert.strictEqual(sessionBaseName('---'), 'session');
});

test('relatedSessions matches the base and its "--" namespace only', () => {
  const sessions = [
    s('foo'),
    s('foo--2'),
    s('foo--claude'),
    s('foo-bar'), // a different workspace's base — must NOT be pulled in
    s('foo-bar--2'), // and neither must its extras
    s('other'),
  ];
  const names = relatedSessions('foo', sessions).map((x) => x.name);
  assert.deepStrictEqual(names, ['foo', 'foo--2', 'foo--claude']);
});

test('relatedSessions does not treat "foo-2" as belonging to "foo"', () => {
  const names = relatedSessions('foo', [s('foo'), s('foo-2'), s('foo--2')]).map((x) => x.name);
  assert.deepStrictEqual(names, ['foo', 'foo--2']);
});

test('relatedSessions sorts numerically', () => {
  const names = relatedSessions('foo', [s('foo--10'), s('foo--2'), s('foo')]).map((x) => x.name);
  assert.deepStrictEqual(names, ['foo', 'foo--2', 'foo--10']);
});

test('isRelatedSession matches the base and its "--" namespace only', () => {
  assert.strictEqual(isRelatedSession('foo', 'foo'), true);
  assert.strictEqual(isRelatedSession('foo', 'foo--2'), true);
  assert.strictEqual(isRelatedSession('foo', 'foo--claude'), true);
  // A different workspace's base and its extras must NOT be related.
  assert.strictEqual(isRelatedSession('foo', 'foo-bar'), false);
  assert.strictEqual(isRelatedSession('foo', 'foo-2'), false);
  assert.strictEqual(isRelatedSession('foo', 'other'), false);
});

test('nextSessionName returns the bare base when free', () => {
  assert.strictEqual(nextSessionName('foo', []), 'foo');
});

test('nextSessionName numbers extras with the "--" separator', () => {
  assert.strictEqual(nextSessionName('foo', [s('foo')]), 'foo--2');
  assert.strictEqual(nextSessionName('foo', [s('foo'), s('foo--2')]), 'foo--3');
});

test('nextSessionName numbering does not collide with a "foo-2" workspace base', () => {
  // Even if a session literally named "foo-2" exists, "foo"'s second session is
  // "foo--2", a distinct name.
  assert.strictEqual(nextSessionName('foo', [s('foo'), s('foo-2')]), 'foo--2');
});

test('nextSessionName gives a profile its own namespace', () => {
  assert.strictEqual(nextSessionName('foo', [], 'claude'), 'foo--claude');
  assert.strictEqual(nextSessionName('foo', [s('foo--claude')], 'claude'), 'foo--claude--2');
  // A profile session never consumes the plain numbering.
  assert.strictEqual(nextSessionName('foo', [s('foo')], 'claude'), 'foo--claude');
});

test('profileSuffix slugs the label when no explicit suffix', () => {
  assert.strictEqual(profileSuffix({ label: 'Claude Code' }), 'claude-code');
  assert.strictEqual(profileSuffix({ label: 'Grok' }), 'grok');
});

test('profileSuffix prefers an explicit sessionSuffix and cleans it', () => {
  assert.strictEqual(profileSuffix({ label: 'X', sessionSuffix: '  My  Thing! ' }), 'my-thing');
  assert.ok(!profileSuffix({ label: 'X', sessionSuffix: 'a--b' }).includes('--'));
});

test('profileSuffix falls back to "profile" when nothing usable remains', () => {
  assert.strictEqual(profileSuffix({ label: '!!!' }), 'profile');
  assert.strictEqual(profileSuffix({ label: 'X', sessionSuffix: '   ' }), 'x');
});

test('resolveToolActions enables restart and update for a profile with an updateCommand', () => {
  assert.deepStrictEqual(resolveToolActions('claude', toolProfiles), {
    canRestart: true,
    canUpdate: true,
    toolLabel: 'Claude Code',
  });
});

test('resolveToolActions enables restart but not update when the profile has no updateCommand', () => {
  assert.deepStrictEqual(resolveToolActions('gemini', toolProfiles), {
    canRestart: true,
    canUpdate: false,
    toolLabel: 'Gemini',
  });
});

test('resolveToolActions returns all-false with no toolLabel for an unknown command', () => {
  // A bare shell (or any command that matches no profile) earns nothing, and
  // the object carries no toolLabel key — "shows nothing rather than wrong".
  assert.deepStrictEqual(resolveToolActions('bash', toolProfiles), {
    canRestart: false,
    canUpdate: false,
  });
});

test('resolveToolActions returns all-false for an undefined command', () => {
  // A session whose command was never recorded (e.g. not yet restored) must not
  // claim any tool identity.
  assert.deepStrictEqual(resolveToolActions(undefined, toolProfiles), {
    canRestart: false,
    canUpdate: false,
  });
});

test('updateSessionName namespaces the transient update session under the base', () => {
  assert.strictEqual(updateSessionName('foo'), 'foo--update');
});

test('updateSessionName stays inside the base "--" namespace (collision-safe)', () => {
  // The transient session shares the base's "--" namespace so it can never be
  // mistaken for an unrelated workspace's session — unlike a bare "foo-update",
  // which would BE the base of a "foo-update" workspace and could attach to it.
  assert.ok(isRelatedSession('foo', updateSessionName('foo')));
  assert.ok(!isRelatedSession('foo-update', updateSessionName('foo')));
});

// ---------------------------------------------------------------------------
// The separator as the READMEs state it (#308).
//
// Both READMEs walk a reader through the naming scheme with a worked example
// (`myrepo`, then the numbered and the profile session). Until #308 they wrote
// it with ONE dash, which is what `SESSION_SEPARATOR` was before the collision
// fix — so the documents described a scheme the code had stopped using, and a
// reader copying it out (a blog post did) reproduced the stale form.
//
// WHAT IS BOUND, AND WHAT IS NOT. This is a CURATED PAIR of documents, not a
// sweep, and reading it as "every place the separator appears is checked" is
// the failure it must not cause:
//
//   * BOUND: the two files in `SEPARATOR_QUOTING_DOCS`, each required to spell
//     the numbered and the profile example with today's `SESSION_SEPARATOR`.
//     The expected strings are DERIVED from the constant, so flipping the
//     constant reddens the documents rather than silently re-describing them.
//   * NOT BOUND, on purpose:
//     - Any other file naming a session (CLAUDE.md, the pages confirmation
//       views, commit messages). They are not the user-facing description of
//       the scheme, which is what this check is for.
//     - The PROSE around the examples — the sentence explaining why the
//       separator is doubled is required by #308's acceptance criteria but is
//       not machine-checkable, so a reviewer carries it.
//     - `myrepo` itself. The base name is an arbitrary example; only the
//       separator between it and the suffix is the fact under test.
//
// So a green here means "the two READMEs spell the examples with today's
// separator", never "no stale separator survives anywhere in the repo".
const fs = require('node:fs');
const path = require('node:path');

const SEPARATOR_QUOTING_DOCS = ['README.md', 'README.ja.md'];

/** Read a repo-root-relative document. */
const readDoc = (rel) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

for (const rel of SEPARATOR_QUOTING_DOCS) {
  test(`${rel} spells the numbered session with today's SESSION_SEPARATOR`, () => {
    // Derived, not literal: `nextSessionName` is what actually builds the name,
    // so the document is compared against the code path rather than against a
    // second copy of the separator.
    const expected = nextSessionName('myrepo', [s('myrepo')]);
    assert.strictEqual(expected, `myrepo${SESSION_SEPARATOR}2`); // guards the guard
    assert.ok(
      readDoc(rel).includes(expected),
      `${rel} must show the second session as "${expected}"`,
    );
  });

  test(`${rel} spells the profile session with today's SESSION_SEPARATOR`, () => {
    const expected = `myrepo${SESSION_SEPARATOR}${profileSuffix({ label: 'Claude Code' })}`;
    assert.ok(
      readDoc(rel).includes(expected),
      `${rel} must show the profile session as "${expected}"`,
    );
  });
}

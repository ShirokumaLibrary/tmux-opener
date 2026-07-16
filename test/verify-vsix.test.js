// Unit tests for the GLIBC-floor guard in scripts/verify-vsix.js (Issue #153).
//
// verify-vsix.js is a CLI, but its glibc-extraction/decision logic is pure and
// exported behind a `require.main === module` guard (same "export the pure bits,
// run the CLI only when invoked directly" shape the other suites rely on). We
// drive those functions here with tiny synthetic buffers — a Buffer that simply
// contains the `GLIBC_x.y` strings an ELF's .dynstr would hold — so the test
// never needs a real .node binary. What must be guaranteed is that we take the
// *maximum* required version (numerically, not lexically) and fail above the cap.
const { test } = require('node:test');
const assert = require('node:assert');

const {
  MAX_GLIBC,
  maxGlibcVersion,
  compareGlibc,
  glibcProblem,
} = require('../scripts/verify-vsix.js');

// A buffer that looks like the string table of a linux pty.node: the GLIBC
// version strings are embedded among unrelated bytes, exactly as they sit in
// .dynstr between other symbol names.
function elfLike(...glibcVersions) {
  const parts = ['\0__libc_start_main\0'];
  for (const v of glibcVersions) {
    parts.push(`\0${v}\0`);
  }
  parts.push('\0some_other_symbol\0');
  return Buffer.from(parts.join('random.padding.bytes'), 'latin1');
}

test('MAX_GLIBC is the bookworm-measured 2.34', () => {
  // Sub #152 measured the node:20-bookworm build of pty.node: its highest
  // required symbol is GLIBC_2.34. bookworm ships glibc 2.36, so 2.34 is the
  // real ceiling of what that toolchain emits, not the image's glibc version.
  assert.deepStrictEqual(MAX_GLIBC, { major: 2, minor: 34 });
});

test('maxGlibcVersion returns the highest embedded GLIBC version', () => {
  const bin = elfLike('GLIBC_2.2.5', 'GLIBC_2.14', 'GLIBC_2.28', 'GLIBC_2.34');
  assert.deepStrictEqual(maxGlibcVersion(bin), { major: 2, minor: 34 });
});

test('maxGlibcVersion compares numerically, not lexically (2.34 > 2.9)', () => {
  // Lexical string comparison would rank "2.9" above "2.34"; numeric must not.
  const bin = elfLike('GLIBC_2.9', 'GLIBC_2.34', 'GLIBC_2.9');
  assert.deepStrictEqual(maxGlibcVersion(bin), { major: 2, minor: 34 });
});

test('maxGlibcVersion returns null when no GLIBC symbols are present', () => {
  assert.strictEqual(maxGlibcVersion(Buffer.from('no versions here')), null);
});

test('compareGlibc orders by major then minor, numerically', () => {
  assert.ok(compareGlibc({ major: 2, minor: 34 }, { major: 2, minor: 36 }) < 0);
  assert.ok(compareGlibc({ major: 2, minor: 36 }, { major: 2, minor: 34 }) > 0);
  assert.strictEqual(compareGlibc({ major: 2, minor: 34 }, { major: 2, minor: 34 }), 0);
  assert.ok(compareGlibc({ major: 2, minor: 34 }, { major: 3, minor: 0 }) < 0);
  // The numeric trap again, at the comparator level.
  assert.ok(compareGlibc({ major: 2, minor: 9 }, { major: 2, minor: 34 }) < 0);
});

test('glibcProblem passes a binary at the cap (max required = 2.34)', () => {
  const bin = elfLike('GLIBC_2.14', 'GLIBC_2.28', 'GLIBC_2.32', 'GLIBC_2.34');
  assert.strictEqual(glibcProblem(bin, 'pty.node'), null);
});

test('glibcProblem fails a binary that requires a version above the cap (2.37)', () => {
  const bin = elfLike('GLIBC_2.14', 'GLIBC_2.34', 'GLIBC_2.37');
  const p = glibcProblem(bin, 'pty.node');
  assert.ok(p, 'expected a problem string');
  assert.match(p, /2\.37/);
  assert.match(p, /pty\.node/);
});

test('glibcProblem flags a binary with no GLIBC symbols (floor unverifiable)', () => {
  const p = glibcProblem(Buffer.from('static, no glibc'), 'pty.node');
  assert.ok(p, 'expected a problem string');
  assert.match(p, /no GLIBC/i);
});

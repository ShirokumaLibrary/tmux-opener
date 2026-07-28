'use strict';

// Monospace metrics check for every TTF shipped by a font extension under
// `font-packages/*/fonts/` (design #229 §7, decision R10, task #231).
//
// #228's acceptance criterion is "a fullwidth glyph advances exactly twice a
// halfwidth one". That was a one-off manual measurement; this suite turns it
// into a reproducible machine check that runs on `npm test` and keeps holding
// when a TTF is added or replaced.
//
// The reader below is a DELIBERATELY MINIMAL sfnt reader, not a font parser:
// it reads the table directory and then only `head` (unitsPerEm, for the
// diagnostic message), `hhea` (numberOfHMetrics), `hmtx` (advance widths) and
// `cmap` (formats 4 and 12 — the shipped MPLUS1CodeTerm-*.ttf carry both, in four
// subtables: (0,3) fmt4, (0,4) fmt12, (3,1) fmt4, (3,10) fmt12). No glyf, no
// loca, no name, no composite glyphs. Keeping it this small is what lets the
// check have ZERO dependencies (rejected alternatives: fonttools/ttx — a
// Python dependency; fc-query spacing — environment-dependent and it does not
// prove the 2x relation; see design #229 §7).
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT: `hmtx` carries the advance widths of
// the font's DEFAULT INSTANCE. That caveat used to have live subject matter —
// MPLUS1Code.ttf was a variable font (`fvar`/`gvar`/`HVAR`/`avar`/`STAT`) whose
// per-instance advance deltas live in `HVAR`, which this reader deliberately does
// not read (reading it would end the "minimal, zero-dependency" property), so a
// green run stated the 2x relation **at the default instance** and nothing about
// the rest of the variation space. Since #275 (design #271 R6) NO shipped face is
// variable: `scripts/font-fit/instance.py` pins M PLUS 1 Code at wght 400 and 700
// before the outlines are refitted (changing outlines first would corrupt the
// gvar deltas), so every TTF under `font-packages/*/fonts/` is static and its
// default instance is its only one. The reader is unchanged and the caveat is
// kept as a statement about the READER, not about today's files — adding a
// variable face back re-arms it instead of slipping through.
//
// `.notdef` is gid 0, and looking a missing codepoint up in a cmap yields gid
// 0 too — whose advance is a perfectly normal number (500 in the M PLUS faces).
// So "absent from cmap" must be detected as absence, never read as a width;
// every lookup here returns `undefined` for gid 0 rather than falling through.
// Measured, that number is not merely plausible: it is exactly A (500), so
// reading gid 0 as a width produces a false PASS as well as a false FAIL. A
// sample absent from every cmap would be counted as *present* by (c) and pad
// the "at least 3 present" floor that exists precisely to forbid an empty pass.
// Absence has to stay absence for (c) to mean anything.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const FONT_PACKAGES_DIR = path.join(REPO_ROOT, 'font-packages');

// (a) ASCII printable range: every codepoint must be present and share one
// advance width A.
const ASCII_FIRST = 0x21;
const ASCII_LAST = 0x7e;

// (b) Fullwidth samples, restricted to CJK ideographs and kana on purpose.
// U+FF21 (fullwidth latin A) and U+3000 (ideographic space) are NOT samples
// and must not be added: measured against the M PLUS 1 Code faces, U+FF21 is in
// none of their cmap subtables (it would fall to gid 0 / advance 500 and fail
// falsely),
// and U+3000 advances 500 = 1A, so "fullwidth codepoint implies 2A" is not
// even true within a single font. See design #229 §7 (b).
const FULLWIDTH_SAMPLES = [
  { cp: 0x4e00, label: '一 U+4E00' },
  { cp: 0x6f22, label: '漢 U+6F22' },
  { cp: 0x3042, label: 'あ U+3042' },
  { cp: 0x3093, label: 'ん U+3093' },
  { cp: 0x30a2, label: 'ア U+30A2' },
];

// (c) A font with no CJK glyphs at all would skip every sample and pass while
// verifying nothing. Requiring a floor of present samples forbids that empty
// pass structurally.
const MIN_PRESENT_SAMPLES = 3;

// --- minimal sfnt reader -------------------------------------------------

function readTableDirectory(buf) {
  const sfntVersion = buf.readUInt32BE(0);
  // 0x00010000 = TrueType outlines, 'true' = legacy Apple, 'OTTO' = CFF.
  assert.ok(
    sfntVersion === 0x00010000 || sfntVersion === 0x74727565 || sfntVersion === 0x4f54544f,
    `unsupported sfnt version 0x${sfntVersion.toString(16)}`,
  );
  const numTables = buf.readUInt16BE(4);
  const tables = new Map();
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    const tag = buf.toString('ascii', rec, rec + 4);
    tables.set(tag, { offset: buf.readUInt32BE(rec + 8), length: buf.readUInt32BE(rec + 12) });
  }
  return tables;
}

// cmap format 4 (BMP, segmented). Returns a gid, or undefined when the
// codepoint maps to nothing (including an explicit gid 0).
function lookupFormat4(buf, base, cp) {
  if (cp > 0xffff) { return undefined; }
  const segCount = buf.readUInt16BE(base + 6) / 2;
  const endCodes = base + 14;
  const startCodes = endCodes + segCount * 2 + 2; // + reservedPad
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;

  for (let i = 0; i < segCount; i += 1) {
    const end = buf.readUInt16BE(endCodes + i * 2);
    if (cp > end) { continue; }
    const start = buf.readUInt16BE(startCodes + i * 2);
    if (cp < start) { return undefined; }
    const delta = buf.readInt16BE(idDeltas + i * 2);
    const rangeOffset = buf.readUInt16BE(idRangeOffsets + i * 2);
    let gid;
    if (rangeOffset === 0) {
      gid = (cp + delta) & 0xffff;
    } else {
      const at = idRangeOffsets + i * 2 + rangeOffset + (cp - start) * 2;
      if (at + 1 >= buf.length) { return undefined; }
      const raw = buf.readUInt16BE(at);
      if (raw === 0) { return undefined; }
      gid = (raw + delta) & 0xffff;
    }
    return gid === 0 ? undefined : gid;
  }
  return undefined;
}

// cmap format 12 (full range, sorted groups).
//
// `nGroups` is a uint32 read straight out of the file, so it is clamped to what
// the buffer can actually hold: an unclamped 0xFFFFFFFF makes `(lo + hi) >> 1`
// fold through ToInt32 to mid = -1, which reads the subtable's own
// `length`/`language` fields as a group (an in-bounds read, so nothing throws)
// and, with those zero, leaves `lo`/`hi` unchanged — an infinite loop. Node's
// test runner has no per-test timeout and this repo has no CI, so that failure
// mode is "never finishes", not "fails". `Math.floor((lo + hi) / 2)` keeps the
// midpoint out of int32 folding as well.
function lookupFormat12(buf, base, cp) {
  const declaredGroups = buf.readUInt32BE(base + 12);
  const maxGroups = Math.max(0, Math.floor((buf.length - (base + 16)) / 12));
  const nGroups = Math.min(declaredGroups, maxGroups);
  let lo = 0;
  let hi = nGroups - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const g = base + 16 + mid * 12;
    const startChar = buf.readUInt32BE(g);
    const endChar = buf.readUInt32BE(g + 4);
    if (cp < startChar) {
      hi = mid - 1;
    } else if (cp > endChar) {
      lo = mid + 1;
    } else {
      const gid = buf.readUInt32BE(g + 8) + (cp - startChar);
      return gid === 0 ? undefined : gid;
    }
  }
  return undefined;
}

function readFont(file) {
  const buf = fs.readFileSync(file);
  const tables = readTableDirectory(buf);
  for (const required of ['cmap', 'hhea', 'hmtx', 'head']) {
    assert.ok(tables.has(required), `missing required table: ${required}`);
  }

  const head = tables.get('head').offset;
  const unitsPerEm = buf.readUInt16BE(head + 18);

  const numberOfHMetrics = buf.readUInt16BE(tables.get('hhea').offset + 34);
  const hmtx = tables.get('hmtx').offset;
  // Zero would make `min(gid, numberOfHMetrics - 1)` read the byte *before*
  // `hmtx` and hand it back as a plausible width — the one place this reader
  // could invent a number, which is exactly what the header rules out.
  assert.ok(numberOfHMetrics > 0, 'hhea.numberOfHMetrics is 0: no advance widths to read');

  const cmap = tables.get('cmap').offset;
  const numSubtables = buf.readUInt16BE(cmap + 2);
  let subtables = [];
  for (let i = 0; i < numSubtables; i += 1) {
    const rec = cmap + 4 + i * 8;
    const base = cmap + buf.readUInt32BE(rec + 4);
    const format = buf.readUInt16BE(base);
    if (format === 4 || format === 12) {
      subtables.push({
        format,
        base,
        platformID: buf.readUInt16BE(rec),
        encodingID: buf.readUInt16BE(rec + 2),
      });
    }
  }
  assert.ok(subtables.length > 0, 'no cmap subtable in format 4 or 12');

  // Search Unicode subtables ONLY, best repertoire first (the sort is stable,
  // so file order decides within a rank). Without the ranking, lookup order is
  // whatever order the font happens to store its subtables in, and a font
  // leading with a (3,0) *symbol* cmap — which maps ASCII into the U+F000
  // private-use block by convention — would have its ASCII resolved against
  // symbol gids. Ranking alone is not enough, though: a font carrying both
  // (3,1) and (3,0) would still fall through to the symbol table for anything
  // the Unicode tables do not map, turning an absent codepoint into an
  // unrelated gid with a plausible advance — the header's "absence stays
  // absence" rule, broken from the other end. So non-Unicode subtables are
  // dropped from the search set outright, after asserting at least one Unicode
  // subtable exists. Harmless for the fonts here (the M PLUS 1 Code faces are
  // (0,3) fmt4 / (0,4) fmt12 / (3,1) fmt4 / (3,10) fmt12, all Unicode), but the next task
  // feeds two unknown faces to this reader.
  const UNICODE_RANK = (sub) => {
    if (sub.platformID === 3 && sub.encodingID === 10) { return 0; } // Windows UCS-4
    if (sub.platformID === 0 && sub.encodingID >= 4) { return 0; }   // Unicode full repertoire
    if (sub.platformID === 3 && sub.encodingID === 1) { return 1; }  // Windows BMP
    if (sub.platformID === 0) { return 1; }                          // Unicode BMP
    return 9;                                                        // symbol / legacy
  };
  subtables.sort((a, b) => UNICODE_RANK(a) - UNICODE_RANK(b));
  assert.ok(
    UNICODE_RANK(subtables[0]) < 9,
    'no Unicode cmap subtable (only symbol/legacy encodings present)',
  );
  subtables = subtables.filter((sub) => UNICODE_RANK(sub) < 9);

  // First non-zero gid across all searched (Unicode) subtables wins; gid 0 (.notdef) is
  // reported as absence by both lookups, so an unmapped codepoint stays
  // unmapped instead of silently taking .notdef's advance width.
  function glyphFor(cp) {
    for (const sub of subtables) {
      const gid = sub.format === 4 ? lookupFormat4(buf, sub.base, cp) : lookupFormat12(buf, sub.base, cp);
      if (gid !== undefined) { return gid; }
    }
    return undefined;
  }

  // hmtx: numberOfHMetrics longHorMetric records (advance, lsb); glyphs past
  // that share the last advance (monospace tails).
  function advanceForGlyph(gid) {
    const index = Math.min(gid, numberOfHMetrics - 1);
    return buf.readUInt16BE(hmtx + index * 4);
  }

  function advanceFor(cp) {
    const gid = glyphFor(cp);
    return gid === undefined ? undefined : advanceForGlyph(gid);
  }

  return { unitsPerEm, numberOfHMetrics, subtables, advanceFor };
}

// --- input discovery -----------------------------------------------------

// `font-packages/*/fonts/*.ttf`. A package directory without a `fonts/`
// directory contributes nothing (e.g. the packaged
// `font-packages/tmux-opener-font-mplus1code/`, which holds only a .vsix).
function discoverFontFiles() {
  if (!fs.existsSync(FONT_PACKAGES_DIR)) { return []; }
  const found = [];
  for (const pkg of fs.readdirSync(FONT_PACKAGES_DIR).sort()) {
    const fontsDir = path.join(FONT_PACKAGES_DIR, pkg, 'fonts');
    if (!fs.existsSync(fontsDir) || !fs.statSync(fontsDir).isDirectory()) { continue; }
    for (const entry of fs.readdirSync(fontsDir).sort()) {
      if (entry.toLowerCase().endsWith('.ttf')) { found.push(path.join(fontsDir, entry)); }
    }
  }
  return found;
}

const fontFiles = discoverFontFiles();

// `font-packages/<pkg>/fonts/x.ttf` -> `<pkg>`. Grouping is by the PACKAGE, not
// by family: a package is what a single `providedFont` contract (and therefore a
// single `@font-face` family name) is declared from, so it is the unit across
// which the faces must agree.
function packageOf(file) {
  return path.basename(path.dirname(path.dirname(file)));
}

const fontFilesByPackage = new Map();
for (const file of fontFiles) {
  const pkg = packageOf(file);
  if (!fontFilesByPackage.has(pkg)) { fontFilesByPackage.set(pkg, []); }
  fontFilesByPackage.get(pkg).push(file);
}

test('font-packages ships at least one TTF to check', () => {
  assert.ok(
    fontFiles.length > 0,
    'no font-packages/*/fonts/*.ttf found — the monospace check would pass vacuously',
  );
});

// One subtest per TTF, named with its repo-relative path, so `node --test`
// output alone shows which fonts were checked (task #231: T2 confirms the
// input grew to 3 TTFs by reading this output).
for (const file of fontFiles) {
  const rel = path.relative(REPO_ROOT, file);

  test(`monospace metrics: ${rel}`, async (t) => {
    const font = readFont(file);

    let asciiAdvance;

    // (a) every ASCII printable codepoint exists and shares one advance A.
    await t.test('(a) ASCII 0x21-0x7E: all present, single advance width A', () => {
      const missing = [];
      const widths = new Map();
      for (let cp = ASCII_FIRST; cp <= ASCII_LAST; cp += 1) {
        const advance = font.advanceFor(cp);
        if (advance === undefined) {
          missing.push(`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
          continue;
        }
        const key = String(advance);
        if (!widths.has(key)) { widths.set(key, []); }
        widths.get(key).push(String.fromCodePoint(cp));
      }
      assert.deepEqual(missing, [], `codepoints absent from cmap: ${missing.join(', ')}`);
      assert.equal(
        widths.size,
        1,
        `ASCII is not single-width (unitsPerEm ${font.unitsPerEm}): ${
          [...widths.entries()].map(([w, chars]) => `${w} => ${chars.join('')}`).join(' | ')
        }`,
      );
      asciiAdvance = Number([...widths.keys()][0]);
      assert.ok(asciiAdvance > 0, `ASCII advance width must be positive, got ${asciiAdvance}`);
    });

    // (b) present fullwidth samples advance exactly 2A.
    // (c) at least MIN_PRESENT_SAMPLES of them must be present, so a font
    //     without CJK glyphs cannot pass by skipping everything.
    await t.test(`(b)(c) fullwidth samples advance 2A, at least ${MIN_PRESENT_SAMPLES} present`, () => {
      assert.ok(asciiAdvance > 0, '(a) must have established A first');
      const expected = asciiAdvance * 2;
      const present = [];
      const absent = [];
      const wrong = [];
      for (const sample of FULLWIDTH_SAMPLES) {
        const advance = font.advanceFor(sample.cp);
        if (advance === undefined) {
          absent.push(sample.label);
          continue;
        }
        present.push(sample.label);
        if (advance !== expected) { wrong.push(`${sample.label}: ${advance} (expected ${expected})`); }
      }
      assert.deepEqual(
        wrong,
        [],
        `A=${asciiAdvance}, so fullwidth must be ${expected}; violations: ${wrong.join(', ')}`,
      );
      assert.ok(
        present.length >= MIN_PRESENT_SAMPLES,
        `only ${present.length}/${FULLWIDTH_SAMPLES.length} fullwidth samples are in cmap `
          + `(need >= ${MIN_PRESENT_SAMPLES}); absent: ${absent.join(', ')}`,
      );
    });
  });
}

// --- (d) cross-face agreement within one package (#249, design #245 R10) -----
//
// Everything above judges each TTF on its own, so two faces of the same family
// could each be perfectly monospaced at DIFFERENT scales and still pass — and
// nothing downstream would notice until pixels: `getHtml` injects one
// `@font-face` family carrying every face, xterm measures the cell from the
// family (the regular face is what it measures), and the bold face is then
// painted into cells sized by the regular one. A bold advance that is not the
// same fraction of the em would make only the bold rows drift out of column.
// unitsPerEm and A are compared as raw font units, so the check is scale-free
// in exactly the way the renderer is not: A/unitsPerEm equal is what actually
// matters, and requiring both equal is the stricter, simpler statement (every
// face here comes from one distribution at one em).
//
// Vacuous for a single-face package by construction — there is nothing to
// disagree with — and it arms itself automatically when a package's second TTF
// lands (`discoverFontFiles` globs `fonts/*.ttf`; nothing per-package has to be
// registered here). That is how it came to cover `font-mplus1code`, whose single
// variable file became two static faces in #275: no edit here, the loop below
// simply started seeing two files.
//
// Same verification limit as the header: `hmtx` is the DEFAULT INSTANCE. Every
// shipped face is static since #275, so that covers them whole; were a variable
// face added back, this would state nothing about the rest of its variation space.
// This RE-IMPLEMENTS subtest (a)'s judgement — (a) keeps its A in a subtest-local
// variable, so there is nothing to share without restructuring the per-file
// tests. The two must state the same thing about ASCII: every codepoint present,
// exactly one advance, and that advance positive. Change one and change the
// other. (The positive check is not decoration here: without it two faces both
// reporting A = 0 would "agree". (a) fails first on any real font in this repo,
// so it guards a case that cannot currently arise — which is exactly why it must
// be written down rather than inferred.)
function singleAsciiAdvance(font, rel) {
  const widths = new Set();
  for (let cp = ASCII_FIRST; cp <= ASCII_LAST; cp += 1) {
    const advance = font.advanceFor(cp);
    assert.notEqual(
      advance,
      undefined,
      `${rel}: U+${cp.toString(16).toUpperCase().padStart(4, '0')} is absent from cmap`,
    );
    widths.add(advance);
  }
  assert.equal(widths.size, 1, `${rel}: ASCII is not single-width (${[...widths].join(', ')})`);
  const asciiAdvance = [...widths][0];
  assert.ok(asciiAdvance > 0, `${rel}: ASCII advance width must be positive, got ${asciiAdvance}`);
  return asciiAdvance;
}

for (const [pkg, files] of fontFilesByPackage) {
  if (files.length < 2) { continue; }

  // @testdoc Every TTF one font package ships agrees with the others on unitsPerEm and A.
  test(`faces of one package agree on unitsPerEm and A: font-packages/${pkg}`, () => {
    const measured = files.map((file) => {
      const rel = path.relative(REPO_ROOT, file);
      const font = readFont(file);
      return { rel, unitsPerEm: font.unitsPerEm, asciiAdvance: singleAsciiAdvance(font, rel) };
    });

    const describe = (m) => `${m.rel}: unitsPerEm ${m.unitsPerEm}, A ${m.asciiAdvance}`;
    const [first, ...rest] = measured;
    for (const other of rest) {
      assert.equal(
        other.unitsPerEm,
        first.unitsPerEm,
        `faces disagree on unitsPerEm — ${describe(first)} vs ${describe(other)}`,
      );
      assert.equal(
        other.asciiAdvance,
        first.asciiAdvance,
        `faces disagree on the ASCII advance A — ${describe(first)} vs ${describe(other)}`,
      );
    }
  });
}

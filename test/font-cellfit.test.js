'use strict';

// Cell-fit contract, sha256 binding and manifest audit for the CONVERSION-OUTPUT
// font packages (design #271 R9 / R13 / review M1, task #276).
//
// Three checks, one file, because all three are keyed off the same single source
// of truth — `scripts/font-fit/manifest.json`:
//
//   (1) GEOMETRY (contract (1), R9, restated against `fitRatio` by #291). For
//       every width-1 codepoint a face maps: ink width ≤ A × fitRatio, ink
//       centred in the cell whenever it leaves the cell at all, and
//       `advance == A`. Zero violations, no allow-list. `fitRatio` is resolved
//       from the manifest (package override → top-level default); its MEANING,
//       LIMIT and DEFAULT are defined once, in `scripts/font-fit/manifest.json`'s
//       `note`, and are not restated here. Applies ONLY to packages listed in the
//       manifest: being listed IS the opt-in to the cell-fit contract. `font-plemoljp-console` is not
//       listed and is not checked — it ships upstream bytes unmodified, and #262
//       measured 372 (Regular) / 454 (Bold) conversion-target glyphs there, by a
//       human scope decision, not by a defect. (Running THIS checker over those
//       two faces reports 374 / 460 — the two numbers count slightly different
//       things: fit.py drops glyphs shared by codepoints of disagreeing width and
//       measures decomposed outlines, while this reads glyf's stored bbox. Both
//       are three digits, which is the point: opting PlemolJP in would make the
//       suite permanently red.)
//   (1v) THE VERTICAL HALF IS NOT HERE, AND THAT IS A MEASURED LIMIT (#293).
//       `vstretch` scales a selected glyph's height by `s × vstretch`, clamped
//       per glyph so the stretched glyph's TOP AND BOTTOM EDGES stay inside
//       those of the face's own U+6F22 (漢). NONE of that is checkable from the
//       shipped bytes alone: the judgement needs the shape the glyph would have
//       had at equal scaling, which lives in the upstream file this repository
//       does not carry. A naive "no subject reaches outside the 漢 box" is FALSE
//       of correct output and was measured to be so — in
//       `MgenPlus1mnTerm-Regular.ttf` 340 width-1 subjects reach above that box
//       and 491 below it at `vstretch = 1.0` (tall brackets and arrows the refit
//       never shrinks, out to y 1101 and −328). THE POPULATION HERE IS EVERY
//       WIDTH-1 SUBJECT OF THE FACE (`is_subject`, a few thousand), NOT the 1,001
//       glyphs `fit.py` actually rewrites — which is the population the manifest
//       note's "141 of 1,001 are already outside at equal scale" counts over.
//       Both numbers are measured and true; they only look contradictory if the
//       word "subject" is read as one set. Those glyphs are outside because the
//       clamp's floor is 1.0: it never SHORTENS or MOVES anything already
//       outside, so the naive claim is false of correct output. That is also
//       why every prose claim about this knob is CONDITIONAL ("the refit pushes
//       nothing past 漢 that was not already past it"), never universal — the
//       universal form contradicts this very paragraph, and #293's first cut
//       shipped it in nine places. So the vertical contract is gated where the
//       input is available — `verify.py`'s contract ③, which measures REACH and
//       is TWO-SIDED (bytes baked at 1.0 fail a 1.3 claim and vice versa; both
//       directions were run, as was the height-clamped first cut against its own
//       1.3 claim, which the reach form fails and the height form passed).
//       Contract ③ also carries a check that does NOT recompute the converter's
//       formula (③c, review Low-A): output reach must stay inside
//       max(wall, equal-scale reach). A formula both `fit.py` and `verify.py`
//       get wrong the same way passes ③a/③b and fails ③c — measured on the
//       height-clamped bytes, where ③a/③b read 0 and ③c reads 312.
//       What this file binds instead is the DECLARATION: (2) below
//       compares the recorded `vstretch` to the manifest's, and (4) binds the
//       prose. Shifting `manifest.vstretch` reddens both.
//   (2) SHA256 BINDING (contract (2)'s repo-side proxy, R13). Each shipped TTF
//       hashes to the value `scripts/font-fit/checksums.json` records — and the
//       `fitRatio` / `vstretch` recorded beside it equal the ones the manifest
//       declares for that face (#291 / #293). The second half is what closes the ONE direction the
//       geometry cannot see: declaring a SMALLER ratio than the bytes were baked
//       at turns (1) red (the widest ink no longer fits the narrower room), but
//       declaring a LARGER one only loosens (1), so nothing geometric fires. The
//       shipped bytes cannot testify to a shrink that never had to happen; the
//       record can, and R13's binding is what keeps the record and the bytes
//       moving together. It is a record, not a measurement — the same identity /
//       provenance limit stated below applies to it.
//   (3) MANIFEST AUDIT (review M1). The manifest decides (1)'s subject set, (2)'s
//       comparison set and README's two-way split, so a typo or a forgotten
//       fifth family there would silently empty all of it. Checked: 4 packages /
//       8 faces, every `package` and `out` exists, and the listed set is
//       IDENTICAL to the set of packages carrying the fixed provenance heading.
//
// Two further sections live below and are NOT keyed off the manifest, so the
// "all three" above does not cover them: (4) prose binding (#291 L1) ties the
// documents that QUOTE the declared numbers to the declaration, and (5)
// license-record line binding (#289 review Medium-1) ties the `path:line: text`
// records transcribed from `scripts/font-fit/check-license.py` to the files they
// cite. (5)'s source of truth is the cited file itself, not `manifest.json`.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT (summary; the canonical single sentence
// is design #271's "検証の限界（再掲・固定枠）" section — do NOT restate it here
// or in `font-packages/README.md`, a norm copied into three places drifts):
//   R13 binds IDENTITY, not PROVENANCE. It says the repo's TTFs have not moved
//   from what `checksums.json` records; any path that rewrites the TTF and
//   `checksums.json` TOGETHER — a deliberate swap, a re-conversion that bypassed
//   `verify.py`, hand work that never ran `run.sh` — passes silently. `npm test`
//   is not a defence against tampering; it detects ACCIDENTS (the "only one of
//   the two moved" kind).
//
// WHICH LAYER MEASURES WHAT (the three do NOT agree, and conflating them is easy):
//   `fit.py`'s fit judgement  -> the DECOMPOSED OUTLINE (`ControlBoundsPen`)
//   `verify.py` contract (1)  -> glyf's STORED bbox (`g.xMin` / `g.xMax`)
//   `verify.py` contract (2)  -> OUTLINE POINT SEQUENCES (body glyphs unchanged)
//   this file (contract (1))  -> glyf's STORED bbox   <- same as verify.py's (1)
//   So this check is not a weaker echo of an outline-measuring gate: it is the
//   SAME measurement as the conversion-time gate's contract (1), re-run at
//   `npm test` time, and the stored-bbox limitation is shared with it rather than
//   unique here. `verify.py`'s own docstring says as much — contract (1) "is not
//   looking at the outlines". What the gate measures from outlines is contract
//   (2), over the whole population, and that is the part with no repo-side
//   equivalent (R13's sha256 binding is its proxy — see (2) above).
//
//   The stored-bbox limitation is real and not rare. Measured here on the shipped
//   faces, over exactly this file's subject set, stored bbox vs `ControlBoundsPen`
//   on the decomposed outline: RoundedMgenPlus1mnTerm-Regular 432 of 2346 subject
//   glyphs disagree, Bold 423 of 2348, MgenPlus1mnTerm-Regular 9 of 2345,
//   MPLUS1CodeTerm-Regular 0 of 341 — and in every one of those the stored box is
//   the NARROWER of the two, which is the direction that can HIDE a violation.
//   (#262 hit the same stale-bbox trap from the other side: ℵ ♺ were judged
//   "already fitting" off a stored bbox smaller than the real outline, which is
//   why `fit.py` measures with `ControlBoundsPen` instead.) Those counts are not
//   432 hidden violations: control bounds include off-curve control points, so
//   they over-estimate ink. They bound WHERE a hidden violation could live, and
//   that bound is not zero. Whether the screen looks right stays, as ever, a human
//   observation on real hardware.
//
// The reader below is the same DELIBERATELY MINIMAL, zero-dependency sfnt reader
// style as `test/font-metrics.test.js`, extended with `maxp`/`loca`/`glyf` so a
// glyph's stored bounding box can be read. No fontTools, no fc-query.
//
// FUTURE ALLOW-LIST GRANULARITY (R9, fixed now so it is not improvised later):
// should a residue ever have to be pinned, the pin is PER FACE, never per family
// — #262 measured different residues for Regular and Bold of the same family
// (R=2 / B=6). Same discipline as `test/font-metrics.test.js` grouping by
// PACKAGE rather than family. Today there is no allow-list: zero is a hard
// condition.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'scripts', 'font-fit', 'manifest.json');
const CHECKSUMS_PATH = path.join(REPO_ROOT, 'scripts', 'font-fit', 'checksums.json');
const FONT_PACKAGES_DIR = path.join(REPO_ROOT, 'font-packages');

// #275 fixed this as the deliverable spec for a conversion-output package's
// README, and #276 uses it as the ≡ key. It is matched as a WHOLE LINE, not as a
// prefix: `font-packages/font-plemoljp-console/README.md` carries an unrelated
// `## Provenance` heading, and a prefix match would classify that non-converted
// package as a conversion output. Changing this heading is allowed only in the
// same commit as this test. `README.ja.md` is NOT consulted — translations are
// free to word their headings differently.
const PROVENANCE_HEADING = '## Provenance (upstream archive → conversion → output)';

const EXPECTED_PACKAGE_COUNT = 4;
const EXPECTED_FACE_COUNT = 8;

// --- exclusion predicates: IDENTICAL to verify.py, a STRICT SUPERSET of xterm --
//
// The subject set is `width === 1 && cp > 0xFF`, minus three ranges. It is a
// term-for-term copy of `scripts/font-fit/verify.py`'s
// `width_of(cp) == 1 and cp > 0xFF and not in_private_use(cp) and not in_custom_range(cp)`
// (constants: `fit.py`'s `CUSTOM_GLYPH_RANGES` / `PRIVATE_USE_RANGE`). The two
// implementations exist on purpose — Node is the regression gate, Python the
// conversion-time full check — so keeping the predicate a 4-term copy is what
// keeps the drift surface minimal. Change one, change the other.
//
//   isBoxDrawing  U+2500–257F  ┐ the WebGL renderer draws these as VECTORS
//   isBlock       U+2580–259F  ┘ without consulting the font, and box drawing
//                                must touch the cell edge to connect, so
//                                shrinking inward would break it
//   isPowerline   U+E000–F8FF  = the WHOLE BMP private use area (planes 15/16,
//                                supplementary private use, are NOT excluded)
//
// WHERE THOSE COME FROM IN XTERM — NOT all from one function, so do not read the
// R9 shorthand "the 3 predicates of `allowRescaling`" too literally. The bundled
// bytes (`node_modules/@xterm/addon-webgl/lib/addon-webgl.js`), de-minified:
//
//   allowRescaling(code, width, glyphWidth, cellWidth) =
//     width === 1 && glyphWidth > Math.ceil(1.5 * cellWidth) &&
//     code !== undefined && code > 255 &&
//     !isEmoji(code) && !isPowerlineGlyph(code) &&
//     !(0xE000 <= code && code <= 0xF8FF)
//
//   isPowerlineGlyph(code) = 0xE0A4 <= code && code <= 0xE0D6
//   treatGlyphAsBackgroundColor(code) = isPowerlineGlyph(code)
//                                       || (0x2500 <= code && code <= 0x259F)
//
// so, precisely:
//   - U+2500–259F is NOT a term of `allowRescaling`. It is excluded one layer
//     earlier, by the `customGlyphs` vector path (`tryDrawCustomGlyph`, gated on
//     `customGlyphs !== false`, default true) and `treatGlyphAsBackgroundColor`.
//     The exclusion is right; the citation "allowRescaling" for it is not.
//   - The PUA exclusion IS a term of `allowRescaling`, but as the inline
//     0xE000–F8FF test; xterm's named `isPowerlineGlyph` is far narrower
//     (U+E0A4–E0D6). R9 fixes the vocabulary on the wider range, which is what
//     this file implements.
//   - `allowRescaling` additionally has `!isEmoji(code)`, and this subject set
//     does NOT. `isEmoji` covers U+2600–26FF and U+2700–27BF among others, so
//     ⚠ U+26A0 / ✓ U+2713 / ✔ U+2714 — the three the width-table test below
//     pins — are inside it: xterm will never rescale them, yet this file still
//     requires them to fit their cell.
//
// Net: the subject set is a STRICT SUPERSET of what `allowRescaling` would act
// on (box/block added, `!isEmoji` not taken). That direction is the safe one —
// stricter than the renderer, and exactly equal to the conversion-time gate,
// which is the pair that must agree. R9's own wording inherits the imprecise
// "3 predicates of allowRescaling" citation; corrected here rather than in the
// design, and reported upward (task #276 review Low-1).
const CUSTOM_GLYPH_RANGES = [
  [0x2500, 0x257f], // isBoxDrawing
  [0x2580, 0x259f], // isBlock
];
const PRIVATE_USE_RANGE = [0xe000, 0xf8ff]; // isPowerline (BMP PUA in full)

function inCustomRange(cp) {
  return CUSTOM_GLYPH_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

function inPrivateUse(cp) {
  return cp >= PRIVATE_USE_RANGE[0] && cp <= PRIVATE_USE_RANGE[1];
}

function isCellFitSubject(cp, widthOf) {
  return cp > 0xff && !inPrivateUse(cp) && !inCustomRange(cp) && widthOf(cp) === 1;
}

// --- width table: generated here, never committed ---------------------------
//
// The column count a codepoint is allotted comes from xterm's OWN unicode11
// provider, not from a hand-transcribed EastAsianWidth table (transcribing one
// dropped ⚠ ✓ ✔ — #262 accident 1). Generated at test time rather than
// committed so it follows the bundled xterm automatically (design #273/#271 R5:
// a committed width table decays into a hand-maintained artifact the moment
// xterm is bumped).
//
// The require is the PACKAGE name, resolving to `node_modules/@xterm/
// addon-unicode11` — the same bytes `scripts/copy-webview-assets.js` copies into
// `media/xterm/`, which is gitignored and absent before `npm run compile`, so
// reading the built copy would make this test depend on build order (the same
// reasoning as `scripts/font-fit/dump-widths.mjs`).
function buildWidthOf() {
  const mod = require('@xterm/addon-unicode11');
  let provider = null;
  new mod.Unicode11Addon().activate({
    unicode: {
      register(p) {
        provider = p;
      },
    },
  });
  assert.ok(
    provider && typeof provider.wcwidth === 'function',
    'could not obtain the unicode11 provider from @xterm/addon-unicode11',
  );
  // -1 (control) is folded to 255 exactly as dump-widths.mjs does, so neither
  // side can confuse "control" with "one column".
  return (cp) => {
    const w = provider.wcwidth(cp);
    return w < 0 ? 255 : w;
  };
}

const widthOf = buildWidthOf();

// --- minimal sfnt reader (cmap enumeration + hmtx + loca/glyf bbox) ----------

function readTableDirectory(buf) {
  const sfntVersion = buf.readUInt32BE(0);
  assert.ok(
    sfntVersion === 0x00010000 || sfntVersion === 0x74727565,
    `expected TrueType outlines (glyf), got sfnt version 0x${sfntVersion.toString(16)}`,
  );
  const numTables = buf.readUInt16BE(4);
  const tables = new Map();
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    tables.set(buf.toString('ascii', rec, rec + 4), {
      offset: buf.readUInt32BE(rec + 8),
      length: buf.readUInt32BE(rec + 12),
    });
  }
  return tables;
}

// Unicode subtables only, best repertoire first — same ranking (and same
// reasoning) as `test/font-metrics.test.js`: a (3,0) symbol cmap maps ASCII into
// U+F000 by convention, so resolving against it would silently answer with
// unrelated gids.
function unicodeRank(sub) {
  if (sub.platformID === 3 && sub.encodingID === 10) { return 0; } // Windows UCS-4
  if (sub.platformID === 0 && sub.encodingID >= 4) { return 0; }   // Unicode full repertoire
  if (sub.platformID === 3 && sub.encodingID === 1) { return 1; }  // Windows BMP
  if (sub.platformID === 0) { return 1; }                          // Unicode BMP
  return 9;                                                        // symbol / legacy
}

// A cmap has at most 0x110000 codepoints; anything past that is a malformed
// table, and an unbounded walk over a uint32 range read straight out of the file
// would hang instead of failing (this repo's `node --test` has no per-test
// timeout — same failure mode `lookupFormat12` in font-metrics.test.js guards).
const MAX_CODEPOINTS = 0x110000;

function enumerateFormat4(buf, base, out) {
  const segCount = buf.readUInt16BE(base + 6) / 2;
  const endCodes = base + 14;
  const startCodes = endCodes + segCount * 2 + 2; // + reservedPad
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;

  for (let i = 0; i < segCount; i += 1) {
    const end = buf.readUInt16BE(endCodes + i * 2);
    const start = buf.readUInt16BE(startCodes + i * 2);
    const delta = buf.readInt16BE(idDeltas + i * 2);
    const rangeOffset = buf.readUInt16BE(idRangeOffsets + i * 2);
    if (start > end) { continue; }
    for (let cp = start; cp <= end; cp += 1) {
      if (cp === 0xffff) { continue; } // the mandatory terminating sentinel
      let gid;
      if (rangeOffset === 0) {
        gid = (cp + delta) & 0xffff;
      } else {
        const at = idRangeOffsets + i * 2 + rangeOffset + (cp - start) * 2;
        if (at + 1 >= buf.length) { continue; }
        const raw = buf.readUInt16BE(at);
        if (raw === 0) { continue; }
        gid = (raw + delta) & 0xffff;
      }
      // gid 0 is .notdef; a codepoint mapping there is absent, not present.
      if (gid !== 0) { out.set(cp, gid); }
    }
  }
}

function enumerateFormat12(buf, base, out) {
  const declaredGroups = buf.readUInt32BE(base + 12);
  const maxGroups = Math.max(0, Math.floor((buf.length - (base + 16)) / 12));
  const nGroups = Math.min(declaredGroups, maxGroups);
  for (let i = 0; i < nGroups; i += 1) {
    const g = base + 16 + i * 12;
    const startChar = buf.readUInt32BE(g);
    const endChar = Math.min(buf.readUInt32BE(g + 4), MAX_CODEPOINTS - 1);
    const startGlyph = buf.readUInt32BE(g + 8);
    for (let cp = startChar; cp <= endChar; cp += 1) {
      const gid = startGlyph + (cp - startChar);
      if (gid !== 0) { out.set(cp, gid); }
    }
  }
}

function readFont(file) {
  const buf = fs.readFileSync(file);
  const tables = readTableDirectory(buf);
  for (const required of ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'loca', 'glyf']) {
    assert.ok(tables.has(required), `${file}: missing required table: ${required}`);
  }

  const head = tables.get('head').offset;
  const unitsPerEm = buf.readUInt16BE(head + 18);
  const indexToLocFormat = buf.readInt16BE(head + 50);
  assert.ok(
    indexToLocFormat === 0 || indexToLocFormat === 1,
    `${file}: head.indexToLocFormat is ${indexToLocFormat} (must be 0 or 1)`,
  );

  const numGlyphs = buf.readUInt16BE(tables.get('maxp').offset + 4);
  const numberOfHMetrics = buf.readUInt16BE(tables.get('hhea').offset + 34);
  assert.ok(numberOfHMetrics > 0, `${file}: hhea.numberOfHMetrics is 0`);
  const hmtx = tables.get('hmtx').offset;
  const loca = tables.get('loca').offset;
  const glyf = tables.get('glyf').offset;

  // Pick THE best Unicode subtable and enumerate it whole — the same choice
  // fontTools' `getBestCmap()` makes, which is what `verify.py` iterates. Merging
  // several subtables would produce a codepoint set no renderer ever sees.
  const subtables = [];
  const numSubtables = buf.readUInt16BE(tables.get('cmap').offset + 2);
  for (let i = 0; i < numSubtables; i += 1) {
    const rec = tables.get('cmap').offset + 4 + i * 8;
    const base = tables.get('cmap').offset + buf.readUInt32BE(rec + 4);
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
  assert.ok(subtables.length > 0, `${file}: no cmap subtable in format 4 or 12`);
  subtables.sort((a, b) => unicodeRank(a) - unicodeRank(b));
  const best = subtables[0];
  assert.ok(unicodeRank(best) < 9, `${file}: no Unicode cmap subtable`);

  const cmap = new Map();
  if (best.format === 4) {
    enumerateFormat4(buf, best.base, cmap);
  } else {
    enumerateFormat12(buf, best.base, cmap);
  }
  assert.ok(cmap.size > 0, `${file}: the best Unicode cmap subtable maps nothing`);

  function locaAt(index) {
    return indexToLocFormat === 0
      ? buf.readUInt16BE(loca + index * 2) * 2
      : buf.readUInt32BE(loca + index * 4);
  }

  // The glyph's STORED bounding box (glyf header: numberOfContours, xMin, yMin,
  // xMax, yMax), which is what `verify.py` reads via `g.xMin` / `g.xMax`.
  // `null` = this glyph has no outline (empty loca entry, or an explicit
  // numberOfContours of 0), matching verify.py's `if g.numberOfContours != 0`.
  //
  // "No outline" and "malformed record" are kept APART on purpose. Folding them
  // together would drop a corrupt glyph out of the subject set silently — a
  // fail-OPEN in a file whose whole job is to fail closed, and the exact shape of
  // "the check looks like it ran and did not". An empty glyph is `end <= start`
  // and nothing else; a non-empty record too short to hold the 10-byte header, or
  // one running past the table, is a broken font and must be loud.
  function glyphBounds(gid) {
    assert.ok(gid < numGlyphs, `${file}: cmap maps to gid ${gid}, past maxp.numGlyphs ${numGlyphs}`);
    const start = locaAt(gid);
    const end = locaAt(gid + 1);
    if (end <= start) { return null; }
    assert.ok(
      end - start >= 10 && glyf + end <= buf.length,
      `${file}: gid ${gid} has a malformed glyf record (loca [${start}, ${end}))`,
    );
    const g = glyf + start;
    if (buf.readInt16BE(g) === 0) { return null; }
    return {
      xMin: buf.readInt16BE(g + 2),
      yMin: buf.readInt16BE(g + 4),
      xMax: buf.readInt16BE(g + 6),
      yMax: buf.readInt16BE(g + 8),
    };
  }

  function advanceForGlyph(gid) {
    return buf.readUInt16BE(hmtx + Math.min(gid, numberOfHMetrics - 1) * 4);
  }

  return { buf, unitsPerEm, numGlyphs, cmap, glyphBounds, advanceForGlyph };
}

// --- (1) geometry -----------------------------------------------------------

// Coordinates are rounded to integers when the converter writes them, so the ink
// width and the centring can each be off by a unit. Same constant, same reason,
// as `verify.py`'s `ROUNDING_TOLERANCE` — change one, change the other.
const ROUNDING_TOLERANCE = 2;

// The contract in three comparisons, a term-for-term copy of `verify.py`'s
// contract (1) a/b/c since #291:
//
//   (a) ink width          `xMax - xMin <= cellWidth * fitRatio`
//   (b) symmetric overhang if the ink leaves the cell at all, it is centred on
//                          the cell (`xMin + xMax == cellWidth`), so the spill is
//                          ±(ink - cellWidth)/2 rather than all on one side
//   (c) advance            `advance == cellWidth`, UNCHANGED by fitRatio — the
//                          terminal's grid does not move, only the ink does
//
// Why (b) is a rewrite and not a widened bound: at `fitRatio > 1` a negative
// `xMin` is LEGAL, so the old `xMin < 0 || xMax > cellWidth` does not survive as
// a comparison at all. Relaxing it to a fixed wide box (say 1.5 everywhere)
// would delete the red path, which is the defect #270 actually shipped ("no red
// path in the ink judgement").
//
// PURE, and separate from the walk, for the same reason `digestMatches` is: the
// red path has to be reachable from crafted input. The three terms are NOT
// interchangeable — R9's substance is INK CONTAINMENT, and the advance term
// alone is the easy one to keep alive by accident. A self-proof that only
// narrows the box exercises `advance !== cellWidth` and nothing else (it is
// vacuously true once the main assertion has established `advance == cellWidth`
// everywhere), so deleting the two ink comparisons left the whole suite green.
// The per-term cases below, plus the ink-only and ratio-only perturbations in
// the per-face test, are what make each comparison independently load-bearing.
function violatesCell({ xMin, xMax, advance }, cellWidth, fitRatio) {
  const room = cellWidth * fitRatio;
  const overflows = xMin < 0 || xMax > cellWidth;
  return (xMax - xMin) > room + ROUNDING_TOLERANCE
    || (overflows && Math.abs(xMin + xMax - cellWidth) > ROUNDING_TOLERANCE)
    || advance !== cellWidth;
}

// `cellWidth` and `fitRatio` are parameters rather than being read inside, and
// `boundsOf` defaults to the font's own reader so a perturbed one can be
// injected — all three exist so a deliberately wrong input can prove the
// detector actually fires.
function findCellFitViolations(font, cellWidth, fitRatio, boundsOf = font.glyphBounds) {
  const violations = [];
  let subjects = 0;
  let maxInk = 0;
  for (const [cp, gid] of font.cmap) {
    if (!isCellFitSubject(cp, widthOf)) { continue; }
    const bounds = boundsOf(gid);
    if (bounds === null) { continue; }
    subjects += 1;
    maxInk = Math.max(maxInk, bounds.xMax - bounds.xMin);
    const advance = font.advanceForGlyph(gid);
    if (violatesCell({ xMin: bounds.xMin, xMax: bounds.xMax, advance }, cellWidth, fitRatio)) {
      violations.push({ cp, advance, xMin: bounds.xMin, xMax: bounds.xMax });
    }
  }
  return { violations, subjects, maxInk };
}

function describeViolations(violations, cellWidth) {
  return violations
    .slice(0, 12)
    .map((v) => `U+${v.cp.toString(16).toUpperCase().padStart(4, '0')} `
      + `adv=${v.advance} ink=[${v.xMin},${v.xMax}] width=${v.xMax - v.xMin} cell=${cellWidth}`)
    .join('; ');
}

// --- fitRatio resolution ----------------------------------------------------
//
// One resolution rule, in one place, matching run.sh's jq (`($p.fitRatio //
// $default)`): a package may override, otherwise the manifest's top-level value
// applies. The RANGE is enforced here too, mirroring `fit.py`'s `MAX_FIT_RATIO`
// — a manifest that declares an out-of-range ratio must fail the suite rather
// than describe bytes nobody could have baked. The reason 1.5 is the ceiling is
// written once, in the manifest's `note`; do not restate it.
const MAX_FIT_RATIO = 1.5;

// Pure, so the drift the geometry cannot see can be shown to fire from crafted
// input rather than only by editing a real file (same discipline as
// `digestMatches`). Strict equality on a NUMBER: a stringified ratio in the
// record is drift, not a formatting choice.
function fitRatioRecordMatches(record, declared) {
  return !!record && typeof record.fitRatio === 'number' && record.fitRatio === declared;
}

// --- vstretch resolution (#293) ---------------------------------------------
//
// Same resolution rule and the same one-place discipline as `fitRatio` above
// (`$p.vstretch // $vdefault` in run.sh's jq). The FLOOR is mirrored from
// `fit.py`'s `MIN_VSTRETCH`; there is deliberately NO ceiling constant, because
// the vertical limit is not a number written anywhere — it is the y reach (the
// ink's top and bottom edges) of U+6F22 measured out of each face, and `fit.py`
// clamps the stretch per glyph so the result stays inside it.
// The meaning is defined once, in the manifest's `note`; do not restate it.
const MIN_VSTRETCH = 1.0;

function vstretchRecordMatches(record, declared) {
  return !!record && typeof record.vstretch === 'number' && record.vstretch === declared;
}

function resolveVstretch(manifest, entry) {
  const raw = entry && entry.vstretch !== undefined ? entry.vstretch : manifest.vstretch;
  assert.equal(
    typeof raw,
    'number',
    `no vstretch for ${entry && entry.package}: neither the package nor the manifest declares one`,
  );
  // Non-finite gets its OWN message (#293 review Low-2). Folding `NaN` /
  // `Infinity` into the floor assertion reported "is below the floor 1" for a
  // value that is not below anything — and the test's own regexp swallowed the
  // mismatch, so nothing could see it. `fit.py`'s `parse_vstretch` separates
  // the two the same way.
  assert.ok(
    Number.isFinite(raw),
    `vstretch ${raw} for ${entry && entry.package} is not a finite number`,
  );
  assert.ok(
    raw >= MIN_VSTRETCH,
    `vstretch ${raw} for ${entry && entry.package} is below the floor ${MIN_VSTRETCH}`,
  );
  return raw;
}

function resolveFitRatio(manifest, entry) {
  const raw = entry && entry.fitRatio !== undefined ? entry.fitRatio : manifest.fitRatio;
  assert.equal(
    typeof raw,
    'number',
    `no fitRatio for ${entry && entry.package}: neither the package nor the manifest declares one`,
  );
  assert.ok(
    Number.isFinite(raw) && raw > 0 && raw <= MAX_FIT_RATIO,
    `fitRatio ${raw} for ${entry && entry.package} is outside 0 < r <= ${MAX_FIT_RATIO}`,
  );
  return raw;
}

// --- (2) sha256 -------------------------------------------------------------

const HEX64 = /^[0-9a-f]{64}$/;

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Pure so the failure path can be exercised in-memory (task #276 item 2 /
// planning review Low): a check whose red path is only ever confirmed by
// temporarily editing a real file leaves no trace in a repo with no CI.
function digestMatches(buffer, recorded) {
  if (typeof recorded !== 'string' || !HEX64.test(recorded)) { return false; }
  return sha256Hex(buffer) === recorded;
}

// --- (3) manifest audit -----------------------------------------------------

// Pure (no fs), so an EMPTY manifest can be handed straight to it and shown to
// fail — "zero subjects" must never be a green result, which is the whole point
// of M1. Existence of the paths is a separate, fs-using test below.
function auditManifest(manifest, provenancePackages) {
  const packages = (manifest && manifest.packages) || [];
  assert.equal(
    packages.length,
    EXPECTED_PACKAGE_COUNT,
    `manifest lists ${packages.length} package(s), expected ${EXPECTED_PACKAGE_COUNT} `
      + '— a forgotten fifth family would empty the geometry and sha256 subject sets silently',
  );

  let faces = 0;
  for (const entry of packages) {
    assert.equal(typeof entry.package, 'string', `manifest entry has no \`package\`: ${JSON.stringify(entry)}`);
    assert.ok(Array.isArray(entry.faces) && entry.faces.length > 0, `${entry.package}: no faces`);
    // The manifest's own rule, all THREE keys it names: `package` / `srcEntry` /
    // `out` forbid absolute paths and `..`. `package` and `out` are joined onto
    // the repo root here; `srcEntry` is joined onto `--src-dir` by run.sh, which
    // is the one that escapes into a directory the caller chose — so it is the
    // last one that should have been left unchecked (review Low-2: the comment
    // used to claim three keys while the loop walked two).
    const relPaths = [entry.package];
    for (const face of entry.faces) {
      relPaths.push(face.out, face.srcEntry);
    }
    for (const rel of relPaths) {
      assert.equal(typeof rel, 'string', `${entry.package}: a face is missing \`out\` or \`srcEntry\``);
      assert.ok(!path.isAbsolute(rel), `${entry.package}: absolute path not allowed: ${rel}`);
      assert.ok(
        !rel.split(/[\\/]/).includes('..'),
        `${entry.package}: '..' not allowed in a manifest path: ${rel}`,
      );
    }
    faces += entry.faces.length;
  }
  assert.equal(
    faces,
    EXPECTED_FACE_COUNT,
    `manifest lists ${faces} face(s), expected ${EXPECTED_FACE_COUNT}`,
  );

  // ⊆ and ≡ in one assertion, deliberately: unlike #236's registry check (where ⊆
  // holds vacuously in every intermediate state while families land one sub-issue
  // at a time), both sides here are written in the SAME commit — the heading is
  // #275's deliverable spec and the manifest entry is what makes a package a
  // conversion output. So there is no intermediate state to keep green, and set
  // equality is the honest statement. The two directions are still named
  // separately in the message, because they fail for different reasons: ⊄ = a
  // listed package whose README never got the provenance chain; ⊅ = a package
  // documenting a conversion chain that the manifest does not drive.
  const listed = [...new Set(packages.map((e) => e.package))].sort();
  const documented = [...new Set(provenancePackages)].sort();
  const missingHeading = listed.filter((p) => !documented.includes(p));
  const missingEntry = documented.filter((p) => !listed.includes(p));
  assert.deepEqual(
    missingHeading,
    [],
    `listed in the manifest but carrying no ${JSON.stringify(PROVENANCE_HEADING)} in README.md: `
      + missingHeading.join(', '),
  );
  assert.deepEqual(
    missingEntry,
    [],
    `carrying the provenance heading but absent from the manifest: ${missingEntry.join(', ')}`,
  );
}

// --- (4) prose binding (#291 review L1) -------------------------------------
//
// The declared ratio and the per-side overhang it implies are QUOTED in prose,
// in documents no other check reads. Changing `manifest.fitRatio` turns (2) red
// (the recorded ratio no longer matches) and forces a re-bake, but every
// sentence quoting the old number stays green and keeps printing it — six of
// those sentences are the Marketplace description and the settings UI. This
// section binds the quotes to the declaration so the drift is loud.
//
// WHAT IS BOUND, AND WHAT IS DELIBERATELY NOT. This is a CURATED SUBSET, not a
// sweep, and reading it as "every place the value appears is now checked" is the
// failure it must not cause:
//
//   * BOUND: the two derived strings below, each in a NAMED list of documents.
//     `RATIO_QUOTING_DOCS` is the curated list of documents this check binds to
//     the ratio — NOT a claim that no other file states it (the NOT BOUND items
//     below are counter-examples, and the last of them is open-ended);
//     `NOMINAL_OVERHANG_DOCS` is the subset of that list which states the
//     per-side overhang as the RATIO'S OWN value ((r - 1) / 2 of a cell) rather
//     than a measured one. Both lists include the two Mgen+ `LICENSE.txt` files
//     (#291 review L4): they quote both numbers, they are what vsce publishes as
//     the Marketplace License tab, and CLAUDE.md's own warning is that a
//     package's `LICENSE.txt` is exactly the file no test sees.
//   * BOUND SEPARATELY: `scripts/font-fit/manifest.json`'s `note`, which names
//     the default in prose ("既定は … 現在 <r>") beside the declaration it
//     describes. Naming it in `RATIO_QUOTING_DOCS` would be tautological — the
//     `"fitRatio": <r>` line is in the same file, so a text search for the token
//     is satisfied by the declaration itself and can never go red. The
//     `manifest note quotes the declared fitRatio` test below reads the number
//     OUT OF THE NOTE instead, which does go red.
//   * NOT BOUND, on purpose:
//     - The M PLUS 1 Code documents' overhang figure. That package's cell is 500
//       units, so 1.15 puts the nominal half-overhang at 37.5 and the shipped
//       integer bbox at 38 — its README, README.ja.md, `package.json` and its
//       `package.nls*.json` entry all state the MEASURED 7.6%, which no formula
//       here produces. They are bound on the ratio only.
//     - Absolute unit figures (`588.8`, `±38`, `A × 1.15` arithmetic, `em 0.574`)
//       and the per-face conversion counts. Those are measurements of specific
//       bytes, and the honest gate for them is re-measuring the shipped files —
//       which is what a re-bake is for, not what a string search can do.
//     - Every file not named in the two lists, including `.ja` translations of
//       CLAUDE.md-style prose that may word the number differently, `survey.py`'s
//       docstring and `verify.py`'s worked example.
//
// The three bullets above are what "curated" means here: the lists are named
// files, the exclusions are named or explicitly open-ended, and no sentence in
// this comment claims the repo has been swept.
//
// So a green here means "the named documents quote today's declared value",
// never "no stale number survives anywhere in the repo".
//
// The value is matched as a NUMBER TOKEN (not a bare substring), so `1.5` — the
// ceiling, which appears in the same sentences — cannot satisfy a search for a
// declared `1.5`… it still would, if the default were ever RAISED to exactly the
// ceiling. That case is called out rather than defended against: at 1.5 this
// check weakens to a presence test, and the re-bake is what carries the burden.
const RATIO_QUOTING_DOCS = [
  'CLAUDE.md',
  'package.nls.json',
  'package.nls.ja.json',
  'font-packages/README.md',
  'font-packages/font-mgenplus-1mn/README.md',
  'font-packages/font-mgenplus-1mn/README.ja.md',
  'font-packages/font-mgenplus-1mn/package.json',
  'font-packages/font-mgenplus-1mn/LICENSE.txt',
  'font-packages/font-rounded-mgenplus-1mn/README.md',
  'font-packages/font-rounded-mgenplus-1mn/README.ja.md',
  'font-packages/font-rounded-mgenplus-1mn/package.json',
  'font-packages/font-rounded-mgenplus-1mn/LICENSE.txt',
  'font-packages/font-mplus1code/README.md',
  'font-packages/font-mplus1code/README.ja.md',
  'font-packages/font-mplus1code/package.json',
  'font-packages/font-shirokumagen/README.md',
  'font-packages/font-shirokumagen/README.ja.md',
  'font-packages/font-shirokumagen/package.json',
  'font-packages/font-shirokumagen/LICENSE.txt',
];

// The documents that state the VERTICAL half (#293). Same curation discipline as
// `RATIO_QUOTING_DOCS`, and deliberately a SECOND list rather than a reuse: a
// document may legitimately describe the horizontal refit without describing the
// stretch (the M PLUS package's `LICENSE.txt` is not in either list today), and
// folding them together would make one omission look like the other.
//
// NOT BOUND, on purpose, and for a reason specific to this value: the per-face
// counts of "how many selected glyphs actually grew taller" (857 of 1001 in
// Mgen+ Regular, and so on). Those are measurements of specific bytes, and the
// honest gate for them is a re-bake — the same exclusion the absolute unit
// figures already carry above.
const STRETCH_QUOTING_DOCS = [
  'CLAUDE.md',
  'package.nls.json',
  'package.nls.ja.json',
  'font-packages/README.md',
  'font-packages/font-mgenplus-1mn/README.md',
  'font-packages/font-mgenplus-1mn/README.ja.md',
  'font-packages/font-mgenplus-1mn/package.json',
  'font-packages/font-mgenplus-1mn/LICENSE.txt',
  'font-packages/font-rounded-mgenplus-1mn/README.md',
  'font-packages/font-rounded-mgenplus-1mn/README.ja.md',
  'font-packages/font-rounded-mgenplus-1mn/package.json',
  'font-packages/font-rounded-mgenplus-1mn/LICENSE.txt',
  'font-packages/font-mplus1code/README.md',
  'font-packages/font-mplus1code/README.ja.md',
  'font-packages/font-mplus1code/package.json',
  'font-packages/font-shirokumagen/README.md',
  'font-packages/font-shirokumagen/README.ja.md',
  'font-packages/font-shirokumagen/package.json',
  'font-packages/font-shirokumagen/LICENSE.txt',
];

// The `LICENSE.txt` files above are in BOTH lists and `font-shirokumagen`'s is a
// third such file (#289): like the two Mgen+ ones it quotes both numbers, and it
// is what vsce publishes as that extension's Marketplace License tab — the file
// CLAUDE.md warns no test sees. It is deliberately absent from
// `NOMINAL_OVERHANG_DOCS` below, for the same reason every `font-mplus1code`
// entry is: it states the per-side overhang as a MEASURED 7.6%, not as the
// ratio's own 7.5%, so binding it to the nominal value would fail a true
// sentence.
const NOMINAL_OVERHANG_DOCS = [
  'CLAUDE.md',
  'package.nls.json',
  'package.nls.ja.json',
  'font-packages/README.md',
  'font-packages/font-mgenplus-1mn/README.md',
  'font-packages/font-mgenplus-1mn/README.ja.md',
  'font-packages/font-mgenplus-1mn/package.json',
  'font-packages/font-mgenplus-1mn/LICENSE.txt',
  'font-packages/font-rounded-mgenplus-1mn/README.md',
  'font-packages/font-rounded-mgenplus-1mn/README.ja.md',
  'font-packages/font-rounded-mgenplus-1mn/package.json',
  'font-packages/font-rounded-mgenplus-1mn/LICENSE.txt',
];

// `1.15` -> "1.15". JSON numbers round-trip through String() exactly, and the
// manifest is the only producer.
function formatRatio(ratio) {
  return String(ratio);
}

// The overhang the ratio itself implies, per side, as a percentage of one cell:
// ink is scaled to `A × r` and centred, so each side spills `(r - 1) / 2`.
// Rounded to two decimals before stringifying, because `(1.15 - 1) / 2 * 100` is
// 7.499999999999996 in binary floating point and the prose says "7.5%".
function nominalOverhangPercent(ratio) {
  return String(Number((((ratio - 1) / 2) * 100).toFixed(2)));
}

function escapeForRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A number token: not preceded by a digit or a dot, not followed by a digit. So
// a search for `1.5` does not match inside `1.15`, and one for `7.5%` does not
// match inside `17.5%`.
function quotesNumber(text, value) {
  return new RegExp(`(?<![\\d.])${escapeForRegExp(value)}(?![\\d])`).test(text);
}

// Whole-line match, and only against README.md (see PROVENANCE_HEADING).
function hasProvenanceHeading(readmePath) {
  if (!fs.existsSync(readmePath)) { return false; }
  return fs
    .readFileSync(readmePath, 'utf8')
    .split('\n')
    .some((line) => line.replace(/\r$/, '') === PROVENANCE_HEADING);
}

function discoverProvenancePackages() {
  const found = [];
  for (const dir of fs.readdirSync(FONT_PACKAGES_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) { continue; }
    if (hasProvenanceHeading(path.join(FONT_PACKAGES_DIR, dir.name, 'README.md'))) {
      found.push(`font-packages/${dir.name}`);
    }
  }
  return found.sort();
}

// --- inputs -----------------------------------------------------------------

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const checksums = JSON.parse(fs.readFileSync(CHECKSUMS_PATH, 'utf8'));
const provenancePackages = discoverProvenancePackages();

// [{ rel, abs, family, style, weight, fitRatio, vstretch }] over every face the
// manifest lists. Both values are resolved ONCE here, so the geometry check and
// the record comparisons below cannot drift into using different values.
const manifestFaces = manifest.packages.flatMap((entry) =>
  entry.faces.map((face) => ({
    rel: `${entry.package}/${face.out}`,
    abs: path.join(REPO_ROOT, entry.package, face.out),
    family: entry.family,
    style: face.style,
    weight: face.weight,
    fitRatio: resolveFitRatio(manifest, entry),
    vstretch: resolveVstretch(manifest, entry),
  })),
);

// ============================================================================
// (3) manifest audit — first, because everything below is subject-selected by it
// ============================================================================

// @testdoc The conversion manifest lists exactly the packages whose README documents a conversion chain.
test('manifest audit: 4 packages / 8 faces, listed set ≡ provenance-heading set', () => {
  auditManifest(manifest, provenancePackages);
  // Named explicitly so a regression report says WHICH package fell out.
  assert.deepEqual(provenancePackages, [
    'font-packages/font-mgenplus-1mn',
    'font-packages/font-mplus1code',
    'font-packages/font-rounded-mgenplus-1mn',
    'font-packages/font-shirokumagen',
  ]);
  // The non-converted package must stay on the other side of the split. Its
  // README does carry a `## Provenance` heading — a DIFFERENT one — so this is
  // the case the whole-line match exists for.
  assert.ok(
    !provenancePackages.includes('font-packages/font-plemoljp-console'),
    'font-plemoljp-console ships upstream bytes unmodified and must not be classified as a conversion output',
  );
});

// @testdoc The manifest audit itself fails on an empty or misspelled manifest (no vacuous green).
test('manifest audit: an empty or drifted manifest FAILS the audit', () => {
  // Zero subjects is the failure mode M1 exists to forbid: an empty manifest
  // would make (1) and (2) check nothing at all and report green.
  assert.throws(
    () => auditManifest({ packages: [] }, provenancePackages),
    /manifest lists 0 package\(s\)/,
  );
  assert.throws(() => auditManifest({}, provenancePackages), /manifest lists 0 package\(s\)/);

  // A misspelled `package` keeps the count right and breaks ≡ in both directions.
  const misspelled = {
    packages: manifest.packages.map((e, i) =>
      (i === 0 ? { ...e, package: `${e.package}-typo` } : e)),
  };
  assert.throws(() => auditManifest(misspelled, provenancePackages), /provenance heading|no .*in README\.md/);

  // A fifth family added to the packages but nowhere else.
  const extra = { packages: [...manifest.packages, { package: 'font-packages/font-future', faces: [] }] };
  assert.throws(() => auditManifest(extra, provenancePackages), /manifest lists 5 package\(s\)/);

  // A face count that drifts from the packages.
  const shortened = {
    packages: manifest.packages.map((e, i) =>
      (i === 0 ? { ...e, faces: e.faces.slice(0, 1) } : e)),
  };
  assert.throws(() => auditManifest(shortened, provenancePackages), /manifest lists 7 face\(s\)/);
});

// @testdoc Every path the manifest names actually exists on disk.
test('manifest audit: every `package` directory and `out` file exists', () => {
  for (const entry of manifest.packages) {
    const dir = path.join(REPO_ROOT, entry.package);
    assert.ok(
      fs.existsSync(dir) && fs.statSync(dir).isDirectory(),
      `manifest names ${entry.package}, which is not a directory`,
    );
  }
  assert.equal(manifestFaces.length, EXPECTED_FACE_COUNT);
  // Distinctness, not just count (review Low-4). Everything downstream states
  // "8 faces, each matched against its record" and infers ≡ from the counts —
  // an inference that only holds while the 8 keys are distinct. A manifest
  // listing the same `package/out` twice would leave one recorded checksum
  // never compared, and still be green.
  assert.equal(
    new Set(manifestFaces.map((f) => f.rel)).size,
    EXPECTED_FACE_COUNT,
    'the manifest names the same package/out more than once',
  );
  for (const face of manifestFaces) {
    assert.ok(
      fs.existsSync(face.abs) && fs.statSync(face.abs).isFile(),
      `manifest names ${face.rel}, which does not exist`,
    );
  }
});

// @testdoc The manifest and each package's providedFont contract declare the same faces.
test('manifest audit: manifest faces ≡ the package `providedFont` contract', () => {
  // Closes the escape route review Low-3 found: a face added to a package's
  // `providedFont` contract but NOT to the manifest ships to users while slipping
  // past BOTH gates in this file — it is not in the geometry subject set and not
  // in the sha256 comparison set. Nothing else in the suite reads
  // `scripts/font-fit/manifest.json`, and `test/font-registry.test.js` only ever
  // relates `FONT_REGISTRY` to `providedFont`, so today only that file's
  // hard-coded `EXPECTED_CONTRACT_FACES` incidentally holds the count down. This
  // closes it at the manifest, which is the deeper of the two positions.
  //
  // It is also what makes the manifest's `family` / `weight` fields load-bearing.
  // `run.sh` never reads `faces[].weight`; the manifest's own note says it exists
  // "for #276 to cross-check against the providedFont face declaration" — which
  // was not true until this test.
  for (const entry of manifest.packages) {
    const pkgJson = path.join(REPO_ROOT, entry.package, 'package.json');
    const contract = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).providedFont;
    assert.ok(contract, `${entry.package}: declares no providedFont contract`);
    assert.equal(
      contract.family,
      entry.family,
      `${entry.package}: providedFont.family ${JSON.stringify(contract.family)} `
        + `!= manifest family ${JSON.stringify(entry.family)}`,
    );
    // Compared as SETS of `file@weight`, so a reordering is not a failure but a
    // missing, extra or re-weighted face is. `faces` may be declared in either of
    // the two shapes the contract allows, so the single-face shorthand is folded
    // into the array form first (same normalization the runtime does).
    const declared = (contract.faces ?? [{ file: contract.file, weight: contract.weight }])
      .map((f) => `${f.file}@${f.weight}`)
      .sort();
    const listed = entry.faces.map((f) => `${f.out}@${f.weight}`).sort();
    assert.deepEqual(
      declared,
      listed,
      `${entry.package}: providedFont declares faces the manifest does not drive `
        + '(or vice versa) — such a face ships to users while escaping both the '
        + 'geometry contract and the sha256 binding',
    );
  }
});

// ============================================================================
// (2) sha256 binding (R13)
// ============================================================================

// @testdoc Every shipped TTF hashes to the value checksums.json records for it.
test('sha256 binding: checksums.json ≡ the shipped TTFs (R13)', () => {
  const recorded = checksums.outputs;
  assert.equal(
    Object.keys(recorded).length,
    EXPECTED_FACE_COUNT,
    'checksums.json records a different number of outputs than the manifest lists',
  );
  for (const face of manifestFaces) {
    const record = Object.prototype.hasOwnProperty.call(recorded, face.rel)
      ? recorded[face.rel]
      : undefined;
    assert.ok(record, `checksums.json records nothing for ${face.rel}`);
    const expected = record.sha256;
    assert.match(expected, HEX64, `checksums.json's value for ${face.rel} is not lowercase hex sha256`);
    const buffer = fs.readFileSync(face.abs);
    assert.ok(
      digestMatches(buffer, expected),
      `${face.rel}: sha256 is ${sha256Hex(buffer)}, but checksums.json records ${expected}. `
        + 'A legitimate re-conversion moves the TTF and checksums.json in the SAME commit; '
        + 'exactly one of them having moved is the accident this check exists for.',
    );
  }
});

// @testdoc The sha256 comparison fires on a one-byte / one-digit change (the red path, in memory).
test('sha256 binding: the comparison detects a 1-byte or 1-digit change', () => {
  const face = manifestFaces[0];
  const buffer = fs.readFileSync(face.abs);
  const expected = checksums.outputs[face.rel].sha256;
  assert.ok(digestMatches(buffer, expected), 'precondition: the unmodified file matches');

  // (a) one byte of the TTF changed — the "someone replaced the file" accident.
  //     Mutated on a COPY in memory; the file on disk is never written.
  const mutatedBytes = Buffer.from(buffer);
  const at = Math.floor(mutatedBytes.length / 2);
  mutatedBytes.writeUInt8(mutatedBytes.readUInt8(at) ^ 0xff, at);
  assert.notEqual(sha256Hex(mutatedBytes), sha256Hex(buffer));
  assert.equal(digestMatches(mutatedBytes, expected), false);

  // (b) one hex digit of the recorded value changed — the "checksums.json was
  //     hand-edited" accident.
  const flip = expected[0] === '0' ? '1' : '0';
  const mutatedDigest = flip + expected.slice(1);
  assert.notEqual(mutatedDigest, expected);
  assert.equal(digestMatches(buffer, mutatedDigest), false);

  // (c) shape guards: a truncated or non-hex record must not compare equal by
  //     accident (an empty string against an empty file would otherwise be the
  //     kind of vacuous pass this whole file is written against).
  assert.equal(digestMatches(buffer, expected.slice(0, 63)), false);
  assert.equal(digestMatches(buffer, expected.toUpperCase()), false);
  assert.equal(digestMatches(buffer, ''), false);
  assert.equal(digestMatches(buffer, undefined), false);
});

// @testdoc checksums.json records the fitRatio each TTF was baked at, and it equals the manifest's.
test('fitRatio record: checksums.json ≡ the manifest declaration (#291)', () => {
  // Recorded because a sha256 cannot say WHICH ratio produced the bytes: it can
  // only say they moved. Compared against the manifest because that is what the
  // next `run.sh` will bake at, and what the geometry check below judges against
  // — a face whose bytes were baked at one ratio while the repo declares another
  // is exactly the state `--fit-ratio`'s `--out-dir` requirement exists to keep
  // out of the repository, and this is where that state is CAUGHT rather than
  // prevented.
  for (const face of manifestFaces) {
    const record = checksums.outputs[face.rel];
    assert.ok(record, `checksums.json records nothing for ${face.rel}`);
    assert.ok(
      fitRatioRecordMatches(record, face.fitRatio),
      `${face.rel}: baked at fitRatio ${record.fitRatio} per checksums.json, but the manifest `
        + `now declares ${face.fitRatio}. Re-run scripts/font-fit/run.sh — changing the declared `
        + 'ratio without re-baking leaves the shipped ink at the old size while every document '
        + 'derived from the manifest describes the new one.',
    );
  }
});

// @testdoc checksums.json records the vstretch each TTF was baked at, and it equals the manifest's.
test('vstretch record: checksums.json ≡ the manifest declaration (#293)', () => {
  // This is where a shifted `vstretch` declaration goes red, and — unlike
  // `fitRatio`, whose downward direction the geometry also catches — it is the
  // ONLY place, in EITHER direction: see (1v) at the top of this file for why
  // the shipped bytes cannot testify to the stretch they were baked with.
  for (const face of manifestFaces) {
    const record = checksums.outputs[face.rel];
    assert.ok(record, `checksums.json records nothing for ${face.rel}`);
    assert.ok(
      vstretchRecordMatches(record, face.vstretch),
      `${face.rel}: baked at vstretch ${record.vstretch} per checksums.json, but the manifest `
        + `now declares ${face.vstretch}. Re-run scripts/font-fit/run.sh — changing the declared `
        + 'stretch without re-baking leaves the shipped ink at the old height while every '
        + 'document derived from the manifest describes the new one.',
    );
  }
});

// @testdoc The vstretch comparison and resolution reject a drifted or out-of-range declaration.
test('vstretch record: resolution, floor and the drift comparison all have red paths', () => {
  const entry = manifest.packages[0];

  assert.equal(resolveVstretch({ vstretch: 1.3 }, { package: 'p' }), 1.3);
  assert.equal(resolveVstretch({ vstretch: 1.3 }, { package: 'p', vstretch: 1.1 }), 1.1);
  // The identity value is legal: `vstretch = 1.0` is #291's equal scaling, and
  // it was measured to reproduce the #291 bytes exactly.
  assert.equal(resolveVstretch({ vstretch: 1.0 }, { package: 'p' }), 1.0);

  // Floor, mirroring fit.py's refusal. A value below 1 would shrink the ink
  // vertically — the opposite of what this parameter exists for. The expected
  // message is pinned PER CASE (#293 review Low-2): one loose alternation over
  // every reason let `NaN` be rejected as "below the floor 1", a reason that is
  // not true of it, with nothing able to notice.
  for (const [bad, why] of [
    [0, /is below the floor 1/],
    [-1, /is below the floor 1/],
    [0.9, /is below the floor 1/],
    [Number.NaN, /is not a finite number/],
    [Number.POSITIVE_INFINITY, /is not a finite number/],
  ]) {
    assert.throws(
      () => resolveVstretch({ vstretch: bad }, { package: 'p' }),
      why,
      `vstretch ${bad} must be rejected for the right reason`,
    );
  }
  assert.throws(() => resolveVstretch({}, { package: 'p' }), /no vstretch/);
  assert.throws(() => resolveVstretch({ vstretch: '1.3' }, { package: 'p' }), /no vstretch/);

  const declared = resolveVstretch(manifest, entry);
  const record = checksums.outputs[`${entry.package}/${entry.faces[0].out}`];
  assert.equal(vstretchRecordMatches(record, declared), true, 'precondition: the repo is consistent');
  assert.equal(vstretchRecordMatches({ ...record, vstretch: declared - 0.1 }, declared), false);
  assert.equal(vstretchRecordMatches({ ...record, vstretch: declared + 0.1 }, declared), false);
  assert.equal(vstretchRecordMatches({ sha256: record.sha256 }, declared), false);
  assert.equal(vstretchRecordMatches(undefined, declared), false);
  assert.equal(vstretchRecordMatches({ vstretch: String(declared) }, declared), false);
});

// @testdoc The fitRatio comparison and resolution reject a drifted or out-of-range declaration.
test('fitRatio record: resolution, range and the drift comparison all have red paths', () => {
  const entry = manifest.packages[0];

  // Resolution: package override beats the top-level default, which is the only
  // rule run.sh's jq implements (`$p.fitRatio // $default`).
  assert.equal(resolveFitRatio({ fitRatio: 1.15 }, { package: 'p' }), 1.15);
  assert.equal(resolveFitRatio({ fitRatio: 1.15 }, { package: 'p', fitRatio: 1.3 }), 1.3);

  // Range, mirroring fit.py's refusal. These are the values fit.py rejects
  // before writing a byte; a manifest carrying one must not describe shipped
  // bytes as though it had been honoured.
  for (const bad of [0, -1, 1.51, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => resolveFitRatio({ fitRatio: bad }, { package: 'p' }),
      /outside 0 < r <=|is not|must be/,
      `fitRatio ${bad} must be rejected`,
    );
  }
  assert.throws(() => resolveFitRatio({}, { package: 'p' }), /no fitRatio/);
  assert.throws(() => resolveFitRatio({ fitRatio: '1.15' }, { package: 'p' }), /no fitRatio/);

  // Drift: the recorded value moved away from the declaration, in EITHER
  // direction. The upward direction is the one the geometry cannot see at all.
  const declared = resolveFitRatio(manifest, entry);
  const record = checksums.outputs[`${entry.package}/${entry.faces[0].out}`];
  assert.equal(fitRatioRecordMatches(record, declared), true, 'precondition: the repo is consistent');
  assert.equal(fitRatioRecordMatches({ ...record, fitRatio: declared - 0.01 }, declared), false);
  assert.equal(fitRatioRecordMatches({ ...record, fitRatio: declared + 0.01 }, declared), false);
  assert.equal(fitRatioRecordMatches({ sha256: record.sha256 }, declared), false);
  assert.equal(fitRatioRecordMatches(undefined, declared), false);
  // A string that would `==` the number must not pass: the record is read by
  // machines that compare it to a JSON number.
  assert.equal(fitRatioRecordMatches({ fitRatio: String(declared) }, declared), false);
});

// ============================================================================
// (4) prose binding (#291 review L1)
// ============================================================================

// Which ratio a document quotes: a document inside a manifest package quotes
// THAT package's resolved ratio; everything else (CLAUDE.md, the two
// package.nls files, font-packages/README.md) speaks for all of them at once and
// therefore only has a single number to quote while no package overrides.
function ratioForDoc(rel) {
  for (const entry of manifest.packages) {
    if (rel.startsWith(`${entry.package}/`)) { return resolveFitRatio(manifest, entry); }
  }
  const distinct = [...new Set(manifestFaces.map((f) => f.fitRatio))];
  assert.equal(
    distinct.length,
    1,
    `${rel} states one ratio for every bundled font, but the manifest now declares `
      + `${distinct.length} different ones (${distinct.join(', ')}). Split the sentence per `
      + 'package before this check can mean anything — it is not a formatting failure.',
  );
  return distinct[0];
}

// The same rule as `ratioForDoc`, for the vertical value.
function stretchForDoc(rel) {
  for (const entry of manifest.packages) {
    if (rel.startsWith(`${entry.package}/`)) { return resolveVstretch(manifest, entry); }
  }
  const distinct = [...new Set(manifestFaces.map((f) => f.vstretch))];
  assert.equal(
    distinct.length,
    1,
    `${rel} states one vstretch for every bundled font, but the manifest now declares `
      + `${distinct.length} different ones (${distinct.join(', ')}). Split the sentence per `
      + 'package before this check can mean anything — it is not a formatting failure.',
  );
  return distinct[0];
}

// @testdoc Prose in the named documents quotes the fitRatio the manifest declares.
test('prose binding: the named documents quote the declared fitRatio (#291 L1)', () => {
  for (const rel of RATIO_QUOTING_DOCS) {
    const abs = path.join(REPO_ROOT, rel);
    assert.ok(fs.existsSync(abs), `${rel} is named by this check but does not exist`);
    const text = fs.readFileSync(abs, 'utf8');
    const value = formatRatio(ratioForDoc(rel));
    assert.ok(
      quotesNumber(text, value),
      `${rel} does not quote the declared fitRatio ${value}. The manifest is the single `
        + 'definition; every sentence naming the value is a quotation and has to move with it. '
        + '(This list is a curated subset — see the comment above RATIO_QUOTING_DOCS for what '
        + 'is deliberately NOT bound.)',
    );
  }
});

// @testdoc Prose stating the per-side overhang quotes the value the ratio implies.
test('prose binding: the named documents quote the nominal per-side overhang (#291 L1)', () => {
  for (const rel of NOMINAL_OVERHANG_DOCS) {
    const ratio = ratioForDoc(rel);
    // Below 1 the refit CONTAINS the ink and there is no overhang to state, so
    // these sentences do not merely carry a stale number — they describe a
    // guarantee the bytes no longer give. Loud, and not auto-derivable.
    assert.ok(
      ratio > 1,
      `${rel} states a per-side overhang, but the declared fitRatio ${ratio} is <= 1 — `
        + 'the prose describes a bound the conversion no longer produces and must be rewritten.',
    );
    const abs = path.join(REPO_ROOT, rel);
    assert.ok(fs.existsSync(abs), `${rel} is named by this check but does not exist`);
    const text = fs.readFileSync(abs, 'utf8');
    const pct = `${nominalOverhangPercent(ratio)}%`;
    assert.ok(
      quotesNumber(text, pct),
      `${rel} does not quote ${pct}, the per-side overhang fitRatio ${ratio} implies `
        + '((r - 1) / 2 of a cell). Documents stating a MEASURED overhang instead '
        + '(the M PLUS 1 Code ones, 7.6% on a 500-unit cell) are not in this list.',
    );
  }
});

// @testdoc Prose in the named documents quotes the vstretch the manifest declares.
test('prose binding: the named documents quote the declared vstretch (#293)', () => {
  for (const rel of STRETCH_QUOTING_DOCS) {
    const abs = path.join(REPO_ROOT, rel);
    assert.ok(fs.existsSync(abs), `${rel} is named by this check but does not exist`);
    const text = fs.readFileSync(abs, 'utf8');
    const value = formatRatio(stretchForDoc(rel));
    assert.ok(
      quotesNumber(text, value),
      `${rel} does not quote the declared vstretch ${value}. The manifest is the single `
        + 'definition; every sentence naming the value is a quotation and has to move with it. '
        + '(Curated subset — same discipline as RATIO_QUOTING_DOCS.)',
    );
  }
});

// The manifest's `note` names each default in prose, in the same file as the
// declaration — so a text search for the token there is satisfied by the
// declaration and proves nothing. Read the number out of the NOTE instead: the
// sentence is "既定は下のトップレベル <key>（現在 <r>）", and the KEY is part of the
// pattern because the note now names two of them and an unkeyed extractor would
// hand `fitRatio`'s check whichever one came first.
function valuesNamedInNote(note, key) {
  const text = Array.isArray(note) ? note.join('\n') : String(note);
  // Deliberately flat (one quantified class, no nested quantifier): the token is
  // re-formatted through `formatRatio` at the comparison, so this only has to
  // find it.
  return [...text.matchAll(new RegExp(`トップレベル ${key}（現在\\s?([0-9][0-9.]*)`, 'g'))]
    .map((m) => m[1]);
}

// @testdoc The manifest note's own "現在 <r>" self-quotes state the declared fitRatio and vstretch.
test('prose binding: the manifest note quotes the declared values (#291 L4 / #293)', () => {
  for (const [key, declared] of [['fitRatio', manifest.fitRatio], ['vstretch', manifest.vstretch]]) {
    const named = valuesNamedInNote(manifest.note, key);
    assert.equal(
      named.length,
      1,
      `the manifest note should name the current ${key} default exactly once `
        + `("既定は下のトップレベル ${key}（現在 <r>）"); found ${named.length} `
        + `(${named.join(', ')}). Reword the note or update this check — a note that names it `
        + 'zero times makes this binding vacuous.',
    );
    assert.equal(
      named[0],
      formatRatio(declared),
      `scripts/font-fit/manifest.json's note says the ${key} default is currently ${named[0]}, `
        + `but the same file declares ${formatRatio(declared)}. The note is the definition of `
        + 'the value\'s meaning; its self-quote has to move with the declaration.',
    );
  }

  // Red path for the extractor itself, so the checks above cannot be constants.
  assert.deepEqual(valuesNamedInNote(['既定は下のトップレベル fitRatio（現在 1.3）'], 'fitRatio'), ['1.3']);
  assert.deepEqual(valuesNamedInNote(['既定は下のトップレベル fitRatio（現在 1.3）'], 'vstretch'), []);
  assert.deepEqual(valuesNamedInNote(['上限 1.5 は …'], 'fitRatio'), []);
});

// @testdoc The derived strings and the token match are computed, not hard-coded.
test('prose binding: derivation and token matching have red paths', () => {
  // Derivation, on values other than today's — so the two helpers cannot be a
  // pair of constants that happen to read 1.15 / 7.5.
  assert.equal(formatRatio(1.15), '1.15');
  assert.equal(formatRatio(1.3), '1.3');
  assert.equal(nominalOverhangPercent(1.15), '7.5');
  assert.equal(nominalOverhangPercent(1.3), '15');
  assert.equal(nominalOverhangPercent(1.2), '10');
  assert.equal(nominalOverhangPercent(1.0), '0');

  // Token matching: a stale document is not rescued by a longer number that
  // happens to contain the new one, and the ceiling is not mistaken for the
  // default.
  assert.equal(quotesNumber('ink wider than 1.15 cells', '1.15'), true);
  assert.equal(quotesNumber('ink wider than 1.15 cells', '1.3'), false);
  assert.equal(quotesNumber('the 1.5 ceiling and 1.15 default', '1.15'), true);
  assert.equal(quotesNumber('ink wider than 1.15 cells', '1.5'), false);
  assert.equal(quotesNumber('about 17.5% of a cell', '7.5%'), false);
  assert.equal(quotesNumber('about 7.5% of a cell', '7.5%'), true);
  assert.equal(quotesNumber('about 7.55% of a cell', '7.5%'), false);
  assert.equal(quotesNumber('セル幅の 1.15 倍', '1.15'), true);

  // And the binding itself is not vacuous: today's documents fail against a
  // ratio they do not carry.
  const sample = fs.readFileSync(path.join(REPO_ROOT, 'font-packages', 'README.md'), 'utf8');
  const declared = formatRatio(manifest.fitRatio);
  assert.equal(quotesNumber(sample, declared), true, 'precondition: the repo is consistent');
  assert.equal(quotesNumber(sample, formatRatio(manifest.fitRatio + 0.13)), false);
});

// ============================================================================
// (1) geometry (R9) — one subtest per face, named by its repo-relative path
// ============================================================================

for (const face of manifestFaces) {
  // @testdoc Every width-1 codepoint of a conversion-output face satisfies the declared fitRatio band.
  test(`cell-fit geometry: ${face.rel}`, () => {
    const font = readFont(face.abs);
    // The cell width is the advance of 'A', exactly as fit.py and verify.py take
    // it (`A = hmtx[cmap[0x41]][0]`). Reading it from the face rather than
    // assuming unitsPerEm/2 keeps this scale-free.
    const gidA = font.cmap.get(0x41);
    assert.ok(gidA, `${face.rel}: U+0041 is absent from the cmap`);
    const cellWidth = font.advanceForGlyph(gidA);
    assert.ok(cellWidth > 0, `${face.rel}: the cell width A must be positive`);

    const { violations, subjects, maxInk } = findCellFitViolations(font, cellWidth, face.fitRatio);

    // Non-vacuity: a face whose subject set were empty would report zero
    // violations while proving nothing.
    assert.ok(
      subjects > 100,
      `${face.rel}: only ${subjects} width-1 subject glyph(s) — the check would be near-vacuous`,
    );
    assert.equal(
      violations.length,
      0,
      `${face.rel}: ${violations.length} codepoint(s) outside the declared band `
        + `(unitsPerEm ${font.unitsPerEm}, A ${cellWidth}, fitRatio ${face.fitRatio}): `
        + describeViolations(violations, cellWidth),
    );

    // The detector, proven to fire on THIS face's real data without touching any
    // file. A green zero above only means something if a wrong input turns it red
    // — and the three comparisons have to be shown to fire SEPARATELY, because
    // one of them can carry the self-proof for all three and hide the loss of the
    // other two (which is precisely what happened: see `violatesCell`).
    //
    // (0) the DECLARED RATIO is load-bearing: shrink the declaration until the
    //     widest ink no longer fits and the ink-width term must fire. This is
    //     the "shift the declared fitRatio and it goes red" proof, run on this
    //     face's real data — and it is one-sided by construction (a LARGER
    //     declaration only loosens the band, which is why checksums.json records
    //     the baked ratio and the test above compares it).
    const tighter = (maxInk - ROUNDING_TOLERANCE - 1) / cellWidth;
    assert.ok(tighter > 0, `${face.rel}: maxInk ${maxInk} is too small to tighten against`);
    const tightened = findCellFitViolations(font, cellWidth, tighter);
    assert.ok(
      tightened.violations.length > 0,
      `${face.rel}: the ink-width comparison does not fire when the declared fitRatio is `
        + `tightened from ${face.fitRatio} to ${tighter} (widest ink ${maxInk}, A ${cellWidth})`,
    );

    // (i) advance term: narrow the box by one unit. Every subject must fire.
    const narrowed = findCellFitViolations(font, cellWidth - 1, face.fitRatio);
    assert.equal(
      narrowed.violations.length,
      narrowed.subjects,
      `${face.rel}: the advance comparison does not fire on a narrowed box `
        + `(${narrowed.violations.length}/${narrowed.subjects})`,
    );

    // (ii) the SYMMETRY term, with the box, the advances and the ink WIDTHS all
    //      left correct so nothing but `|xMin + xMax - cellWidth|` can be
    //      responsible. Shifting the ink by a whole cell plus one unit moves it
    //      out of the cell (so the term applies) without changing its width (so
    //      the ink-width term stays satisfied). The `+ 1` matters: a degenerate
    //      glyph whose ink sits exactly at `[cellWidth, cellWidth]` would survive
    //      a shift of exactly one cell and make this vacuous.
    const shift = (dx) => (gid) => {
      const b = font.glyphBounds(gid);
      return b === null ? null : { xMin: b.xMin + dx, xMax: b.xMax + dx };
    };
    const shiftedRight = findCellFitViolations(font, cellWidth, face.fitRatio, shift(cellWidth + 1));
    assert.equal(
      shiftedRight.violations.length,
      shiftedRight.subjects,
      `${face.rel}: the symmetry comparison does not fire on ink shifted a cell to the right `
        + `(${shiftedRight.violations.length}/${shiftedRight.subjects})`,
    );
    const shiftedLeft = findCellFitViolations(font, cellWidth, face.fitRatio, shift(-(cellWidth + 1)));
    assert.equal(
      shiftedLeft.violations.length,
      shiftedLeft.subjects,
      `${face.rel}: the symmetry comparison does not fire on ink shifted a cell to the left `
        + `(${shiftedLeft.violations.length}/${shiftedLeft.subjects})`,
    );
  });
}

// @testdoc Every conversion-output face carries the U+6F22 the vertical clamp is measured from.
test('vertical reference: U+6F22 is present in every face and its ink height is positive', () => {
  // The ONE vertical fact the shipped bytes can testify to on their own. `fit.py`
  // refuses to write a byte for a font without this codepoint — the limit is
  // measured, never guessed — so a face here that lacked it could not have come
  // out of this pipeline at all. Its ink height is NOT compared to anything: see
  // (1v) at the top for why a per-glyph ceiling is not checkable from one file.
  for (const face of manifestFaces) {
    const font = readFont(face.abs);
    const gid = font.cmap.get(0x6f22);
    assert.ok(gid, `${face.rel}: U+6F22 (漢) is absent — the vertical clamp has no reference`);
    const bounds = font.glyphBounds(gid);
    assert.ok(bounds !== null, `${face.rel}: U+6F22 has no outline`);
    assert.ok(
      bounds.yMax - bounds.yMin > 0,
      `${face.rel}: U+6F22 ink height is ${bounds.yMax - bounds.yMin}, which cannot bound anything`,
    );
  }
});

// @testdoc Each of the three cell-fit comparisons fires on its own (crafted input).
test('cell-fit judgement: ink width, symmetry and advance are each independently load-bearing', () => {
  // The Medium-1 gap, closed in the same style as `digestMatches`: crafted input
  // straight into the pure judgement, one case per term. Deleting ANY single
  // comparison from `violatesCell` now fails here — the ink terms included, which
  // is the substance of R9 and the part the narrowed-box self-proof could not see.
  const A = 512;
  const R = 1.15;          // room = 588.8; the legal overhang is ±38.4 per side
  const OLD = 0.96;        // the pre-#291 shipped ratio, as a fitRatio

  // (a) fits: ink inside the cell with the advance exactly A. A glyph that never
  //     leaves the cell need not be centred — an ordinary comma is not.
  assert.equal(violatesCell({ xMin: 0, xMax: A, advance: A }, A, R), false);
  assert.equal(violatesCell({ xMin: 40, xMax: A - 100, advance: A }, A, R), false);
  // Zero-width ink (a glyph drawn as a hairline at the origin) still fits.
  assert.equal(violatesCell({ xMin: 0, xMax: 0, advance: A }, A, R), false);
  // Overhanging but centred and inside the room: the #291 shape. ±38 per side.
  assert.equal(violatesCell({ xMin: -38, xMax: A + 38, advance: A }, A, R), false);

  // (b) ink width alone — centred, advance correct, but wider than the room.
  //     This is the term that ties the judgement to the DECLARED ratio.
  assert.equal(violatesCell({ xMin: -60, xMax: A + 60, advance: A }, A, R), true);
  // ... and the same ink is legal under a wider declaration, illegal under a
  //     narrower one. Both directions, on one datum: this is why the ratio is a
  //     parameter and not a constant.
  assert.equal(violatesCell({ xMin: -38, xMax: A + 38, advance: A }, A, 1.3), false);
  assert.equal(violatesCell({ xMin: -38, xMax: A + 38, advance: A }, A, OLD), true);
  // The pre-#291 output (ink 492, centred) still satisfies the OLD declaration —
  // so the red path above is not an artefact of a judgement that fails on
  // everything.
  assert.equal(violatesCell({ xMin: 10, xMax: 502, advance: A }, A, OLD), false);

  // (c) symmetry alone — the ink WIDTH fits the room, the advance is correct, but
  //     the whole overhang is on one side (all 76 units to the right).
  assert.equal(violatesCell({ xMin: 0, xMax: A + 76, advance: A }, A, R), true);
  assert.equal(violatesCell({ xMin: -76, xMax: A, advance: A }, A, R), true);
  // Rounding is tolerated, one unit either way.
  assert.equal(violatesCell({ xMin: -38, xMax: A + 39, advance: A }, A, R), false);

  // (d) advance alone — ink fits and is centred, but the glyph claims a different
  //     number of cells (the half/full-width mismatch fit.py rewrites `hmtx`
  //     for). fitRatio must NOT move this term: the grid does not change.
  assert.equal(violatesCell({ xMin: 0, xMax: A, advance: A * 2 }, A, R), true);
  assert.equal(violatesCell({ xMin: 0, xMax: A, advance: A - 1 }, A, R), true);
});

// @testdoc The exclusion ranges equal verify.py's and stay a superset of xterm's rescaling set.
test('cell-fit exclusions: identical to verify.py, a strict superset of allowRescaling', () => {
  // Boundaries, not samples: an off-by-one in any range silently changes which
  // codepoints the contract covers, and both the Python and the Node side would
  // have to move together.
  const alwaysWidth1 = () => 1;
  for (const cp of [0x2500, 0x257f, 0x2580, 0x259f, 0xe000, 0xf8ff]) {
    assert.equal(isCellFitSubject(cp, alwaysWidth1), false, `U+${cp.toString(16)} must be excluded`);
  }
  for (const cp of [0x24ff, 0x25a0, 0xdfff, 0xf900]) {
    assert.equal(isCellFitSubject(cp, alwaysWidth1), true, `U+${cp.toString(16)} must be a subject`);
  }
  // cp <= 0xFF is never a subject: xterm never rescales ASCII/Latin-1, so a
  // slight overhang there is normal typography, and including it would drag the
  // body glyphs A M V W into the conversion (fit.py's docstring).
  assert.equal(isCellFitSubject(0xff, alwaysWidth1), false);
  assert.equal(isCellFitSubject(0x100, alwaysWidth1), true);
  // Supplementary private use (planes 15/16) is NOT excluded — xterm does not
  // exclude it either (R9 fixes this explicitly).
  assert.equal(isCellFitSubject(0xf0000, alwaysWidth1), true);
  // Width 0 (combining) and width 2 (fullwidth) are out of scope: allowRescaling
  // only ever fires at width === 1.
  assert.equal(isCellFitSubject(0x4e00, () => 2), false);
  assert.equal(isCellFitSubject(0x0301, () => 0), false);
  // And the width table really is xterm's, not a transcription: these three were
  // the codepoints a hand-written EastAsianWidth table dropped (#262 accident 1).
  // They are ALSO inside `allowRescaling`'s `!isEmoji` term (U+2600–26FF and
  // U+2700–27BF), which this subject set deliberately does not take — the
  // "strict superset" half of this test's name. xterm will never rescale them;
  // the conversion still makes them fit, and this file still requires it.
  for (const cp of [0x26a0, 0x2713, 0x2714]) {
    assert.equal(widthOf(cp), 1, `U+${cp.toString(16).toUpperCase()} must be 1 column per xterm's provider`);
    assert.equal(
      isCellFitSubject(cp, widthOf),
      true,
      `U+${cp.toString(16).toUpperCase()} must stay a subject even though xterm's isEmoji covers it`,
    );
  }
});

// ============================================================================
// (5) license-record line binding (#289 review Medium-1)
// ============================================================================
//
// A package README transcribes `scripts/font-fit/check-license.py`'s output as
// the record of its OFL §3 reserved-font-name check, and that output CITES LINE
// NUMBERS (`…/LICENSE.txt:109: Copyright (c) 2019, …`). A line number is a
// reference to a file this repository also owns, so ANY edit above the cited
// line falsifies the record silently — the prose stays true, the quoted text
// stays true, only the number moves. That is exactly what happened in #295: a
// three-line insert into `font-shirokumagen/LICENSE.txt` shifted nine
// references in each README by +3, `npm test` stayed green at 382 pass, and a
// reviewer re-running the tool is what found it. This section is the check that
// was missing.
//
// WHAT IS BOUND (two shapes, both of them shapes check-license.py PRINTS, so a
// record is bound by having been transcribed rather than by being listed here):
//
//   (a) TRANSCRIBED LINES — a whole line of the form
//         font-packages/<pkg>/<file>:<N>: <the cited line's own text>
//       anywhere in a `font-packages/*/README.md` or `README.ja.md`. Bound: the
//       cited file exists, has an Nth line, and that line — WHITESPACE-TRIMMED,
//       because the tool prints `line.strip()` — is character-for-character the
//       transcribed text.
//   (b) RESERVED-NAME PROVENANCE — a line of the form
//         '<name>'  ← <path>:<N>, <path>:<N>, …
//       (the tool's dedup list, which carries line numbers but no text). Bound:
//       the Nth line of each cited path CONTAINS `<name>` literally. Weaker than
//       (a) by construction — containment, not equality — because the name was
//       EXTRACTED from that line rather than copied off it.
//
// WHAT IS NOT BOUND, on purpose. Reading this as "every line number in the repo
// is now checked" is the failure it must not cause (#291 L4 shipped exactly that
// false comment):
//
//   * REFERENCES WITH NO QUOTED TEXT. `font-mgenplus-1mn`, `font-rounded-mgenplus-1mn`
//     and `font-mplus1code` record their check as a MARKDOWN TABLE whose cells
//     read `` `…/LICENSE.txt:62` | *no name* — this package's own note ``. There
//     is nothing transcribed to compare the line against, so those references
//     — and the prose ones beside them (`the note at `:62``) — are NOT checked
//     by (a) at all, and only the `font-shirokumagen` READMEs carry shape (a)
//     today. Their line numbers can go stale exactly as #295's did. Widening
//     shape (a) to them would mean inventing a text to compare, which is why the
//     narrower, certain subset was taken instead.
//   * EVERYTHING OUTSIDE `font-packages/*/README*.md`. `font-packages/README.md`,
//     `CLAUDE.md`, the `LICENSE.txt` files themselves and the `scripts/font-fit`
//     docstrings all cite line numbers in prose; none is read here.
//   * WHETHER THE TRANSCRIPT IS COMPLETE OR CURRENT. Nothing here re-runs
//     check-license.py (it needs the fontTools venv, which `npm test` must not
//     require), so a record that omits a matching line, or predates a NEW
//     declaration added to a license, passes. Green means "every line number
//     transcribed still points at the text beside it", never "the record is what
//     the tool would print today". Re-running the tool is still the gate for
//     that, and the READMEs print the exact command.
//   * LEADING/TRAILING WHITESPACE of the cited line, which the tool strips.
//
// NON-VACUITY. A record whose format drifts would make the parser match nothing
// and this section pass by finding no work, so each README carrying the tool's
// fixed section heading must yield at least one bound reference, and at least
// one README must carry that heading at all.

// The heading check-license.py prints above its verbatim transcript. Its
// presence is what makes a README a "record" for the non-vacuity check below.
const CHECK_LICENSE_HITS_HEADING = '--- 一致行（全行・省略なし）---';
// … and above the deduplicated reserved-name list (matched as a PREFIX: the
// tool appends the count, `… 4 件 ---`).
const CHECK_LICENSE_NAMES_HEADING = '--- 予約名: 引用符で宣言されたもの';

// Shape (a). Anchored at both ends so it cannot match a line number quoted mid
// sentence. The path may not contain a space, a colon or a `#`; it is the `#`
// that excludes the tool's `path#face:nameID` font-name-table citations (no line
// number to check) — space and colon alone would let `X.ttf#0:1: …` through, so
// naming only those two would misdescribe the guard. The parser red-path test
// below pins that exact input.
const TRANSCRIBED_LINE_RE = /^(font-packages\/[^\s:#]+):(\d+): (.*)$/;
// Shape (b). Two spaces of indent and the tool's `←` separator.
const PROVENANCE_NAME_RE = /^ {2}'(.+)'\s+←\s+(.+)$/;
const PROVENANCE_REF_RE = /^(font-packages\/[^\s:#]+):(\d+)$/;

function transcribedLineRefs(readmeText) {
  return readmeText.split('\n').flatMap((line, i) => {
    const m = TRANSCRIBED_LINE_RE.exec(line);
    return m ? [{ at: i + 1, file: m[1], line: Number(m[2]), text: m[3] }] : [];
  });
}

function provenanceRefs(readmeText) {
  return readmeText.split('\n').flatMap((line, i) => {
    const m = PROVENANCE_NAME_RE.exec(line);
    if (!m) { return []; }
    return m[2].split(',').flatMap((ref) => {
      const r = PROVENANCE_REF_RE.exec(ref.trim());
      // Anything that is not a `path:line` citation (a `path#face:nameID`
      // source, trailing prose) is skipped rather than failed: shape (b) only
      // claims to bind the citations that carry a line number.
      return r ? [{ at: i + 1, name: m[1], file: r[1], line: Number(r[2]) }] : [];
    });
  });
}

// The one file-system read both checks share, so a missing file / short file is
// reported the same way in both.
function citedLine(ref) {
  const abs = path.join(REPO_ROOT, ref.file);
  assert.ok(fs.existsSync(abs), `${ref.file} is cited at :${ref.line} but does not exist`);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  assert.ok(
    ref.line >= 1 && ref.line <= lines.length,
    `${ref.file}:${ref.line} is cited, but the file has only ${lines.length} lines`,
  );
  return lines[ref.line - 1];
}

function packageReadmes() {
  const out = [];
  for (const pkg of fs.readdirSync(FONT_PACKAGES_DIR).sort()) {
    for (const name of ['README.md', 'README.ja.md']) {
      const rel = path.join('font-packages', pkg, name);
      const abs = path.join(REPO_ROOT, rel);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        out.push({ rel, text: fs.readFileSync(abs, 'utf8') });
      }
    }
  }
  return out;
}

// @testdoc Every `path:line: text` record transcribed into a package README still matches that file's line.
test('license-record binding: transcribed line numbers still carry the transcribed text (#289 Medium-1)', () => {
  let bound = 0;
  let records = 0;
  for (const readme of packageReadmes()) {
    const refs = transcribedLineRefs(readme.text);
    if (readme.text.includes(CHECK_LICENSE_HITS_HEADING)) {
      records++;
      assert.ok(
        refs.length > 0,
        `${readme.rel} carries check-license.py's "${CHECK_LICENSE_HITS_HEADING}" heading but no `
          + 'line of the transcribed shape was parsed. The tool\'s output format moved and this '
          + 'check has gone vacuous — fix the parser, do not delete the heading.',
      );
    }
    for (const ref of refs) {
      assert.equal(
        citedLine(ref).trim(),
        ref.text,
        `${readme.rel}:${ref.at} transcribes ${ref.file}:${ref.line}, but that line now reads `
          + `something else. Editing a license file shifts every record below the edit (#295: a `
          + '3-line insert moved 9 references by +3). Re-run the command the README prints and '
          + 'paste the output again — do not hand-patch the number.',
      );
      bound++;
    }
  }
  assert.ok(records > 0, 'no package README carries a check-license.py transcript any more');
  assert.ok(bound > 0, 'no transcribed line reference was bound');
});

// @testdoc Every reserved-name provenance citation still points at a line containing that name.
test('license-record binding: reserved-name provenance citations still point at the name', () => {
  let bound = 0;
  for (const readme of packageReadmes()) {
    const refs = provenanceRefs(readme.text);
    if (readme.text.includes(CHECK_LICENSE_NAMES_HEADING)) {
      assert.ok(
        refs.length > 0,
        `${readme.rel} carries check-license.py's reserved-name heading but no provenance `
          + 'citation was parsed — the parser has gone vacuous.',
      );
    }
    for (const ref of refs) {
      assert.ok(
        citedLine(ref).includes(ref.name),
        `${readme.rel}:${ref.at} records that ${ref.file}:${ref.line} declares '${ref.name}', but `
          + 'that line does not contain it. The reserved-name list carries line numbers with no '
          + 'quoted text, so it goes stale from an edit above the line exactly as the transcript does.',
      );
      bound++;
    }
  }
  assert.ok(bound > 0, 'no reserved-name provenance citation was bound');
});

// @testdoc The two parsers and the comparison each have a red path (crafted input).
test('license-record binding: parsing and comparison have red paths', () => {
  const transcript = [
    'font-packages/font-x/LICENSE.txt:3: with Reserved Font Name "Alpha"',
    '    予約名候補: \'Alpha\'',
    'see `font-packages/font-x/LICENSE.txt:3` for the note',   // prose: NOT a record
    'font-packages/font-x/fonts/X.ttf#0:1: not a line citation', // `#face` form: skipped
  ].join('\n');
  const refs = transcribedLineRefs(transcript);
  assert.deepEqual(refs, [{
    at: 1,
    file: 'font-packages/font-x/LICENSE.txt',
    line: 3,
    text: 'with Reserved Font Name "Alpha"',
  }]);

  const prov = provenanceRefs([
    "  'Alpha'  ← font-packages/font-x/LICENSE.txt:3, font-packages/font-x/licenses/L:9",
    "  'Beta'  ← font-packages/font-x/fonts/X.ttf#0:1",
    "  ↑ 照合に使う予約名は …",
  ].join('\n'));
  assert.deepEqual(prov.map((r) => `${r.name}@${r.file}:${r.line}`), [
    'Alpha@font-packages/font-x/LICENSE.txt:3',
    'Alpha@font-packages/font-x/licenses/L:9',
  ]);

  // The comparison itself, on the shift that produced #295: the same text, three
  // lines lower. Trim-insensitive (the tool strips), text-sensitive otherwise.
  const file = ['a', 'b', '    with Reserved Font Name "Alpha"'];
  assert.equal(file[3 - 1].trim() === refs[0].text, true);
  const shifted = ['x', 'y', 'z', ...file];
  assert.equal(shifted[3 - 1].trim() === refs[0].text, false);
  assert.equal(shifted[6 - 1].trim() === refs[0].text, true);
  assert.equal(shifted[3 - 1].includes('Alpha'), false);
  assert.equal(shifted[6 - 1].includes('Alpha'), true);
});

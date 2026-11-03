'use strict';

// en/ja drift gate for the `providedFont` contract canon (#303).
//
// `font-packages/README.md` is the single canonical description of the contract;
// `font-packages/README.ja.md` beside it is a Japanese translation of the
// specification half. A translation that silently falls behind its original is
// worse than no translation, because it still LOOKS authoritative — so the
// structural relationship between the two files is bound here.
//
// -------------------------------------------------------------------------
// WHY THIS LIVES IN `npm test`, AND NOT IN `shirokuma-flow lint areas docs`
// -------------------------------------------------------------------------
// Measured, not assumed: the docs-lint rules themselves live in a DIFFERENT
// repository — not this one, and not any of its dependencies — and reach this
// project only through a globally installed CLI, so a fresh clone
// cannot reproduce them; and this project's receiving end for that lint,
// `.shirokuma/`, is `export-ignore`d, so it never reaches the public repository
// at all. `font-packages/**` is the opposite on both counts — it IS published,
// to the public repository and (as each font extension's Marketplace Readme tab)
// to the Marketplace. That is exactly CLAUDE.md's Layer 1 / Layer 2 distinction:
// a check whose result is published must itself be REPRODUCIBLE from the
// repository. `node --test test/*.test.js` is; a globally installed rule pack is
// not. Neither is AUTOMATIC — nothing runs this for you, there is no CI — but
// that is the property CI's removal cost us, and it is not the one at stake here.
//
// This is a separate file from `test/font-cellfit.test.js` on purpose: that file
// binds the conversion pipeline's numbers to the prose that quotes them (a
// value-level binding, across many documents). This one binds the STRUCTURE of
// one document pair. Folding them together would make one concern's failure look
// like the other's.
//
// -------------------------------------------------------------------------
// THE TRAP THIS FILE HAD TO AVOID: A CODE FENCE THAT LOOKS LIKE A HEADING
// -------------------------------------------------------------------------
// `command grep -c '^## ' font-packages/README.md` answers 9, and ONE OF THOSE
// NINE IS NOT A HEADING. `font-packages/README.md`'s "Provenance regime 2"
// section contains
//
//     ```
//     ## Provenance (upstream archive → conversion → output)
//     ```
//
// — a fenced example of the verbatim MACHINE KEY each converted package's README
// must carry as its own heading (it is what `test/font-cellfit.test.js`'s
// manifest ≡ package check matches on). There is NO real `## Provenance` heading
// in `font-packages/README.md`, and the translation carries the same fenced
// example at the same place. A heading scan that does not strip fences first
// therefore counts a code sample as a section — and the day that machine key is
// reworded, it would report a heading mismatch that is not one, in a file whose
// whole purpose is telling real drift from noise. That is the same species of
// defect as #105 (a check that could not touch what it claimed to test), #276 and
// #291: THE CHECK MEASURED SOMETHING OTHER THAN WHAT IT CLAIMED TO. So
// `parseMarkdown` below strips fenced blocks before it looks for headings, and
// the fenced example is instead bound as a fence — where its byte-for-byte
// equality between en and ja is the single most valuable comparison in this file.
//
// -------------------------------------------------------------------------
// WHAT THIS FILE DELIBERATELY DOES NOT BIND
// -------------------------------------------------------------------------
// NOTHING HERE CONSTRAINS THE PROSE. Word order, vocabulary, register, sentence
// count, paragraph count, how a sentence is split or joined, whether a clause is
// rendered as a subordinate clause or its own sentence — all free. A translation
// is not a transliteration, and a gate that demanded shape-for-shape prose would
// be a gate against translating well. What is bound is only what a reader would
// be MISLED by if it drifted: which sections exist and in what order, the
// contents of code samples, the identifiers and values quoted in inline code, and
// the fact that a section the translation declines to translate says so and
// points back at the canon (#303 acceptance criteria).
//
// TWO CONSEQUENCES OF THAT LINE, STATED RATHER THAN LEFT TO BE DISCOVERED
// (#303 review M2 / M3 — both were self-reported by the author and neither was
// written down, which is the half that mattered):
//
// (1) THE CONTENT CHECKS ARE ONE-DIRECTIONAL: en -> ja. `checkInlineCode`,
//     `checkIssueRefs` and `checkTranslatedNotStubbed` all walk the ENGLISH
//     section and ask whether the Japanese one kept up. Nothing walks the other
//     way. That is deliberate — a translation legitimately adds text the canon
//     has no counterpart for (its own preamble names `font-packages/README.md`;
//     a translator's note may cite a path) — and making it symmetric would
//     turn every such addition red. The cost is real and is NOT the same size
//     as the benefit: an assertion that exists ONLY in the translation is
//     invisible here, and it is the more dangerous drift, because the reader
//     who reads only the translation has nothing to check it against. Measured:
//     inserting a fabricated normative sentence into a translated section leaves
//     this file at 20 pass / 0 fail.
//     NOTE the asymmetry with the SECTION table above, which IS three-directional.
//     The two are not inconsistent — a section that exists on one side only is
//     always a defect, whereas a sentence that exists on one side only often is
//     not — but a reader who takes the three-direction argument as this file's
//     general policy will over-trust the content checks. Hence this paragraph.
//
// (2) ENGLISH PROSE CAN GROW WITHOUT BEING SEEN. A normative English paragraph
//     that happens to contain no inline code and no `#nnn` reference is added
//     with no failure here (measured: 20 pass / 0 fail).
//     `TRANSLATED_MIN_LINE_RATIO` is NOT a backstop for this: it is a floor
//     against an empty body, and the real files sit at 0.78-1.00 against a
//     threshold of 0.5, so a section can lose roughly a quarter of its content
//     without approaching it (measured: deleting ~28% of a translated section's
//     body went red only because an inline-code token happened to be inside the
//     deleted range). Raising the floor toward the measured range was considered
//     and rejected: it would fire on the ordinary case of English prose growing
//     ahead of a translation that has not caught up yet, which is a state this
//     repository will legitimately be in. So the honest summary of this gate's
//     reach is STRUCTURE, FENCES, INLINE-CODE TOKENS AND ISSUE REFERENCES —
//     narrower than the "a translation that silently falls behind" framing at
//     the top of this file might suggest on its own.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const EN_REL = 'font-packages/README.md';
const JA_REL = 'font-packages/README.ja.md';

// ---------------------------------------------------------------------------
// The section table.
//
// Headings cannot be compared by text — they are translated. So the mapping is
// declared here, and it is checked in THREE directions, because any one of them
// alone is vacuous:
//
//   (a) the `en` column ≡ README.md's own h1–h3 headings, in order
//   (b) the `ja` column ≡ README.ja.md's own h1–h3 headings, in order
//   (c) order, which (a) and (b) carry by being ordered arrays
//
// Only (a) catches a section added to the English canon; only (b) catches one
// added (or dropped) on the Japanese side. A one-directional table would stay
// green while the file it does not check drifts arbitrarily — the same reason
// `test/font-registry.test.js` keeps ⊆ and ≡ as two separate tests (#236).
//
// `kind` records how much of the section the translation carries:
//
//   'translated' — rendered in Japanese in full.
//   'partial'    — the section's opening is translated and the rest is a pointer
//                  back at the canon. Today only "Provenance regime 2", whose
//                  Link 1 / Link 2 / Link 3 detail is measured values.
//   'pointer'    — the heading exists so the structures line up, and the body is
//                  a note naming the English section to read instead.
//
// A section is a 'pointer' when its body is measured tables and file-path lists:
// a second copy of a measured value is precisely the drift a single canon exists
// to prevent.
const SECTIONS = [
  { kind: 'translated', en: 'The `providedFont` contract (font resource extensions)', ja: '`providedFont` 契約(フォントリソース拡張機能)' },
  { kind: 'translated', en: 'The contract field', ja: '契約フィールド' },
  { kind: 'translated', en: 'Shape A — `faces[]` (N faces)', ja: '宣言形 A —— `faces[]`(N 面)' },
  { kind: 'translated', en: 'Shape B — the flat `file` / `weight` pair (one face)', ja: '宣言形 B —— フラットな `file` / `weight` の対(1 面)' },
  { kind: 'translated', en: 'Which shape wins', ja: 'どちらの宣言形が優先されるか' },
  { kind: 'translated', en: 'Normalization (what a reader must compute)', ja: '正規化(読み手が計算しなければならないこと)' },
  { kind: 'translated', en: 'Degradation (when a family cannot be supplied)', ja: '縮退(family を供給できないとき)' },
  { kind: 'translated', en: 'Declaration stage — the 400 rule', ja: '宣言段階 —— 400 の規則' },
  { kind: 'translated', en: 'Existence stage — per-face drop', ja: '実在段階 —— face 単位の drop' },
  { kind: 'translated', en: 'Static faces declare a single value; only a variable font declares a range', ja: '静的 face は単一値を宣言する。範囲を宣言してよいのは可変フォントだけ' },
  { kind: 'translated', en: 'Consumer steps', ja: '消費側の手順' },
  { kind: 'translated', en: 'Injecting contract values safely', ja: '契約の値を安全に注入する' },
  { kind: 'translated', en: "The injection does not depend on the font file's internal names", ja: '注入機構はフォントファイル内部の名前に依存しない' },
  { kind: 'translated', en: 'Conventions for the packages in this directory', ja: 'このディレクトリの package についての作法' },
  { kind: 'translated', en: 'How a shipped family name is derived', ja: '出荷する family 名の導き方' },
  { kind: 'translated', en: 'Provenance regime 1 (unmodified) — the two-column sha256 table', ja: '取得元(provenance)regime 1(無改変)—— 二列 sha256 表' },
  { kind: 'partial', en: 'Provenance regime 2 (conversion output) — the three-link chain', ja: '取得元(provenance)regime 2(変換出力)—— 三段連鎖' },
  { kind: 'pointer', en: 'Reserved Font Name check (required for every modified package, every time)', ja: '予約フォント名(Reserved Font Name)の確認(改変された package では毎回必須)' },
  { kind: 'pointer', en: 'Packaging a font extension: check the VSIX carries every declared face', ja: 'フォント拡張機能のパッケージング: VSIX が宣言どおりの face を含むか確認する' },
  { kind: 'pointer', en: 'Terminal width conventions — a width-1 code point must not be squashed', ja: '端末の幅の規約 —— 幅 1 の符号位置は潰されてはならない' },
  { kind: 'pointer', en: 'Where the machine checks live', ja: '機械検査がどこにあるか' },
];

// Fenced blocks whose contents are NOT compared, keyed `<section index>#<fence
// index within the section>`. ONE entry today, and the exclusion list is itself
// checked for staleness below (an entry that would pass the comparison anyway is
// a failure, so this list cannot quietly outlive its reason).
const FENCE_EXCEPTIONS = new Map([
  // §14 "How a shipped family name is derived" opens with the naming formula
  //     <upstream family name> + " Term"
  // whose left-hand side is an angle-bracket PLACEHOLDER — English prose inside a
  // fence, not code. The translation renders it `<上流の family 名> + " Term"`.
  // The part that carries meaning, the literal ` Term` suffix, is bound anyway by
  // the inline-code check below (the suffix appears in the section's prose on
  // each side).
  ['14#0', 'the fence is a naming formula whose placeholder is prose, and is translated as prose'],
]);

// Inline-code tokens (`…`) present in an English translated section that are NOT
// required to appear in its Japanese counterpart, keyed `<section index>:<token>`.
// Six today, measured against 230 tokens compared. Same staleness rule as the
// fence list: an entry that would have passed anyway fails the suite.
const INLINE_CODE_EXCEPTIONS = new Map([
  // The English preamble names the translation file. The translation does not
  // cite itself; it cites the canon (which the same check requires of it).
  ['0:font-packages/README.ja.md', 'the canon names the translation; the translation names the canon'],
  // §13 quotes the two-column provenance table's COLUMN HEADINGS in prose, and
  // the translation renders both the table header row and these quotations of it
  // in Japanese (`取得元 URL | sha256(取得時)` and so on). The heading strings are
  // an illustration inside this document, not a machine key — unlike the
  // `## Provenance (upstream archive → conversion → output)` fence, which IS one
  // and is required byte-for-byte on both sides.
  ['13:source URL | sha256 (fetched)', 'illustrative column heading, translated with the table it labels'],
  ['13:placed at | sha256 (placed)', 'illustrative column heading, translated with the table it labels'],
  ['13:placed at', 'illustrative column heading, translated with the table it labels'],
  ['13:quoted verbatim in LICENSE.txt', 'an example CELL VALUE for that column, translated with it'],
  // Not a token at all: two inline-code spans on one line with the word "as"
  // between them, which the ``…`` regex pairs across the gap. Left in the
  // exclusion list rather than fixed in the regex, because a smarter tokenizer
  // would be a second Markdown parser to get wrong; naming the artifact costs one
  // line and hides nothing.
  ['13: as ', 'tokenizer artifact — the text between two adjacent inline-code spans, not an identifier'],
]);

// A 'pointer' section's Japanese body must stay a pointer: short, naming the
// canon, and quoting the English heading it defers to. The ceiling is loose on
// purpose — it exists to catch "the section was translated but the pointer was
// left in", not to police how a pointer is worded. Measured today: 3 / 5 / 6 / 7
// non-blank lines.
const POINTER_MAX_NONBLANK_LINES = 12;

// A 'translated' section's Japanese body must not be a stub. Measured today the
// ratio of non-blank lines ja/en runs 0.78 … 1.00 across the sixteen translated
// sections, so 0.5 is a floor with room, and it is only a floor: this detects a
// section whose heading was translated and whose body was not, NOT whether the
// prose says the same thing. Nothing here can check that.
const TRANSLATED_MIN_LINE_RATIO = 0.5;

// ---------------------------------------------------------------------------
// Parsing.

// Headings are collected only OUTSIDE fenced blocks. See the trap note at the
// top of this file: `font-packages/README.md` contains a fenced line that reads
// exactly like an h2 and is not one.
function parseMarkdown(content, label) {
  const lines = content.split('\n');
  const headings = [];
  const fences = [];
  let open = null;
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (open === null) {
        open = { startLine: index + 1, info: trimmed.slice(3), body: [] };
      } else {
        open.endLine = index + 1;
        fences.push(open);
        open = null;
      }
      continue;
    }
    if (open !== null) {
      open.body.push(line);
      continue;
    }
    const m = /^(#{1,6}) (.+)$/.exec(line);
    if (m) headings.push({ line: index + 1, level: m[1].length, text: m[2].trim() });
  }
  assert.equal(open, null, `${label}: unclosed code fence starting at line ${open && open.startLine}`);
  return { label, lines, headings, fences };
}

// Sections are delimited by h1–h3. h4+ headings are NOT section boundaries; they
// are collected into the section they sit in (see the h4 test for why).
function sectionize(doc) {
  const tops = doc.headings.filter((h) => h.level <= 3);
  return tops.map((h, i) => {
    const next = tops.at(i + 1);
    const endLine = next ? next.line - 1 : doc.lines.length;
    return {
      heading: h,
      bodyLines: doc.lines.slice(h.line, endLine),
      subHeadings: doc.headings.filter((s) => s.level >= 4 && s.line > h.line && s.line <= endLine),
      fences: doc.fences.filter((f) => f.startLine > h.line && f.startLine <= endLine),
    };
  });
}

const nonBlank = (lines) => lines.filter((l) => l.trim() !== '').length;

// A fence's comparable content: comments stripped, then blank lines dropped.
//
// Comments inside a code sample are prose and ARE translated (the `js` samples in
// "Consumer steps" carry Japanese comments), so a byte-for-byte comparison of raw
// fence bodies would forbid translating them. What must not drift is the code —
// identifiers, paths, the CSP string, the JSON shapes.
//
// The `//` stripping is deliberately naive (it requires start-of-line or
// whitespace before the slashes, which spares a `://` in a URL). Measured: no
// fence body line in either file contains `://`, and none contains `//` inside a
// string literal or a regex. If one ever does, this helper is where it breaks,
// and it breaks LOUDLY — a stripped line stops matching its counterpart.
//
// THE STRIPPING HAS A COST, AND IT IS NOT SYMMETRIC WITH ITS BENEFIT (#303
// review L1). Allowing a translator's note inside a fence also un-binds any
// CODE that happens to sit inside a comment. Measured today: fence #3 carries
// `// .term { font-family: '<family>', monospace; }` (a CSS declaration) and
// `// '/etc/passwd' -> ['', 'etc', 'passwd']` (the traversal-defusing example)
// — both are exactly the "identifiers, paths, CSP strings, JSON shapes" this
// helper's own contract says must not drift, and both are outside the
// comparison because of where they are written. The fix is not in this helper:
// a code sample that must be bound belongs OUTSIDE a `//` comment. Anything
// added inside one is, by construction, free to drift.
function comparableFenceBody(body) {
  return body
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1').replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '');
}

function inlineCodeTokens(lines) {
  const found = [];
  for (const line of lines) {
    for (const m of line.matchAll(/`([^`\n]+)`/g)) found.push(m[1]);
  }
  return [...new Set(found)];
}

// ---------------------------------------------------------------------------
// The checks, as pure functions over two parsed documents (and over the table,
// which is passed in rather than closed over), so the red-path tests at the
// bottom can run them against mutated copies without touching the files.

// Positional pairing, written with `.at()` rather than `a[i]` throughout this
// file: the indices here are loop counters, never external input, but
// `security/detect-object-injection` cannot tell those apart and this file would
// otherwise be the noisiest in the repository for a rule that has nothing to say
// about it. Avoiding the shape costs less than 38 disable comments.
const zip = (a, b) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a.at(i), b.at(i)]);

// The section table paired with both documents' sections, in one place.
const align = (enSecs, jaSecs, table) => table.map((spec, index) => ({
  index, spec, en: enSecs.at(index), ja: jaSecs.at(index),
}));

function checkHeadingColumn(doc, column, side) {
  const actual = doc.headings.filter((h) => h.level <= 3).map((h) => h.text);
  const failures = [];
  for (const [index, [found, declared]] of zip(actual, column).entries()) {
    if (found !== declared) {
      failures.push(`${side} heading #${index}: file has ${JSON.stringify(found ?? null)}, `
        + `SECTIONS declares ${JSON.stringify(declared ?? null)}`);
    }
  }
  return failures;
}

// h4+ headings exist only under sections the translation does not carry in full,
// so there is nothing to pair them with there. Under a 'translated' section they
// MUST be paired positionally — otherwise a subsection could be added to the
// English canon inside translated material and go unnoticed. (Their TEXT is not
// mapped: no translated section has an h4 today, so a text column would be an
// empty table nobody could review.)
function checkSubHeadings(enSecs, jaSecs, table = SECTIONS) {
  const failures = [];
  for (const { index, spec, en, ja } of align(enSecs, jaSecs, table)) {
    if (!en || !ja || spec.kind !== 'translated') continue;
    if (en.subHeadings.length !== ja.subHeadings.length) {
      failures.push(`§${index} (${spec.en}) is 'translated' but carries `
        + `${en.subHeadings.length} h4+ heading(s) in en and ${ja.subHeadings.length} in ja: `
        + JSON.stringify(en.subHeadings.map((h) => h.text)));
    }
  }
  return failures;
}

function checkFences(enSecs, jaSecs, table = SECTIONS) {
  const failures = [];
  const usedExceptions = new Set();
  let compared = 0;
  for (const { index, spec, en, ja } of align(enSecs, jaSecs, table)) {
    if (!en || !ja || spec.kind === 'pointer') continue;
    if (spec.kind === 'translated' && en.fences.length !== ja.fences.length) {
      failures.push(`§${index} (${spec.en}): ${en.fences.length} fence(s) in en, ${ja.fences.length} in ja`);
    }
    // 'partial' sections translate only their opening, so the English tail may
    // carry fences the translation has no counterpart for. Either way the pairing
    // is positional from the start of the section, and an unpaired fence is
    // skipped here — for a 'translated' section the count check above has already
    // reported it.
    for (const [k, [a, b]] of zip(en.fences, ja.fences).entries()) {
      if (!a || !b) continue;
      const key = `${index}#${k}`;
      const same = comparableFenceBody(a.body).join('\n') === comparableFenceBody(b.body).join('\n');
      if (FENCE_EXCEPTIONS.has(key)) {
        usedExceptions.add(key);
        if (same) {
          failures.push(`FENCE_EXCEPTIONS['${key}'] is stale: the two fences now agree, `
            + 'so the exclusion hides nothing and must be deleted');
        }
        continue;
      }
      compared++;
      if (a.info !== b.info) {
        failures.push(`§${index} fence #${k}: info string is ${JSON.stringify(a.info)} in en `
          + `(line ${a.startLine}) and ${JSON.stringify(b.info)} in ja (line ${b.startLine})`);
      }
      if (!same) {
        failures.push(`§${index} fence #${k} (en line ${a.startLine} / ja line ${b.startLine}): `
          + 'code differs once comments are stripped\n'
          + `  en: ${JSON.stringify(comparableFenceBody(a.body))}\n`
          + `  ja: ${JSON.stringify(comparableFenceBody(b.body))}`);
      }
    }
  }
  for (const key of FENCE_EXCEPTIONS.keys()) {
    if (!usedExceptions.has(key)) {
      failures.push(`FENCE_EXCEPTIONS['${key}'] names a fence that no longer exists`);
    }
  }
  return { failures, compared };
}

function checkInlineCode(enSecs, jaSecs, table = SECTIONS) {
  const failures = [];
  const usedExceptions = new Set();
  let compared = 0;
  for (const { index, spec, en, ja } of align(enSecs, jaSecs, table)) {
    if (!en || !ja || spec.kind !== 'translated') continue;
    const jaText = ja.bodyLines.join('\n');
    for (const token of inlineCodeTokens(en.bodyLines)) {
      const key = `${index}:${token}`;
      const present = jaText.includes(token);
      if (INLINE_CODE_EXCEPTIONS.has(key)) {
        usedExceptions.add(key);
        if (present) {
          failures.push(`INLINE_CODE_EXCEPTIONS['${key}'] is stale: the token now appears in ja`);
        }
        continue;
      }
      compared++;
      if (!present) {
        failures.push(`§${index} (${spec.en}): inline code \`${token}\` has no counterpart in the `
          + 'Japanese section. Identifiers, paths and values are not translated — either carry it '
          + 'over, or add it to INLINE_CODE_EXCEPTIONS with the reason it is prose.');
      }
    }
  }
  for (const key of INLINE_CODE_EXCEPTIONS.keys()) {
    if (!usedExceptions.has(key)) {
      failures.push(`INLINE_CODE_EXCEPTIONS['${key}'] names a token the English section no longer has`);
    }
  }
  return { failures, compared };
}

// Cross-references to Issues / PRs (`#275`, `#291`, …). These are identifiers
// that happen not to be written in inline code, so the check above cannot see
// them — and a mistyped digit in a translation is invisible to a reader who
// cannot check it against the canon. Measured: 9 distinct references across the
// translated sections, all present on both sides, no exceptions needed.
function checkIssueRefs(enSecs, jaSecs, table = SECTIONS) {
  const failures = [];
  let compared = 0;
  for (const { index, spec, en, ja } of align(enSecs, jaSecs, table)) {
    if (!en || !ja || spec.kind !== 'translated') continue;
    // Tokenized on both sides rather than substring-searched, so `#27` cannot be
    // satisfied by a `#275` that happens to be nearby.
    const jaRefs = new Set(ja.bodyLines.join('\n').match(/#\d+/g) ?? []);
    const refs = new Set(en.bodyLines.join('\n').match(/#\d+/g) ?? []);
    for (const ref of refs) {
      compared++;
      if (!jaRefs.has(ref)) {
        failures.push(`§${index} (${spec.en}): the English section cites ${ref} and the Japanese one `
          + 'does not. A cross-reference is an identifier, not prose.');
      }
    }
  }
  return { failures, compared };
}

function checkPointers(enSecs, jaSecs, table = SECTIONS) {
  const failures = [];
  let compared = 0;
  for (const { index, spec, ja } of align(enSecs, jaSecs, table)) {
    if (!ja || spec.kind === 'translated') continue;
    compared++;
    const text = ja.bodyLines.join('\n');
    if (!text.includes(EN_REL)) {
      failures.push(`§${index} (${spec.ja}) is '${spec.kind}' but its body never names \`${EN_REL}\`. `
        + 'A section the translation declines to translate must say where to read it instead — '
        + 'otherwise it reads as a section with nothing in it.');
    }
    if (spec.kind !== 'pointer') continue;
    if (!text.includes(spec.en)) {
      failures.push(`§${index} (${spec.ja}) does not quote the English heading it defers to, `
        + `verbatim: ${JSON.stringify(spec.en)}. The quotation is how a reader finds the `
        + 'section, and how renaming the English heading is forced to touch this file.');
    }
    const lines = nonBlank(ja.bodyLines);
    if (lines > POINTER_MAX_NONBLANK_LINES) {
      failures.push(`§${index} (${spec.ja}) is declared 'pointer' but carries ${lines} non-blank `
        + `lines (ceiling ${POINTER_MAX_NONBLANK_LINES}). If it was translated, change its kind in `
        + 'SECTIONS and drop the pointer note.');
    }
  }
  return { failures, compared };
}

function checkTranslatedNotStubbed(enSecs, jaSecs, table = SECTIONS) {
  const failures = [];
  let compared = 0;
  for (const { index, spec, en, ja } of align(enSecs, jaSecs, table)) {
    if (!en || !ja || spec.kind !== 'translated') continue;
    compared++;
    const e = nonBlank(en.bodyLines);
    const j = nonBlank(ja.bodyLines);
    if (e > 0 && j / e < TRANSLATED_MIN_LINE_RATIO) {
      failures.push(`§${index} (${spec.en}) is declared 'translated' but its Japanese body is `
        + `${j} non-blank lines against ${e} in English (ratio ${(j / e).toFixed(2)} < `
        + `${TRANSLATED_MIN_LINE_RATIO}). Either it is a stub, or it is really a pointer — say which.`);
    }
  }
  return { failures, compared };
}

// ---------------------------------------------------------------------------

function load() {
  const en = parseMarkdown(fs.readFileSync(path.join(REPO_ROOT, EN_REL), 'utf8'), EN_REL);
  const ja = parseMarkdown(fs.readFileSync(path.join(REPO_ROOT, JA_REL), 'utf8'), JA_REL);
  return { en, ja, enSecs: sectionize(en), jaSecs: sectionize(ja) };
}

const report = (failures) => failures.join('\n\n');

test('section table: the en column ≡ README.md\'s own h1–h3 headings, in order', () => {
  const { en } = load();
  const failures = checkHeadingColumn(en, SECTIONS.map((s) => s.en), 'en');
  assert.deepEqual(failures, [], report(failures));
  assert.equal(en.headings.filter((h) => h.level <= 3).length, SECTIONS.length);
});

test('section table: the ja column ≡ README.ja.md\'s own h1–h3 headings, in order', () => {
  const { ja } = load();
  const failures = checkHeadingColumn(ja, SECTIONS.map((s) => s.ja), 'ja');
  assert.deepEqual(failures, [], report(failures));
  assert.equal(ja.headings.filter((h) => h.level <= 3).length, SECTIONS.length);
});

// #303 review L2. Both files state the size of the translated range in PROSE —
// "a Japanese translation of the seven specification sections below" (en) and
// 「訳したのは規範的な散文の 7 節だけ」(ja). Nothing derived that 7 from
// `SECTIONS`, so widening the translated range by one h2 would leave two stale
// sentences behind a green gate: the same species of defect as #291's ratio
// quotations, and the same fix — derive the number, then require the documents
// that quote it to carry today's value.
//
// It counts h2 only, because that is what "section" means in those two
// sentences; h3s are subsections of them, and counting those would make the
// number 16 and the prose wrong for a reason that has nothing to do with drift.
test('the "seven sections" both files state in prose is derived, not written down', () => {
  const { en, ja } = load();
  const levels = en.headings.filter((h) => h.level <= 3).map((h) => h.level);
  const translatedH2 = SECTIONS
    .filter((s, i) => s.kind === 'translated' && levels.at(i) === 2)
    .length;

  assert.equal(translatedH2, 7, 'the section table itself moved — update both prose statements below');
  assert.match(
    en.lines.join('\n'),
    /translation of the seven specification sections/,
    'font-packages/README.md no longer states the translated range as "seven"',
  );
  assert.match(
    ja.lines.join('\n'),
    /規範的な散文の 7 節/,
    'font-packages/README.ja.md no longer states the translated range as 7 節',
  );
  // The ja heading count is bound too, so a section added on one side alone is
  // already caught above; this pair only stops the PROSE from going stale.
  assert.equal(ja.headings.filter((h) => h.level <= 3).length, SECTIONS.length);
});

test('the fenced `## Provenance …` sample is NOT counted as a heading', () => {
  // The trap, asserted rather than only commented: the machine key exists as a
  // fence in both files, and as a heading in neither.
  const { en, ja, enSecs, jaSecs } = load();
  const KEY = '## Provenance (upstream archive → conversion → output)';
  for (const doc of [en, ja]) {
    assert.ok(!doc.headings.some((h) => `${'#'.repeat(h.level)} ${h.text}` === KEY),
      `${doc.label}: the machine key is being read as a real heading — the fence stripping broke`);
    assert.ok(doc.fences.some((f) => f.body.join('\n').trim() === KEY),
      `${doc.label}: the fenced \`${KEY}\` sample is gone`);
  }
  // And it is in the same section on both sides.
  const idx = SECTIONS.findIndex((s) => s.kind === 'partial');
  const hasKey = (sec) => sec.fences.some((f) => f.body.join('\n').trim() === KEY);
  assert.ok(hasKey(enSecs.at(idx)));
  assert.ok(hasKey(jaSecs.at(idx)));
});

test('h4+ subsections exist only where the translation is not carrying the section', () => {
  const { enSecs, jaSecs } = load();
  const failures = checkSubHeadings(enSecs, jaSecs);
  assert.deepEqual(failures, [], report(failures));
  // Non-vacuous: there ARE h4s in this document, and every one of them sits in a
  // section the translation points at rather than renders.
  const withH4 = align(enSecs, jaSecs, SECTIONS).filter(({ en }) => en.subHeadings.length > 0);
  assert.ok(withH4.length > 0, 'no h4 anywhere — this check is measuring nothing');
  for (const { spec } of withH4) assert.notEqual(spec.kind, 'translated');
});

test('code fences agree byte-for-byte once comments are stripped', () => {
  const { enSecs, jaSecs } = load();
  const { failures, compared } = checkFences(enSecs, jaSecs);
  assert.deepEqual(failures, [], report(failures));
  // 6 pairs compared, 1 excluded — if this drops to 0 the comparison has stopped
  // finding fences and would be green on anything.
  assert.equal(compared, 6);
  assert.equal(FENCE_EXCEPTIONS.size, 1);
});

test('inline-code identifiers and values carry over into the translation', () => {
  const { enSecs, jaSecs } = load();
  const { failures, compared } = checkInlineCode(enSecs, jaSecs);
  assert.deepEqual(failures, [], report(failures));
  // 224 tokens compared, 6 excluded (230 found in the sixteen translated
  // sections). The floor is loose because the canon gains prose; it exists to
  // catch a tokenizer that has stopped finding anything, not to pin the count.
  assert.ok(compared > 200, `only ${compared} inline-code tokens compared — the tokenizer is not finding them`);
  assert.equal(INLINE_CODE_EXCEPTIONS.size, 6);
});

test('Issue cross-references carry over into the translation', () => {
  const { enSecs, jaSecs } = load();
  const { failures, compared } = checkIssueRefs(enSecs, jaSecs);
  assert.deepEqual(failures, [], report(failures));
  assert.equal(compared, 9);
});

test('an untranslated section points at the canon and quotes the heading it defers to', () => {
  const { enSecs, jaSecs } = load();
  const { failures, compared } = checkPointers(enSecs, jaSecs);
  assert.deepEqual(failures, [], report(failures));
  assert.equal(compared, 5); // 4 pointer + 1 partial
});

test('a section declared translated is not a stub', () => {
  const { enSecs, jaSecs } = load();
  const { failures, compared } = checkTranslatedNotStubbed(enSecs, jaSecs);
  assert.deepEqual(failures, [], report(failures));
  assert.equal(compared, 16);
});

// ---------------------------------------------------------------------------
// Red paths. Each check above is run against a deliberately drifted copy of the
// real documents, so a check that has quietly stopped looking at anything fails
// HERE rather than staying green forever. (These mutate strings in memory; the
// files on disk are never touched.)
//
// Seven of them were ALSO applied to the files on disk once, and `npm test` run
// against the result, because a red path asserted only against a string in this
// file proves the helper works, not that a real edit reaches the suite. Measured,
// against a green control of 427 pass / 0 fail:
//
//   en gains a section heading .................. 1 fail
//   ja loses a section heading .................. 2 fail (table + pointer quote)
//   one character changed in an en code fence ... 2 fail
//   ja pointer stops naming the canon ........... 1 fail
//   the machine key reworded in en only ......... 3 fail
//   an identifier dropped from ja ............... 1 fail
//   an Issue reference mistyped in ja ........... 1 fail
//
// (The "2 fail" rows include `red path: a comment-only difference … is NOT a
// failure`, which reads the real files and so inherits a real fence mutation.
// That is the control failing for the right reason, not a second defect.)

function mutated(fn) {
  const enRaw = fs.readFileSync(path.join(REPO_ROOT, EN_REL), 'utf8');
  const jaRaw = fs.readFileSync(path.join(REPO_ROOT, JA_REL), 'utf8');
  const { en, ja } = fn(enRaw, jaRaw);
  const enDoc = parseMarkdown(en, 'en(mutated)');
  const jaDoc = parseMarkdown(ja, 'ja(mutated)');
  return { enDoc, jaDoc, enSecs: sectionize(enDoc), jaSecs: sectionize(jaDoc) };
}

test('red path: a section added to the English canon', () => {
  const { enDoc } = mutated((en, ja) => ({
    en: en.replace('## Where the machine checks live', '## A brand new section\n\nbody\n\n## Where the machine checks live'),
    ja,
  }));
  assert.notEqual(checkHeadingColumn(enDoc, SECTIONS.map((s) => s.en), 'en').length, 0);
});

test('red path: a heading dropped from the translation', () => {
  const { jaDoc } = mutated((en, ja) => ({
    en,
    ja: ja.replace('## 機械検査がどこにあるか', 'ここに見出しがあった'),
  }));
  assert.notEqual(checkHeadingColumn(jaDoc, SECTIONS.map((s) => s.ja), 'ja').length, 0);
});

test('red path: an English heading renamed under a pointer section', () => {
  const { enDoc, enSecs, jaSecs } = mutated((en, ja) => ({
    en: en.replace('## Where the machine checks live', '## Where the machine checks are'),
    ja,
  }));
  // The table catches the rename …
  assert.notEqual(checkHeadingColumn(enDoc, SECTIONS.map((s) => s.en), 'en').length, 0);
  // … and, once someone updates the table to match, the pointer's verbatim
  // quotation catches that the translation was not updated with it.
  const renamed = SECTIONS.map((s) => (s.en === 'Where the machine checks live'
    ? { ...s, en: 'Where the machine checks are' }
    : s));
  assert.notEqual(checkPointers(enSecs, jaSecs, renamed).failures.length, 0);
});

test('red path: one character changed in an English code sample', () => {
  const { enSecs, jaSecs } = mutated((en, ja) => ({
    en: en.replace("format('truetype')", "format('truetypo')"),
    ja,
  }));
  assert.notEqual(checkFences(enSecs, jaSecs).failures.length, 0);
});

test('red path: the machine key reworded on one side only', () => {
  const { enSecs, jaSecs } = mutated((en, ja) => ({
    en: en.replace('## Provenance (upstream archive → conversion → output)', '## Provenance (upstream → output)'),
    ja,
  }));
  assert.notEqual(checkFences(enSecs, jaSecs).failures.length, 0);
});

test('red path: a comment-only difference inside a code sample is NOT a failure', () => {
  // The other side of the same coin: translating a comment must stay legal.
  const { enSecs, jaSecs } = mutated((en, ja) => ({
    en: en.replace('// your own root', '// the root this extension owns'),
    ja,
  }));
  assert.deepEqual(checkFences(enSecs, jaSecs).failures, []);
});

test('red path: an identifier dropped from the translation', () => {
  const { enSecs, jaSecs } = mutated((en, ja) => ({
    en,
    ja: ja.replace(/`normalizeContractFaces`/g, '正規化関数'),
  }));
  assert.notEqual(checkInlineCode(enSecs, jaSecs).failures.length, 0);
});

test('red path: a cross-reference mistyped in the translation', () => {
  const { enSecs, jaSecs } = mutated((en, ja) => ({
    en,
    ja: ja.replace(/#275/g, '#725'),
  }));
  assert.notEqual(checkIssueRefs(enSecs, jaSecs).failures.length, 0);
});

test('red path: a pointer section that stops naming the canon', () => {
  const { enSecs, jaSecs } = mutated((en, ja) => ({
    en,
    ja: ja.replace(
      '> **本節は日本語版では訳していない。** 英語版 `font-packages/README.md` の\n> "Where the machine checks live" を参照すること。',
      '> **本節は日本語版では訳していない。**\n> "Where the machine checks live" を参照すること。',
    ),
  }));
  assert.notEqual(checkPointers(enSecs, jaSecs).failures.length, 0);
});

test('red path: a translated section reduced to a stub', () => {
  const { enSecs, jaSecs } = mutated((en, ja) => {
    const start = ja.indexOf('## 正規化(読み手が計算しなければならないこと)');
    const end = ja.indexOf('## 縮退(family を供給できないとき)');
    return { en, ja: `${ja.slice(0, start)}## 正規化(読み手が計算しなければならないこと)\n\nTODO\n\n${ja.slice(end)}` };
  });
  assert.notEqual(checkTranslatedNotStubbed(enSecs, jaSecs).failures.length, 0);
});

test('red path: an h4 added inside a translated section', () => {
  const { enSecs, jaSecs } = mutated((en, ja) => ({
    en: en.replace('### Injecting contract values safely', '#### A new subsection\n\nbody\n\n### Injecting contract values safely'),
    ja,
  }));
  assert.notEqual(checkSubHeadings(enSecs, jaSecs).length, 0);
});

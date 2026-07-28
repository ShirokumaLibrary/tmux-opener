# Rounded Mgen+ 1mn Term (font resource for extensions)

*[日本語](README.ja.md)*

Extension ID: `shirokuma-library.font-rounded-mgenplus-1mn`

A general-purpose font resource extension that **supplies the Rounded Mgen+ 1mn
Term font to other extensions**. It has no UI and no commands of its own
(`contributes` is empty, `activationEvents` is empty, and `main` is a no-op),
and it **does not install the font into the OS**. Its sole purpose is to let a
consuming extension load the bundled TTF from its own webview via
`vscode-resource`.

**Rounded Mgen+ 1mn Term is a modified version of Rounded Mgen+ 1mn**, refitted
for terminal use: the symbols a terminal counts as one column wide are brought
under the width at which a renderer squashes them sideways. Ink wider than
**1.15 cells** is scaled down to exactly that
width, and any ink that reaches past its cell is centred on the cell, so the
overhang is the same on both sides and never exceeds 38 units of a 512-unit cell
(about 7.5%). **A symbol may therefore touch its neighbour slightly**; what it
never does is reach the squashing threshold. Advance widths are not part of that:
the cell grid does not move, and this file's `hmtx` — every advance and every
left side bearing, all 18,105 glyphs of the Regular face — is byte-identical
to the #291 release that preceded this one (measured). The ratio itself —
what it means, its 1.5 ceiling and why 1.15 — is defined once, in
`scripts/font-fit/manifest.json`'s `note`.

**The two axes are scaled by different factors** (since #293): the width goes to
`s`, the height to `s × 1.3` where the face allows it. Scaling `①` down to the cell took its height to
588 units as well — below this face's own cap height of 748 (measured) — so the
symbol read as small because it was *short*, and horizontally there was nothing
left to give. The growth is clamped, per glyph, against a limit **measured out of
this face**: the **top and bottom edges** of its own 漢 (U+6F22) — `y = −75..843`
in the Regular face, `−89..847` in the Bold — and each glyph's stretch is capped
so the stretched glyph stays inside them. **What is bounded is the glyph's reach,
not its height**: the conversion keeps each glyph's vertical centre, so capping
the height alone would still let a glyph whose centre sits off the kanji's push
past the line. The statement that is true of these bytes is therefore a
**conditional** one: the refit never pushes a glyph past that kanji's top or
bottom, and a glyph already past it at equal scaling keeps the previous release's
shape, unchanged to the unit (measured: **0** glyphs of either face newly reach
outside). It is *not* claimed that nothing here reaches further above or below
the line than 漢 — this typeface draws symbols taller than 漢 to begin with, and
**131 of the 1000** refitted glyphs in the Regular face are outside its box at
equal scaling already. The clamp's floor is 1.0, so **not every refitted
glyph gets taller**: measured on the shipped bytes, **868 of the 1000** refitted
glyphs grew in the Regular face and **896 of 1019** in the Bold — the rest had no
room left at equal scaling and did not move a unit. `1.3` is a
*chosen* value, arrived at by looking at five bakes; it is not derived from the
cap-height ratio (748 / 588 = 1.272) it happens to sit near. Its meaning, its
measured limit and the current default are defined in the same `note`. ASCII and Latin-1 are out of scope — a
renderer does not rescale those, and refitting them would rework the body text —
as are box drawing, block elements and private use; the exact scope is stated in
`font-packages/README.md`. Nothing else about the outlines was touched.
The full chain — which archive it came from, what did the converting, and the
hash of what came out — is in "Provenance", below.

## Bundled font

| family (measured) | file | weight | license |
|---|---|---|---|
| `Rounded Mgen+ 1mn Term` | `fonts/RoundedMgenPlus1mnTerm-Regular.ttf` | `400` (static, not variable) | OFL-1.1 |
| `Rounded Mgen+ 1mn Term` | `fonts/RoundedMgenPlus1mnTerm-Bold.ttf` | `700` (static, not variable) | OFL-1.1 |

Both faces are shipped, and each declares its **own single weight**. They are two
separate static fonts, converted from the two static faces of the same upstream
distribution, not two instances of
one variable font, so neither may declare a range: a face whose descriptor covers
the requested weight is selected as the real thing by CSS font matching, and a
static regular claiming `100 700` would be picked for bold cells and painted at
regular weight. Because the bold face is real bytes, a consumer that injects both
`@font-face` rules gets true bold rather than the renderer's synthesized one.

`family` is the **measured** name table value, not an assumption — see
"family name" below. Every `weight` above is written out as a single value rather
than being omitted. What an omission would cost differs by which declaration
shape it sits in, and the two rules are stated once, for all packages, in
`font-packages/README.md` — the canonical description of the contract.

See `LICENSE.txt` for the copyright notices and the full license
text, and `fonts/SIL_Open_Font_License_1.1.txt` for the license text exactly as
the distribution ships it.

## Copyright and attribution (three parties)

Rounded Mgen+ is the rounded-corner cut of Mgen+, which fills the glyphs
M+ OUTLINE FONTS does not cover with glyphs from Source Han Sans, so three
parties are credited. **Which source states what is kept separate below**,
because two of the three are named as copyright holders in so many words and the
third is not.

### Copyright holders, quoted verbatim

The bundled TTF's own `name` table, nameID 0 (copyright) — identical in the
Macintosh (platform 1, encoding 0, language 0x0) and Windows (platform 3,
encoding 1, language 0x409) records, and byte-for-byte identical between the two
faces (measured). The conversion rewrites the family and style names but
**carries nameID 0 through byte-identically** (re-measured on the placed files,
#275), so this is still the machine-readable copyright field OFL §2 speaks of,
unchanged from upstream:

```
[Source Han Sans]
Copyright © 2014, 2015 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name 'Source'.

[M+ OUTLINE FONTS]
Copyright(c) 2015 M+ FONTS PROJECT
```

The distribution's own README (`fonts/README_Rounded-MgenPlus.txt`, section
「ライセンスと著作権について」), which ships here unmodified, names the same two
holders in Japanese:

```
・フォントデータに含まれる、源ノ角ゴシック由来の文字グリフの著作権は Adobe が所有しています。
・フォントデータに含まれる、M+ OUTLINE FONTS 由来の文字グリフの著作権は M+ FONTS PROJECT が所有しています。
```

Note the **Reserved Font Name `'Source'`** (OFL §3) in the Adobe line. This
package *is* a modified version, so that clause is squarely in scope — and it is
satisfied, because the name the faces declare (`Rounded Mgen+ 1mn Term`) contains
no reserved name. `'Source'` is the only RFN declared anywhere in this package's
license texts; the measurement is recorded under "Provenance", below. Nothing
derived from this font may be distributed under a name containing `'Source'`.

### The third party: 自家製フォント工房 (Jikasei Font Studio)

Neither the name table nor the README's copyright section carries a verbatim
copyright line for 自家製フォント工房. It is credited here as the **author and
distributor of the composed font** — the work of selecting, merging, fitting and
rounding the two upstream glyph sets into Rounded Mgen+ — which the distribution
states in a *separate* section, 「■ 頒布元」
(`fonts/README_Rounded-MgenPlus.txt`, line 97):

```
自家製フォント工房
http://jikasei.me/
```

Read that as an attribution of authorship and distribution, not as a quoted
copyright notice.

### Licenses, and a note on the links

The font is licensed under the **SIL Open Font License, Version 1.1** (full text
in `LICENSE.txt`, whose OFL body is byte-identical to the distribution's own
copy at `fonts/SIL_Open_Font_License_1.1.txt`). The M+ OUTLINE FONTS licenses
covering the upstream glyphs ship at `fonts/mplus-TESTFLIGHT-059/LICENSE_E` and
`.../LICENSE_J`, under their original archive-internal path so their subject
stays unambiguous.

Project links, for convenience: Rounded Mgen+
<http://jikasei.me/font/rounded-mgenplus/>, Source Han Sans
<https://github.com/adobe-fonts/source-han-sans>, M+ FONTS PROJECT
<http://mplus-fonts.osdn.jp/>. **These are current addresses, not quotations
from the distribution** — its 「■ 改変元」 section cites
`http://mplus-fonts.sourceforge.jp/` and an Adobe store product page
(`http://store1.adobe.com/cfusion/store/html/index.cfm?store=OLS-JP&event=displayFontPackage&code=1967`),
both of which have since moved.

## Scope limitation: it does not work in `editor.fontFamily` / `terminal.integrated.fontFamily`

**A font supplied this way cannot be used by writing the font name
`Rounded Mgen+ 1mn Term` into VS Code's settings (`editor.fontFamily` or
`terminal.integrated.fontFamily`).** This is a common misconception, so it is
worth stating outright — it is also why this extension's displayName /
description say it is "a resource for extension developers, not a font
selectable from ordinary settings such as editor.fontFamily".

- To render with this font, the consuming extension must **inject the
  `@font-face` itself** into its own webview HTML/CSS. That `@font-face`
  definition exists only within the scope of that one webview; it is entirely
  absent from the CSS of VS Code's main window (the editor proper — Monaco — and
  the standard integrated terminal).
- `editor.fontFamily` is a setting for the editor that renders in the main
  window, so an `@font-face` injected for a webview never reaches it. Naming
  such a font behaves exactly like naming a font that does not exist: no error
  is raised, and VS Code silently falls through to the next fallback.
  `terminal.integrated.fontFamily` (VS Code's standard integrated terminal) is
  likewise rendered in the main window and is equally out of reach.
- This mechanism is therefore usable **only when the consuming extension has its
  own webview and implements the borrowing steps itself**. If what you want
  is this font in the editor or the standard terminal, the only way to get it
  there is to install the font into the OS.

## How other extensions use this font (the convention)

**Note:** this is not an official VS Code mechanism for sharing fonts between
extensions. **No such official mechanism exists.** What follows is an unofficial,
homegrown convention, and it assumes the exact shape of this extension's ID and
of the `providedFont` contract field in `package.json`. If this extension later
changes the file layout, the ID, or the contract field, consumers will break
silently.

The contract itself is the `providedFont` field in `package.json`:

```json
"providedFont": {
  "family": "Rounded Mgen+ 1mn Term",
  "file": "fonts/RoundedMgenPlus1mnTerm-Regular.ttf",
  "weight": "400",
  "license": "OFL-1.1",
  "faces": [
    { "file": "fonts/RoundedMgenPlus1mnTerm-Regular.ttf", "weight": "400" },
    { "file": "fonts/RoundedMgenPlus1mnTerm-Bold.ttf", "weight": "700" }
  ]
}
```

`faces` is the full list — one entry per shipped face — and the flat
`file` / `weight` pair beside it is the **shorthand for a single face**, kept
forever so a consumer written before `faces` existed keeps working: it is
byte-identical to the `400` entry (bold then falls back to synthesis, exactly as
before this package shipped one).

**How a consumer reads that — the two declaration shapes, which one wins, the
normalization and degradation rules, and the borrowing steps with code — is
`font-packages/README.md` in the same repository. That file is the single
canonical description of the contract; this section records only what *this*
package declares.** tmux-opener's `src/font-registry.ts` / `getHtml` are a
working implementation of the consumer side.

One caveat specific to this family: `Rounded Mgen+ 1mn Term` **contains**
`Mgen+ 1mn Term` as a substring (as did the pre-conversion names), so a consumer
that decides "which bundled family did the user select" with a plain substring
test will resolve a Rounded selection to the Mgen+ extension. Match
longest-first (tmux-opener's `matchRegisteredFamily` does).

## Provenance (upstream archive → conversion → output)

**The two TTFs this package ships are conversion output, not the upstream bytes.**
Until #275 they were placed byte-for-byte as distributed, and the two-column
sha256 table that rule comes with was the whole proof of provenance: hash the
archive entry, hash the placed file, and the two columns agreeing said "identical
to what upstream published". That proof is not available for a modified file —
the thing it would be compared against is the upstream TTF, which this repository
does not ship. It is replaced by a **three-link chain**, each link measured:
where the input came from, what turned it into the output, and what the output
hashes to. The chain is a different claim, not a cheaper version of the old one:
it records how these bytes were made, and nothing in it can be machine-checked
against upstream.

The accompanying license and README documents are **still placed byte-for-byte**
and keep the two-column rule unchanged — they were never converted.

### 1. Upstream archive (the input)

- **Distribution**: Rounded Mgen+ 1.059.20150602, official archive
  `rounded-mgenplus-20150602.7z`
- **URL**: `https://ftp.iij.ad.jp/pub/osdn.jp/users/8/8598/rounded-mgenplus-20150602.7z`
  (IIJ mirror of OSDN; upstream project page `http://jikasei.me/font/rounded-mgenplus/`)
- **Archive**: 55,829,761 bytes, `Last-Modified: Wed, 03 Jun 2015 14:30:52 GMT`,
  sha256 `ecea6764973d93936238f1c06ed246310bec320f63f350c2bdb7e8d1feee25cc`.
  Size and Last-Modified match the values recorded during triage, so this is the
  same OFL-1.1 release that was triaged there, not a later re-cut. The archive
  itself is **not** committed.
- **Extraction**: this distribution exists only as 7z (the zip is behind
  OneDrive / Google Drive links that are not scriptable), and this host has no
  `7z`/`7za`/`bsdtar`. It was extracted with `py7zr` in a user-local virtualenv
  outside the repository — no `sudo`, no system change, the same PEP 668 pattern
  `CLAUDE.md` already documents for Semgrep:

  ```sh
  python3 -m venv ~/.local/share/py7zr-venv
  ~/.local/share/py7zr-venv/bin/pip install py7zr    # py7zr 1.1.3
  ```

The entry hashes below are the same values `scripts/font-fit/manifest.json`
carries as `srcSha256`, and `run.sh` re-checks every one of them against the
`--src-dir` it is given **before it writes a single byte** — a mixed-up input
fails there rather than producing a plausible-looking output.

| archive entry | sha256 (entry, on extraction) |
|---|---|
| `rounded-mgenplus-1mn-regular.ttf` | `310277eac41dcf5aacd84e52d55237d505a0996cb2163f811268aa3eae646f06` |
| `rounded-mgenplus-1mn-bold.ttf` | `8f9808dababcd01a71bdb3b742260c629af00be2ddcfaa5e03bf3194402a3603` |

### 2. Conversion (what turned input into output)

- **Pipeline**: `scripts/font-fit/run.sh` in this repository, driven by
  `scripts/font-fit/manifest.json` (this package is one entry in it; membership
  of that file is what makes a package a converted one). `fit.py` does the
  refit, `verify.py` gates the result, `dump-widths.mjs` produces the cell-width
  table from `@xterm/addon-unicode11`'s own provider — a hand-written width
  table is forbidden.
- **Which converter, identified by content rather than by commit** — introduced
  by issue **#275**, and pinned by the sha256 of each file that determines the
  output:

  | pipeline file | sha256 |
  |---|---|
  | `scripts/font-fit/fit.py` | `c634881d418a59d68f1892db4d35f4fc66780a71cff277448cbef91479470bf7` |
  | `scripts/font-fit/instance.py` | `86240ac88d1dfa4527ebaa1e7e97caf6c656e97cd04833d12b21149d2fefe2af` |
  | `scripts/font-fit/verify.py` | `5c7d58d6a8ff4e4d248990c4bc39bcf379faee2fec9303ea3966c6ce1c5d9cf5` |
  | `scripts/font-fit/dump-widths.mjs` | `4813198fba79edb3d3086aa07b8808183a362406b1a1da9c7d614c5b90633a03` |
  | `scripts/font-fit/run.sh` | `4966ccca260ded4b1d7aa94fa71bc9802956363e9a646c788166ee530ab8c55a` |
  | `scripts/font-fit/manifest.json` | `0fed27ae2614fd0cbe570cde156bb4ed5ff32fe7a0a7c814b97d71acaf49629b` |

  **Why not a commit SHA.** The first draft of this section recorded one, and it
  was false within the same PR: the converter was then changed (a bold face was
  flagging itself Regular), the output moved, and the recorded SHA still pointed
  at the older converter — checking it out and re-running produced a *different*
  hash than the one recorded three lines below. That is not a slip that better
  care avoids: a git SHA is content-addressed, so **a file cannot name the commit
  that contains it**. Recording one means either splitting the TTFs, the
  `checksums.json` record and this table across two commits — the one coupling
  R13 exists to prevent — or leaving a placeholder for someone to substitute,
  which ships silently when they forget. Hashing the scripts has neither problem:
  the values are knowable while writing, they survive rebases and rewrites, and
  they identify the converter *directly* instead of via a commit that also
  carries unrelated changes. `run.sh` additionally appends `-dirty` to the commit
  it prints when the working tree differs from `HEAD`, so a provenance line
  generated from uncommitted edits can no longer be mistaken for one generated
  from a clean checkout.
- **Measured tool versions** (printed by `run.sh` at the start of the run, not
  copied from documentation):

  | tool | version |
  |---|---|
  | fontTools | `4.63.0` |
  | Python | `3.14.4` |
  | `@xterm/addon-unicode11` | `0.10.0-beta.288` |

- **Fixed environment**: `PYTHONHASHSEED=0`, `LC_ALL=C.UTF-8`, and fontTools
  saved with `recalcTimestamp=False` (a recalculated `head.modified` would make
  every run produce different bytes and the output hashes below meaningless).
- **The `fitRatio` the run was driven by**: **1.15** (`manifest.json`'s
  top-level default; this package declares no override). Ink wider than
  `A × 1.15` — 588.8 units of the 512-unit cell — is scaled down to it; wider ink
  is what "scaled" counts below. The value's meaning and its 1.5 ceiling are
  defined in `scripts/font-fit/manifest.json`'s `note` and not restated here.
- **The `vstretch` the run was driven by**: **1.3** (`manifest.json`'s top-level
  default; this package declares no override), with the vertical limit **measured
  from each face** rather than declared — the **top and bottom edges** of 漢
  (U+6F22), `y = −75…843` in the Regular face and `−89…847` in the Bold, as
  `run.sh` printed them. The clamp bound the stretch on **301 of the 1000**
  refitted glyphs in the Regular face and **287 of 1019** in the Bold; of those,
  132 and 123 respectively had no room left at equal scaling and were left
  **completely unmoved** (the clamp's floor is 1.0). So the glyphs that
  actually grew taller are **868 of 1000** and **896 of 1019** — the vertical
  change is not universal, and the counts are the honest way to say so. Of the
  refitted glyphs, **131** (Regular) / **123** (Bold) already reached outside the
  漢 box at equal scaling, and **none** of either face reaches outside it that
  did not already (measured on the shipped bytes against a `vstretch = 1.0` bake
  of the same upstream). The
  horizontal side is untouched by this: `hmtx` is byte-identical to the pre-#293
  release across all 18,105 (Regular) / 18,107 (Bold) glyphs (measured), and the
  widest in-scope ink is unchanged at 588.
- **What the run changed**, per face — measured, and reported by `run.sh`:

  | face | glyphs refitted | of which moved only / scaled | already fitting |
  |---|---|---|---|
  | Regular | 1000 | 262 / 738 | 1346 |
  | Bold | 1019 | 239 / 780 | 1329 |

  "Moved only" grew and "scaled" shrank against the 0.96-ratio release: at 1.15
  the room is wider than the cell, so a glyph whose ink already fits within
  588.8 is re-centred at its original size rather than shrunk.

- **All three gates passed on both faces** (`verify.py`, run against the upstream file
  the converter actually read, at the declared ratio and stretch): **contract ① — in-scope
  code points outside the declared band (ink ≤ `A × 1.15`, centred when it
  overhangs, advance `== A`): 0**, with the widest in-scope ink landing on the
  declared room exactly (both faces 1024 → 588); **contract ② — body glyphs whose
  outlines changed: 0 of 13,101**; **contract ③ — refitted glyphs whose top and
  bottom edges differ from what the declared `vstretch` and the measured wall
  (this face's own 漢 y reach) imply: 0 of
  1000 (Regular) and 0 of 1019 (Bold)**, checked as an equality in both
  directions, so bytes baked at a different stretch would fail whichever way they
  differed — and the half of that gate which recomputes no formula (③c) reports
  **0 glyphs newly outside the wall** on both faces. *In-scope* is load-bearing rather than a
  hedge: the pipeline
  deliberately excludes ASCII / Latin-1, the BMP private use area, box drawing
  and block elements, and everything not width 1 (`font-packages/README.md`,
  "Terminal width conventions"), so a Latin-1 glyph overhanging its advance is
  outside this count by design.
- The family and style names in the `name` table are rewritten
  (`Rounded Mgen+ 1mn` → `Rounded Mgen+ 1mn Term`); **nameID 0, the copyright
  field, is carried through byte-identically** (re-measured on the output, quoted
  above).
- **Reproducibility, as measured, not as promised**: re-running the pipeline on
  the same machine, from the same input, with the tool versions above, produced
  byte-identical output — the sha256s below. Nothing is claimed about a
  *different* fontTools or Python: that was not tested, and neither was the
  effect of environment variables beyond the three fixed above.

### 3. Output (what is shipped)

Measured on the placed files, and recorded in `scripts/font-fit/checksums.json`
as the same values — from #276 `npm test` compares the two, so a TTF and its
record can only move together. Since #291 the record carries the `fitRatio`
beside each sha256 and since #293 the `vstretch` as well, and `npm test` compares
both against the manifest too.

| placed at | sha256 (placed) | fitRatio | vstretch |
|---|---|---|---|
| `fonts/RoundedMgenPlus1mnTerm-Regular.ttf` | `33d91acae4b4332b9ca03e69d180ae2fb5cda61f861f2f773ed0f6f5c7e605ea` | `1.15` | `1.3` |
| `fonts/RoundedMgenPlus1mnTerm-Bold.ttf` | `b003c0af1c2d382d5fbf2c7f0db2c75042a44adbd3e097f56a8a54936bab5874` | `1.15` | `1.3` |

### Reserved Font Name check (measured)

OFL 1.1 §3 forbids a Modified Version from carrying a Reserved Font Name, so a
converted package must establish which names are reserved **before** choosing
its own. Measured over every license text this package ships:

> **Superseded (#288).** This `grep` is **no longer the procedure**. Run
> `scripts/font-fit/check-license.py` instead — the steps are in
> `font-packages/README.md` ("Reserved Font Name check"). The command below
> **cannot reach the `name` table**, where a package can declare a reserved name
> that appears in no file at all (measured on Source Han Code JP, #285); it is
> also blind to license documents that are not UTF-8. The table below is kept as
> the **record this grep produced**, not as instructions: it predates the
> `name`-table stage, so any `fonts/*.ttf#0:nameID N` row the tool reports is
> missing from it. Adding those rows is #289's work.

```sh
grep -rniI 'reserved font name' \
  font-packages/font-rounded-mgenplus-1mn/LICENSE.txt \
  font-packages/font-rounded-mgenplus-1mn/fonts/
```

**Two flags and the path list are all load-bearing**, and each of them was got
wrong once in #275:

- **`-i`** — OFL prose writes the phrase title-case (`Reserved Font Name`) but a
  section heading may shout it, and a case-sensitive grep silently drops those
  lines. That is how the first version of this table came to omit
  `LICENSE.txt:63`, the very line stating this package's conclusion.
- **The path list, not `--include='*.txt'`** — the M+ license documents this font
  derives from ship as `LICENSE_E` / `LICENSE_J`, **with no extension**, so a
  `*.txt` filter reads right past them while the prose above claims to have
  searched every license text. Naming `LICENSE.txt` plus the whole `fonts/`
  directory covers them. (They contain no reserved font name — measured, 0 hits
  each — so the verdict was never in doubt; the search that produced it was.)
- **`-I`** — `fonts/` also holds the TTFs, and without it grep reports
  `Binary file … matches` and clutters a table that is supposed to be
  reproducible line for line.

A verdict is only as good as the search that produced it, so the command is
written down and the table below lists **every** line it returns, not just the
interesting ones:

| file:line | declares |
|---|---|
| `LICENSE.txt:33` | *no name* — a forward reference to the note at `:63` |
| `LICENSE.txt:52` | `'Source'` (Adobe, in the quoted Source Han Sans copyright line) |
| `LICENSE.txt:63` | `'Source'` — this package's own RESERVED FONT NAME note, restating the line above |
| `LICENSE.txt:66` | *no name* — the same note's prose |
| `LICENSE.txt:68` | *no name* — the same note naming the files it searched |
| `LICENSE.txt:149` | *no name* — the OFL definition clause itself |
| `fonts/SIL_Open_Font_License_1.1.txt:31` | *no name* — the same definition clause |
| `fonts/mplus-TESTFLIGHT-059/LICENSE_E` | *no hits* — searched, nothing to declare |
| `fonts/mplus-TESTFLIGHT-059/LICENSE_J` | *no hits* — searched, nothing to declare |
| `fonts/README_Rounded-MgenPlus.txt` | *no hits* — searched, nothing to declare |

**The `name`-table rows the `grep` could not reach (#289, measured with
`scripts/font-fit/check-license.py`).** These are not corrections to the table
above — the name they declare is the one it already records — they are evidence
the text-only procedure was structurally blind to, added here because the
superseded note above says they were missing:

| source | declares |
|---|---|
| `fonts/RoundedMgenPlus1mnTerm-Regular.ttf#0:nameID 0` | `'Source'` (plus the over-captures `'M+ OUTLINE FONTS'` / `'OUTLINE'` off the same line) |
| `fonts/RoundedMgenPlus1mnTerm-Bold.ttf#0:nameID 0` | `'Source'` (same line, same over-captures) |

The tool's own verdict on the shipped bytes, verbatim:
`'Rounded Mgen+ 1mn Term': どの予約名も含まない → OK （照合した予約名 7 件）`, exit 0.
Its text hit lines carry **different line numbers** from the table above because
`LICENSE.txt` has been rewritten since that `grep` was run; the table stays as
the record of what that command returned, which is what it is for.

**`'Source'` is the only Reserved Font Name declared here**, and neither
`Rounded` nor `Mgen+` nor `1mn` nor `Term` contains it, so
`Rounded Mgen+ 1mn Term` is a permitted name for this modified version. (For
contrast, `font-plemoljp-console` declares `"PlemolJP"` as reserved — which is
one reason that package is not converted at all.)

### Accompanying documents (byte-for-byte, two-column rule)

Both columns are measured, in that order: the left one comes off the extracted
file in a scratchpad directory **before** anything was copied into the
repository, the right one off the committed file afterwards. The rule — and why
a single self-referential column would verify nothing — is stated once for every
package in `font-packages/README.md`.

| archive entry | sha256 (entry, on extraction) | placed at | sha256 (placed) |
|---|---|---|---|
| `SIL_Open_Font_License_1.1.txt` | `697383c6addd5dd14d7e1ff053aaa44520ce86a58589eef1f9985ab66e08db08` | `fonts/SIL_Open_Font_License_1.1.txt` | `697383c6addd5dd14d7e1ff053aaa44520ce86a58589eef1f9985ab66e08db08` |
| `README_Rounded-MgenPlus.txt` | `77539662070b60c747ea39b4de7439726ebcf0a285656c77ac8fd8e6b7aed224` | `fonts/README_Rounded-MgenPlus.txt` | `77539662070b60c747ea39b4de7439726ebcf0a285656c77ac8fd8e6b7aed224` |
| `mplus-TESTFLIGHT-059/LICENSE_E` | `2d499d752eca1988766eeca70d4145fd94793579924702629181d0ed63dd51a7` | `fonts/mplus-TESTFLIGHT-059/LICENSE_E` | `2d499d752eca1988766eeca70d4145fd94793579924702629181d0ed63dd51a7` |
| `mplus-TESTFLIGHT-059/LICENSE_J` | `66b4cd071d8b2e8a69db344604c00aec7e81192dd9c0c9657979b142310cc3ab` | `fonts/mplus-TESTFLIGHT-059/LICENSE_J` | `66b4cd071d8b2e8a69db344604c00aec7e81192dd9c0c9657979b142310cc3ab` |

They ship at their original archive-internal
paths: the OFL 1.1 text that covers Rounded Mgen+ itself, the distribution's own
`README_Rounded-MgenPlus.txt` (which states the version and what the font is
composed of), and the upstream M+ OUTLINE FONTS licenses that Rounded Mgen+
derives from, kept under their `mplus-TESTFLIGHT-059/` directory rather than
flattened, so their subject stays unambiguous. The OFL text and the two M+
license files are byte-identical to the ones in the Mgen+ archive (same
sha256), which is expected: both distributions ship the same upstream texts.
They describe the **upstream** font; this README is where the modification is
described.

## family name (measured, not assumed)

Re-measured in #275 **on the converted files**, since those are what ships: the
conversion rewrites the `name` table, so a family string carried over from the
pre-conversion measurement would have been a claim about bytes this package no
longer contains. Read from the `name` table directly (nameID 1 / 2 / 4 / 6, and
nameID 16 / 17 where present) — every face this package ships is measured:

| field | `RoundedMgenPlus1mnTerm-Regular.ttf` | `RoundedMgenPlus1mnTerm-Bold.ttf` |
|---|---|---|
| nameID 1 (family) | `Rounded Mgen+ 1mn Term` | `Rounded Mgen+ 1mn Term` |
| nameID 16 (typographic family) | `Rounded Mgen+ 1mn Term` | `Rounded Mgen+ 1mn Term` |
| nameID 2 / 17 (subfamily) | `Regular` | `Bold` |
| nameID 4 (full name) | `Rounded Mgen+ 1mn Term Regular` | `Rounded Mgen+ 1mn Term Bold` |
| nameID 6 (PostScript) | `RoundedMgenPlus1mnTerm-Regular` | `RoundedMgenPlus1mnTerm-Bold` |
| `OS/2.usWeightClass` | `400` | `700` |
| `fvar` | absent (static) | absent (static) |

nameID 16 is the typographic family and it is identical across the two faces —
upstream designed them as one family and the conversion preserves that, which is
what makes pairing them under a single CSS `font-family` legitimate (and their
metrics agreement, below, an expected property rather than a coincidence). **The
injection does not depend on it** — `@font-face` *declares* a family name rather
than reading one, and CSS font matching never consults a file's internal names;
`font-packages/README.md` states that mechanism in full. This table is evidence
about the fonts, not about the mechanism.

`Rounded Mgen+ 1mn Term` is the value this extension's `providedFont.family`
carries, and it must stay identical to the consumer-side registry entry
(tmux-opener's `FONT_REGISTRY`). Note it **contains** `Mgen+ 1mn Term` as a
substring — which is exactly the collision the longest-match family matcher
exists to resolve; a plain substring match would resolve a user's
`Rounded Mgen+ 1mn Term` selection to the Mgen+ registry entry.

Note for consumers: the pre-conversion name `Rounded Mgen+ 1mn` is **not** what
these files declare any more. tmux-opener keeps it working by registering it as
an alias and injecting an alias-named `@font-face` over the same files, so an
existing `settings.json` renders with the converted bytes; that is a
consumer-side compatibility layer, not a property of this package. It also makes
the containment chain four names long, which is why the matcher's longest-first
rule is pinned by a property test rather than by a list of cases.

A note on fontconfig, which the pre-#275 version of this table was taken from:
`fc-scan` reports `spacing` as `dual` (90), not `mono` (100), for these faces —
normal for a CJK font, and precisely why fontconfig's `spacing` is not the
monospace evidence. The evidence is `test/font-metrics.test.js`, below.

## Monospace metrics (measured)

`npm test` in the repository root (`test/font-metrics.test.js`) covers **each TTF
in this package** — it globs them, so the bold face is asserted on every run too:

- unitsPerEm 1024; every ASCII printable codepoint 0x21–0x7E is present in
  cmap and shares one advance **A = 512**.
- The fullwidth samples 一 / 漢 / あ / ん / ア each advance **1024 = 2A**.

Both faces meet this with the *same* numbers, which is the property a terminal
needs: bold cells advance exactly as regular ones do, so switching weight cannot
shift a column. The equality is a fact about the TTFs' `hmtx` tables (the default
instance), not about any one renderer, and it is asserted per file rather than
inferred from the regular face alone.

**These particular numbers are unchanged by the conversion — but plenty of other
advances are not**, and the distinction is worth stating exactly, because a
looser version of this sentence shipped in #275 claiming the conversion never
touches an advance at all, which is false:

- **A width-1 code point's advance is set to the cell width**, deliberately, and
  for nearly all of them that is a change. That is half the
  point of the refit: upstream draws nearly all of these at the full-width
  advance 1024, and the conversion sets them to the cell width. Measured on the shipped files
  against the upstream ones, **997 glyphs in the regular face and 1016 in the
  bold** went 1024 → 512, and 1024 → 512 is the *only* transition either file
  contains. Both numbers were **re-measured on the #291 bytes and are unchanged**
  — `fitRatio` moves ink, never advances, so the `hmtx` **advances** are
  byte-identical to the 0.96-ratio release. The `hmtx` table as a whole is not:
  each entry is `(advanceWidth, lsb)`, and moving a refitted glyph's ink moves
  its `lsb`, so against that release **864 entries in the regular face and 930 in
  the bold differ while 0 advances do** (measured with fontTools, #292).
- **A body glyph's advance is not changed**, and neither is its outline — that
  is contract ② in "Provenance", verified glyph by glyph.
- **The cell grid does not move**: A stays 512 and full-width glyphs stay 1024,
  which is why the numbers in this section still hold and why converted text
  sets in the same columns.

Conflating the second and third points with "no advance changed" is the mistake
that produced the false sentence. Contract ② is about the glyphs the refit did
*not* select; a selected glyph changes in outline, and in advance too whenever
upstream drew it full-width — which is nearly always, but not always. Measured:
**1000 glyphs were refitted in the regular face and 997 of those changed advance
(1019 and 1016 in the bold)**; the 3 per face left over — `↑ U+2191`, `↓ U+2193`
and `↕ U+2195` — are glyphs upstream already drew one column wide, so the refit
re-centred their ink and left the advance where it was.

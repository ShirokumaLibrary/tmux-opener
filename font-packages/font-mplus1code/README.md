# M PLUS 1 Code Term (font resource for extensions)

*[日本語](README.ja.md)*

Extension ID: `shirokuma-library.font-mplus1code`

A general-purpose font resource extension that **supplies the M PLUS 1 Code Term
font to other extensions**. It has no UI and no commands of its own
(`contributes` is empty, `activationEvents` is empty, and `main` is a no-op),
and it **does not install the font into the OS**. Its sole purpose is to let a
consuming extension load the bundled TTF from its own webview via
`vscode-resource`.

**M PLUS 1 Code Term is a modified version of M PLUS 1 Code**, refitted for
terminal use: the symbols a terminal counts as one column wide are brought under
the width at which a renderer squashes them sideways. Ink wider than **1.15
cells** is scaled down to exactly that width, and
any ink that reaches past its cell is centred on the cell, so the overhang is the
same on both sides and never exceeds 38 units of a 500-unit cell (measured; the
ratio puts it at 37.5 and integer rounding accounts for the rest — about 7.6%).
**A symbol may therefore touch its neighbour slightly**; what it never does is
reach the squashing threshold. Advance widths are not part of that: the cell grid
does not move, and this file's `hmtx` — every advance and every left side
bearing, all 6,747 glyphs — is byte-identical to the #291 release that
preceded this one (measured). The ratio itself — what it
means, its 1.5 ceiling and why 1.15 — is defined once, in
`scripts/font-fit/manifest.json`'s `note`.

**The two axes are scaled by different factors** (since #293): the refit takes
the height to `s × 1.3`, where the face allows it, and the width to `s`. The reason was measured
on the Mgen+ families, where the horizontal refit actually shrinks glyphs —
scaling `①` to the cell width took its height below that face's cap height, so
the symbol read as small because it was short. This face is barely scaled at all
(see "Provenance"), so here the stretch makes the few touched glyphs taller
without having made them narrower first. The growth is clamped, per glyph, against a
limit **measured out of this face** — the **top and bottom edges** of its own 漢
(U+6F22): `y = −77..824` in the Regular face, `−93..827` in the Bold — and each
glyph's stretch is capped so the stretched glyph stays inside them. **What is
bounded is the glyph's reach, not its height**: the conversion keeps each glyph's
vertical centre, so capping the height alone would still let a glyph whose centre
sits off the kanji's push past the line. The statement that is true of these
bytes is therefore a **conditional** one: the refit never pushes a glyph past
that kanji's top or bottom, and a glyph already past it at equal scaling keeps
the previous release's shape, unchanged to the unit (measured: **0** glyphs of
either face newly reach outside). It is *not* claimed that nothing here reaches
further above or below the line than 漢 — this face draws symbols taller than 漢
to begin with, and **27 of the 46** refitted glyphs in the Regular face are
outside its box at equal scaling already. That clamp has a floor of
1.0, so **not every refitted glyph gets taller**: measured on the shipped bytes,
**19 of the 46** refitted glyphs grew in the Regular face and **25 of 67** in the
Bold; the rest had no room left at equal scaling and did not move a unit.
`1.3` is a *chosen* value, arrived at by looking at five bakes — not derived from
the cap-height ratio it happens to sit near. Its meaning, its measured limit and
the current default are defined in the same `note`. ASCII and Latin-1 are out of scope — a renderer
does not rescale those, and refitting them would rework the body text — as are
box drawing, block elements and private use; the exact scope is stated in
`font-packages/README.md`, and this package ships a measured instance of it
(`î` / `ï` in the bold face, under "Provenance"). Nothing else about the
outlines was touched. The full
chain — where the input came from, what did the converting, and the hash of what
came out — is in "Provenance", below.

## Bundled font

| family (measured) | file | weight | license |
|---|---|---|---|
| `M PLUS 1 Code Term` | `fonts/MPLUS1CodeTerm-Regular.ttf` | `400` (static, not variable) | OFL-1.1 |
| `M PLUS 1 Code Term` | `fonts/MPLUS1CodeTerm-Bold.ttf` | `700` (static, not variable) | OFL-1.1 |

**Two static faces, where this package used to ship one variable file.** That is
not a packaging preference: editing a variable font's outlines corrupts its
`gvar` deltas, so the conversion has to pin an instance first. It pins two — 400
and 700 — and refits each, which is why the contract now declares two faces with
single-value weights instead of one face claiming the `100 700` axis. A static
face declaring a range is the bold-suppression trap `font-packages/README.md`
describes: CSS font matching would pick the regular face as a genuine covering
face for bold cells and paint them at regular weight. The upside of the split is
that bold is now real bytes rather than a synthesized approximation.

See `fonts/OFL.txt` for the full license text.

## Scope limitation: it does not work in `editor.fontFamily` / `terminal.integrated.fontFamily`

**A font supplied this way cannot be used by writing the font name
`M PLUS 1 Code Term` into VS Code's settings (`editor.fontFamily` or
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
  own webview and implements the borrowing steps (`getExtension` →
  `localResourceRoots` → `asWebviewUri` → `@font-face`) itself**. tmux-opener is
  exactly this case (by design it does not use VS Code's standard Terminal
  panel; it hosts xterm.js in its own webview), so it can use this font. But for
  the ordinary use case — wanting this font in the editor or the standard
  terminal — it does not work, and the only way to get it there is to install
  the font into the OS.

## How other extensions use this font (the convention)

**Note:** this is not an official VS Code mechanism for sharing fonts between
extensions. **No such official mechanism exists.** It is an unofficial,
homegrown convention, and it assumes the exact shape of this extension's ID and
of the `providedFont` contract field in `package.json`. If this extension later
changes the file layout, the ID, or the contract field, consumers will break
silently.

**The contract specification — both declaration shapes, the reader's
normalization rules, the degradation rules and the consumer steps with code — is
`font-packages/README.md` in the same repository. That file is the single
canonical description; this section only records what *this* package declares.**

This extension's `providedFont`:

```json
"providedFont": {
  "family": "M PLUS 1 Code Term",
  "file": "fonts/MPLUS1CodeTerm-Regular.ttf",
  "weight": "400",
  "faces": [
    { "file": "fonts/MPLUS1CodeTerm-Regular.ttf", "weight": "400" },
    { "file": "fonts/MPLUS1CodeTerm-Bold.ttf", "weight": "700" }
  ],
  "license": "OFL-1.1"
}
```

`faces` lists every face of the family, in declaration order; a consumer that
reads it injects one `@font-face` per entry. The flat `file` / `weight` pair
beside it is the **shorthand for the single 400 face** and stays byte-equal to
that entry, so a consumer written against the older one-file contract keeps
working unchanged.

Each weight is a **single value, never a range**, because these are static
faces. Until #275 this package declared `"weight": "100 700"` with no `faces`
array, and that was a *true* statement then: it shipped one **variable** file
whose fvar `wght` axis really was 100–700, so one file covered both cell weights
with real glyphs. The conversion instances that axis away (see "Bundled font"),
so the range would now be a claim about an axis these files no longer have — the
bold-suppression trap. The two static Mgen+ packages in the same directory have
always declared a face each, for the same reason.

Consumers of this extension must handle
`vscode.extensions.getExtension('shirokuma-library.font-mplus1code')` returning
`undefined`: this is a **soft** dependency (use it if present), so use a runtime
check plus a fallback and **do not** put it in `package.json`'s
`extensionDependencies`. tmux-opener itself then renders with the OS's standard
monospace, injecting no `@font-face` at all, and — only when this font is the
selected one — shows a one-time notification prompting installation
(`src/font-registry.ts`). Its `src/font-registry.ts` and `getHtml`
(`src/extension.ts`) are a working implementation of the consumer side.

## Provenance (upstream archive → conversion → output)

**The two TTFs this package ships are conversion output, not the upstream bytes.**
Until #275 it shipped one unmodified variable TTF. A modified file cannot be
proved by the two-column sha256 rule the unmodified packages use — the thing it
would be compared against is the upstream TTF, which this repository does not
ship — so provenance is a **three-link chain**, each link measured: where the
input came from, what turned it into the output, and what the output hashes to.
The chain is a different claim, not a cheaper version of the old one: it records
how these bytes were made, and nothing in it can be machine-checked against
upstream.

### 1. Upstream (the input)

**This is the one weak link, and it is recorded as weak rather than guessed.**
This package predates the two-column provenance rule (#174), so **no upstream
archive URL or archive sha256 was ever recorded for it**, and no such value is
written here: an invented one would look exactly like a measured one.
`scripts/font-fit/manifest.json` says the same thing in its `unrecorded` field
for this package, deliberately leaving `upstream.url` and `upstream.archiveSha256`
as `null`. Whoever next re-fetches the archive should measure both and fill them
in on both sides.

What *is* measured is the input file itself — the unmodified `MPLUS1Code.ttf`
this package shipped up to #275, hashed as it stood in the repository. That is
the value `manifest.json` carries as `srcSha256`, and `run.sh` re-checks it
against the `--src-dir` it is given **before it writes a single byte**.

| conversion input | sha256 |
|---|---|
| `MPLUS1Code.ttf` (the pre-#275 bundled file) | `ff68678c5bd7e9d9d6ab6d57e4355aabe30f6b8f8bff9bd59baf6a7807dcfd36` |

Upstream project: M PLUS FONTS <https://github.com/coz-m/MPLUS_FONTS>. The
license text bundled at `fonts/OFL.txt` names the copyright holder as
`Copyright 2021 The M+ FONTS Project Authors` (line 1), and `LICENSE.txt` at the
package root is byte-identical to it.

### 2. Conversion (what turned input into output)

- **Pipeline**: `scripts/font-fit/run.sh` in this repository, driven by
  `scripts/font-fit/manifest.json` (this package is one entry in it; membership
  of that file is what makes a package a converted one). `instance.py` pins the
  variable axis, `fit.py` does the refit, `verify.py` gates the result, and
  `dump-widths.mjs` produces the cell-width table from
  `@xterm/addon-unicode11`'s own provider — a hand-written width table is
  forbidden. **The order is fixed**: instance first, refit second. Refitting a
  variable font's outlines would corrupt its `gvar` deltas.
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
  was false within the same PR — and *this* package is where it broke visibly:
  `fit.py` gained the style-bit fix below, this package's Bold output changed
  hash, and the recorded SHA still pointed at the converter from before the fix,
  so checking it out and re-running produced a different hash than the one
  recorded three lines below. That is not a slip that better care avoids: a git
  SHA is content-addressed, so **a file cannot name the commit that contains
  it**. Recording one means either splitting the TTFs, the `checksums.json`
  record and this table across two commits — the one coupling R13 exists to
  prevent — or leaving a placeholder for someone to substitute, which ships
  silently when they forget. Hashing the scripts has neither problem: the values
  are knowable while writing, they survive rebases and rewrites, and they
  identify the converter *directly* instead of via a commit that also carries
  unrelated changes. `run.sh` additionally appends `-dirty` to the commit it
  prints when the working tree differs from `HEAD`, so a provenance line
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
- **What the run changed**, per face — measured, and reported by `run.sh`. The
  source axis is `wght: (100.0, 400.0, 700.0)`, pinned per output face:

  | output face | instanced at | glyphs refitted | of which moved only / scaled | already fitting |
  |---|---|---|---|---|
  | Regular | `wght=400` | 46 | 46 / 0 | 295 |
  | Bold | `wght=700` | 67 | 61 / 6 | 274 |

  Two orders of magnitude fewer than the Mgen+ families, and that is the point of
  the design brief: this face's ambiguous-width symbols were mostly correct
  already, and only the overflowing ones were touched. At `fitRatio` 1.15 the
  Regular face is scaled **not at all** — measured: its widest in-scope ink is
  555 units against a room of 575, so every refitted glyph there is a re-centring
  and nothing more.
- **The `fitRatio` the run was driven by**: **1.15** (`manifest.json`'s
  top-level default; this package declares no override). Ink wider than
  `A × 1.15` — 575 units of the 500-unit cell — is scaled down to it. The value's
  meaning and its 1.5 ceiling are defined in `scripts/font-fit/manifest.json`'s
  `note` and not restated here.
- **The `vstretch` the run was driven by**: **1.3** (`manifest.json`'s top-level
  default; this package declares no override), with the vertical limit **measured
  from each face** rather than declared — the **top and bottom edges** of 漢
  (U+6F22), `y = −77…824` in the Regular face and `−93…827` in the Bold,
  as `run.sh` printed them. The clamp bound the stretch on **46 of
  the 46** refitted glyphs in the Regular face and **67 of 67** in the Bold; of
  those, 27 and 42 respectively had no room left at equal
  scaling and were left **completely unmoved** (the clamp's floor is 1.0). So the
  glyphs that actually grew taller are **19 of 46** and **25 of 67** — the
  vertical change is not universal, and the counts are the honest way to say so.
  Of the refitted glyphs, **27** (Regular) / **42** (Bold) already reached
  outside the 漢 box at equal scaling, and **none** of either face reaches
  outside it that did not already (measured on the shipped bytes against a
  `vstretch = 1.0` bake of the same instanced input).
  The horizontal side is untouched by this: `hmtx` is byte-identical to the
  pre-#293 release across all 6,747 glyphs (measured), and the widest in-scope
  ink is unchanged at 555 / 575.
- **All three gates passed on both faces** (`verify.py`, run against the instanced
  file the converter actually read, at the declared ratio and stretch):
  **contract ① —
  in-scope code points outside the declared band (ink ≤ `A × 1.15`, centred when
  it overhangs, advance `== A`): 0**, with the widest in-scope ink at Regular
  555 → 555 (nothing to scale: already inside the room) and Bold 650 → 575 (the
  declared room exactly); **contract ② — body glyphs whose outlines changed:
  0 of 5,567**; **contract ③ — refitted glyphs whose top and bottom edges differ
  from what the declared `vstretch` and the measured wall (this face's own 漢 y
  reach) imply: 0 of 46 (Regular)
  and 0 of 67 (Bold)**, checked as an equality in both directions, so bytes baked
  at a different stretch would fail whichever way they differed — and the half of
  that gate which recomputes no formula (③c) reports **0 glyphs newly outside the
  wall** on both faces.
  *In-scope* is load-bearing rather than a hedge: the pipeline
  deliberately excludes ASCII / Latin-1, the BMP private use area, box drawing
  and block elements, and everything not width 1 (`font-packages/README.md`,
  "Terminal width conventions"). This package ships the measured instance of
  that: in `fonts/MPLUS1CodeTerm-Bold.ttf` (`A` = 500) `î` (U+00EE) advances 500
  with ink `74 … 524` and `ï` (U+00EF) `74 … 509` — width 1, outside the cell,
  and correctly untouched.
- The family and style names in the `name` table are rewritten
  (`M PLUS 1 Code` → `M PLUS 1 Code Term`); **nameID 0, the copyright field, is
  carried through byte-identically** (re-measured on the output):
  `Copyright 2021 The M+ FONTS Project Authors (https://github.com/coz-m/MPLUS_FONTS)`.
  The **style bits move with the names**: `OS/2.fsSelection` bit 5 (BOLD) and
  bit 6 (REGULAR), and `head.macStyle` bit 0, are derived from the style rather
  than inherited. That matters only on this package, and only because it is the
  variable one: `instantiateVariableFont` updates `usWeightClass` but not the
  bits, so the default (Regular) instance's bits would otherwise ride into the
  Bold face and the file would name itself `Bold` while flagging itself Regular.
  Measured on the output: Regular `fsSelection=0x00C0` / `macStyle=0x0000`,
  Bold `fsSelection=0x00A0` / `macStyle=0x0001` — bit 7 (USE_TYPO_METRICS) is
  preserved in both, because the fix sets and clears individual bits rather than
  assigning the field.
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
| `fonts/MPLUS1CodeTerm-Regular.ttf` | `63c80ed65c2a9eff8a80d54cf918aa2cbf68a06f6f23dc04d0a04ed401521ebf` | `1.15` | `1.3` |
| `fonts/MPLUS1CodeTerm-Bold.ttf` | `06f4fd340d71a39f44dc516f03968fd40608f4d300d9594269cc7ec7b4474f0f` | `1.15` | `1.3` |

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
  font-packages/font-mplus1code/LICENSE.txt \
  font-packages/font-mplus1code/fonts/
```

**The flags and the path list are load-bearing**, and this package is the one
where it matters most, because **"no hits" is the answer it relies on** — a
search must not be able to produce that answer by accident. `-i` keeps a line
that shouts the phrase from being skipped; naming `fonts/` rather than filtering
`--include='*.txt'` keeps an extensionless license document from being read past
(this package has none, but its sibling packages do, and the command should not
differ between them for no reason); `-I` keeps the TTFs from being reported as
matching binaries. The table lists **every** line the search returns:

| file:line | declares |
|---|---|
| `LICENSE.txt:33` | *no name* — the OFL definition clause itself |
| `fonts/OFL.txt:33` | *no name* — the same clause (the two files are byte-identical) |

**The `name`-table stage adds no row here (#289, measured with
`scripts/font-fit/check-license.py`).** The superseded note above says any
`fonts/*.ttf#0:nameID N` row the tool reports is missing from this table; the
tool reports **none** — the two shipped faces' `name` table declares no reserved
name either, so the answer this package relies on is now backed by the stage a
`grep` cannot reach as well as by the two lines above. Because the total is zero,
the tool's OK is **vacuously true** and it says so, exiting **4** rather than 0
and printing the verdict as
`'M PLUS 1 Code Term': どの予約名も含まない → OK **（照合した予約名 0 件——この OK は空虚に真）**`.
That distinction is the point of the exit code: a pass measured against nothing
must not look like a pass measured against four names. It is legitimate here, and
`--allow-zero-reserved` is how one says so explicitly.

**No Reserved Font Name is declared anywhere in this package.** The copyright
line (`LICENSE.txt:1`) carries no `with Reserved Font Name …` clause, which is
the position §3 attaches one to. `M PLUS 1 Code Term` is therefore unconstrained
by §3 — the check found nothing to avoid, which is a *result*, not a reason to
skip the check next time. (For contrast, `font-plemoljp-console` declares
`"PlemolJP"` as reserved — which is one reason that package is not converted at
all.)

## family name (measured, not assumed)

Measured on the converted files — the ones that ship. Read from the `name` table
directly:

| field | `MPLUS1CodeTerm-Regular.ttf` | `MPLUS1CodeTerm-Bold.ttf` |
|---|---|---|
| nameID 1 (family) | `M PLUS 1 Code Term` | `M PLUS 1 Code Term` |
| nameID 2 (subfamily) | `Regular` | `Bold` |
| nameID 4 (full name) | `M PLUS 1 Code Term Regular` | `M PLUS 1 Code Term Bold` |
| nameID 6 (PostScript) | `MPLUS1CodeTerm-Regular` | `MPLUS1CodeTerm-Bold` |
| `OS/2.usWeightClass` | `400` | `700` |
| `fvar` | absent (static) | absent (static) |

Neither face carries a nameID 16 / 17 pair; nameID 1 is the family, and it is
identical across the two, which is what makes pairing them under a single CSS
`font-family` legitimate. **The injection does not depend on it** — `@font-face`
*declares* a family name rather than reading one, and CSS font matching never
consults a file's internal names; `font-packages/README.md` states that
mechanism in full. This table is evidence about the fonts, not about the
mechanism.

`M PLUS 1 Code Term` is the value this extension's `providedFont.family` carries,
and it must stay identical to the consumer-side registry entry (tmux-opener's
`FONT_REGISTRY`).

Note for consumers: the pre-conversion name `M PLUS 1 Code` is **not** what these
files declare any more. tmux-opener keeps it working by registering it as an
alias and injecting an alias-named `@font-face` over the same files, so an
existing `settings.json` renders with the converted bytes; that is a
consumer-side compatibility layer, not a property of this package.

## Monospace metrics (measured)

`npm test` in the repository root (`test/font-metrics.test.js`) covers **each TTF
in this package** — it globs them, so the bold face is asserted on every run too:

- unitsPerEm 1000; every ASCII printable codepoint 0x21–0x7E is present in cmap
  and shares one advance **A = 500**.
- The fullwidth samples 一 / 漢 / あ / ん / ア each advance **1000 = 2A**.
- The two faces agree with each other: same unitsPerEm, same A. That agreement
  became checkable only with #275 — while this package shipped a single file
  there was nothing for it to disagree with, and the test armed itself the moment
  a second TTF appeared, with no edit.

These values are `hmtx` advances, and they are unchanged by the conversion. So,
as it happens, is **every** advance in this package — but that is a fact about
*this typeface*, not a property of the tool, and the difference matters:

- **The refit sets a selected glyph's advance to the cell width.** Where upstream
  drew a width-1 code point at the full-width advance, the conversion changes it.
  In the Mgen+ families that applies to ~1000 glyphs per face (1024 → 512).
- **Here it selected 46 and 67 glyphs and changed no advance at all**, measured
  by diffing the shipped files against the instanced inputs the converter read:
  **0 advance changes in either face.** M PLUS 1 Code already gave those code
  points the correct advance; what overflowed was the *ink* (stacked accents like
  `Ấ` `Ố` reaching past the box), so moving and scaling the outline was the whole
  of the work.
- **One advance does differ from the original variable font**, and it is not the
  refit's doing: `uni20A9.BRACKET.varAlt02` goes 1015 → 1044 when the font is
  instanced at `wght=700` (measured at the instancing step, before any refit; at
  `wght=400` nothing changes). That glyph is not reachable from `cmap`.
- **A body glyph is untouched in both outline and advance** — contract ② in
  "Provenance", verified glyph by glyph — and **the cell grid does not move**:
  A stays 500 and full-width glyphs stay 1000.

The earlier version of this paragraph said the conversion "never touches an
advance width". For this package the shipped result is the same either way, which
is exactly why the wrong reason survived review: it was stated as a property of
the tool, and as such it is false — the Mgen+ packages prove it. Contract ② is
about the glyphs the refit did *not* select; a selected glyph may change in both
outline and advance, by design.

## About this convention

To repeat: VS Code has **no official mechanism** for sharing fonts between
extensions. The borrowing steps are an unofficial, homegrown convention agreed
between the supplier (this extension) and the consumer (tmux-opener and the
like); the `providedFont` contract field is the source of truth for that
agreement, and `font-packages/README.md` is the source of truth for the
convention's *description*. If you change the shape of the contract field or the
location of the font file, update both sides together, keeping in mind that
consumers will break silently.

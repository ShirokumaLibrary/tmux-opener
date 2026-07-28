# ShirokumaGen Term (font resource for extensions)

*[日本語](README.ja.md)*

Extension ID: `shirokuma-library.font-shirokumagen`

A general-purpose font resource extension that **supplies the ShirokumaGen Term
font to other extensions**. It has no UI and no commands of its own
(`contributes` is empty, `activationEvents` is empty, and `main` is a no-op),
and it **does not install the font into the OS**. Its sole purpose is to let a
consuming extension load the bundled TTF from its own webview via
`vscode-resource`.

**ShirokumaGen Term is a modified version of HackGen Console** (白源
Console, v2.10.0), refitted for terminal use: the symbols a terminal counts as
one column wide are brought under the width at which a renderer squashes them
sideways. Upstream draws those symbols on the **full-width advance 1080**, and
the refit sets the advance of the selected glyphs to the one-cell width **540**
— 1656 glyphs in the Regular face and 1621 in the Bold, measured on the shipped
files. Ink wider than **1.15 cells** is scaled down to exactly that width, and
any ink that reaches past its cell is centred on the cell, so the overhang is the
same on both sides and never exceeds 41 units of a 540-unit cell (measured; the
ratio puts it at 40.5 and integer rounding accounts for the rest — about 7.6%).
**A symbol may therefore touch its neighbour slightly**; what it never does is
reach the squashing threshold. The ratio itself — what it means, its 1.5 ceiling
and why 1.15 — is defined once, in `scripts/font-fit/manifest.json`'s `note`.

**The two axes are scaled by different factors**: the refit takes the height to
`s × 1.3`, where the face allows it, and the width to `s`. The growth is clamped,
per glyph, against a limit **measured out of this face** — the **top and bottom
edges** of its own 漢 (U+6F22): `y = −72..856` in the Regular face, `−80..866` in
the Bold — and each glyph's stretch is capped so the stretched glyph stays inside
them. **What is bounded is the glyph's reach, not its height**: the conversion
keeps each glyph's vertical centre, so capping the height alone would still let a
glyph whose centre sits off the kanji's push past the line. The statement that is
true of these bytes is therefore a **conditional** one: the refit never pushes a
glyph past that kanji's top or bottom, and a glyph already past it at equal
scaling keeps the shape equal scaling gives it (measured: **0** glyphs of either
face newly reach outside — in the Regular face the count outside went from 593 at
equal scaling to **592** in the output). It is *not* claimed that nothing here
reaches further above or below the line than 漢 — this typeface draws symbols
taller than 漢 to begin with, and **593 of the 1723** refitted glyphs in the
Regular face are outside its box at equal scaling already. That clamp has a floor
of 1.0, so **not every refitted glyph gets taller**: measured on the shipped
bytes, **1128 of the 1723** refitted glyphs grew in the Regular face and **1115
of 1694** in the Bold; the rest had no room left at equal scaling, so their
stretch stayed at the clamp's 1.0 floor — **a statement about the vertical
factor, not about the bytes**: this package has no earlier release, so the
comparison is with upstream, and against the upstream faces only **8 of those
595** and **11 of those 579** are unchanged to the unit (the others were still
re-centred, given advance `A`, or scaled down horizontally; the counts are under
"Provenance"). `1.3` is a *chosen* value, arrived at by looking at five bakes — not
derived from the cap-height ratio it happens to sit near. Its meaning, its
measured limit and the current default are defined in the same `note`. ASCII and
Latin-1 are out of scope — a renderer does not rescale those, and refitting them
would rework the body text — as are box drawing, block elements and private use;
the exact scope is stated in `font-packages/README.md`, and this package ships a
measured instance of it (`©` in both faces, under "Provenance"). Nothing else
about the outlines was touched. The full chain — where the input came from, what
did the converting, and the hash of what came out — is in "Provenance", below.

## Bundled font

| family (measured) | file | weight | license |
|---|---|---|---|
| `ShirokumaGen Term` | `fonts/ShirokumaGenTerm-Regular.ttf` | `400` (static, not variable) | OFL-1.1 |
| `ShirokumaGen Term` | `fonts/ShirokumaGenTerm-Bold.ttf` | `700` (static, not variable) | OFL-1.1 |

Two faces of one family, each converted from the corresponding upstream static
face. Each `weight` is declared as a **single value, never a range**: a range is
a *claim* to cover the weights in it, and a static regular face declaring
`100 700` is selected as the real thing for a terminal's bold cells and painted
at regular weight — the range would **suppress** synthetic bold rather than
produce bold. Bold here is a real 700 face, so 700 is covered by glyphs. The
reasoning is stated once, for all packages, in `font-packages/README.md`.

**Which upstream variant, and why it matters.** HackGen publishes four families
per release; this package converts **`HackGenConsole`**, not `HackGenConsoleNF`.
The NF variant adds the Nerd Fonts icon set, whose glyphs sit in private-use
planes — and the **supplementary** private-use planes are *not* among the four
exclusions the refit borrows from the renderer, so converting the NF variant
would scale thousands of icon glyphs that were never meant to fit one cell
(measured in #285: of the NF variant's 10,383 extra glyphs, 10,376 are private
use, and 3,959 of them would end up below 0.70× their upstream size). The plain
variant bundled here carries **7** BMP private-use code points in cmap, measured
on both shipped faces. Widening the exclusion set is a change to the conversion's
scope and is deliberately out of this package's scope.

See `LICENSE.txt` for the copyright notices and the full license text, and
`licenses/` for the primary license documents of the upstream components it
refers to.

## Scope limitation: it does not work in `editor.fontFamily` / `terminal.integrated.fontFamily`

**A font supplied this way cannot be used by writing the font name
`ShirokumaGen Term` into VS Code's settings (`editor.fontFamily` or
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
  "family": "ShirokumaGen Term",
  "file": "fonts/ShirokumaGenTerm-Regular.ttf",
  "weight": "400",
  "faces": [
    { "file": "fonts/ShirokumaGenTerm-Regular.ttf", "weight": "400" },
    { "file": "fonts/ShirokumaGenTerm-Bold.ttf", "weight": "700" }
  ],
  "license": "OFL-1.1"
}
```

`faces` lists every face of the family, in declaration order; a consumer that
reads it injects one `@font-face` per entry. The flat `file` / `weight` pair
beside it is the **shorthand for the single 400 face** and stays byte-equal to
that entry, so a consumer written against the older one-file contract keeps
working unchanged.

**This family has no alias.** The three families converted in #275 were *renamed*
by their conversion, so tmux-opener registers each one's pre-rename name as an
alias and injects an alias-named `@font-face` over the same files, keeping an
untouched `settings.json` working. This package is new: `ShirokumaGen Term`
never had an earlier name, so there is nothing to alias, and "converted"
does not imply "carries an alias".

**#298 renamed this family and still adds no alias**, which is the same rule read
the other way round. An alias protects a value that is on someone's disk; this
family has never been published, so the pre-#298 spelling is on nobody's, and an
alias is a permanent registry entry with no expiry. Renaming *before* the first
release is exactly when a rename is free — and taking an alias anyway would be
paying for it forever.

**The same fact is why `version` stays at 0.1.0** even though both TTFs' bytes
moved. The question a bump answers is "did what this package *publishes* differ
from what was published under the previous number?" — and nothing has been
published under 0.1.0, so there is no previous release for these bytes to differ
from. (Had 0.1.0 shipped, the rename would have been a minor bump on the same
reasoning as #289's 0.1.0 → 0.2.0 elsewhere: a name-table change is visible to a
user's `settings.json`.)

Consumers of this extension must handle
`vscode.extensions.getExtension('shirokuma-library.font-shirokumagen')` returning
`undefined`: this is a **soft** dependency (use it if present), so use a runtime
check plus a fallback and **do not** put it in `package.json`'s
`extensionDependencies`. tmux-opener itself then renders with the OS's standard
monospace, injecting no `@font-face` at all, and — only when this font is the
selected one — shows a one-time notification prompting installation
(`src/font-registry.ts`). Its `src/font-registry.ts` and `getHtml`
(`src/extension.ts`) are a working implementation of the consumer side.

## Provenance (upstream archive → conversion → output)

**The two TTFs this package ships are conversion output, not the upstream bytes.**
A modified file cannot be proved by the two-column sha256 rule the unmodified
packages use — the thing it would be compared against is the upstream TTF, which
this repository does not ship — so provenance is a **three-link chain**, each
link measured: where the input came from, what turned it into the output, and
what the output hashes to. The chain is a different claim, not a cheaper version
of the old one: it records how these bytes were made, and nothing in it can be
machine-checked against upstream.

### 1. Upstream (the input)

| upstream archive | sha256 (measured on the download) |
|---|---|
| `https://github.com/yuru7/HackGen/releases/download/v2.10.0/HackGen_v2.10.0.zip` | `ed182e2a4b95792d94dea7932f6b45280b5ae353651be249d5f6b7867b788db7` |

The archive itself is **not** committed. It holds 8 TTFs and nothing else — the
whole entry listing is 8 `.ttf` entries plus the one directory, measured with
`python3 -m zipfile -l` (this host has no `unzip`/`7z`/`bsdtar`), and **no
license and no README entry**. The two entries taken out of it are the Console
variant's Regular and Bold; their hashes are the values `manifest.json` carries
as `srcSha256`, and `run.sh` re-checks both against the `--src-dir` it is given
**before it writes a single byte**.

| archive entry | sha256 (entry, on extraction) |
|---|---|
| `HackGen_v2.10.0/HackGenConsole-Regular.ttf` | `72f550f90b49be633a9661f153b8c8398272785d9beda53dd5c400b61412a3ec` |
| `HackGen_v2.10.0/HackGenConsole-Bold.ttf` | `268a3fb847765aa12779e6021329e5aa33a45a6cb4c98ed0d40ee9d201d5d84a` |

Upstream project: HackGen (白源) <https://github.com/yuru7/HackGen>.

#### License documents (not in the archive — taken from the upstream repository)

Because the release archive carries no license file of its own, the primary
documents come from the upstream repository at its **`v2.10.0` tag**, by the
route `font-packages/README.md` describes for exactly this case. Their
provenance is recorded like the TTFs': two independently measured columns, the
left one taken on fetch (before placement), the right one off the placed file.

| source URL | sha256 (fetched) | placed at | sha256 (placed) |
|---|---|---|---|
| `https://raw.githubusercontent.com/yuru7/HackGen/v2.10.0/LICENSE` | `9bfc3b3826a9c71042b87fda90a19cda4918894cdbd449cab163b7a7c93c5aa7` | `licenses/LICENSE_HackGen` | `9bfc3b3826a9c71042b87fda90a19cda4918894cdbd449cab163b7a7c93c5aa7` |
| `https://raw.githubusercontent.com/yuru7/HackGen/v2.10.0/source/LICENSE_GenJyuuGothic` | `68b83948ea44760eaf1cefc59f0ce2a381bb0e307508e8f0e5e8df529ee04170` | `licenses/LICENSE_GenJyuuGothic` | `68b83948ea44760eaf1cefc59f0ce2a381bb0e307508e8f0e5e8df529ee04170` |
| `https://raw.githubusercontent.com/yuru7/HackGen/v2.10.0/source/LICENSE_Hack` | `1f61bb7c790c59b4b0ecdf304628b94e42ae4c8020094a8c3da73381ab212623` | `licenses/LICENSE_Hack` | `1f61bb7c790c59b4b0ecdf304628b94e42ae4c8020094a8c3da73381ab212623` |
| `https://raw.githubusercontent.com/yuru7/HackGen/v2.10.0/source/LICENSE_NerdFonts` | `1f6ad4edae6479aaace3112ede5279a23284ae54b2a34db66357aef5f64df160` | `licenses/LICENSE_NerdFonts` | `1f6ad4edae6479aaace3112ede5279a23284ae54b2a34db66357aef5f64df160` |
| (the same fetched `LICENSE`) | `9bfc3b3826a9c71042b87fda90a19cda4918894cdbd449cab163b7a7c93c5aa7` | OFL 1.1 body quoted verbatim in `LICENSE.txt` | — |

The root `LICENSE` appears twice because it is both **placed** as a file and
**quoted**: the placed copy carries the two measured columns, while the
quotation into `LICENSE.txt` has no placed file of its own to hash and takes the
`—` the convention prescribes. The quotation was checked byte-identical to the
fetched document, which is the claim the right-hand column would have carried.

`licenses/LICENSE_NerdFonts` is shipped even though this is the **non-NF**
variant, and the reason is measured rather than assumed: the shipped faces'
`name` table nameID 0 credits Nerd Fonts (`Copyright (c) 2014, Ryan L McIntyre`),
carried through from upstream unchanged, so the document the credit points at
travels with it. That is a statement about the metadata, not about the glyphs —
the icon set is what the NF variant adds, and this one carries 7 private-use code
points in total.

### 2. Conversion (what turned input into output)

- **Pipeline**: `scripts/font-fit/run.sh` in this repository, driven by
  `scripts/font-fit/manifest.json` (this package is one entry in it; membership
  of that file is what makes a package a converted one). `fit.py` does the
  refit, `verify.py` gates the result, and `dump-widths.mjs` produces the
  cell-width table from `@xterm/addon-unicode11`'s own provider — a hand-written
  width table is forbidden. `instance.py` did **not** run for this package: both
  upstream faces are already static (`fvar` absent, measured), so there was no
  axis to pin.
  **Adding this package required exactly one new entry in `manifest.json` and no
  change to any script** — `run.sh`, `fit.py` and `verify.py` know no typeface
  name, which is the property design #271 R5 was aiming at and this package is
  the first outside case to exercise it.
- **Which converter, identified by content rather than by commit**, pinned by
  the sha256 of each file that determines the output:

  | pipeline file | sha256 |
  |---|---|
  | `scripts/font-fit/fit.py` | `c634881d418a59d68f1892db4d35f4fc66780a71cff277448cbef91479470bf7` |
  | `scripts/font-fit/instance.py` | `86240ac88d1dfa4527ebaa1e7e97caf6c656e97cd04833d12b21149d2fefe2af` |
  | `scripts/font-fit/verify.py` | `5c7d58d6a8ff4e4d248990c4bc39bcf379faee2fec9303ea3966c6ce1c5d9cf5` |
  | `scripts/font-fit/dump-widths.mjs` | `4813198fba79edb3d3086aa07b8808183a362406b1a1da9c7d614c5b90633a03` |
  | `scripts/font-fit/run.sh` | `4966ccca260ded4b1d7aa94fa71bc9802956363e9a646c788166ee530ab8c55a` |
  | `scripts/font-fit/manifest.json` | `0fed27ae2614fd0cbe570cde156bb4ed5ff32fe7a0a7c814b97d71acaf49629b` |

  `instance.py` is listed because it is part of the pipeline whose content
  determines what a run produces, not because it ran here. **A commit SHA would
  not do**: a git SHA is content-addressed, so a file cannot name the commit that
  contains it, and recording one forces either a two-commit split (breaking the
  coupling the sha256 binding depends on) or a placeholder that ships silently
  when nobody substitutes it. **The `manifest.json` row is also why adding this
  package edits the other converted packages' READMEs in the same commit**: the
  manifest is one of the hashed files, so a new entry invalidates every row that
  named the old one.
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
- **What the run changed**, per face — measured, and reported by `run.sh`:

  | output face | glyphs refitted | of which moved only / scaled | already fitting | advances changed |
  |---|---|---|---|---|
  | Regular | 1723 | 956 / 767 | 1193 | 1656 (all 1080 → 540) |
  | Bold | 1694 | 888 / 806 | 1201 | 1621 (all 1080 → 540) |

  The advance column is the tier that upstream's design makes necessary here:
  HackGen Console draws these ambiguous-width symbols on the full-width advance,
  so a terminal counting them as one column hands them a single cell. Setting the
  advance to `A` is what settles that, and it is a change to the *selected*
  glyphs only — every other advance in the file is untouched (measured by diffing
  the shipped files against the upstream inputs: 1656 and 1621 changes, and no
  other).
- **The `fitRatio` the run was driven by**: **1.15** (`manifest.json`'s
  top-level default; this package declares no override). Ink wider than
  `A × 1.15` — 621 units of the 540-unit cell — is scaled down to it. The value's
  meaning and its 1.5 ceiling are defined in `scripts/font-fit/manifest.json`'s
  `note` and not restated here.
- **The `vstretch` the run was driven by**: **1.3** (`manifest.json`'s top-level
  default; this package declares no override), with the vertical limit **measured
  from each face** rather than declared — the **top and bottom edges** of 漢
  (U+6F22), `y = −72…856` in the Regular face and `−80…866` in the Bold, as
  `run.sh` printed them. The clamp bound the stretch on **987 of the 1723**
  refitted glyphs in the Regular face and **919 of 1694** in the Bold; of those,
  595 and 579 respectively had no room left at equal scaling and were held at the
  clamp's 1.0 floor — **not stretched, which is not the same as not moved**. The
  three existing packages can say "unmoved" because their baseline is their own
  previous release (#291 already applied the horizontal refit); this package has
  no previous release, so its baseline is **upstream**, and against upstream only
  **8 of those 595** (Regular) and **11 of those 579** (Bold) are unchanged to
  the unit. The rest moved in the same pass: **133** and **152** of them were
  scaled down in both directions (`s < 1`), and the remainder kept `s = 1` but
  were re-centred and/or had their advance set to `A` (442 and 404 with the
  advance changed, 12 and 12 with it unchanged). Measured by re-deriving
  `fit.py`'s selection with `verify.py`'s `selected_glyphs` on the upstream face
  and comparing each selected glyph's point sequence (`DecomposingRecordingPen`,
  the same measure contract ② uses) against the shipped one. So the glyphs that actually
  grew taller are **1128 of 1723** and **1115 of 1694** — the vertical change is
  not universal, and the counts are the honest way to say so. Of the refitted
  glyphs, **593** (Regular) / **577** (Bold) already reached outside the 漢 box at
  equal scaling, and **none** of either face reaches outside it that did not
  already (the Regular face's count went 593 → 592, i.e. the stretch removed one
  rather than adding any).
- **All three gates passed on both faces** (`verify.py`, run against the upstream
  file the converter actually read, at the declared ratio and stretch):
  **contract ① — in-scope code points outside the declared band (ink ≤ `A × 1.15`,
  centred when it overhangs, advance `== A`): 0**, with the widest in-scope ink
  going 1024 → 622 on both faces (the declared room is 621.0, and 622 is where
  the integer grid lands); **contract ② — body glyphs whose outlines changed:
  0 of 13,101** on each face; **contract ③ — refitted glyphs whose top and bottom
  edges differ from what the declared `vstretch` and the measured wall imply:
  0 of 1723 (Regular) and 0 of 1694 (Bold)**, checked as an equality in both
  directions, so bytes baked at a different stretch would fail whichever way they
  differed — and the half of that gate which recomputes no formula (③c) reports
  **0 glyphs newly outside the wall** on both faces (largest excess 0.5 units
  against a tolerance of 1).
  *In-scope* is load-bearing rather than a hedge: the pipeline
  deliberately excludes ASCII / Latin-1, the BMP private use area, box drawing
  and block elements, and everything not width 1 (`font-packages/README.md`,
  "Terminal width conventions"). This package ships the measured instance of
  that: in both faces (`A` = 540) `©` (U+00A9) advances 540 with ink `−1 … 541`
  — width 1, one unit outside the cell on each side, and correctly untouched.
- The family and style names in the `name` table are rewritten
  (`HackGen Console` → `ShirokumaGen Term`, with nameID 3 carrying
  `; derived`); **nameID 0, the copyright field, is carried through
  byte-identically** (re-measured on the output) — the four bracketed notices are
  quoted in `LICENSE.txt` §1. The **style bits move with the names**:
  `OS/2.fsSelection` bit 5 (BOLD) and bit 6 (REGULAR), and `head.macStyle`
  bit 0, are derived from the style rather than inherited. Measured on the
  output: Regular `fsSelection=0x0040` / `macStyle=0x0000`, Bold
  `fsSelection=0x0020` / `macStyle=0x0001`. Upstream's `fsSelection` already
  carried the right bit on each face; `head.macStyle` bit 0 did **not** (the Bold
  face had `0x0000`), so that single bit is the only metadata the conversion
  moved beyond the names.
- **Reproducibility, as measured, not as promised**: re-running the pipeline on
  the same machine, from the same input, with the tool versions above, produced
  byte-identical output — the sha256s below. Nothing is claimed about a
  *different* fontTools or Python: that was not tested, and neither was the
  effect of environment variables beyond the three fixed above.

### 3. Output (what is shipped)

Measured on the placed files, and recorded in `scripts/font-fit/checksums.json`
as the same values — `npm test` compares the two, so a TTF and its record can only
move together, and it compares the recorded `fitRatio` and `vstretch` against the
manifest as well.

| placed at | sha256 (placed) | fitRatio | vstretch |
|---|---|---|---|
| `fonts/ShirokumaGenTerm-Regular.ttf` | `a1ae61cd72e9ec6eb2869e4581adcb1f56f99f08bb9e6b2d232f09b50bccdcf7` | `1.15` | `1.3` |
| `fonts/ShirokumaGenTerm-Bold.ttf` | `c31cd509f2a909fc799e28a0c0948842c00a089f4ee332028a0a3f5463b936ea` | `1.15` | `1.3` |

### Reserved Font Name check (measured)

OFL 1.1 §3 forbids a Modified Version from carrying a Reserved Font Name, so a
converted package must establish which names are reserved **before** choosing
its own. The check is `scripts/font-fit/check-license.py`, not a hand-built
`grep`: it enumerates every file under the package, decides text from font from
binary by the **leading bytes** rather than by file name, and opens the fonts to
read their `name` table — the three pitfalls `font-packages/README.md` documents,
one of which no file search can reach at all.

```sh
~/.local/share/fonttools-venv/bin/python scripts/font-fit/check-license.py \
  font-packages/font-shirokumagen --derived-name 'ShirokumaGen Term'
```

Exit status **0**. Every line the tool printed, verbatim:

```
走査: テキスト 7 / フォント 2 / バイナリ除外 1 / 拡張子で除外 0 / 読めず 0 / name レコード decode 失敗 0
バイナリとして飛ばしたパス（中は見ていない・zip は展開しない）:
  - font-packages/font-shirokumagen/icon.png
記録ファイルとして外したパス（README.md / README.ja.md——この検査の記録そのもの。読ませるなら --all-files）:
  - font-packages/font-shirokumagen/README.ja.md
  - font-packages/font-shirokumagen/README.md
一致行: 10

--- 一致行（全行・省略なし）---
font-packages/font-shirokumagen/LICENSE.txt:79: RESERVED FONT NAME note at the end of section 1.
    予約名候補: （宣言なし——散文・定義文）
font-packages/font-shirokumagen/LICENSE.txt:109: Copyright (c) 2019, Yuko OTAWARA. with Reserved Font Name "白源", "HackGen"
    予約名候補: '白源', 'HackGen'
font-packages/font-shirokumagen/LICENSE.txt:118: RESERVED FONT NAME: the HackGen line above reserves "白源" and "HackGen" (OFL
    予約名候補: '白源', 'HackGen', 'the HackGen line above reserves', 'OFL'
font-packages/font-shirokumagen/LICENSE.txt:121: contains neither. Four reserved font names are declared anywhere in this
    予約名候補: （宣言なし——散文・定義文）
font-packages/font-shirokumagen/LICENSE.txt:216: "Reserved Font Name" refers to any names specified as such after the
    予約名候補: （宣言なし——散文・定義文）
font-packages/font-shirokumagen/licenses/LICENSE_GenJyuuGothic:33: "Reserved Font Name" refers to any names specified as such after the
    予約名候補: （宣言なし——散文・定義文）
font-packages/font-shirokumagen/licenses/LICENSE_Hack:5: Bitstream Vera Sans Mono Copyright 2003 Bitstream Inc. and licensed under the Bitstream Vera License with Reserved Font Names "Bitstream" and "Vera"
    予約名候補: 'Bitstream', 'Vera'
font-packages/font-shirokumagen/licenses/LICENSE_HackGen:10: Copyright (c) 2019, Yuko OTAWARA. with Reserved Font Name "白源", "HackGen"
    予約名候補: '白源', 'HackGen'
font-packages/font-shirokumagen/licenses/LICENSE_HackGen:42: "Reserved Font Name" refers to any names specified as such after the
    予約名候補: （宣言なし——散文・定義文）
font-packages/font-shirokumagen/licenses/LICENSE_NerdFonts:66: "Reserved Font Name" refers to any names specified as such after the
    予約名候補: （宣言なし——散文・定義文）

--- 予約名: 引用符で宣言されたもの 4 件 ---
  'Bitstream'  ← font-packages/font-shirokumagen/licenses/LICENSE_Hack:5
  'HackGen'  ← font-packages/font-shirokumagen/LICENSE.txt:109, font-packages/font-shirokumagen/LICENSE.txt:118, font-packages/font-shirokumagen/licenses/LICENSE_HackGen:10
  'Vera'  ← font-packages/font-shirokumagen/licenses/LICENSE_Hack:5
  '白源'  ← font-packages/font-shirokumagen/LICENSE.txt:109, font-packages/font-shirokumagen/LICENSE.txt:118, font-packages/font-shirokumagen/licenses/LICENSE_HackGen:10

--- 引用符なしで拾った候補: 2 件（宣言のことも過剰捕捉のこともある・判定には同じく使う）---
  'OFL'  ← font-packages/font-shirokumagen/LICENSE.txt:118
  'the HackGen line above reserves'  ← font-packages/font-shirokumagen/LICENSE.txt:118
  ↑ 照合に使う予約名は上下あわせて 6 件。散文由来の候補は出所の行を見て人が捨てる（落とすより拾いすぎる側に倒してある）。

--- 派生名の判定（部分文字列・NFKC + casefold）---
  'ShirokumaGen Term': どの予約名も含まない → OK （照合した予約名 6 件）
```

Run again for the Japanese name this package is called by, since §3 constrains
the primary font name as presented to users in either language. Exit status **0**,
verdict line verbatim:

```
--- 派生名の判定（部分文字列・NFKC + casefold）---
  '白熊源': どの予約名も含まない → OK （照合した予約名 6 件）
```

**Reading the record.** The **quoted** group is the declaration: `"白源"` and
`"HackGen"` (upstream's own, at `licenses/LICENSE_HackGen:10`, restated in this
package's `LICENSE.txt`), plus `"Bitstream"` and `"Vera"` carried in by the Hack
document's reproduction of the Bitstream Vera License. The **unquoted** group is
the tool's deliberate over-capture — `'OFL'` and the phrase fragment
`'the HackGen line above reserves'`, both picked off this package's own prose
line explaining the conclusion. They are compared against the derived name like
any other candidate and recorded rather than tuned away; neither is a claim that
this package reserves that name. **No row comes from the `name` table**: the two
shipped faces' nameID 0 carries four copyright notices and no
`with Reserved Font Name` clause (measured), so the font-binary stage — the one a
`grep` cannot reach — found nothing here. Its presence in the run is what makes
that a result rather than an untested assumption.

`ShirokumaGen Term` and 白熊源 each contain none of the six candidates.
The reserved names are also why the derived name is not a suffixed
`HackGen Console Term`: mechanically appending `Term` to the upstream family
would have published a name containing a Reserved Font Name.

**`Console` was dropped for a different reason, and that one is a naming rule
rather than a licence constraint** (#298). `font-packages/README.md` states it
once, under "How a shipped family name is derived": the shipped name is the
upstream family plus `" Term"`, minus any upstream variant word whose meaning
`Term` already carries. The question is what the word *says* — `Console` is
upstream's mark for the terminal-oriented member of a pair, which is the property
` Term` asserts, so the two would say one thing twice. (`Code` in
`M PLUS 1 Code` says something else, namely which typeface it is — the
monospaced sibling of the proportional `M PLUS 1` — so there the word stays.)
That section, not this one, is where the rule and its limits are stated; it also
records why "does upstream publish the name left after removing the word?" is
corroboration rather than the test. The rename changes the `name` table and
nothing else: it was applied by
re-running the same pipeline on the same input at the same `fitRatio` and
`vstretch`, and every glyph's outline and every `hmtx` entry came out identical
to the #289 bytes (measured, all 19,795 / 19,797 glyphs per face; the only other
byte that moved is `head.checkSumAdjustment`, which is the whole file's own
checksum).

## family name (measured, not assumed)

Measured on the converted files — the ones that ship. Read from the `name` table
directly:

| field | `ShirokumaGenTerm-Regular.ttf` | `ShirokumaGenTerm-Bold.ttf` |
|---|---|---|
| nameID 1 (family) | `ShirokumaGen Term` | `ShirokumaGen Term` |
| nameID 2 (subfamily) | `Regular` | `Bold` |
| nameID 3 (unique ID) | `ShirokumaGen Term Regular; derived` | `ShirokumaGen Term Bold; derived` |
| nameID 4 (full name) | `ShirokumaGen Term Regular` | `ShirokumaGen Term Bold` |
| nameID 6 (PostScript) | `ShirokumaGenTerm-Regular` | `ShirokumaGenTerm-Bold` |
| `OS/2.usWeightClass` | `400` | `700` |
| `fvar` | absent (static) | absent (static) |

Neither face carries a nameID 16 / 17 pair; nameID 1 is the family, and it is
identical across the two, which is what makes pairing them under a single CSS
`font-family` legitimate. **The injection does not depend on it** — `@font-face`
*declares* a family name rather than reading one, and CSS font matching never
consults a file's internal names; `font-packages/README.md` states that
mechanism in full. This table is evidence about the fonts, not about the
mechanism.

`ShirokumaGen Term` is the value this extension's `providedFont.family`
carries, and it must stay identical to the consumer-side registry entry
(tmux-opener's `FONT_REGISTRY`).

## Monospace metrics (measured)

`npm test` in the repository root (`test/font-metrics.test.js`) covers **each TTF
in this package** — it globs them, so the bold face is asserted on every run too:

- unitsPerEm 1024; every ASCII printable codepoint 0x21–0x7E is present in cmap
  and shares one advance **A = 540**.
- The fullwidth samples 一 / 漢 / あ / ん / ア each advance **1080 = 2A**.
- The two faces agree with each other: same unitsPerEm, same A.

**What the refit changed and what it left alone** is the point worth stating
precisely, because this package is the opposite case from `font-mplus1code`:

- **The refit sets a selected glyph's advance to the cell width**, and here it
  did so 1656 times in the Regular face and 1621 times in the Bold — every one of
  them 1080 → 540, measured against the upstream inputs. Upstream designs these
  ambiguous-width symbols full-width; a terminal counts them as one column.
- **Nothing else moved.** No other advance in either file differs from upstream,
  and body glyphs are untouched in outline too — contract ② in "Provenance",
  verified glyph by glyph, 0 of 13,101 per face.
- **The cell grid does not move**: A stays 540 before and after, full-width glyphs
  stay 1080, and gid 0 (named `.notdef#0#0#0` in these faces, which is why
  `font-packages/README.md` states the rule over **gid 0** rather than over a
  glyph name) stays 540 — the last one matters because a code
  point missing from `cmap` resolves to gid 0, and a reader that takes its width
  would report every missing symbol as a tidy half-width pass.

## Coverage (measured, and what conversion cannot do)

`scripts/font-fit/survey.py` over the shipped faces, against the upstream ones:

- cmap size **18,201** code points (Regular) / **18,180** (Bold) — the largest of
  the families bundled in this repository.
- Of the 26 everyday symbols the survey samples, **26 are present** in both faces
  — no `—` (absent) row at all. That is the half the conversion cannot supply:
  **a refit moves glyphs, it never adds one**, so a face missing a symbol stays
  missing it and the OS fallback draws it.
- Before conversion, **14 of the 26** did not fit their cell, and the *cause* is
  overwhelmingly (13 of the 14) the advance rather than a disorderly outline —
  which is exactly the shape
  `fit.py` settles. Stated as measured: **13 of the 14** carry the full-width
  advance (2A = 1080), and those 13 fail the ink test as well, necessarily —
  ink drawn on a 1080-unit advance cannot stay inside a 540-unit box. The
  fourteenth is `‰` (U+2030), already on advance 540 with ink `−1…541`: a
  one-unit overhang on each side, so what it fails is the ink test alone.
  **That is not the same as being left alone, and its bytes are not upstream's.**
  The ±1 overhang is what `verify.py`'s contract ① *tolerates*; `fit.py`'s
  "already fits" test is a different, stricter thing (`x0 >= 0 and x1 <= A and
  …`), so `x0 = −1` puts `‰` into the refit plan. Being in the plan costs it
  nothing horizontally — its ink is well inside `room` (540 × 1.15 = 621), so
  the width factor is `s = 1.0` and the advance stays 540 — but the vertical
  factor still applies, and it stretched: measured against the upstream faces,
  the control box goes `(−1, 0, 541, 695)` → `(−1, −72, 541, 767)` in the
  Regular face and `(−1, 0, 541, 695)` → `(−1, −80, 541, 775)` in the Bold,
  with the vertical centre (347.5) preserved. After conversion **0** in-scope code points
  fail the advance condition in either face (measured: `adv≠箱` 0 of 2916 in-scope
  code points in the Regular face, 0 of 2895 in the Bold).
- The survey's `○` column is stricter than the conversion's contract and does not
  move: it asks for ink inside `[0, A]`, while the contract allows ink up to
  `A × 1.15` centred on the cell. So the same 14 samples stay `△` after
  conversion — they are now *bounded and symmetric* overhang rather than
  full-width glyphs squeezed into one cell. Do not read that column as "the
  conversion did nothing"; read the advance numbers above.

## About this convention

To repeat: VS Code has **no official mechanism** for sharing fonts between
extensions. The borrowing steps are an unofficial, homegrown convention agreed
between the supplier (this extension) and the consumer (tmux-opener and the
like); the `providedFont` contract field is the source of truth for that
agreement, and `font-packages/README.md` is the source of truth for the
convention's *description*. If you change the shape of the contract field or the
location of the font file, update both sides together, keeping in mind that
consumers will break silently.

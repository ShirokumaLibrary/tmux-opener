# PlemolJP Console HS (font resource for extensions)

*[日本語](README.ja.md)*

Extension ID: `shirokuma-library.font-plemoljp-console`

A general-purpose font resource extension that **supplies the PlemolJP Console
HS font to other extensions**. It has no UI and no commands of its own
(`contributes` is empty, `activationEvents` is empty, and `main` is a no-op),
and it **does not install the font into the OS**. Its sole purpose is to let a
consuming extension load the bundled TTF from its own webview via
`vscode-resource`.

## Bundled font

| family (measured) | file | weight | license |
|---|---|---|---|
| `PlemolJP Console HS` | `fonts/PlemolJPConsoleHS-Regular.ttf` | `400` (static, not variable) | OFL-1.1 |
| `PlemolJP Console HS` | `fonts/PlemolJPConsoleHS-Bold.ttf` | `700` (static, not variable) | OFL-1.1 |

Two faces of one family, each a separate static TTF from the same distribution.

`family` is the **measured** name table value, not an assumption — see
"family name" below. Each `weight` is declared as a **single value, never a
range**: these are static fonts, and a range is a *claim* to cover the weights
in it. A face declaring `100 700` is selected as the real thing for xterm's bold
cells and painted at regular weight, so declaring the range **suppresses
synthetic bold** instead of producing bold. That is exactly why the real 700
face is shipped here: with it declared, 700 is covered by glyphs that are
actually bold rather than by a claim.

Every `weight` above is spelled out rather than omitted. What an omission would
cost differs by which declaration shape it sits in, and the two rules are stated
once, for all packages, in `font-packages/README.md` — the canonical description
of the contract.

See `LICENSE.txt` for the copyright notices and the full license text, and
`licenses/` for the primary license documents of the upstream components it
refers to.

## Which variant this is, and why (measured)

The PlemolJP project publishes several families. This package ships **PlemolJP
Console HS**, and both halves of that name matter:

- **Console** — the upstream project describes this variant as the one that
  applies IBM Plex Mono's glyphs without excluding any, so that many symbols
  render **halfwidth**. Measured on the shipped faces (`hmtx` advances of the
  default instance, ASCII advance `A` = 528): `●` `○` `■` `★` `✓` `✔` `…` `①`
  all advance **528 = A**, i.e. one terminal cell. `⚠` advances **1056 = 2A**
  and stays fullwidth — a known limitation of this face, not something the
  package works around.
- **HS** — "Hidden Space", the upstream release variant that does **not** add
  the ideographic-space visualization the default release carries.

Both measurements above are of *these bytes*; they are recorded here because a
consuming terminal's width convention (East Asian Ambiguous counted as width 1)
is what makes them load-bearing, and the general procedure for checking it lives
in `font-packages/README.md`.

## Copyright and attribution (four parties)

The bundled faces' own copyright field credits four parties. **Which source
states what is kept separate below**, because a paraphrase must not be presented
as a quotation.

### Copyright holders, quoted verbatim

The bundled TTFs' own `name` table, nameID 0 (copyright) — identical in the
Macintosh (platform 1, encoding 0, language 0x0) and Windows (platform 3,
encoding 1, language 0x409) records, and byte-for-byte identical between the
regular and the bold face (measured), so one quotation covers both. The TTFs are
bundled unmodified, so this is the machine-readable copyright field OFL §2
speaks of:

```
[IBM Plex]
Copyright (c) 2017 IBM Corp. https://github.com/IBM/plex

[Hack]
Copyright 2018 Source Foundry Authors https://github.com/source-foundry/Hack

[Nerd Fonts]
Copyright (c) 2014, Ryan L McIntyre https://ryanlmcintyre.com

[PlemolJP]
Copyright (c) 2021, Yuko Otawara
```

The upstream repository's own `LICENSE` (tag v3.0.0) states the PlemolJP holder
again, there with a **Reserved Font Name**:

```
Copyright (c) 2021, Yuko OTAWARA. with Reserved Font Name "PlemolJP"
```

`licenses/LICENSE_IBM-Plex` reserves `"Plex"` the same way (OFL §3). Nothing
here triggers either clause — both TTFs are bundled unmodified and the family
name they declare (`PlemolJP Console HS`) is the upstream one — but a *modified*
version may not be distributed under a name containing those reserved names.

### The OFL declaration, and the license documents

The bundled TTFs' `name` table, nameID 13 (license description), reproduced
exactly (identical between the two records and the two faces, measured):

```
This Font Software is licensed under the SIL Open Font License,
Version 1.1. This license is available with a FAQ
at: http://scripts.sil.org/OFL
```

The full OFL 1.1 text is in `LICENSE.txt`, copied verbatim from the upstream
repository's `LICENSE` at tag v3.0.0. The primary documents of the upstream
components ship under `licenses/` — see "License documents" in the provenance
section below for where each came from and why they are shipped in full rather
than cited.

Project links, for convenience: PlemolJP <https://github.com/yuru7/PlemolJP>,
IBM Plex <https://github.com/IBM/plex>, Hack
<https://github.com/source-foundry/Hack>, Nerd Fonts
<https://github.com/ryanoasis/nerd-fonts>. These are current addresses, not
quotations from the distribution.

## Scope limitation: it does not work in `editor.fontFamily` / `terminal.integrated.fontFamily`

**A font supplied this way cannot be used by writing the font name
`PlemolJP Console HS` into VS Code's settings (`editor.fontFamily` or
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
  "family": "PlemolJP Console HS",
  "file": "fonts/PlemolJPConsoleHS-Regular.ttf",
  "weight": "400",
  "license": "OFL-1.1",
  "faces": [
    { "file": "fonts/PlemolJPConsoleHS-Regular.ttf", "weight": "400" },
    { "file": "fonts/PlemolJPConsoleHS-Bold.ttf", "weight": "700" }
  ]
}
```

`faces` lists every face of the family, in declaration order; a consumer that
reads it injects one `@font-face` per entry. The flat `file` / `weight` pair is
kept as a **shorthand for the single 400 face** and stays byte-equal to the
first entry, so a consumer written against the older one-file contract keeps
working unchanged (it simply gets no bold face and falls back to synthetic
bold).

**How a consumer reads that — the two declaration shapes, which one wins, the
normalization and degradation rules, and the borrowing steps with code — is
`font-packages/README.md` in the same repository. That file is the single
canonical description of the contract; this section records only what *this*
package declares.** tmux-opener's `src/font-registry.ts` / `getHtml` are a
working implementation of the consumer side.

## Provenance

Both TTFs are placed **byte-for-byte as distributed**: unmodified, and under
their original file names (renaming or subsetting would put the package under
OFL §5's derived-work rules for no benefit).

- **Distribution**: PlemolJP v3.0.0, release asset `PlemolJP_HS_v3.0.0.zip`
  (`HS` = Hidden Space, the variant without the ideographic-space
  visualization)
- **URL**: `https://github.com/yuru7/PlemolJP/releases/download/v3.0.0/PlemolJP_HS_v3.0.0.zip`
  (upstream project `https://github.com/yuru7/PlemolJP`)
- **Archive**: 216,568,254 bytes, sha256
  `52c4de59f5030caf9e3c88aa304d281c7ea987e2c30fa0441ca162eede2bff12`
  (the archive itself is **not** committed — only the files below are)
- **Extraction**: python3 stdlib `zipfile` (this host has no `unzip`/`7z`/`bsdtar`).
  The archive holds 16 Console faces; the two shipped here are the Regular and
  the Bold of `PlemolJPConsole_HS/`, chosen because the contract declares
  exactly one 400-covering face and one real 700 face.

### sha256: archive entry (measured on extraction) → placed file

Both columns are measured, in that order: the left one comes off the extracted
file in a scratchpad directory **before** anything was copied into the
repository, the right one off the committed file afterwards. The rule — and why
a single self-referential column would verify nothing — is stated once for every
package in `font-packages/README.md`.

| archive entry | sha256 (entry, on extraction) | placed at | sha256 (placed) |
|---|---|---|---|
| `PlemolJPConsole_HS/PlemolJPConsoleHS-Regular.ttf` | `de583b2a81e5bf991ae54523dc11ef7588d4d0fe9b9de5a67d1dfeb56dfa0f43` | `fonts/PlemolJPConsoleHS-Regular.ttf` | `de583b2a81e5bf991ae54523dc11ef7588d4d0fe9b9de5a67d1dfeb56dfa0f43` |
| `PlemolJPConsole_HS/PlemolJPConsoleHS-Bold.ttf` | `11af5bc2a756fca43db9268ce3b7ba537e811c08d5a71084956c635d23dd40b8` | `fonts/PlemolJPConsoleHS-Bold.ttf` | `11af5bc2a756fca43db9268ce3b7ba537e811c08d5a71084956c635d23dd40b8` |

### License documents (not in the archive — taken from the upstream repository)

**The distribution archive contains font files only.** Listing all 69 of its
entries — 5 directories and 64 TTFs — turns up **no license and no README
entry** (measured with `python3 -m zipfile -l`). Every other package in `font-packages/` ships the
distribution's own license/README files at their archive-internal paths; here
there are none to ship, so the primary documents come from the upstream
repository at its **`v3.0.0` tag** instead, and their provenance is recorded
exactly like the TTFs': two independently measured columns, the left one taken
on fetch (before placement), the right one off the placed file.

Note what does *not* change: `LICENSE.txt` at the package root has always been a
**composed** document (a sectioned file separating verbatim quotations from
explanatory prose) in every package here. What is different about this one is
only where the primary documents it can be checked against were obtained.

| source URL | sha256 (fetched) | placed at | sha256 (placed) |
|---|---|---|---|
| `https://raw.githubusercontent.com/yuru7/PlemolJP/v3.0.0/LICENSE` | `52bbb5e729acc62435831d20641ece6a919e610100285ba183ef4d7233fb1e9a` | quoted verbatim in `LICENSE.txt` (OFL 1.1 body, byte-identical) | — |
| `https://raw.githubusercontent.com/yuru7/PlemolJP/v3.0.0/source/LICENSE_IBM-Plex` | `37784b44044a4ffd9256702b7c0982c37e5c8887ba90c6dca0479aea93dc898d` | `licenses/LICENSE_IBM-Plex` | `37784b44044a4ffd9256702b7c0982c37e5c8887ba90c6dca0479aea93dc898d` |
| `https://raw.githubusercontent.com/yuru7/PlemolJP/v3.0.0/source/hack/LICENSE` | `1f61bb7c790c59b4b0ecdf304628b94e42ae4c8020094a8c3da73381ab212623` | `licenses/LICENSE_Hack` | `1f61bb7c790c59b4b0ecdf304628b94e42ae4c8020094a8c3da73381ab212623` |
| `https://raw.githubusercontent.com/yuru7/PlemolJP/v3.0.0/source/LICENSE_NerdFonts` | `245b522abb5aba0d8e84898bf6d5e95102620637626106bfd0061189a2370360` | `licenses/LICENSE_NerdFonts` | `245b522abb5aba0d8e84898bf6d5e95102620637626106bfd0061189a2370360` |

The Hack document's upstream path is `source/hack/LICENSE`; it is placed as
`licenses/LICENSE_Hack` so the three files sit under one naming scheme, and the
row above is where that renaming is recorded. The root `LICENSE` has no placed
hash of its own because it is not shipped as a file — its OFL 1.1 body is quoted
into `LICENSE.txt`, and that quotation was checked to be byte-identical to the
fetched document.

These are shipped in full rather than cited because two of them carry MIT
permission notices, whose condition is that the notice itself "shall be included
in all copies or substantial portions of the Software". Read each document for
what it says: in **Nerd Fonts** the fonts are OFL-licensed and MIT covers the
project's source code, whereas in the **Hack** project it is the font work that
is MIT-licensed — and `licenses/LICENSE_Hack` additionally states the DejaVu
project's public-domain dedication and reproduces the Bitstream Vera License, so
it speaks for more parties than the one named beside it above. `LICENSE.txt` §4
explains how the upstream OFL declaration and that MIT text, which look at first
reading as though they disagree, differ in subject.

## family name (measured, not assumed)

`fc-scan --format '%{family}\n%{familylang}\n%{style}\n%{spacing}\n%{weight}\n'`
on **each** extracted TTF — every face this package ships is measured, because
the whole borrowing scheme rests on the two of them naming the *same*
typographic family:

| field | `PlemolJPConsoleHS-Regular.ttf` | `PlemolJPConsoleHS-Bold.ttf` |
|---|---|---|
| `family` | `PlemolJP Console HS` | `PlemolJP Console HS` |
| `familylang` | `en` | `en` |
| `style` | `Regular` | `Bold` |
| `spacing` | `90` (= `dual`) | *(unset — fontconfig reports no value)* |
| `weight` | `80` (fontconfig scale: Regular) | `200` (fontconfig scale: Bold) |

The `family` value is the font family name — name ID 1, since these faces carry
no name ID 16 (typographic family) record at all, measured — and it is identical
across the two faces. Upstream designed them as one family, which is what makes pairing them
under a single CSS `font-family` legitimate (and their metrics agreement, below,
an expected property rather than a coincidence). **The injection does not depend
on it** — `@font-face` *declares* a family name rather than reading one, and CSS
font matching never consults a file's internal names; `font-packages/README.md`
states that mechanism in full. This row is evidence about the fonts, not about
the mechanism.

`PlemolJP Console HS` is the value this extension's `providedFont.family`
carries, and it must stay identical to the consumer-side registry entry
(tmux-opener's `FONT_REGISTRY`).

Note `spacing` is `dual` (90) on the regular face and reported as no value at all
on the bold one — neither is the monospace evidence. fontconfig's `spacing` is a
heuristic; the evidence is `test/font-metrics.test.js`, below.

## Monospace metrics (measured)

`npm test` in the repository root (`test/font-metrics.test.js`) covers **both**
files and asserts this on every run:

- unitsPerEm 1000; every ASCII printable codepoint 0x21–0x7E is present in
  cmap and shares one advance **A = 528**.
- The fullwidth samples 一 / 漢 / あ / ん / ア each advance **1056 = 2A**.
- The two faces agree with each other: same unitsPerEm, same A. Each face being
  monospaced on its own is not enough — the terminal measures its cell from one
  family and paints both faces into it, so bold at a different scale would drift
  out of column while every per-file check still passed.

The values above are `hmtx` advances of the **default instance**, which for
these static faces is the whole font. Both faces also declare the same vertical
metrics (`hhea` ascender 950, descender −225, lineGap 0 — a line height of
1.175 em).

# The `providedFont` contract (font resource extensions)

**This file is the single canonical specification of the `providedFont`
contract** — the convention by which a *font resource extension* supplies a font
to a *consuming extension*'s webview. Each package under `font-packages/`
documents the facts about **its own font** (which faces it ships, where the bytes
came from, what the family name measures as); the contract *format*, the reader's
normalization and the degradation rules are described here and nowhere else.

Why here: `font-packages/` is not `export-ignore`d, so this document reaches the
public repository and any third-party consumer; and it is **not bundled into any
VSIX** — a font extension is packaged from *its own* directory, and the
tmux-opener host excludes `font-packages/**` in `.vscodeignore` (asserted by
`scripts/verify-vsix.js`) — so revising the specification never obliges anything
to be republished. The contract spec and the extensions' release cycles are
deliberately decoupled.

**There is no official VS Code mechanism for sharing fonts between extensions.**
What follows is an unofficial, homegrown convention agreed between supplier and
consumer. Change the shape of the contract on one side only and consumers break
*silently*.

References below are backticked plain paths, not Markdown links, on purpose:
these READMEs are bundled into VSIXs and rendered on the Marketplace, where
`vsce` rewrites relative links. Being unbreakable matters more than being
clickable.

## The contract field

A font resource extension declares `providedFont` at the top level of its
`package.json`:

| field | required | meaning |
|---|---|---|
| `family` | yes | The CSS family name this font is known by. **A consumer does not feed it to the injection** — it declares a family string it holds itself and compares this one against it (see "The injection does not depend on the font file's internal names"). |
| `faces` | one of the two shapes | Array of `{ file, weight }`, one entry per shipped face, in declaration order. |
| `file` | one of the two shapes | Path of a single face's font file, relative to the extension root, `/`-separated. |
| `weight` | optional beside `file` (see rule 3); required in a `faces` entry | That face's CSS `font-weight` descriptor value. Omitted beside a flat `file` it defaults to `100 700`; omitted inside a `faces` entry it drops the entry. Always spell it out. |
| `license` | yes | SPDX identifier of the font's license (e.g. `OFL-1.1`). **Informational — no consumer code reads its value** (tmux-opener's contract *type* declares `license?: string` and its test fixtures set it, but nothing in `src/` or `test/` ever reads the field). It states the terms to a human deciding whether to borrow the font; the license text itself ships in the package. |

`family` and `license` sit outside the face declaration in both shapes. What
varies is how the *faces* are declared.

### Shape A — `faces[]` (N faces)

```json
"providedFont": {
  "family": "Mgen+ 1mn Term",
  "file": "fonts/MgenPlus1mnTerm-Regular.ttf",
  "weight": "400",
  "faces": [
    { "file": "fonts/MgenPlus1mnTerm-Regular.ttf", "weight": "400" },
    { "file": "fonts/MgenPlus1mnTerm-Bold.ttf", "weight": "700" }
  ],
  "license": "OFL-1.1"
}
```

The flat `file` / `weight` beside `faces` here is **not part of Shape A** — a
`faces` array alone is a complete, valid contract, and a reader ignores the flat
pair whenever `faces` is an array. It is present because the packages in *this*
repository always keep the flat alias for older readers; that is a repo
convention ("Always keep the flat alias", below), not a requirement on you.

### Shape B — the flat `file` / `weight` pair (one face)

```json
"providedFont": {
  "family": "Some Variable Mono",
  "file": "fonts/SomeVariableMono.ttf",
  "weight": "100 700",
  "license": "OFL-1.1"
}
```

The flat pair is the **shorthand for a single face** and is supported
permanently: a consumer written before `faces` existed keeps working against a
`faces`-carrying contract unchanged (it gets the flat face only). That is the
whole point of keeping both.

The example is deliberately a **hypothetical variable font**, and the `weight`
is why. `100 700` is a legitimate declaration only for a face that genuinely has
that axis; on a static face it is the bold-suppression trap described under
"Static faces declare a single value" below. This slot used to hold the real
`font-mplus1code` contract, which was exactly such a variable font — until #275
instanced it into two static faces, at which point the canonical document would
have been teaching the trap using a package that no longer had the axis. **No
package in this directory declares a range any more**; every shipped face is
static and spells out a single value.

### Which shape wins

**A `faces` key that IS an array is authoritative — including an empty array,
and including one whose every entry is malformed. The flat pair is read only
when `faces` is not an array** — which covers the key being absent, `null`, and
any non-array truthy value alike.

- `Array.isArray(contract.faces)` is the test. `contract.faces ?? [...]` is
  **wrong**: a non-array truthy value (an object, a string) must fall back to
  the flat pair rather than be walked as a face list.
- The asymmetry is deliberate. Falling back to the flat pair when a `faces`
  array turns out unusable would let a broken multi-face declaration lose its
  extra faces *silently* — bold simply stops rendering. Yielding nothing sends
  the family to "no supplying source", where a consumer can say so (in
  tmux-opener, the install nudge). Shows nothing rather than something wrong.

## Normalization (what a reader must compute)

The reference implementation is `normalizeContractFaces` in tmux-opener's
`src/font-registry.ts`; this is its specification.

1. **No contract at all** (`providedFont` absent) → no faces.
2. **`faces` is an array** → map it, keeping only *valid* entries, in
   declaration order. An entry is valid only when **both** `file` and `weight`
   are **non-empty strings**.
   - **The string requirement is a type requirement, not just a
     presence one.** `{ "file": "fonts/x.ttf", "weight": 700 }` — a JSON
     *number* rather than the string `"700"` — is **invalid**, and so is a
     `file` given as an array, an object, `null` or `true`. The entry is
     dropped **whole**; the reader does not coerce a number to a string, and it
     does not keep the `file` while discarding the bad `weight`. Write every
     value as a JSON string.
   - **There is no default weight inside `faces`.** An entry that omits
     `weight` is dropped, not defaulted. In a multi-face list a face declaring
     no weight says nothing about *which* face it is.
3. **`faces` is not an array** — absent, `null`, or any non-array value —
   → read the flat pair. `file` must be a non-empty
   string, otherwise there are no faces. `weight` defaults to **`100 700`**
   when it is absent, empty, or not a string.
   - **That default is flat-only.** It exists for the first single-file
     variable-font contract ever published here — `font-mplus1code` as it stood
     before #275, whose fvar axis really was 100–700. Since #275 that package is
     two static faces and **no shipped package relies on the default any more**;
     it is kept because it is part of the published contract, not because a
     bundled face still has that axis. It is not a general statement about
     faces, and rule 2 above does not apply it. A **static** face that inherits
     it silently declares a range it does not have — see "Static faces declare a
     single value" below, which is why every package here spells `weight` out.

The result is a `{ file, weight }[]`, and it is what every downstream step sees.
Nothing after normalization reads `contract.file` or `contract.faces` again.

## Degradation (when a family cannot be supplied)

Two stages, and they degrade differently on purpose.

### Declaration stage — the 400 rule

After normalization, **at least one face must cover weight 400**. 400 is what a
terminal asks for on a normal cell, so a family that cannot draw ordinary text
from the borrowed bytes must not be offered at all.

If no face covers 400 (including the case of zero faces), the **whole family**
has no supplying source: the consumer injects **no `@font-face` at all** for it
and the CSS stack falls through to the OS's standard monospace. It does not
inject a partial set.

**What counts as covering 400 is decided from numeric descriptor values only:**

- a single value — `"400"` — covers exactly that weight;
- a two-value range, space-separated as in the CSS descriptor — `"100 700"` —
  covers every weight between them inclusive.

Anything else is **not understood, and an unparsable claim is treated as no
claim**: an empty string, more than two tokens, a non-numeric token.

> **CSS keywords do not count.** `normal` and `bold` are perfectly legal
> `font-weight` descriptor values in CSS, and a browser would read `normal` as
> 400 — but this contract's reader does **not**. A face declaring
> `"weight": "normal"` is valid by rule 2 (a non-empty string) yet covers
> nothing, so a family whose only face declares `normal` resolves to "no
> supplying source". Declare weights numerically.

### Existence stage — per-face drop

A consumer that also checks the declared files are really on disk drops **only
the face whose file is missing**. A package that declares a bold face but ships
just the regular one keeps rendering with the regular face — the pre-existing
behaviour — instead of losing the family to the OS monospace, which would punish
a packaging slip far beyond what it broke.

The one exception is the 400 rule again: if the surviving faces include none
covering 400, the family goes to "no supplying source" as a whole. That keeps
the meaning of what a consumer offers ("every family offered can draw normal
cells from the borrowed bytes") true.

**This degradation is deliberately silent, and nothing at runtime reports it.**
A package that declares a bold face and ships only the regular one renders
exactly like a package that never declared bold: no warning, no notification,
no difference a user can see except that bold cells are synthesized again. The
repo-side cage is `npm test` (which checks every declared face against disk in
the source tree); what no machine layer here checks is whether a **published
VSIX** actually contains every declared face — that is a human step when
packaging.

**Two safety notes on the existence check itself**, because it runs in the
extension host rather than the webview:

- `localResourceRoots` does **not** protect it. That root is the access control
  for *webview resource serving*; an `fs` call in the extension host is outside
  it entirely.
- `Uri.joinPath` **resolves** `..`, so `.split('/')` — which does neutralize an
  absolute `file` — does not stop traversal. If you stat a declared path,
  confirm the resolved absolute path is still inside `fontExt.extensionUri`
  before calling `fs`. Otherwise a contract declaring
  `"file": "../../../../etc/shadow"` turns your check into a file-existence
  oracle outside the supplying extension. **Note that tmux-opener does not yet
  do this either**: `fontFileExistsInExtension` (`src/extension.ts`) hands
  `Uri.joinPath(ext.extensionUri, ...relFile.split('/')).fsPath` straight to
  `fs.existsSync` with no containment test. It is accepted on the same
  trust-boundary argument as the `font-weight` case below (the suppliers are the
  fixed extension ids hardcoded in `FONT_REGISTRY`) — **measured against this
  canon it is likewise short of it**, and the two are the only such points, both
  disclosed here rather than one left to look implemented.

## Static faces declare a single value; only a variable font declares a range

A `font-weight` descriptor is a **claim** about the face, and CSS font matching
selects a face whose descriptor covers the requested weight as *the real thing*
— it will not synthesize on top of it. So a **static** regular face declaring
`100 700` is picked for bold cells and painted at regular weight: the range
declaration **suppresses** synthetic bold rather than producing bold.

- A static face declares its own single weight: `"400"` for a regular,
  `"700"` for a bold. Never a range.
- A variable font declares its real axis (e.g. `"100 700"` for a face whose fvar
  wght axis really spans 100–700). That range is a true statement about the
  bytes. **No package in this directory is variable today**: `font-mplus1code`
  was, and was the example this rule used to cite, until #275 instanced it into
  static 400/700 faces — a conversion cannot edit a variable font's outlines
  without corrupting its `gvar` deltas, so the axis had to go before the refit.
  Keep the rule anyway; it is about what a declaration means, not about what
  happens to be bundled.
- Consequently, a family that wants real bold ships a real 700 face and
  declares it as a second `faces` entry — 700 covered by glyphs, not by a
  claim.
- **Instancing a variable font also has to move the style bits**, not just the
  weight: `instantiateVariableFont` updates `usWeightClass` but leaves
  `OS/2.fsSelection` and `head.macStyle` at the default instance's values, so a
  bold instance keeps claiming REGULAR unless something sets bit 5 and clears
  bit 6. `scripts/font-fit/fit.py` derives those bits from the style for exactly
  this reason (#275); the rendering here does not depend on them, but OS-level
  style linking in any other consumer does.

## Consumer steps

1. **Look the supplying extension up.**
   `vscode.extensions.getExtension('<publisher>.<name>')` returns metadata
   (`extensionUri`, `packageJSON`) for an installed extension **even when it has
   not been activated** — which is what a supply-only extension with empty
   `activationEvents` relies on. Always handle `undefined`: this is a **soft**
   dependency, so use a runtime check plus a fallback and **do not** put it in
   `package.json`'s `extensionDependencies` (which is a hard "won't run without
   it" dependency and cannot express "use it if present").

2. **Read `fontExt.packageJSON.providedFont` and normalize it** by the rules
   above, into a `{ file, weight }[]`. Never hardcode a font file path — that is
   what the contract's `file` fields are for, so a consumer follows a future
   layout change.

3. **Add `fontExt.extensionUri` to your webview's `localResourceRoots`.**

   ```js
   const fontExtensionRoots = fontExt ? [fontExt.extensionUri] : [];

   webviewView.webview.options = {
     enableScripts: true,
     localResourceRoots: [
       vscode.Uri.joinPath(context.extensionUri, 'media'), // your own root
       ...fontExtensionRoots,                              // the borrowed one
     ],
   };
   ```

   **This is the actual access control.** Without that root VS Code refuses to
   serve an `asWebviewUri` URL for a file under another extension — *before* it
   even evaluates the CSP. Conversely, once it is added there is **no need to
   widen the CSP's `font-src`**: `asWebviewUri` rewrites the borrowed file to
   the consuming webview's own resource authority, which is exactly what
   `webview.cspSource` returns, so an existing `font-src ${webview.cspSource}`
   already covers it. (Verified on real hardware in tmux-opener.) Entries need
   not live under your own extension; any `vscode.Uri` is accepted, and when the
   font extension is absent you add an empty array.

4. **Inject one `@font-face` per face**, all under the **same** `font-family`.
   `family` here is **your own registry's** family string, not
   `contract.family` — see "Injecting contract values safely" below:

   ```js
   // `family` comes from the consumer's own registry (tmux-opener: FONT_REGISTRY),
   // NOT from the contract. `faces` is the normalized list from step 2.
   let css = '';
   for (const face of faces) {
     // `.split('/')` is load-bearing, not just a separator convention: it makes an
     // absolute `file` ('/etc/passwd' -> ['', 'etc', 'passwd']) resolve relative to
     // the extension root instead of escaping it. `vscode.Uri.file(face.file)` or
     // string concatenation would lose that.
     const fileUri = vscode.Uri.joinPath(fontExt.extensionUri, ...face.file.split('/'));
     const fontUri = webview.asWebviewUri(fileUri);
     css += `
       @font-face {
         font-family: '${family}';
         src: url(${fontUri}) format('truetype');
         font-weight: ${face.weight};
         font-display: block;
       }`;
   }
   // .term { font-family: '<family>', monospace; }
   ```

   The faces differ only by their `font-weight` descriptor; **which face a bold
   cell gets is CSS font matching's decision, not the consumer's.** Do not pick
   a face per weight yourself, and do not vary `font-display` per face — holding
   text invisible until the face loads is uniform, and a `swap` on one face
   licenses exactly the visible substitution the uniform value avoids.

   The CSP that `<style>` lives under needs no widening for the borrowed font.
   tmux-opener's baseline, unchanged since before the borrowing existed, is:

   ```html
   <meta http-equiv="Content-Security-Policy"
         content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; font-src ${webview.cspSource};">
   ```

   `'unsafe-inline'` in `style-src` is what an injected `<style>` block needs;
   `font-src ${webview.cspSource}` already covers the borrowed file, because
   `asWebviewUri` rewrote it to this webview's own authority. That is the
   "existing `font-src`" step 3 refers to.

5. **Match family names longest-first** if you keep a registry of several. One
   registered family may be a *substring* of another (`Mgen+ 1mn` is a substring
   of `Rounded Mgen+ 1mn`), and a plain substring test would resolve a Rounded
   selection to the Mgen+ extension — borrowing from the wrong package.

### Injecting contract values safely

**A contract is another extension's data, and the validity rules above are not a
sanitizer.** They require non-empty strings; they say nothing about CSS
metacharacters, and a value that fails the 400 parse is merely "no claim" — the
face can still survive (another face covers 400) and its `weight` string is
still interpolated verbatim.

- **`font-family`: interpolate your own registry's constant, never
  `contract.family`.** A supplier-declared `family` of
  `x'; } body { display: none } @font-face { font-family: 'y` passes every rule
  in this document. The value lands **inside** the `@font-face` block, so its
  closing quote ends the `font-family` descriptor, its `}` ends the whole
  `@font-face` rule, and everything after it is parsed as new top-level CSS —
  here a `body { display: none }` rule, then a fresh `@font-face` opened so the
  trailing `';` of your template still parses. Since the contract's
  `family` exists to be *compared* with your registry entry rather than used
  (see "The injection does not depend on…"), using the constant costs nothing.
- **`font-weight`: interpolate only after checking it is a number or a
  space-separated pair of numbers** — the same parse the 400 rule already
  describes. Drop or ignore anything else rather than passing it through. **Note
  that tmux-opener does not yet do this**: `getHtml` writes
  `font-weight: ${face.weight}` verbatim, and `coversWeight400` only feeds the
  `some(...)` 400-coverage decision — the weights of the remaining faces are
  never parsed. It is accepted there on a trust-boundary argument (the suppliers
  are the fixed extension ids hardcoded in `FONT_REGISTRY`), not because the rule
  does not apply: **measured against this canon, the reference implementation is
  short of it on this one point.** Do not take that file as the pattern here.
- **Constrain the family names your registry may hold**, so a new entry cannot
  break out of the declaration either. tmux-opener asserts its registry against
  `/^[A-Za-z0-9 +-]+$/` in `test/font-registry.test.js`.

None of this makes a malicious font extension harmless — one that is installed
already runs in the extension host — but it keeps a supplier from reaching into
the consumer's webview CSS, and it costs one constant and one regex.

tmux-opener's `src/font-registry.ts` (resolution, kept free of any `vscode`
import so `node --test` drives it) and `getHtml` in `src/extension.ts` (URI
construction and injection) are a working implementation of all five steps.

## The injection does not depend on the font file's internal names

`@font-face` **declares** a family name; it does not read one. The consumer
interpolates a family string **it holds itself** into
`@font-face { font-family: … }` — in tmux-opener, its own `FONT_REGISTRY` entry
(`for (const { family } of FONT_REGISTRY)` in `getHtml`) — and **CSS font
matching never consults a file's internal `name` table.** A face whose name ID 16
said something else entirely would be injected, matched and painted exactly the
same way.

**On the injection path the contract's `family` is not read at all.** What
`getHtml` takes from the contract is `file` and `weight`, nothing else;
`resolveBundledFontSource` likewise keys off the registry and never looks at
`providedFont.family`. Say it precisely — the opposite claim ("the consumer
interpolates the contract's value") has now been made three times in this
repository, and this canon exists to end that.

Three consequences, and none is optional reading:

- **A measured `name`-table row in a package README is evidence about the
  font, not about the mechanism.** Recording that two faces share one
  typographic family is what makes pairing them under a single CSS
  `font-family` *legitimate* (and their metrics agreement expected rather than
  coincidental). It is not what makes the injection *work*.
- **The contract's `family` matters as a declared string that must equal the
  consumer's own registry entry** — two declarations, on two sides of the
  convention — not as an input to the injection. Precisely because it is never
  read there, a disagreement is **symptomless**: resolution, injection and
  rendering all still succeed while the two declared names differ. That is why
  a machine check is needed and why `test/font-registry.test.js` holds one in
  both directions (⊆ and ≡).
- **Interpolating a *supplier-declared* string into your CSS is also the less
  safe of the two.** A `family` your own registry holds is a constant you
  control; a `family` read out of another extension's `package.json` is a value
  that extension controls, and the contract's validity rules (non-empty strings)
  do not exclude CSS metacharacters. See "Injecting contract values safely"
  under the consumer steps.

## Conventions for the packages in this directory

These are repo-side rules for `font-packages/*`, not requirements the contract
imposes on a third-party supplier.

- **Always keep the flat alias.** A `faces`-only contract (no flat
  `file`/`weight`) is legal by the reader specification above, so a third-party
  package may ship one. The extensions in **this** repo nevertheless always
  declare the flat pair alongside `faces`, byte-equal to the 400-covering face,
  so that a consumer running an older reader still gets a usable regular face.
  The machine cage for it is `test/font-registry.test.js`, whose equivalence
  guard asserts `providedFont.file` / `providedFont.weight` against the single
  400-covering `faces` entry whenever a `faces` array is present.
- **One font, one extension.** Each family is supplied by its own
  independently-versioned extension (`{publisher}.font-{slug}`), never by one
  extension carrying several fonts. À-la-carte install and independent
  versioning are the reason; "don't bloat the consuming VSIX" must not simply
  move to a bloated pack.
- **A package's `version` names the bytes it publishes, and the reason for a
  bump is written down in the change that makes it.** The question a bump
  answers is "did what this package publishes differ from what was published
  under the previous version number?" — not "how large was the diff that
  carried the bump", which is a different question and usually a smaller one.
  It has to be recorded, because the two answers come apart routinely and
  nothing in the repository can reconstruct the intent afterwards. Worked
  example, #289: `font-mgenplus-1mn`, `font-rounded-mgenplus-1mn` and
  `font-mplus1code` went **0.1.0 → 0.2.0** while that change edited only their
  READMEs. The bump is not for the READMEs — it is for the **six TTFs**, all of
  which differ from the bytes published as 0.1.0, because #291 (`fitRatio`) and
  #293 (`vstretch`) rebaked them and neither touched a version. Minor rather
  than patch: rebaked outlines are a change a user can see on screen, and it is
  the one class of change worth being able to read off the version alone.
  `font-plemoljp-console` stayed at **0.0.1** in the same change — unmodified
  regime, no rebake reached it, and its shipped bytes are the ones already
  published. Docs-only re-publishes (a correction to the Marketplace Readme or
  License tab, with the TTFs untouched) are patch bumps for the same reason.
  **Measure before writing the reason down**: `git show <commit>:<path> |
  sha256sum` against the current file, per face, is the whole check —
  `3bfd558` is the commit that set 0.1.0 for the three packages above.
- **Every package is in exactly one of two provenance regimes, and which one is
  a fact rather than a judgement: a package listed in
  `scripts/font-fit/manifest.json` ships conversion output; a package absent
  from it ships the upstream bytes unmodified.** That file is the conversion
  pipeline's job list, so membership and "was converted" cannot drift apart.
  The two regimes make **different** claims and are proved differently — the
  two-column sha256 table for the unmodified regime, a three-link chain for the
  conversion regime — and both are specified below. Adding a font means
  deciding, first, which regime it is in.
- **A package in the unmodified regime places fonts byte-for-byte as
  distributed**, under their original file
  names — renaming or subsetting puts the package under the derived-work rules
  of licenses like OFL §5 for no benefit — with the distribution's own license
  and README files shipped alongside at their archive-internal paths.
  - **Exception — a distribution archive that carries no license or README of
    its own.** Some releases ship the font files alone (PlemolJP's zip contains
    zero license and README entries), so there is nothing to place alongside
    them and the clause above cannot be satisfied as written. Then take the
    primary license text from the **upstream repository at the tag
    corresponding to that release**, take it into the package, and record every
    fetched document in the package's provenance. **A document shipped as a
    file of its own gets the same two measured columns a TTF gets**:
    `source URL | sha256 (fetched)`, measured on the downloaded file before it
    was placed, and `placed at | sha256 (placed)`, measured on the placed file
    afterwards. Such a document is shipped bytes like any other, so the reason
    the two columns exist — measuring only the placed file and copying the
    number into both compares the file with itself and verifies nothing (see
    "Provenance regime 1") — applies to it unchanged: **when
    a placed file exists, do not collapse the row to one column.**

    **A document taken in by quotation gets a `—` instead, and names where it
    went.** A package's `LICENSE.txt` may be *assembled* (an OFL body plus the
    copyright lines the `name` table carries), and a fetched document quoted
    verbatim into it has no placed file to hash: write `placed at` as the
    quotation site (e.g. `quoted verbatim in LICENSE.txt`) and `sha256
    (placed)` as `—`. That row is not a collapsed two-column row — the
    prohibition above is about *files*, where hashing one file twice would be
    the self-comparison. Record instead that the quotation was checked
    byte-identical against the fetched document, which is the same claim the
    right-hand column would have carried.

    This exception is about the accompanying documents only; the
    byte-for-byte rule for the font files themselves is untouched, and an
    archive that *does* carry its license and README is handled exactly as
    above. The PlemolJP Console HS package is the first to take this route.
- **Family names are measured, not assumed.** A package README records what
  `fc-scan` (or an equivalent) read off **each** shipped face. What that
  measurement records is the name the conversion *wrote*; how the name is
  **chosen** in the first place is the next section.

### How a shipped family name is derived

**This section decides the name a converted package ships. It is a naming rule,
not a licence rule** — the Reserved Font Name check below is a separate, harder
constraint that can veto a name this rule produces, and it runs whatever this
rule says. Two independent questions, asked in this order:

```
<upstream family name> + " Term"
```

- **` Term` is the mark of conversion output**, and it means a specific pair of
  facts about the bytes: a width-1 code point advances exactly one cell **and**
  its ink fits the cell as this directory's contract defines fitting (see
  "Terminal width conventions"). **An unconverted package never takes it** —
  `PlemolJP Console HS` ships upstream bytes under the upstream name. So the
  suffix and membership of `scripts/font-fit/manifest.json` are the same fact
  twice, and the provenance regime a package is in (three-link chain vs.
  two-column sha256) can be read off its name.
- **Upstream variant words are kept — except one whose meaning ` Term` already
  carries.** The deciding question is about **meaning**, and it is a judgement
  rather than a mechanical test: **does the word assert the same property
  ` Term` asserts** — a width-1 code point advancing exactly one cell, with its
  ink inside that cell? If it does, the two say one thing twice and the word
  goes. If it says something else — *which typeface* this is, or an axis
  orthogonal to cell width — it stays.

  | upstream | word | what the word says | already said by ` Term`? | verdict |
  |---|---|---|---|---|
  | `HackGen Console` | `Console` | upstream's mark for the terminal-oriented member of a pair — symbols pulled toward the cell | **yes** | **drop it**: the shipped name is `ShirokumaGen Term` |
  | `M PLUS 1 Code` | `Code` | *which typeface* this is — the monospaced sibling of the proportional `M PLUS 1` | no | **keep it**: `M PLUS 1 Code Term` |
  | `Mgen+ 1mn` and `Rounded Mgen+ 1mn` | `1mn` | upstream's designation for this cut of the family (weight is a separate token — `mgenplus-1mn-regular.ttf` / `-bold.ttf` in `scripts/font-fit/manifest.json`); the `m` in it is upstream's monospace mark (upstream's own naming — not measured here) | **only half of it** | **keep it**: `Mgen+ 1mn Term` / `Rounded Mgen+ 1mn Term` |
  | `PlemolJP Console HS` | — | — | — | **out of scope**: the package is unconverted, so it takes no ` Term` at all and there is no suffix for any word to duplicate. It ships upstream bytes under the upstream name, `PlemolJP Console HS` (measured: nameID 1 of both shipped faces) |

  **Partial overlap keeps the word.** ` Term` asserts *two* facts (one cell of
  advance, **and** the ink inside that cell), so a word can say part of what it
  says without duplicating it. That is the `1mn` row: monospace is the first
  fact only, and nothing in `1mn` claims the second — a claim #275's conversion
  had to *create* for those faces, since both failed the cell contract as
  shipped (see "The selection-time measurement", where the recorded failure is
  of the first fact: full-width advance on all nine probes, so the conversion
  had to produce both). Dropping it
  would also delete which cut of `Mgen+` these bytes are. Only a word that says
  **both** facts is redundant with the suffix; that is why the `Console` row is
  the only drop so far, and it matches the shipped names.

  **"Remove the word and ask whether upstream publishes what is left" is
  corroboration, not the procedure** — do not write it down as one. It is worth
  asking, and in its *rich* form it does real work: "is what is left the same
  typeface's sibling variant, or a different typeface?" separates the first two
  rows correctly — `HackGen` is HackGen Console's sibling, `M PLUS 1` is a
  different, proportional family — because finding a sibling hints that the word
  named a *treatment* of one typeface, while finding a different typeface shows
  it named the typeface. Two things keep it corroboration rather than the test.

  **Flattened to yes/no it decides nothing.** "Does upstream publish the name
  that is left?" answers **yes** for `HackGen` and for `M PLUS 1` alike, under
  opposite verdicts. That is the shape a *mechanical* test would actually be
  written in, and in that shape the answer cannot be what separates them; all the
  information sits in the richer "what is it" reading, which is already a
  judgement about meaning rather than a lookup.

  **And in its rich form it still gets `HS` wrong.** Removing `HS` from
  `PlemolJP Console HS` leaves `PlemolJP Console` — the same typeface's other
  variant, so corroboration says "drop". The meaning question keeps it: `HS` is
  upstream's release-variant mark for **"Hidden Space"**, the cut that does
  **not** add the ideographic-space visualization the default release carries
  (recorded, with the archive it came from, in
  `font-plemoljp-console/README.md`), which is an axis with nothing to do with
  whether a width-1 code point advances one cell or where its ink falls. **This
  one row is what demotes the corroboration question** — it is the only case
  where the two disagree — and it decides nothing today, because the rule does
  not reach an unconverted package, which is why the row above carries no
  verdict. It is what the next package with an orthogonal variant word will run
  into.

  **Say which cells were measured, on which file, and how reproducible that is**
  (#298). **None of the three upstream files is in this repository's working tree
  today**: the two HackGen faces were never bundled here, and `MPLUS1Code.ttf`
  was bundled twice and deleted twice — from `media/fonts/` in #199 (`f809787`)
  and from `font-packages/font-mplus1code/fonts/` in #275 (`3bfd558`), the commit
  that replaced it with the conversion output. Every "measured" below was taken
  on a copy outside the working tree, and the two rows are re-obtainable by
  **different routes**, not by the same route to different degrees:

  | upstream file | what was measured on it | getting that file again |
  |---|---|---|
  | `HackGen-Regular.ttf` and `HackGenConsole-Regular.ttf`, both from `HackGen_v2.10.0.zip` | their `name` tables read `HackGen` and `HackGen Console`, and **both advance every ASCII printable 0x21–0x7E at the same 540 units** — one monospace typeface in two variants, not two typefaces | **by fetching, and only by fetching**: neither upstream file has ever been tracked in this repository (`git log --all --diff-filter=A --name-only` lists no HackGen face). The shipped `ShirokumaGenTerm-*.ttf` are not a substitute for one: they do carry the upstream outlines — `font-shirokumagen/README.md` records contract ②, 0 of 13,101 body glyphs changed per face, and `LICENSE.txt` is written on that basis — but at converted advances and under a different name, so they are the conversion's output, not a copy of the file this row is about. `manifest.json` records the archive's `url` and `archiveSha256`, so a downloaded copy can be *verified* — but re-obtaining it depends on that release asset still being served. The Console faces additionally carry a per-face `srcSha256` there; plain `HackGen` has no entry of its own, so it is pinned only through the archive hash |
  | `MPLUS1Code.ttf` | its `name` table reads `M PLUS 1 Code`, and it too is monospaced (500) | **from this repository's own history, deterministically** — the strongest of the three, and not by way of the manifest: `git show 3bfd558^:font-packages/font-mplus1code/fonts/MPLUS1Code.ttf \| sha256sum` returns `ff68678c…fd36`, which is exactly the `srcSha256` the manifest records for both of that package's faces (measured; the blob deleted in #199 has the same hash). What is *not* re-obtainable is the upstream **archive** it came in: that entry's `url` and `archiveSha256` are both `null`, with the reason in its `unrecorded` field |

  **Not measured here**: that `M PLUS 1` is a separate proportional family. No
  file of it has ever been in this repository, and that row rests on upstream's
  own catalogue. What this repository *can* read is the conversion **output** —
  nameID 1 of `MPLUS1CodeTerm-Regular.ttf` is `M PLUS 1 Code Term` (measured),
  carrying the `Code` this rule kept — but that is the name the rule *produced*,
  not the upstream name it was asked about, so it corroborates nothing on its
  own.

  **One more thing was measured, and it does not change the table's verdict.**
  The upstream `HackGen Console` faces do **not** meet this directory's cell
  contract — see the HackGen Console row under "The selection-time measurement
  (evaluating an upstream candidate)" — which is why the package was converted
  rather than bundled unmodified. So `Console` and ` Term` differ in **warrant**:
  `Console` asserts the property, ` Term` is the measured claim that it holds of
  *these* bytes. They do not differ in **what is said**, and the table's column
  asks only that: `Console` says the same thing ` Term` says, hence **yes** and
  hence "drop it". Warrant is not a second meaning, so it cannot save a word —
  read the two sentences together and the disagreement is only apparent.
- **Rename the base name only when a Reserved Font Name forbids it**
  (`HackGen` → `ShirokumaGen`; OFL 1.1 §3, measured with
  `scripts/font-fit/check-license.py` — see "Reserved Font Name check"). The
  variant-word rule above is unchanged by that substitution: it is asked about
  the *upstream* name, before the base is swapped.
- **Our own future axes stack AFTER ` Term`** (`… Term NL`), so the suffix stays
  the boundary between what upstream called the face and what we did to it.
- **Getting this wrong is cheap only before the first release.** A family name
  that has shipped is a value in users' `settings.json`, and changing it then
  costs a permanent alias entry (`FontRegistryEntry.aliases`) that can never be
  removed. Decide the name in the change that adds the package; #298 renamed one
  family (`ShirokumaGen …`) precisely because it had not been published yet, and
  took **no** alias for that reason.

### Provenance regime 1 (unmodified) — the two-column sha256 table

**This is the regime for a package absent from `scripts/font-fit/manifest.json`,
and it is not a legacy section**: `font-plemoljp-console` is in it today and
ships its upstream TTFs untouched, so the rules below are live. They also apply,
unchanged, to the **accompanying license and README documents of a converted
package** — those are placed byte-for-byte whatever happened to the TTFs beside
them.

Each package records the bytes it ships in a table with **two** measured hash
columns:

| archive entry | sha256 (entry, on extraction) | placed at | sha256 (placed) |
|---|---|---|---|

- The **left** column is the hash of the archive entry **measured before the
  file was placed into the repository** — off the extracted file in a scratch
  directory. The **right** column is measured on the placed file afterwards.
- **Hashing only the placed file and copying the number into both columns
  verifies nothing**: it compares the placed file with itself, while the claim
  being made ("byte-for-byte identical to the distribution") is a claim about
  the *archive*. Two independently measured columns agreeing is what makes the
  row evidence.
- The rule is **per row**, and it holds for a face added later just as much as
  for the original ones: a new face's left column is the entry hash measured on
  extraction, not a copy of its right column. Because the rule is stated here,
  a package need not restate it or annotate individual rows — an explanatory
  note present in one package's table and absent from another's reads as a
  difference between the packages when there is none.

### Provenance regime 2 (conversion output) — the three-link chain

**This is the regime for a package listed in
`scripts/font-fit/manifest.json`** — today `font-mgenplus-1mn`,
`font-rounded-mgenplus-1mn`, `font-mplus1code` and `font-shirokumagen`, whose TTFs
are refitted for terminal cells rather than placed as distributed.

**The two-column rule cannot be carried over, and stretching it would be a
forgery.** Its claim is "byte-for-byte identical to the distribution", proved by
two independent measurements of the *same* bytes. A converted file is not
identical to anything upstream published, and the file it would be compared
against — the upstream TTF — is deliberately absent from this repository (design
#271 weighed committing upstream TTFs as fixtures and rejected it: that undoes
the size reduction #199 was taken for). Writing the output hash into both columns would
compare the file with itself: the exact empty claim the two-column rule exists
to forbid.

What replaces it is a **different** claim, not a cheaper version of the same
one: **where the input came from, what turned it into the output, and what the
output hashes to** — three links, each measured, none of them checkable against
upstream by any machine here.

**The section carrying it has a fixed heading**, and the package README
(English) writes it exactly:

```
## Provenance (upstream archive → conversion → output)
```

**That string is a machine key, not a style preference.** From #276 the
manifest-vs-package equivalence check in `test/font-cellfit.test.js` matches on
it, so a package that is in the manifest and has no such section — or has one
under a reworded heading — is a failure rather than a silent gap. **Changing the
string is therefore only permissible in the same commit that changes the test**;
split them and one side is passing against a heading the other no longer writes.
(An unmodified package keeps the plain `## Provenance` heading; the arrow form
is what marks the conversion regime.)

**Link 1 — the upstream archive (the input).** URL and the archive's own sha256,
measured on the download in a scratch directory, plus the sha256 of every entry
taken out of it. The entry hashes are the same values `manifest.json` carries as
`srcSha256`, and `run.sh` re-checks all of them against the source directory it
is given **before it writes a byte**, so a mixed-up input fails there instead of
producing a plausible-looking output.

- **A value that was never measured is recorded as absent, never guessed.** A
  package that predates the two-column rule may have no archive URL or archive
  hash on record; then `manifest.json` carries `upstream.url` and
  `upstream.archiveSha256` as `null` with the reason in `unrecorded`, and the
  README says so in prose. An invented hash is indistinguishable from a measured
  one, which is precisely why it must not be written. (`font-mplus1code` is the
  live instance: its conversion input is the unmodified TTF this repository
  itself shipped until #275, hashed as it stood.)

**Link 2 — the conversion (what turned input into output).** The pipeline is
`scripts/font-fit/run.sh` driven by `manifest.json`, and the record names:

- **Which converter, by content: the sha256 of each file in `scripts/font-fit/`
  that determines the output** (`fit.py`, `instance.py`, `verify.py`,
  `dump-widths.mjs`, `run.sh`, `manifest.json`) — **not a commit SHA.** A git SHA
  is content-addressed, so **a file cannot name the commit that contains it**.
  Recording one leaves exactly two options, and both were hit in #275: split the
  TTFs, the `checksums.json` record and the provenance table across two commits —
  breaking the single-commit coupling the sha256 binding depends on — or leave a
  placeholder for someone to substitute later, which ships silently the first
  time they forget. File hashes have neither problem: they are knowable while
  the text is being written, they survive rebases and history rewrites, and they
  identify the converter directly instead of via a commit that also carries
  unrelated changes.
  - **Adding a package invalidates every other package's `manifest.json` row.**
    The manifest is one of the hashed files, so a new entry changes its hash and
    the value recorded in the packages that were already there is now a hash of
    a file that no longer exists. **Re-measure and update link 2 in every
    converted package's README in the same commit that adds the new one** — and
    the same holds for any edit to `fit.py`, `instance.py`, `verify.py`,
    `dump-widths.mjs` or `run.sh`. Nothing checks these values (see "What the
    machine layer does and does not verify"), so a missed one drifts in
    silence: it stays a plausible-looking hex string that no longer names
    anything.
- **Measured tool versions, printed by the run rather than copied from
  documentation** — fontTools, the Python interpreter itself, and
  `@xterm/addon-unicode11` (the width provider; see "Terminal width
  conventions" for why a hand-written table is forbidden).
- **The fixed environment**: `PYTHONHASHSEED=0`, `LC_ALL=C.UTF-8`, and fontTools
  saved with `recalcTimestamp=False`. Without the last one `head.modified` is
  rewritten on every save, every run produces different bytes, and link 3 means
  nothing.
- **What the run changed and what it did not** — the per-face refit counts, the
  **`fitRatio` and `vstretch` the run was driven by**, and the three
  conversion-time gates
  (`verify.py`, run per face, non-zero exit aborting the run): every **in-scope**
  code point satisfies the declared ratio — ink ≤ `A × fitRatio`, centred on the
  cell whenever it leaves the cell, advance exactly `A`, and the widest ink in
  the face lands exactly at the declared room (read from the bbox `glyf` stores;
  scope is the four-exclusion set under "Terminal width conventions", **not**
  every width-1 code point) — and no body glyph's outline moved. The last of the
  four ink conditions is what keeps the gate **tight against the declaration
  rather than merely loose**: without it, declaring a larger ratio would relax
  the check instead of describing the bytes, and a face refitted at one ratio
  would pass under another (#291; the same defect shape as #270's missing red
  path). The body-glyph half is measured
  on the **outline point sequence**, not on bounding boxes — fontTools
  recalculates every glyph's bbox on save, so a bbox comparison reports
  unchanged curved glyphs as changed.
  - **The third gate is the vertical one (#293)**, and it is an *equality*
    rather than a bound — **on the glyph's top and bottom edges, not on its
    height**: a selected glyph's edges must equal
    `vertical centre ± (equal-scale height / 2) × max(1.0, min(vstretch, room left to the 漢 box))`
    within the rounding tolerance. Both halves are load-bearing and each kills a
    different lie — bytes baked at `vstretch = 1.0` fail a 1.3 declaration on the
    lower half, bytes baked at 1.3 fail a 1.0 declaration on the upper half (both
    directions were run, on a real face, before this sentence was written).
    Measuring the **edges** rather than the height is what makes the gate match
    the mechanism: the transform preserves each glyph's vertical centre, so a
    height equality is satisfied by bytes that pushed an off-centre glyph past
    the line, and #293's first cut shipped exactly those (the height-clamped
    bytes fail this form of the gate on their own declaration — run, before this
    sentence was written). **The equality is still a mirror of the converter's
    expression, so it can only catch an implementation that departs from that
    expression — not an expression that is wrong**, which is how the height cap
    got through: `fit.py` and `verify.py` held the same misreading and the
    equality stayed green. Beside it therefore sits a check that recomputes
    nothing (③c, #293 review Low-A): each refitted glyph's reach must stay inside
    `max(漢 box, its own equal-scale reach)` on each side — the property the
    documents claim, stated without the clamp expression, so a wrong expression
    fails here even when the equality passes (measured: on the height-clamped
    Mgen+ Regular bytes, paired with the height-form equality of that era, the
    equality reports 0 and this check reports 312; the shipped reach-form ③a
    reports 303 on those same bytes, since it was fixed too). It is
    also the ONLY place the vertical value is bound to bytes: unlike the
    horizontal contract, `npm test` cannot re-check it from the shipped file
    alone, because the equal-scale height it compares against lives in the
    upstream file the repository does not carry. That gate measures the
    **decomposed outline's control box**, not the stored bbox the horizontal
    contract reads; mixing the two measures produces false failures, since the
    stored box is the narrower of the two.

**Link 3 — the output (what is shipped).** The sha256 of each placed TTF,
measured after placing, and recorded in `scripts/font-fit/checksums.json` as the
same values, **each beside the `fitRatio` and the `vstretch` it was baked at**
(#291 / #293 — a sha256 can say the bytes moved, never why). From #276 `npm test`
compares the two, so a TTF
and its record can only move together; since #291 it also compares the recorded
ratio against the manifest's declaration, which is the only check that catches a
declaration raised without re-baking (the geometry gate cannot: a larger declared
ratio only widens the band the shipped ink already fits). The `vstretch` record
carries more weight still: for the vertical value that comparison is the only
repo-side check in *either* direction, for the reason given under link 2.

#### How strong the reproducibility claim is

Record it as a **measurement, not a promise**: *re-running the pipeline on the
same machine, from the same input, with the tool versions above, produced
byte-identical output.* That is what was done and all that was done.

**Nothing is claimed about a different fontTools or a different Python** — that
was not tested — **and the effect of environment variables beyond the ones fixed
above is likewise unverified.** Writing "reproducible" without those limits would
be the same species of empty claim as a two-column table whose columns are one
measurement copied twice: a statement whose evidence is not what it appears to
be. The variables the record therefore names are exactly the ones that were
pinned: the three tool versions and the fixed environment of link 2.

#### What the machine layer does and does not verify

The repo-side cage is the sha256 binding of link 3 (in `npm test` from #276),
and it catches the **accident** — a TTF replaced out of band, a face swapped for
its sibling, a record left un-updated — because those move one side only. It
does **not** catch a TTF and its recorded hash rewritten together, and nothing
here checks the tool versions, the environment or the script hashes that links 1
and 2 record; they are a record, not a value recoverable from the shipped bytes.
So `npm test`, once that check is in it, **detects accidents; it does not
prevent tampering.**

The full statement of that limit — what each of the three layers (conversion-time
outline measurement, sha256 identity, `npm test` regression) is and is not
entitled to claim — is design #271's 「検証の限界」 section, which is its single
canonical wording. It is deliberately **not** restated here: three copies of one
paragraph is how the copies start disagreeing.

### Reserved Font Name check (required for every modified package, every time)

**OFL 1.1 §3 forbids a Modified Version from carrying a Reserved Font Name, so a
package in the conversion regime must establish which names are reserved
*before* it chooses its own.** Do this when adding such a package **and again on
every upstream update** — a new upstream release can add a reserved name, and
the derived name that was legal last time is then not.

The procedure, and the record it must leave:

1. **Run `scripts/font-fit/check-license.py` over the package** — do not rebuild
   a search by hand. The tool enumerates every file under the path, decides what
   each one is from its **leading bytes**, scans the text files, and opens the
   fonts to read their `name` table (every record, every face of a TTC):

   ```sh
   ~/.local/share/fonttools-venv/bin/python scripts/font-fit/check-license.py \
     font-packages/<package> --derived-name '<the family name you intend to ship>'
   ```

   (Same venv as `run.sh`; `$FONTTOOLS_PY` if it lives elsewhere.) **Read the
   exit code, not just the prose** — "did it say OK" and "did it finish the
   check" are different questions:

   | exit | meaning |
   |---|---|
   | 0 | no violation, measured against at least one reserved name |
   | 3 | the derived name **contains** a reserved name (OFL §3 violation) |
   | 4 | **nothing to compare against** — zero reserved names found, so the OK is vacuously true. Legitimate for some packages (`font-mplus1code` really does declare none); say so explicitly with `--allow-zero-reserved`, which turns it back into 0 |
   | 5 | **held, not passed** — either the phrase sat on a line the tool could not parse into names, or the derived name matches a reserved one **once spaces are removed** (`MPLUS1CodeTerm` against `M PLUS 1 Code`, which is exactly how this repository names its derivatives). Read those lines; `--allow-spaceless-match` accepts the second case explicitly |
   | 1 | the check did not complete (path missing, fontTools absent, bad arguments) |

   4 and 5 exist because an OK that nobody could distinguish from a real pass is
   how a detector goes quiet: exit 0 with an empty stderr looks identical from a
   `set -e` wrapper whether it compared four names or none.
2. **Record every line the tool printed in the package README**, verbatim — the
   tool prints them all, including the lines that declare no name (OFL's own
   definition clause, headings, prose), because a verdict is only as good as the
   search that produced it and a table listing only the interesting hits cannot
   be re-derived by a reader. Record the `name`-table rows (`path#face:nameID N`)
   too: they are part of this check, not an extra (#286 C-1).
   **The candidate list comes in two groups, and the split is part of the
   record**: names the licence *quoted* (`"PlemolJP"`, `'Source'`) and candidates
   picked up *without* quotes. Both are compared against the derived name — an
   unquoted declaration is a real form (`with Reserved Font Name Cica`, measured)
   — but only the first group is a *declaration* as far as the record is
   concerned; the second is where the tool's deliberate over-capture lives (see
   "One candidate in that output is over-capture", below). Transcribe both, under
   their own headings, and do not promote a residual candidate into a claim that
   the package reserves that name.

   **Those lines are cited as `<file>:<line>`, so the cited file's line numbering
   becomes part of the record.** Measured today, with
   `command grep -o 'LICENSE\.txt:[0-9]\+' <README> | sort -u | wc -l` for the
   distinct column and the same pipeline without `sort -u` for the citation
   column: four of the five packages quote line numbers into their own
   `LICENSE.txt`, in each of `README.md` and `README.ja.md`
   (`font-shirokumagen` **11 citations of 5 distinct lines**, `font-mgenplus-1mn`
   and `font-rounded-mgenplus-1mn` **7 of 6** each, `font-mplus1code` **2 of 2**;
   `font-plemoljp-console` cites none). **Count citations and distinct lines
   separately** — a repeated citation is a second thing that breaks, while a
   distinct line is a thing that must not move, and `font-shirokumagen` is the
   package where the two numbers differ.

   **Part of that record is machine-checked and part is not, so list which
   before editing a cited file.** `test/font-cellfit.test.js`'s section (5)
   ("license-record line binding") compares a *transcribed* citation —
   a whole line of the form `font-packages/<pkg>/<file>:<N>: <text>` in a
   package README — against the Nth line of the cited file, so moving such a
   line turns `npm test` red. The packages that record the check as a table of
   bare `` `…:<N>` `` cells transcribe no text, so that comparison has nothing
   to make and does not reach them. The transcribed citations today:

   ```sh
   git grep -h -E '^font-packages/[^ :#]+:[0-9]+: ' -- 'font-packages/*/README*.md' \
     | sed -E 's/:([0-9]+):.*/:\1/' | sort -u
   ```

   10 lines, all in `font-shirokumagen` — five of them
   `LICENSE.txt:{79,109,118,121,216}`, the rest under `licenses/`.

   So an edit to a
   `LICENSE.txt` either **keeps the cited lines at their line numbers**, or it
   re-runs `check-license.py` and re-transcribes into both READMEs **in the same
   commit**. #298 took the first route in
   `font-shirokumagen/LICENSE.txt`: the file stayed at 276 lines and the five
   cited lines (79 / 109 / 118 / 121 / 216) did not move, at the cost of a few
   short-wrapped lines around 120–122. **That unevenness is the constraint, not
   sloppiness — do not reflow it on its own**: a reflow that moves a cited line
   breaks a record on the Marketplace License tab, and where the citation is a
   table cell rather than a transcription it breaks it silently.
3. **State the conclusion against the chosen name** by recording the tool's
   `--derived-name` judgement line verbatim: which reserved names exist, and
   that the derived family name contains none of them. Everything that qualifies
   the verdict is **on that one line** — a degraded run (`[劣化実行]`), a held
   verdict, a spaces-removed match — precisely so that a record cut down to the
   verdict cannot look cleaner than the run was.

**Why a tool and not a `grep` command written out here.** Every one of the three
pitfalls below was measured on real bytes, and the third one **cannot be closed
by any grep over files at all** — the hand-built search is not merely
error-prone, it is blind to that case. #285 rebuilt the search by hand and came
within one step of missing a reserved name for exactly that reason. The tool
closes all three by construction:

- **Case.** OFL prose writes the phrase title-case, but a section heading may
  shout it. `font-plemoljp-console/LICENSE.txt:48` is exactly that
  (`RESERVED FONT NAME:`). Measured with the tool: 6 hit lines over that file,
  and 5 under `--control-case-sensitive` — the missing one being the file's own
  conclusion.
- **No extension filter — and no encoding filter either.** Bundled upstream
  license documents routinely have no extension
  (`font-plemoljp-console/licenses/LICENSE_IBM-Plex` and `licenses/LICENSE_Hack`;
  the Mgen+ packages' `LICENSE_E` / `LICENSE_J`). The tool **never looks at a
  file's name** — text, font and binary are told apart by the leading bytes, so a
  rename cannot defeat it. Measured on a synthetic extensionless fixture carrying
  one RFN line: found by default, and under `--control-ext-filter txt` the
  reserved name disappears and a violating derived name is reported as **OK** — a
  green from a detector that searched nothing.
  **The same hole opens on the encoding axis**, and the first version of the tool
  had it: deciding "text" by whether the bytes decode as UTF-8 threw away a
  Shift_JIS `LICENSE_J`, a UTF-16 one and a Latin-1 one **without even printing
  their paths** (measured — all three declared a reserved name, and the tool
  answered `0 件 → OK`). Text is now decided by the **absence of NUL bytes** (with
  UTF-16 taken by its BOM) and read with `errors="replace"`, which is enough
  because the phrase itself is pure ASCII; the files it does skip as binary are
  **listed by path**, since a count alone cannot tell an `icon.png` from a
  license.
- **The `name` table, which no file search reaches.** A package can declare a
  reserved name **only inside the font binary**: Source Han Code JP's repository
  `LICENSE.txt` has no RFN line at all, and `'Source'` is reserved in nameID 0
  (#285, measured). Text-only procedures miss this by construction. Measured on
  the shipped bytes: the two Mgen+ packages' TTFs carry `'Source'` in nameID 0,
  agreeing with the `'Source'` their READMEs already record from `LICENSE.txt`;
  on a synthetic face whose nameID 0 is the *only* declaration, the tool finds it
  and `--control-skip-name-table` loses it.

**The `--control-*` switches are positive controls, and belong to no real
check.** They degrade the tool on purpose so that each pitfall has a run that
goes red; an all-clear from a detector nobody proved was detecting is what #270
named the GREEN CONTROL problem. Never pass one while performing this step —
the tool prints a two-line banner on **stdout and stderr** when you do, and
prefixes every verdict line with `[劣化実行]`, so a record that was cut down to
the verdict still shows it.

**Re-running the controls: the fixtures are generated, not committed.** Control 1
goes red on the shipped bytes, but 2 and 3 need files this repository does not
ship, and a control nobody else can re-run is not evidence. Build them (into
scratch — do not commit them) and run the three pairs:

```sh
PY=~/.local/share/fonttools-venv/bin/python
$PY scripts/font-fit/make-fixtures.py /tmp/rfn-fixtures     # from the repo root
$PY scripts/font-fit/check-license.py --self-test           # extraction regression table
```

Each control is a **pair** of runs — clean, then degraded — and it is the
*difference* that is the evidence:

| control | clean | degraded |
|---|---|---|
| 1 case | `font-plemoljp-console/LICENSE.txt` → 6 hit lines | `--control-case-sensitive` → 5 |
| 2 extension | `/tmp/rfn-fixtures/text/LICENSE_E --derived-name 'FixtureExtless Term'` → exit 3 | `--control-ext-filter txt` → exit 4 (vacuous OK) |
| 3 `name` table | `/tmp/rfn-fixtures/font/Probe-Regular.ttf --derived-name 'NameTableOnlyProbe Term'` → exit 3 | `--control-skip-name-table` → exit 4 |

`--self-test` is the fourth control and the one that guards the part with no
files at all: a table of `(line → expected names)` over the extraction rule.
**It carries every shape that was ever measured to slip through** — 23 of them so
far, from three separate rebuilds of the extractor. The first rebuild's six were an
unquoted name pushed out by an unrelated quotation, `Names Foo and Bar`,
backticks, a lowercase name, parentheses, and two declarations on one line; the
second's nine were a name behind ordinary prose (`Names **are** Foo and Bar`,
`Name **of** Cica`, and a name that *starts* with such a word — `Note Sans`), and
a name following a quotation (`Name "Alpha" **and Bravo**`); the third's six were
a name after a bracketed aside (`Names Hack **(the base)** and NerdFonts`), after
an abbreviation's full stop (`Name Inc. **Quux**`) and after a semicolon
(`Name Zeta; **Eta**`). Every one of them made the tool answer **OK** for a name
that contains a reserved one.

**All three rebuilds failed the same way: some condition made the parse stop
early** — first "a quotation was found", then "a prose word came next", then
"the sentence ended, or a bracket opened" (that third one dropped the rest of an
enumeration, and split a name at an abbreviation's full stop: `Name Inc. Quux`
reported `Inc` and lost `Quux`). So the rule now has **no stopping condition at
all**: `.` `;` `。` `(` `)` `[` `]` are boundaries that *divide* candidates rather
than end the scan, everything after the phrase is read, and only then are
prose-only candidates discarded. A place that is never skipped cannot be silently
skipped — that is the property being aimed at, rather than a fourth patch. The
discard list's misses are now over-captures (a spurious candidate a human throws
away), where before they were silences; the negative cases in `--self-test`
(OFL's definition clause and friends) keep that list honest in the other
direction, and a small **forbidden-candidate list** pins the two over-captures
that would have broken the verdict itself. Run it after touching
`extract_names`; it exits 6 on any regression. One boundary is deliberately
*not* resolved: an **unquoted CJK** fragment cannot be split into words, so the
line is reported as held (`unresolved`) rather than guessed at.

**No automatic gate reaches any of the three Python tools here.** `npm run lint`
is JavaScript only, and Semgrep's bundled rules are all
`languages: [typescript, javascript]` (measured, #273) — so nothing checks
`check-license.py`, `survey.py` or `make-fixtures.py` on your behalf, and
`npm test` staying green says nothing about them. (`make-fixtures.py` earns its
place by making the controls above re-runnable at all; it holds no judgement
logic, and it verifies its own seed — a seed face that already declared a
reserved name would leave control 3 green while proving nothing.) What stands in
for a gate is exactly two things: the
positive controls above, and the recorded numbers each tool must reproduce
(`font-packages/README.md` for this check, #285's measurements for `survey.py`).
Neither defends against a deliberate rewrite of tool and record together — the
same limit link 3's sha256 binding carries, stated in "What the machine layer
does and does not verify".

**Division of labour: this document owns the Why and the record; the tool owns
the search.** What must be recorded, and that an all-clear is a *result* rather
than a licence to skip the step, is stated here. How the search is performed —
matching, extraction, which files are opened — is
`scripts/font-fit/check-license.py`'s docstring, which is canonical for it and
deliberately not restated here. If the two ever disagree, the tool is what ran.

**What the tool scans, and the one thing it leaves out.** Everything under the
path, recursively; binaries that are not fonts are skipped and **listed by path**
(a `.vsix` is a zip and is **not** unpacked — check a packaged extension's entries
by hand, per "Packaging a font extension" below). The
files named `README.md` / `README.ja.md` are skipped **wherever they sit** because
they hold *this very record*, and scanning them would make the record quote
itself and change on every edit; they are **listed by path too**, since an
upstream archive can perfectly well declare a reserved name in a `README.md`, and
`--all-files` reads them. (Skipping only the
ones directly under the path given was worse than useless: pointed at
`font-packages` it let every package's README in — 73 hit lines, 52 of them the
records themselves — while excluding the one file that is not a record, this one.)
That skip names two files, not an extension class — an upstream `LICENSE.md` is
still read.

**What the check catches, as an instance rather than a hypothetical:**
`font-plemoljp-console` declares **three** reserved names — `"PlemolJP"`
(`LICENSE.txt:46`, restated at `:131`), `"Plex"` (`licenses/LICENSE_IBM-Plex:1`)
and `"Bitstream"` / `"Vera"` (`licenses/LICENSE_Hack:5`). None of the three
packages converted in #275 declares a reserved name their derived `… Term` names
touch — `'Source'` in the two Mgen+ packages, none in `font-mplus1code` — so the
process passed for all three. But had PlemolJP been converted too, mechanically
appending a suffix to its family name would have published a name containing a
Reserved Font Name to the Marketplace. **All-clear is the expected result of this
step; it is not a reason to skip it.**

**#289 is the case where that hypothetical was real, and the step changed the
name.** `font-shirokumagen` converts HackGen Console, whose upstream `LICENSE`
declares `"白源"` and `"HackGen"` as reserved (measured, `licenses/LICENSE_HackGen:10`),
and whose bundled Hack document brings in `"Bitstream"` / `"Vera"` as well. A
mechanically suffixed `HackGen Console Term` would have carried a reserved name;
the derived name is `ShirokumaGen Term` instead, and both it and the
Japanese name 白熊源 were run through `--derived-name` before either was written
anywhere. Note also that this package's `name`-table stage found **nothing** —
its nameID 0 carries four copyright notices and no `with Reserved Font Name`
clause — so here the stage a `grep` cannot reach is what turns "no declaration in
the binary" from an assumption into a result.

**Re-run over every package present when the tool landed (#288, measured).** The
set of *text* hit lines the tool reports is identical, line for line, to the
table each package README already records: `font-mgenplus-1mn` 7 lines
(quoted: `'Source'`, plus 8 residual candidates — see the over-capture paragraph
below), `font-rounded-mgenplus-1mn` 7 (quoted: `'Source'`, plus 6 residual),
`font-mplus1code` 2 (no name declared anywhere, and no residual either),
`font-plemoljp-console` 10 (quoted: `PlemolJP` / `Plex` / `Bitstream` / `Vera`,
plus one residual `OFL`). **The quoted group is exactly what those READMEs
record**; the residual group is new and is over-capture, not a correction. The tool reports **two rows no
README carries**, in each Mgen+ package: `fonts/…-Regular.ttf#0:nameID 0` and
`…-Bold.ttf#0:nameID 0`, both declaring `'Source'`. That is not a disagreement
about which names are reserved — the name is the one those READMEs already
record — it is the `name`-table stage producing evidence that did not exist when
they were written, and those package READMEs have not been rewritten to include
it. A package README updated from here on records the tool's output in full,
name-table rows included.

**Some of that output is over-capture, it is confined to the unquoted group, and
it is meant to be visible.** Both Mgen+ packages come out with `'Adobe'`, `'OFL'`
and a few phrase fragments beside the quoted `'Source'`, off prose lines such as
`RESERVED FONT NAME: the Adobe line above reserves the name 'Source' (OFL` —
proper nouns sitting in a sentence *about* a reserved name, which the extractor
cannot tell from a declaration and therefore keeps. This is the direction the
tool is deliberately wrong in: a spurious candidate costs a human one glance at
the line it came from (printed right beside it), while a dropped one costs a
published name. Two things keep that trade from turning into alarm fatigue —
candidates are capped at five words (a name is not a sentence) and a candidate
with a single alphanumeric character is discarded outright, because such a
candidate makes *every* derived name containing that letter a violation (`'c'`
out of `Copyright(c)`, `'s'` out of `Foo's Sans`; both were measured). Record the
residual group with the rest and say what it is; do not tune it away.

**The stale evidence stayed; the stale instructions did not.** Those same package
READMEs also carried the old `grep` command *as the procedure to follow*, and the
two are not equally harmless: an out-of-date record is behind, while an
out-of-date instruction tells the next person to use a method that **cannot reach
the `name` table at all**. So each of the six files that carried one (the three
packages converted in #275 × `md` / `ja.md`) now opens its `grep` block with a
superseding note pointing here, while
the tables below them are left as the record that `grep` produced. **#289 closed
the other half**: those six files now also carry the `name`-table rows the `grep`
could not reach, as a separate table marked as such rather than folded into the
old one — two rows declaring `'Source'` in each Mgen+ package, and in
`font-mplus1code` the explicit statement that the stage found none (which is why
its run exits **4**, a vacuously true OK, rather than 0). The two tables carry
different line numbers for the same files, because `LICENSE.txt` has been
rewritten since the `grep` ran; that is what keeping the old table as a *record*
means. `font-shirokumagen` (#289) has no `grep` block at all — it was written
against the tool from the start and records its output verbatim.

### Packaging a font extension: check the VSIX carries every declared face

A declared face whose file is missing from a **published** VSIX degrades
silently — the family renders with the faces that are there, i.e. exactly its
pre-bold behaviour, with no warning anywhere (see "Existence stage — per-face
drop"). `npm test` checks declared faces against the files in the **source
tree**, and no gate here reads a font extension's zip.

So when packaging a font extension: **list the VSIX entries and match them
against the contract's declared faces by hand.** A green suite is not evidence
about the package you are about to publish.

### Terminal width conventions — a width-1 code point must not be squashed

**There are two ways a package satisfies this, and they belong to the two
provenance regimes.** A package in the conversion regime satisfies it by
**construction**; a package in the unmodified regime satisfies it only if the
upstream face already did, which is a **selection-time measurement** someone
takes on the candidates. Both are below, contract first.

#### The contract the conversion guarantees

For a package listed in `scripts/font-fit/manifest.json`, the refit establishes,
for every code point **in scope**: `advance == A` (the cell width; **A itself is
unchanged by the refit** — the terminal's grid never moves, though setting a
selected glyph's advance *to* A is usually a change to that glyph), the glyph's
ink at most `A × fitRatio` wide, and that ink centred on the cell whenever it
reaches past it, so the overhang is symmetric.

**`fitRatio` is a bound on the overhang, not containment**, and since #291 its
shipped value is **1.15** — so ink may reach about 7.5% of a cell into each
neighbour. It is `scripts/font-fit/manifest.json`'s `note` that defines the
value's meaning, its 1.5 ceiling (the renderer's squash threshold) and the
current default; **that note is the single definition and this section
deliberately does not restate it.** What belongs here is the shape of the
guarantee: *nothing is squashed*, and any overhang is bounded and symmetric —
which is weaker than the `ink ⊆ [0, A]` this contract asserted until #291, and is
weaker on purpose. The old containment made symbols noticeably smaller than an
unconverted face draws them (`①` at em 0.480 against PlemolJP Console HS's
0.616); at 1.15 it measures em 0.574, still below that reference, while the
`1.0 < ink/A ≤ 1.5` band it now sits in is the band the renderer leaves alone.

**The refit is not equal scaling, and has not been since #293.** A selected
glyph's ink is scaled by `s` horizontally and by up to `s × vstretch` vertically,
with `vstretch` shipping at **1.3** — so the horizontal statement above is the whole
of the horizontal story, and the vertical one is a separate claim with a separate
bound. The reason is arithmetic: scaling a 928-unit-wide `①` down to 588 takes
its height down to 588 as well, which is *below the cap height* (748) of the same
face — the symbol reads as small because it is short, not because it is narrow,
and horizontally there is nothing left to give. What bounds the growth is
**measured per font rather than chosen**: the **top and bottom edges** of that
face's own 漢 (U+6F22), and the vertical factor is clamped per glyph so the
stretched glyph stays inside them. **The bound is on reach, not on height**, and
the difference is the whole of the safety argument — the transform preserves each
glyph's vertical centre, so a height cap alone still lets an off-centre glyph
push past the line, which is what #293's first cut measurably did. The true
statement is therefore **conditional**: the refit pushes nothing past that
kanji's edges, and a glyph already past them at equal scaling gets no vertical
stretch — it is left with the shape equal scaling gives it, which on a face that
HAS a pre-#293 release is exactly what that release shipped. #289's two faces
have no such release, and the paragraph below states what the floor does and does
not mean for them. An unconditional "nothing reaches further than 漢"
is false of every face here whatever the clamp does, because upstream draws
symbols taller than 漢 to begin with.
A font without that codepoint is refused outright rather than converted against a
guessed value. As with `fitRatio`, the meaning, the limit and the current default
are defined once in `scripts/font-fit/manifest.json`'s `note` and are not
restated here; **1.3 is a chosen value, not a derived one** (a nearby measurable
reference exists — cap height 748 over symbol width 588 is 1.272 — but the value
was picked by looking at five bakes, not computed from it).

**"Every selected glyph gets taller" is false**, and the quantity matters more
than the direction: the clamp's floor is 1.0, so a glyph with no room left
between the equal-scale edges and the 漢 box gets **no vertical stretch at all** —
its vertical factor is the same `s` its horizontal one is, which is equal
scaling. That is a statement about the *stretch*, not about the glyph, and the
two coincide only where equal scaling is itself a no-op: on a face that HAS a
pre-#293 release the equal-scale output is that release's bytes (measured: all
**144** floored glyphs of `MgenPlus1mnTerm-Regular` are byte-identical to the
#291 file), so there the floor does mean "unchanged". On #289's two faces — the
same exception the horizontal claim below carries — there is no previous release
to be equal to, and equal scaling still sets the advance to A, scales the ink by
`s` and re-centres it in the cell: of the **595** floored glyphs of
`ShirokumaGenTerm-Regular` only **8** come out identical to their upstream
input (**11** of **579** in the Bold), compared as decomposed outlines together
with the advance and side bearing.
Measured on the shipped
bytes, per face: **857 of 1001** selected glyphs grew in `MgenPlus1mnTerm-Regular`
(the other 144 had no room), 899 of 1020 in its Bold, 868 of 1000
and 896 of 1019 in the Rounded pair, 19 of 46 / 25 of 67 in the M PLUS 1 Code
pair, and 1128 of 1723 / 1115 of 1694 in the ShirokumaGen Term pair
(#289). The complement of that claim is measured too: across all eight faces, **0**
glyphs reach outside their face's 漢 box that did not already at equal scaling —
and on `ShirokumaGenTerm-Regular` the count outside went *down*, 593 → 592.
**The horizontal side did not move at all**: `hmtx` — every advance and
every left side bearing, all 18,109 glyphs of the Regular face — is byte-identical
to the pre-#293 release, and the widest in-scope ink is still 588 of a 512-unit
cell (measured, both faces of both Mgen+ packages). That comparison is only
available for a face that HAS a pre-#293 release; #289's two do not, and their
horizontal claim is stated against their upstream input instead (1656 / 1621
advances changed, no other).

**Scope is not "every width-1 code point".** It is the four-way classification
the renderer's own rescale predicate makes, taken from it rather than invented
here:

| excluded | why |
|---|---|
| `cp <= 0xFF` — ASCII and Latin-1 | **xterm never rescales these**, so ink reaching slightly past the advance does no harm; it is ordinary typography rather than a defect. Taking them into scope would refit the body text itself (`A M V W`). |
| The BMP private use area (U+E000–U+F8FF) | Powerline / Nerd Font glyphs, which the renderer leaves alone. The supplementary private-use planes are **not** excluded, because xterm does not exclude them either. |
| Box drawing (U+2500–U+257F) and block elements (U+2580–U+259F) | The WebGL addon's `customGlyphs` draws them as vectors without consulting the font at all. |
| Anything not width 1 | Rescaling only ever applies at width 1. A prototype that took width 2 into scope was found editing `ぃ`. |

**The first exclusion is load-bearing, and an earlier draft of this very section
left it out** — claiming the contract for *every* width-1 code point, which this
repository's own shipped bytes refute: in `MPLUS1CodeTerm-Bold.ttf` (`A` = 500)
`î` (U+00EE) advances 500 with ink `74 … 524` and `ï` (U+00EF) `74 … 509`
(measured). Both are width 1, both overhang, and both are correct — they are
Latin-1 and out of scope. Unmodified faces are the same, only more so:
`PlemolJP Console HS Bold` has 22 Latin-1 glyphs whose ink leaves the cell
(`A`, `V`, `X`, `Æ`, `©`, `¼` …) against one in its Regular (`©`). **State the
scope together with the claim**; a universal sentence about a set the pipeline
deliberately does not touch is false in the output of the pipeline that wrote it.

**Scope is deliberately wider than what the renderer actually rescales, and
only these four conditions are borrowed.** `allowRescaling` additionally
requires the glyph to be wider than `ceil(1.5 × cellWidth)` and not to be an
emoji codepoint; the refit **examines** any overhanging glyph, emoji ranges
included, because the codepoints that fall through those two conditions are
precisely the ones drawn over the neighbouring cell — the symptom #261 reported.
Borrowing the classification without the escape hatches is the point, not an
oversight.

**Examining is not the same as shrinking**, and #291 separated the two: an
examined glyph is scaled down only if its ink exceeds `A × fitRatio`, so at 1.15
a glyph 1.10 cells wide keeps its size and is merely centred — it still reaches
about 5% of a cell into each neighbour. The overhang #261 reported is therefore
**bounded and made symmetric, not removed**. What is removed is the squashing,
and the fullwidth-advance case behind the worst of #261 (a `2A` glyph handed one
cell), which the advance rewrite settles outright.

The predicates live in `scripts/font-fit/fit.py` (`target_advance` for the first,
second and fourth; the box-drawing / block exclusion is applied where the refit
collects each glyph's demanded width, since `customGlyphs` means no glyph is
demanded at all), in `scripts/font-fit/verify.py` as one four-term condition,
and from #276 in the test's own subject filter — three copies of one rule, which
is why they are written against the same four conditions.

`verify.py` gates every face at conversion time; from #276 `npm test` re-checks
the shipped bytes (`test/font-cellfit.test.js`, which reads the manifest to
decide what is in scope). Both read the bbox `glyf` stores rather than
re-deriving it from the outline, so a glyph left at its upstream bytes is
trusted to carry an accurate one — the residual false-negative is stated in
design #271 and not re-argued here. **An unmodified package does not opt in** —
it never made that promise, and holding it to one would fail the suite
permanently for symbols someone deliberately decided to live with.

**The width table is never hand-written.** Which code points count as width 1 is
read from the same provider the terminal uses — `@xterm/addon-unicode11`,
required out of `node_modules` and regenerated on each run — so the table
follows a package bump instead of going stale in a file nobody re-derives. A
hand-kept EastAsianWidth list dropped `⚠ ✓ ✔` in the #262 prototype and the gap
was invisible: every code point in the list passed, and the missing ones were
simply never asked about. Do not commit a generated width table either; that
freezes the same staleness one step later.

#### The selection-time measurement (evaluating an upstream candidate)

**When a face is to be bundled unmodified, whether its East Asian Ambiguous
code points are designed half-width is one of the measurements that decides
adoption.** Take it before adopting a face, not after someone reports that the
bullets look wrong. It is also worth taking on a conversion candidate, because
it says how much of the font the refit will have to touch.

**Why.** xterm.js counts an ambiguous codepoint as width **1**, so a glyph
designed on the full-width advance is handed one cell and squeezed horizontally
by `rescaleOverlappingGlyphs` — a filled circle comes out a tall narrow ellipse.
That option is **xterm.js's, defaulting to `false`, and tmux-opener turns it on**
(`rescaleOverlappingGlyphs: true` in `media/webview-terminal.js`) to match VS
Code, whose built-in terminal shows **the same squeezing** because its
`terminal.integrated.rescaleOverlappingGlyphs` defaults to `true` and is passed
straight through. So this is not a defect in the consuming extension but a
mismatch between the typeface's design and the terminal width convention, and it
cannot be settled on the consumer side — turning the rescale off trades
squeezing for overlapping the neighbouring cell, and widening the count to 2 in
xterm alone puts it out of step with tmux and with every program computing
columns through libc's `wcwidth()`, which count these codepoints as 1 and offer
no setting to change it. tmux-opener #261 rejected the consumer-side workarounds
on exactly those grounds (rescale off, excluding the range via `unicode-range`,
widening the count in xterm alone) and, separately, measured four candidate
faces before adopting one of them.

**"Squeezed" is one of two outcomes, and which one a given codepoint gets is not
something to assert lightly.** Rescaling is conditional: read out of the bundled
`@xterm/xterm`, `allowRescaling` requires width 1, a glyph wider than
`ceil(1.5 × cellWidth)`, a codepoint above `0xFF`, and **not** an emoji, a
Powerline glyph or private use. Two of those emoji ranges cover much of what a
terminal user thinks of as symbols — **U+2600–U+26FF** and **U+2700–U+27BF** —
so `⚠` (U+26A0), `★` (U+2605), `✓` (U+2713), `♨` (U+2668), `♬` (U+266C) and the
dingbat digits `❶–❿` (U+2776–U+277F) are **never** rescaled, and neither is
anything overhanging by less than half a cell: `①` in PlemolJP Console HS is
616/528 = 1.17 cells, under the `1.5` threshold. What is left in those cases is
the other outcome — the ink is drawn over the neighbouring cell.

So the safe formulation, and the one this document uses, is **"does not fit one
cell — squeezed or drawn over the neighbour"**. Which of the two happens follows
from the conditions above, and this repository has read them **statically, out
of a minified bundle; it has not observed them on screen**. The one real
observation on record points at the overlap branch: `①` repeated
(`①①①①①`) was seen overlapping in #261, which is what started the refit
work. Report a specific codepoint as *squeezed* only from an observation, not
from this paragraph.

**How to judge it — read `hmtx`.** Let `A` be the advance of an ASCII glyph.
For each sample below, look the codepoint up in `cmap` and read its advance:

| sample | codepoint | verdict |
|---|---|---|
| ● ○ ■ ★ ⚠ ✓ ✔ … ① | U+25CF U+25CB U+25A0 U+2605 U+26A0 U+2713 U+2714 U+2026 U+2460 | advance `== A` → half-width, designed for one column (whether the *ink* stays inside it is a second measurement — see below). advance `== 2A` → full-width: it does not fit one cell, and is squeezed or drawn over the neighbour per the conditions above. |

This is a direct sfnt read with no dependencies — the same approach
`test/font-metrics.test.js` already uses for the monospace ratio — and any other
*measuring* tool (`fc-scan`, a font library) does as well. It is independent of
the existing fullwidth check (that 漢 measures `2A`): a face can be perfectly
monospaced and still design every one of these symbols full-width.

**`scripts/font-fit/survey.py` takes these measurements** (#288) — block-by-block
coverage, the everyday-symbol samples with their per-face verdicts, and cell fit
with the **two conditions kept apart** (`advance` vs `ink`) over the in-scope and
whole-cmap series, plus `--codepoints U+00EE` for a single glyph's advance and
ink bounds. Its width table comes from `dump-widths.mjs`, so it uses the same
provider the terminal does. It is an **observation, not a gate**: it exits 0
whatever it finds, and what it reports is `glyf`'s stored bbox rather than a
re-measured outline — the same limit `verify.py`'s contract (1) carries. The
adoption decision, and reading the numbers, stay a person's.

**An advance of `A` is necessary, not sufficient — the ink can still leave the
cell.** `hmtx` says how far the pen moves, `glyf`'s bbox says where the ink is,
and a glyph may be centred on a one-cell advance while overhanging both sides.
Measured on the adopted PlemolJP Console HS (`A` = 528), among the nine samples
that advance one cell:

| face | one-cell advance, ink overhangs |
|---|---|
| Regular | `★` `-37 … 565`, `✓` `33 … 532`, `✔` `17 … 547`, `①` `-44 … 572` (four) |
| Bold | `★` `-44 … 572`, `✔` `-25 … 553`, `①` `-51 … 579` (three — `✓` is `0 … 528`, inside) |

**The two faces do not agree**, so a measurement taken on one of them is not a
statement about the family: `✓` overhangs in the Regular and fits in the Bold.
Measure every face, exactly as the family-name and metrics tables already do.
None of these were visible to the advance-only procedure — it reported eight of
the nine as passing, `⚠` being the only one it failed. Read the bbox too when
the question is whether the cell is respected; the advance alone answers only
whether the face claims one column.

**This is a selection-time measurement a person takes and records, and the
suite does not take it for you.** `npm test`'s ambiguous samples do not exist:
its width samples are the fullwidth ones, and the cell-fit check #276 adds
covers **converted** packages only (the manifest decides), on the contract stated
above rather than on this nine-sample list. A green suite is not compliance with
this section.

Three boundaries on the procedure:

- **A sample missing from `cmap` is not a pass.** It is an absence: the glyph
  comes from the OS fallback, whose design this package does not control, so
  record it as absent rather than counting it half-width. (Measured: of the nine
  samples, `MPLUS1Code.ttf` carries only `…`.)
  - **Skipping that detection produces a false PASS, not a visible error.** A
    codepoint absent from `cmap` looks up as gid 0 (`.notdef`), and gid 0's
    advance is `A` in **all ten** TTFs shipped here — re-measured on the
    current files, per package and face: 512/512 (Mgen+ 1mn Term), 512/512
    (Rounded Mgen+ 1mn Term), 500/500 (M PLUS 1 Code Term, two static faces
    since #275 where there used to be one variable file), 528/528 (PlemolJP
    Console HS), 540/540 (ShirokumaGen Term, added #289 — where gid 0 is
    named `.notdef#0#0#0` rather than `.notdef`, which is why the rule is stated
    over **gid 0** and not over a glyph name), each equal to that face's own `A`
    — so a reader that
    takes gid 0's width reports every missing symbol as a tidy half-width pass.
    Resolve "not
    in `cmap`" to *absent* before reading `hmtx`, exactly as
    `test/font-metrics.test.js` does.
- **`hmtx` is the default instance.** For a variable font these advances
  describe the default instance only and say nothing about the others. Every
  face shipped here is static since #275 (M PLUS 1 Code was the one with an
  `fvar` axis), so the caveat currently has no subject — keep it, because it
  re-arms the moment a variable face is bundled again. That limit is inherited
  from the existing metrics test, not new here.
- **Box drawing (U+2500–U+257F) and block elements (U+2580–U+259F) are out of
  scope.** The WebGL addon's `customGlyphs` — on by default — draws them as
  vectors without consulting the font at all, so their `hmtx` values say nothing
  about what appears on screen.
- **The nine samples are a sample, not the class.** East Asian Ambiguous has
  hundreds of members; these nine were picked because they are the ones that
  turn up in everyday terminal output. A `passes` verdict below therefore means
  *these nine measured half-width*, never *this face designs the whole
  Ambiguous class half-width*. Measured on the adopted face: a census of the
  Ambiguous ranges (box drawing and block elements excluded per the boundary
  above) puts PlemolJP Console HS Regular at roughly **409 half-width against
  90 full-width** — so ⚠ is the sample that fails, not the only codepoint that
  does. Enclosed letters (Ⓐ–Ⓩ, ⓐ–ⓩ), the dingbat digits (❶–❿), `∥` (U+2225),
  `♨` and `♬` stay full-width and still do not fit a cell — squeezed or drawn
  over the neighbour, by the conditions above (the dingbat digits, `♨` and `♬`
  fall in the emoji ranges, so the static read puts them on the overlap side).
  Widening the sample set
  is fair game; reporting a face as "half-width" without saying which samples
  were measured is not.

**Measured** (`hmtx`; both faces of a package agree, and the PlemolJP Console HS
row is the selection measurement that adopted it):

**These rows measure the UPSTREAM faces, at selection time.** Three of them are
no longer what this directory ships: #275 converted Mgen+ 1mn, Rounded Mgen+ 1mn
and M PLUS 1 Code, and the conversion sets a refitted glyph's advance to the
cell width — so the very rows marked **fails** below are the ones it fixed. The
table is kept as the record of *why each face was adopted or converted*, which
is a statement about the upstream bytes and stays true; it is not a description
of the shipped files. PlemolJP Console HS is the one row that is still both.

| upstream family (pre-conversion) | ● ○ ■ ★ ⚠ ✓ ✔ … ① | verdict at selection |
|---|---|---|
| Mgen+ 1mn | full-width, all nine | **fails** → converted in #275 (ships as `Mgen+ 1mn Term`) |
| Rounded Mgen+ 1mn | full-width, all nine | **fails** → converted in #275 (ships as `Rounded Mgen+ 1mn Term`) |
| M PLUS 1 Code (`MPLUS1Code.ttf`) | `…` half-width; the other eight **missing from `cmap`** (see the boundary above) | **not a pass** — eight verdicts are the OS fallback's, not this font's → converted in #275 (ships as `M PLUS 1 Code Term`); conversion cannot add a glyph the font never had, so the eight absent code points are still the OS fallback's |
| PlemolJP Console HS | half-width, all but ⚠ | **passes** on these nine, ⚠ accepted (see the sample boundary — the wider class is ~409 half / ~90 full) — **not converted**, ships upstream bytes |
| HackGen Console (`HackGenConsole-*.ttf`, v2.10.0) | `● ○ ■ …` half-width (advance 540 = `A`, ink inside the cell); `★ ⚠ ✓ ✔ ①` full-width (advance 1080 = 2A) — five of the nine, identical in both faces (measured with `survey.py`) | **fails** → converted in #289 (ships as `ShirokumaGen Term`). Every failure was an *advance* failure, which is precisely what the refit settles; on the wider 26-sample set the shape is nearly the same but not identical — **14 of 26 fail, 13 of them on the advance** (1080 against a 540 cell), while the fourteenth, `‰` (U+2030), already advances 540 and fails the ink test alone (ink `−1…541`) — and **0 are missing from `cmap`** |

**Every bundled family is listed above, including the ones that do not pass**;
being left out of this table is not a verdict, so do not read a family's silence
as compliance. Of the five, only PlemolJP Console HS was chosen on this
measurement as it stood:
the Mgen+ pair and M PLUS 1 Code were bundled as **text typefaces** — the Mgen+
faces designing all nine full-width, M PLUS 1 Code leaving eight of them to
whatever the OS falls back to — and neither was the one to pick for symbol-heavy
terminal work. #275 took the other route for those three: rather than dropping
them, it converted them, which is the second answer this convention admits.
Selecting a face that already measures half-width remains the cheaper one, and
is what to reach for first.

**HackGen Console is the one row adopted *because* it fails**, and that inverts
the reading of this table for it. It was not a candidate for unmodified bundling
at all: the measurement was taken to decide whether the refit could fix it, and
the answer — every failure is an advance failure, not a stray outline — is what
made it a good conversion candidate rather than a rejected face. The other
question that decided it is one this table does not ask, so it is stated here:
**coverage**, since a refit moves glyphs but cannot add one. It carries all 26 of
the wider sample set (against M PLUS 1 Code's 7) and 18,201 code points in cmap,
the most of any family here.

**One full-width sample was accepted in the adopted face.** ⚠ alone measures
`2A` in PlemolJP Console HS, so it does not fit its cell; that was weighed and
taken in #261, and it is recorded rather than hidden. (It sits in U+2600–U+26FF,
which `allowRescaling` excludes as emoji, so on the static read it is drawn over
the neighbour rather than squeezed — the earlier text here said "squeezed"
flatly. Neither branch has been observed on screen for this codepoint.) The
heading's `must` is the rule this convention exists to enforce — a face whose
everyday bullets are handed a cell they will be squashed into is what it
excludes — not a claim that one such symbol disqualifies a face outright. State which samples fail and
decide; do not report "half-width" for a face that has one.

**And the verdicts in that table are about advances only.** They were taken with
the `hmtx` procedure above, before the ink test was added to it, so `passes`
there means *designed for one column*, not *stays inside one column*: four of
the eight samples it passed overhang the cell in the shipped Regular face and
three do in the Bold, per the per-face table under "An advance of `A` is
necessary, not sufficient" (they are not the same three). The row stands as the
record of the decision that adopted the face — that decision was taken on these
numbers — and the overhang is the residue #271 recorded as deliberately left
alone: the packages whose *advances* disagreed with the terminal were converted;
a face whose advance is already right and whose outline merely overhangs was
not.

## Where the machine checks live

In tmux-opener's repository root, run by `npm test`:

- `test/font-registry.test.js` — the host side. Registry families ⇄ each
  `font-packages/*/package.json` `providedFont.family` in **both** directions;
  `EXPECTED_CONTRACT_FACES`, the per-extension expected list of face weights
  taken through the same `normalizeContractFaces` the runtime uses; the flat/
  `faces` equivalence guard; every declared face's file checked against disk;
  and the install-state matrix through `resolveExistingFontSource`.
- `test/webview-terminal-font.test.js` — the manifest/webview side (settings
  `enum`, `enumItemLabels`, `enumDescriptions` index positions, the webview's
  hand-kept family list).
- `test/font-metrics.test.js` — the monospace advance ratio read straight out
  of every shipped TTF, including the agreement *between* the faces of one
  package (the unit a single contract — and therefore a single `@font-face`
  family — is declared from).
- `test/font-cellfit.test.js` (from #276) — the conversion regime only, scoped
  by `scripts/font-fit/manifest.json`: the cell-fit contract on the shipped
  bytes, and each TTF's sha256 against `scripts/font-fit/checksums.json` so a
  font file and its provenance record can only move in the same commit. It also
  matches the fixed `## Provenance (upstream archive → conversion → output)`
  heading, which is why that string is not free to be reworded on its own.

Green means no declared string has drifted, no install state resolves the wrong
extension, and — from #276 — no converted byte has moved away from its record.
**It says nothing about pixels** — whether a bold cell is visibly heavier is a
human observation, not a machine one — and, for the provenance chain, that last
check detects accidents rather than preventing tampering (design #271's
「検証の限界」).

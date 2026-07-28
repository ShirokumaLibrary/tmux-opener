// Cross-extension font registry (#185, design #181 case A; vendored fallback
// removed in #199; generalized from one bundled family to N in #233/design #229;
// three families renamed to their converted `Term` editions in #275/design #271;
// a fifth family added as conversion output in #289/plan #287).
// The Tmux Opener terminal offers bundled monospace faces ("M PLUS 1 Code Term",
// "Mgen+ 1mn Term", "Rounded Mgen+ 1mn Term", "PlemolJP Console HS",
// "ShirokumaGen Term"). Each one's bytes come
// from its own dedicated *font extension* (`shirokuma-library.font-mplus1code`,
// #184, renamed to a generic id in #192; `…font-mgenplus-1mn` /
// `…font-rounded-mgenplus-1mn`, #233; `…font-plemoljp-console`, #264;
// `…font-shirokumagen`, #289)
// that ships the TTF and declares a `providedFont` contract in its
// `package.json`. When installed, the webview borrows the font from that
// extension's `extensionUri` (the cross-extension path SUB-A/#183 verified
// renders under the existing production CSP — see `resolveWebviewView`'s
// `localResourceRoots`, which is the real access-control requirement).
//
// When no such font extension supplies the face, the resolver returns
// `{ source: 'none' }`: getHtml injects no `@font-face` at all and the terminal
// falls to the OS monospace (`"M PLUS 1 Code Term", monospace` → `monospace`). The
// body no longer vendors a TTF under `media/fonts/`.
//
// This module is deliberately free of any `vscode` import so `node --test` can
// drive the resolver directly with a mocked `getExtension` (test/font-registry.test.js).
// The URI work (asWebviewUri, joinPath) stays in `src/extension.ts`, which reads
// the plain-data `FontResolution` this returns and builds the webview URIs from it.

/**
 * The first bundled family the terminal exposed as a fontFamily option (#174/#175),
 * renamed to its converted edition in #275. Its FORMER name lives on as an alias
 * (`MPLUS1CODE_FORMER_FAMILY`) so an existing `settings.json` keeps working.
 */
export const BUNDLED_FONT_FAMILY = 'M PLUS 1 Code Term';

/** Extension id of the shipped M PLUS 1 Code font extension (#184, renamed #192). */
export const MPLUS1CODE_EXTENSION_ID = 'shirokuma-library.font-mplus1code';

/**
 * Mgen+ 1mn Term and Rounded Mgen+ 1mn Term (#233, design #229; renamed in #275,
 * design #271 R1). The family strings are the TTFs' own English family names read
 * off the name table (ID 16 → 1) — measured again in #275 **after** the conversion,
 * because since then the shipped TTFs are no longer the upstream bytes: `font-fit`
 * (`scripts/font-fit/`) rewrites the name table along with the outlines, so these
 * strings state what the CONVERTED files declare. They must match the
 * `@font-face { font-family }` getHtml injects and the `providedFont.family` each
 * supplying extension declares.
 *
 * The ` Term` suffix is what OFL 1.1 §3 allows here: neither `Mgen+` nor
 * `M PLUS` is a Reserved Font Name in the respective licenses (measured, see each
 * package README's provenance section), so a modified version may keep the base
 * name. That is a per-font finding, not a rule — `PlemolJP` IS reserved, which is
 * one reason that package is not converted.
 *
 * NOTE: `Mgen+ 1mn Term` is a *substring* of `Rounded Mgen+ 1mn Term`, and each
 * former name is a substring of its own new name. Every match against a settings
 * value therefore goes through `matchRegisteredFamily` (longest-first over the
 * whole pool, canonical names and aliases together), never a bare `includes` over
 * the registry in declaration order.
 */
export const MGENPLUS_1MN_FAMILY = 'Mgen+ 1mn Term';
export const MGENPLUS_1MN_EXTENSION_ID = 'shirokuma-library.font-mgenplus-1mn';
export const ROUNDED_MGENPLUS_1MN_FAMILY = 'Rounded Mgen+ 1mn Term';
export const ROUNDED_MGENPLUS_1MN_EXTENSION_ID = 'shirokuma-library.font-rounded-mgenplus-1mn';

/**
 * The pre-#275 canonical names of the three families that were RENAMED by their
 * conversion — the values an existing `settings.json` still holds. (There are four
 * converted families since #289; `ShirokumaGen Term` is new, so it never
 * had a former name and declares no alias — "converted" and "carries an alias" are
 * not the same set.) They are registered as `aliases` (below),
 * which makes them resolve to the same extension AND get an `@font-face` block of
 * their own (`buildFontFaceCss`), so an untouched setting renders with the new
 * bytes instead of silently falling to the OS monospace.
 *
 * They are exported because they are load-bearing in three places at once (the
 * registry, the webview's hand-copied `BUNDLED_FAMILY_NAMES` pool, the tests), and
 * a former canonical is not a string anyone may re-spell later: it is a value on
 * users' disks.
 */
export const MPLUS1CODE_FORMER_FAMILY = 'M PLUS 1 Code';
export const MGENPLUS_1MN_FORMER_FAMILY = 'Mgen+ 1mn';
export const ROUNDED_MGENPLUS_1MN_FORMER_FAMILY = 'Rounded Mgen+ 1mn';

/**
 * PlemolJP Console HS (#264, plan #263 / issue #261). Same rule as the families
 * above: the family string is the TTFs' own name-table value, measured on both
 * shipped faces, not a name invented here. Unlike them it is NOT a conversion
 * output — this package ships the upstream bytes unchanged (its advances already
 * match the cell), so it keeps its name, declares no alias, and is absent from
 * `scripts/font-fit/manifest.json`.
 *
 * It is offered for a terminal-specific reason: the Mgen+ families draw East
 * Asian Ambiguous symbols (● ○ ■ ★ ✓ … ①) fullwidth, which xterm.js — counting
 * them as width 1 — squashes via `rescaleOverlappingGlyphs`. The Console variant
 * draws them at the ASCII advance (measured, #261/#264). No substring relation
 * exists between this name and any other registered family, so it adds no new
 * trap for `matchRegisteredFamily`'s longest-first match.
 */
export const PLEMOLJP_CONSOLE_HS_FAMILY = 'PlemolJP Console HS';
export const PLEMOLJP_CONSOLE_EXTENSION_ID = 'shirokuma-library.font-plemoljp-console';

/**
 * ShirokumaGen Term (#289, plan #287; renamed in #298 — the pre-#298 spelling
 * carried one more word and is deliberately written nowhere) — the first family converted by the
 * pipeline AFTER it was built, rather than as part of building it. Its bytes are
 * HackGen Console v2.10.0 refitted by `scripts/font-fit/` (one new manifest entry,
 * no script change), so the string here is the CONVERTED files' own name-table
 * value, measured on both shipped faces.
 *
 * It declares NO alias, and that is the point worth stating TWICE OVER. It is a
 * conversion output like the three above, but it is a NEW family rather than a
 * renamed one, so there was no former name on anyone's disk to keep resolving;
 * and the #298 rename does not create one either, because the pre-#298 spelling
 * was never published — an alias exists to protect a
 * value that is on someone's disk, and adding one for a string that never left
 * this repository would be a permanent entry protecting nothing.
 *
 * The upstream family (`HackGen Console`) was never offered by this extension, and
 * could not be reused as a derived name in any case — OFL 1.1 §3 reserves `"白源"`
 * and `"HackGen"` (measured with `scripts/font-fit/check-license.py`; the record is
 * in the package README), which is why the derived name is `ShirokumaGen …` rather
 * than a suffixed `HackGen …`. The upstream word `Console` was then dropped in
 * #298. WHY it was dropped — and how the same question is answered for the next
 * package — is written down once, in `font-packages/README.md` ("How a shipped
 * family name is derived"); read it there. It is deliberately neither restated
 * nor summarized here, because the summary that used to sit in this comment
 * reproduced a procedure that section now explicitly tells you not to write down
 * ("'Remove the word and ask whether upstream publishes what is left' is
 * corroboration, not the procedure"), and attributed it to that section as its
 * rule. What belongs here is only what is specific to THIS family: `Console` was
 * dropped, and the base name was replaced with `ShirokumaGen` for the RFN reason
 * above.
 *
 * No substring relation exists between this name and any other registered family,
 * so it adds no new trap for `matchRegisteredFamily`'s longest-first match.
 */
export const SHIROKUMAGEN_TERM_FAMILY = 'ShirokumaGen Term';
export const SHIROKUMAGEN_EXTENSION_ID = 'shirokuma-library.font-shirokumagen';

/**
 * The default `font-weight` for a FLAT contract that supplies a `file` but omits
 * `weight`. The value comes from the first such contract ever published — the
 * original variable M PLUS 1 Code, whose single face declared the whole fvar wght
 * 100–700 axis (measured in #176).
 *
 * Since #275 (design #271 R6) NO shipped package declares it any more: M PLUS 1
 * Code Term is two STATIC faces (400 / 700), so every bundled contract now spells
 * its weight out. The default is kept because it is part of the published contract
 * spec (`font-packages/README.md`), not because a shipped face still has that axis
 * — do not read this constant as a statement about any bundled font. A static face
 * must never inherit it: a range is a CLAIM to cover the weights in it, and CSS
 * font matching then picks that face for bold cells and paints them at regular
 * weight, suppressing synthetic bold instead of producing it.
 */
const DEFAULT_FONT_WEIGHT = '100 700';

/**
 * One registry entry: a bundled family and the extension id that supplies it.
 *
 * `family` is the CANONICAL name: the one the settings enum ships, the one the
 * nudge names, and the one every resolver keys off. `aliases` (optional, 0..n)
 * lists FORMER canonical names of the same family — old `settings.json` values
 * that must keep resolving to this extension after a rename (#274, design #271
 * R3). It is deliberately optional and the mixed state is the steady one: an
 * entry that never gets renamed simply never grows the field, and `?? []` folds
 * "absent" and "empty" into the same thing everywhere it is read, so such an
 * entry behaves exactly as it did before the field existed.
 *
 * Named (rather than inlined into `FONT_REGISTRY`) so `buildFontFaceCss` can take
 * the entries as a parameter and be driven from `node --test` with synthetic ones
 * — which is what covers the alias path while the real registry declares none.
 */
export interface FontRegistryEntry {
  family: string;
  extensionId: string;
  aliases?: readonly string[];
}

/**
 * Static registry: bundled family -> the extension id that supplies it.
 *
 * An entry carries an alias exactly when the family was RENAMED, which is not the
 * same as "was converted". Three of the four converted families were renamed by
 * #275 and carry their pre-#275 name; `ShirokumaGen Term` is conversion
 * output too but is a NEW family (#289), so it has no former name to alias; and
 * the unconverted `PlemolJP Console HS` was never renamed either. That mix is the
 * steady state the optional field was designed for, not a transitional gap — see
 * `FontRegistryEntry`.
 */
export const FONT_REGISTRY: ReadonlyArray<FontRegistryEntry> = [
  { family: BUNDLED_FONT_FAMILY, extensionId: MPLUS1CODE_EXTENSION_ID, aliases: [MPLUS1CODE_FORMER_FAMILY] },
  { family: MGENPLUS_1MN_FAMILY, extensionId: MGENPLUS_1MN_EXTENSION_ID, aliases: [MGENPLUS_1MN_FORMER_FAMILY] },
  {
    family: ROUNDED_MGENPLUS_1MN_FAMILY,
    extensionId: ROUNDED_MGENPLUS_1MN_EXTENSION_ID,
    aliases: [ROUNDED_MGENPLUS_1MN_FORMER_FAMILY],
  },
  { family: PLEMOLJP_CONSOLE_HS_FAMILY, extensionId: PLEMOLJP_CONSOLE_EXTENSION_ID },
  { family: SHIROKUMAGEN_TERM_FAMILY, extensionId: SHIROKUMAGEN_EXTENSION_ID },
];

/** One matchable name and the canonical family it stands for. */
export interface FamilyPoolEntry {
  /** A canonical family name or one of its aliases — the string that is matched. */
  name: string;
  /** The registry entry's canonical `family`, i.e. what a hit resolves to. */
  canonical: string;
}

/**
 * Every matchable family name — canonical names AND aliases — as ONE pool, sorted
 * longest name first (#274, design #271 R3).
 *
 * One pool, not a primary pass over canonicals with an alias fallback (rejected
 * option B): two passes would give the match two tie-break systems at once
 * (within-pool length, then pass order), and "which pass found it" is precisely
 * the kind of implicit ordering dependency R5/#233 was opened to remove.
 *
 * The pool only ever GROWS — an alias is never retired (design #271: this
 * extension has no telemetry, so there is no way to learn that an old value has
 * stopped being used; retiring one is a separate decision with its own migration
 * nudge). The cost of that monotonic growth is that every future name has to
 * coexist with every past one, including substring relations nobody planned. What
 * makes it safe is not review of each addition but the property test over the
 * whole pool (`test/font-registry.test.js`, "every name in the match pool resolves
 * to its own canonical family"): it walks whatever the pool contains, so a new
 * entry or alias is checked the moment it is declared, and a name that would be
 * swallowed by a longer one fails there instead of silently resolving to another
 * extension.
 */
export function familyMatchPool(): FamilyPoolEntry[] {
  return FONT_REGISTRY.flatMap((e) =>
    [e.family, ...(e.aliases ?? [])].map((name) => ({ name, canonical: e.family })),
  ).sort((a, b) => b.name.length - a.name.length);
}

/**
 * Just the names in the match pool (canonical ∪ aliases), in pool order. This is
 * what `media/webview-font.js`'s `BUNDLED_FAMILY_NAMES` hand-copy is checked
 * against (test/webview-terminal-font.test.js) — the webview has no module system
 * and cannot import this module.
 *
 * NOTE (same standing as `shouldNotifyFontExtensionMissing` below): this has **no
 * production caller**; both users are tests — the webview mirror check above and
 * the `INJECTABLE_FAMILY_NAME` guard in test/font-registry.test.js, which walks
 * canonical ∪ aliases through it. It is kept deliberately, not by oversight: it
 * is the name the "what the webview must mirror" claim is stated by, and deleting
 * it as an unused export takes the mirror check with it, at which point the
 * hand-copied webview pool drifts silently.
 */
export function registeredFamilyNames(): string[] {
  return familyMatchPool().map((e) => e.name);
}

/**
 * The registered family a `tmuxOpener.terminal.fontFamily` value selects, or
 * `undefined` when it selects none (#233, design #229 decision R5).
 *
 * The semantics of the match are the pre-existing ones: the enum ships a family
 * as a CSS stack (`"M PLUS 1 Code Term", monospace`) but a user may hand-write any
 * value naming the family — including in a fallback position — so a family counts
 * as selected when its name appears *anywhere* in the string.
 *
 * The tie-break: candidates are tried in **descending name length** (longest match
 * wins). `Mgen+ 1mn Term` is a substring of `Rounded Mgen+ 1mn Term`, and since
 * #275 each alias is a substring of its own canonical, so a registry-order
 * `includes` would report a Rounded selection as Mgen+ — resolving the wrong
 * extension, gating the Rounded picker entry on the Mgen+ extension's presence,
 * and naming the wrong extension in the nudge. Longest-first makes the containing
 * family win, and for non-overlapping names it is identical to the old behaviour.
 *
 * Since #274 the candidates are the whole `familyMatchPool()` — canonical names
 * and aliases together — but what comes BACK is always the canonical family. An
 * alias is a lookup key, never an answer: everything downstream (the resolver, the
 * picker gate, the nudge wording) speaks canonical, so letting an old name escape
 * here would spread the rename's compatibility layer across the whole body. The
 * webview's `bundledFamilyOf` deliberately does the opposite — see the comment
 * block in `media/webview-font.js` for why the two must not be made to agree.
 */
export function matchRegisteredFamily(value: string): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return familyMatchPool().find((e) => value.includes(e.name))?.canonical;
}

/** One face of a bundled family: the file that holds it and the weight it claims. */
export interface FontFace {
  file: string;
  weight: string;
}

/**
 * The `providedFont` contract a font extension declares in its package.json.
 *
 * Two shapes, one meaning (#247, design #245 §1): the flat `file`/`weight` pair
 * is the shorthand for a single face and stays supported permanently, while
 * `faces` declares N faces explicitly. `normalizeContractFaces` is the only
 * reader of either — everything downstream sees a `FontFace[]`.
 */
export interface FontContract {
  family?: string;
  file?: string;
  weight?: string;
  faces?: FontFace[];
  license?: string;
}

/** Minimal shape of `vscode.Extension` this resolver reads (kept vscode-free). */
export interface ExtensionLike {
  extensionUri?: unknown;
  packageJSON?: { providedFont?: FontContract };
}

/** Injected lookup — `vscode.extensions.getExtension` in production, a mock in tests. */
export type GetExtension = (id: string) => ExtensionLike | undefined;

/**
 * Where the bundled family's bytes resolve from, as plain data (no vscode.Uri).
 *
 * Resolution stays per FAMILY (design #245 R4): all three consumers — the
 * `@font-face` injection, the picker filter and the nudge — ask "can this family
 * be rendered from a font extension?", so the answer carries the family's face
 * list rather than being taken one weight at a time.
 */
export type FontResolution =
  | { source: 'extension'; extensionId: string; faces: FontFace[] }
  | { source: 'none' };

function isUsableFace(face: unknown): face is FontFace {
  if (typeof face !== 'object' || face === null) {
    return false;
  }
  const { file, weight } = face as { file?: unknown; weight?: unknown };
  return typeof file === 'string' && file.length > 0 && typeof weight === 'string' && weight.length > 0;
}

/**
 * The faces a `providedFont` contract declares, in declaration order (#247,
 * design #245 §1). This is the ONE place either contract shape is read.
 *
 * - A `faces` key that IS an array is authoritative — including an empty one, and
 *   including one whose every entry is malformed. The flat `file`/`weight` pair
 *   is read only when the key is absent. The asymmetry is deliberate: falling
 *   back to the flat pair would let a broken `faces` declaration lose its extra
 *   faces silently (bold simply stops rendering), whereas returning nothing sends
 *   the family to `{ source: 'none' }`, where the nudge speaks up. "Shows nothing
 *   rather than something wrong."
 * - An entry counts only with a non-empty string `file` AND `weight`. There is no
 *   `DEFAULT_FONT_WEIGHT` substitution inside `faces`: the default exists for the
 *   already-published flat contract (`font-mplus1code`), and a face declaring no
 *   weight in a multi-face list says nothing about which face it is.
 * - The flat pair normalizes to one face, `weight` defaulting as it always has.
 */
export function normalizeContractFaces(contract: FontContract | undefined): FontFace[] {
  if (!contract) {
    return [];
  }
  if (Array.isArray(contract.faces)) {
    return contract.faces
      .filter(isUsableFace)
      .map((face) => ({ file: face.file, weight: face.weight }));
  }
  if (typeof contract.file !== 'string' || contract.file.length === 0) {
    return [];
  }
  const weight =
    typeof contract.weight === 'string' && contract.weight.length > 0
      ? contract.weight
      : DEFAULT_FONT_WEIGHT;
  return [{ file: contract.file, weight }];
}

/**
 * Whether a `font-weight` descriptor value covers 400 — the weight xterm asks for
 * on a normal cell, so a family with no such face cannot draw ordinary text.
 *
 * Accepts the two forms a contract may declare: a single value (`"400"`) and a
 * range (`"100 700"`, space-separated as in the CSS descriptor). Anything else —
 * a keyword, an empty string, more than two tokens — is not understood, and an
 * unparsable claim is treated as no claim.
 *
 * It lives here, next to the normalization, because the check it feeds belongs to
 * the DECLARATION stage (design #245 §1): putting it in the existence check
 * instead would let a family with a broken declaration disappear from the picker
 * while the nudge — which reads `resolveBundledFontSource` — stayed silent.
 */
export function coversWeight400(weight: string): boolean {
  if (typeof weight !== 'string') {
    return false;
  }
  const tokens = weight.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0 || tokens.length > 2) {
    return false;
  }
  const values = tokens.map(Number);
  if (values.some((v) => !Number.isFinite(v))) {
    return false;
  }
  const [min, max] = values.length === 1 ? [values[0], values[0]] : values;
  return min <= 400 && 400 <= max;
}

/**
 * Resolve where the given font family's bytes should come from.
 *
 * If `family` is a registered bundled family AND its supplying extension is
 * installed with a contract that normalizes to at least one usable face covering
 * weight 400, borrow from that extension. Otherwise — no font extension, no
 * contract, no usable face (an empty/absent `file`, an empty or all-malformed
 * `faces` array), no face covering 400, or a non-registered family — there is no
 * supplying source and the result is `{ source: 'none' }`, on which getHtml
 * injects no `@font-face` at all (#199) and the nudge fires.
 */
export function resolveBundledFontSource(
  family: string,
  getExtension: GetExtension,
): FontResolution {
  const entry = FONT_REGISTRY.find((e) => e.family === family);
  if (!entry) {
    return { source: 'none' };
  }

  const ext = getExtension(entry.extensionId);
  if (!ext) {
    return { source: 'none' };
  }
  const faces = normalizeContractFaces(ext.packageJSON?.providedFont);
  if (faces.length === 0 || !faces.some((face) => coversWeight400(face.weight))) {
    return { source: 'none' };
  }

  return { source: 'extension', extensionId: entry.extensionId, faces };
}

/**
 * Resolve where the given family's bytes come from AND confirm the borrowed files
 * are actually on disk (#208, plan #207 task 1). Composes the unchanged
 * `resolveBundledFontSource` with an injected `fileExists` predicate, so getHtml
 * never injects an `@font-face` pointing at a file the extension declares but does
 * not ship. A `none` resolution passes through untouched — there is no file to
 * check, so the predicate is not called.
 *
 * With multi-face contracts the check is per FACE and so is the degradation
 * (#247, design #245 §3): a face whose file is missing is dropped ALONE. A
 * package that declares a bold face but ships only the regular one keeps
 * rendering with the regular face — i.e. exactly today's behaviour — instead of
 * losing the family to the OS monospace, which would punish a packaging slip
 * far beyond what it broke. Losing the 400-covering face is the one exception:
 * the family then goes to `{ source: 'none' }`, preserving the picker's meaning
 * ("every family offered can draw normal cells with the borrowed face").
 *
 * The repo-side cage for a declared-but-unshipped file is `npm test`
 * (test/font-registry.test.js checks every normalized face against disk); at
 * runtime the degradation is deliberately quiet, which is the pre-existing #208
 * bargain widened from one face to N.
 *
 * The predicate is injected (not an `fs` import) to keep this module vscode/fs-free
 * so `node --test` drives it with a mock — the same pattern as the injected
 * `getExtension`. The caller (`src/extension.ts`) supplies a closure that joins
 * the contract-relative `file` against the supplying extension's `extensionUri`
 * and stats it; the `path` the predicate receives is that contract-relative
 * `file` string.
 *
 * The predicate takes the **supplying extension id** as its second argument (#233,
 * design #229 §4). The resolution already carries it, so passing it costs nothing
 * and it is what lets the host closure stat exactly one extension root instead of
 * searching every registered font extension for a matching relative path — a
 * search that, with more than one font extension registered, would report a file
 * "present" because a *different* extension happens to ship the same relative name.
 */
export function resolveExistingFontSource(
  family: string,
  getExtension: GetExtension,
  fileExists: (path: string, extensionId: string) => boolean,
): FontResolution {
  const resolution = resolveBundledFontSource(family, getExtension);
  if (resolution.source !== 'extension') {
    return resolution;
  }
  const present = resolution.faces.filter((face) =>
    fileExists(face.file, resolution.extensionId),
  );
  if (present.length === 0 || !present.some((face) => coversWeight400(face.weight))) {
    return { source: 'none' };
  }
  return present.length === resolution.faces.length ? resolution : { ...resolution, faces: present };
}

/**
 * The characters an injectable `@font-face` family name may consist of (#274
 * follow-up; #233 follow-up L3 for the canonical half).
 *
 * The name is interpolated into `@font-face { font-family: '<name>' }` inside the
 * webview's inline `<style>` (see `buildFontFaceCss`), so a quote, backslash,
 * semicolon or brace would terminate the declaration early and take the rest of
 * the stylesheet with it. The class is deliberately loose — a guard against a
 * malformed *registry entry*, not a spelling rule: ASCII letters, digits, spaces,
 * `+` and `-` cover every canonical name the registry has (`M PLUS 1 Code Term`,
 * `Mgen+ 1mn Term`, `Rounded Mgen+ 1mn Term`, `PlemolJP Console HS`,
 * `ShirokumaGen Term`) and every
 * alias #275 added, with room for the obvious next ones. A family genuinely needing other
 * characters must widen this deliberately, having checked the escaping here.
 *
 * This constant is the SINGLE source of the rule: `buildFontFaceCss` enforces it
 * at runtime and `test/font-registry.test.js` asserts canonical names and aliases
 * against this same exported value rather than re-typing the pattern. A rule
 * written twice is one that can be widened once — and an alias is by definition a
 * former canonical, so the two halves can never legitimately disagree.
 */
export const INJECTABLE_FAMILY_NAME = /^[A-Za-z0-9 +-]+$/;

/**
 * The `@font-face` block set the webview's inline stylesheet gets, as a string.
 *
 * Extracted from `getHtml` (#274 follow-up) for the reason `src/font-options.ts`
 * gives for the same move: `src/extension.ts` imports `vscode` and cannot be
 * loaded by `node --test`, so anything decided in there is untestable. What was
 * left untested here was the alias loop — the ONE observable output the alias
 * mechanism produces — and a mutation dropping the alias-named blocks passed the
 * whole suite. `getHtml` keeps only the URI work: it supplies `faceUri`, which
 * joins a contract-relative file against the supplying extension's `extensionUri`
 * and rewrites it with `asWebviewUri`.
 *
 * A family is emitted under its CANONICAL name and under every alias it declares
 * — the same faces, one block set per name (design #271 R3). Resolving the alias
 * in the registry alone is NOT enough: with no alias-named block CSS finds no
 * face, `resolveFontForMeasure`'s `document.fonts.check` fails and the terminal
 * falls back to `DEFAULT_FONT_FAMILY`, dropping the user's setting entirely —
 * the exact silent breakage the alias exists to prevent. An entry declaring no
 * aliases emits one name, i.e. the pre-#274 output byte for byte.
 *
 * `faceUri` returning `undefined` skips that face (the supplying extension is not
 * installed, so there is nothing to point at). A name failing
 * `INJECTABLE_FAMILY_NAME` is skipped too, fail-closed: emitting it could break
 * out of the CSS string and disable the rest of the stylesheet, and one family
 * rendering with the OS monospace is strictly less damage than a webview with no
 * layout ("shows nothing rather than something wrong"). The test asserting the
 * registry's names is the first line of defence, but this repository has no CI —
 * nothing runs it unless a person does — so the invariant also holds at runtime.
 */
export function buildFontFaceCss(
  entries: ReadonlyArray<FontRegistryEntry>,
  resolve: (family: string) => FontResolution,
  faceUri: (extensionId: string, file: string) => string | undefined,
): string {
  let css = '';
  for (const entry of entries) {
    const resolution = resolve(entry.family);
    if (resolution.source !== 'extension') {
      continue;
    }
    // One @font-face per FACE the contract declares (#247, design #245 §4):
    // same family name, per-face src and font-weight, so a package shipping a
    // real 700 file gets bold cells drawn from it instead of relying on the
    // renderer to synthesize one. A flat (single-face) contract normalizes to
    // one face and produces exactly the pre-#247 output.
    //
    // font-display: block is uniform across faces — it holds text invisible
    // until the face loads rather than flashing a fallback. Splitting it per
    // face (e.g. `swap` for bold) would license the visible substitution the
    // webview's document.fonts.load await (resolveFontForMeasure) exists to
    // avoid.
    for (const face of resolution.faces) {
      const uri = faceUri(resolution.extensionId, face.file);
      if (uri === undefined) {
        continue;
      }
      for (const name of [entry.family, ...(entry.aliases ?? [])]) {
        if (!INJECTABLE_FAMILY_NAME.test(name)) {
          continue;
        }
        css += `  @font-face {
    font-family: '${name}';
    src: url(${uri}) format('truetype');
    font-weight: ${face.weight};
    font-display: block;
  }
`;
      }
    }
  }
  return css;
}

/** Every extension id in the registry — used to widen `localResourceRoots`. */
export function fontExtensionIds(): string[] {
  return FONT_REGISTRY.map((e) => e.extensionId);
}

/**
 * Whether the given `tmuxOpener.terminal.fontFamily` value selects *any* registered
 * bundled family. The enum ships each one as a CSS stack (`"M PLUS 1 Code Term",
 * monospace`), but a user may also type a custom settings.json value that names the
 * family, so this matches on the family name appearing anywhere in the string
 * rather than the exact enum entry (`matchRegisteredFamily`, longest-first).
 */
export function isBundledFamilySelected(fontFamily: string): boolean {
  return matchRegisteredFamily(fontFamily) !== undefined;
}

/**
 * The registered family the "font extension not installed" nudge should name, or
 * `undefined` when no nudge is due (#186, design #181 case A / plan #182 task 4;
 * generalized to N families in #233).
 *
 * It fires only when a registered family is selected AND its supplying font
 * extension is not supplying the face — i.e. the webview is rendering with no
 * bundled `@font-face` (`resolveBundledFontSource` → `none`) — and never twice in
 * one session (`alreadyNotified`). Returning the family (rather than a bare
 * boolean) is what lets the host name the right extension in the message: with
 * more than one registered family a fixed "M PLUS 1 Code Term" string would send the
 * user to install the wrong one. Per decision R7 the debounce/dismiss flags stay single — only the
 * wording is per-family.
 *
 * This is the decision half, kept vscode-free so `node --test` can drive it; the
 * actual `showInformationMessage` lives in `src/extension.ts`.
 */
export function fontExtensionNudgeFamily(
  fontFamily: string,
  getExtension: GetExtension,
  alreadyNotified: boolean,
): string | undefined {
  if (alreadyNotified) {
    return undefined;
  }
  const family = matchRegisteredFamily(fontFamily);
  if (family === undefined) {
    return undefined;
  }
  return resolveBundledFontSource(family, getExtension).source === 'none' ? family : undefined;
}

/**
 * Boolean form of `fontExtensionNudgeFamily` — whether to fire the nudge at all,
 * with no interest in which family. Kept as the named predicate the decision is
 * described by; the host uses the family-returning form because it needs the name
 * for the message.
 *
 * NOTE (#236, follow-up L2 from #233): this is a thin wrapper with **no production
 * caller** — `src/extension.ts` switched to `fontExtensionNudgeFamily` when the
 * nudge message became per-family. It is kept deliberately, not by oversight: it
 * is the pre-#233 public name of this decision and the shape the existing tests
 * assert the predicate by, so deleting it would be an API break for no gain. Do
 * not "fix" the unused export by removing it, and do not read its existence as
 * evidence that a boolean nudge path is live.
 */
export function shouldNotifyFontExtensionMissing(
  fontFamily: string,
  getExtension: GetExtension,
  alreadyNotified: boolean,
): boolean {
  return fontExtensionNudgeFamily(fontFamily, getExtension, alreadyNotified) !== undefined;
}

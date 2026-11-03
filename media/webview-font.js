// Pure decision logic for the bundled-font path, split out of
// webview-terminal.js so it can be unit-tested with `node --test` without a
// browser or `document.fonts` — the same treatment webview-keymap.js and
// webview-sound.js get, and for the same reason (an untested predicate is one a
// later refactor deletes). The async half (`resolveFontForMeasure`, which calls
// `document.fonts.load`/`.check`) stays in webview-terminal.js; only the pure
// bits live here.
//
// This file is loaded into the webview as a plain <script> (NOT an ES module,
// NOT bundled by esbuild — see CLAUDE.md), so it must not put bare `export` /
// `require` / `import` at top level. The UMD guard below attaches
// `window.TmuxFont` in the webview and sets `module.exports` under Node; the
// `module` reference lives only inside a `typeof` check, which is safe in a
// browser where `module` is undefined.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.TmuxFont = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // The @font-face family names injected by `getHtml` (src/extension.ts). Each is
  // the name-table family of the TTFs its font extension actually ships, so they
  // must match the `@font-face { font-family }` declarations exactly. For the four
  // ` Term` families those TTFs are CONVERSION OUTPUTS, not upstream bytes
  // (#275, design #271 R4; `ShirokumaGen Term` added by #289, renamed by #298):
  // `scripts/font-fit/` rewrites the name table along with
  // the outlines, and these strings were re-measured off the converted files.
  // `PlemolJP Console HS` is the one unconverted family and ships upstream bytes.
  //
  // CRITICAL: this list, the `enum` values in package.json (`"M PLUS 1 Code Term",
  // monospace` etc.) and the `enumItemLabels` strings (`M PLUS 1 Code Term (font
  // extension)` etc.) must all keep the family name as a substring.
  // `usesBundledFont` gates the `document.fonts.load` wait on `.includes()`, so a
  // mismatch here silently skips the wait and the terminal measures against an
  // OS font while the bundled glyphs paint later — the exact metric drift the
  // async gate exists to prevent (plan #173, #174 review).
  //
  // CRITICAL: this list must equal the family set of `FONT_REGISTRY`
  // (src/font-registry.ts). The webview is a plain <script> with no module system
  // and the registry is not pushed over the message channel (design #229 rejected
  // option B), so the constant is duplicated on purpose — and the duplication is
  // held together by a mechanical test (test/webview-terminal-font.test.js,
  // decision R4), not by this comment.
  const BUNDLED_FAMILIES = [
    'M PLUS 1 Code Term',
    'Mgen+ 1mn Term',
    'Rounded Mgen+ 1mn Term',
    'PlemolJP Console HS',
    'ShirokumaGen Term',
  ];

  // FORMER canonical names, as [alias, canonical] pairs — the hand-copy of the
  // registry entries' `aliases` (#274, design #271 R3/R11). An old settings.json
  // value naming one of these keeps rendering, because getHtml injects the SAME
  // faces under the alias name as well as the canonical one.
  //
  // Still three pairs after #289, and the reason is worth stating precisely: a
  // family contributes a pair when it was RENAMED, which is not the same as when it
  // was CONVERTED. #275 renamed three families as it converted them, so those three
  // carry their pre-rename name. `ShirokumaGen Term` is conversion output
  // too (#289) but is a NEW family — no former name exists on anyone's disk — and
  // the unconverted `PlemolJP Console HS` was never renamed either. So four
  // converted families produce three pairs; the mixed state is the steady one, not
  // a gap to be filled.
  //
  // #298 renamed that family (its pre-#298 spelling carried one more word) and
  // still adds NO pair: the old string was never published, so no settings.json
  // holds it, and an alias protecting nothing is a permanent entry with no expiry.
  //
  // Two constants, not one widened list (R11): `BUNDLED_FAMILIES` is the CANONICAL
  // set and doubles as "how many bundled entries the settings enum has" for five
  // checks in test/webview-terminal-font.test.js — aliases never appear in the
  // enum, so folding them in here would break all five. `BUNDLED_FAMILY_NAMES` is
  // the MATCHING POOL, mirroring the host's `familyMatchPool()`.
  const BUNDLED_FAMILY_ALIASES = [
    ['M PLUS 1 Code', 'M PLUS 1 Code Term'],
    ['Mgen+ 1mn', 'Mgen+ 1mn Term'],
    ['Rounded Mgen+ 1mn', 'Rounded Mgen+ 1mn Term'],
  ];

  /** The matching pool: canonical names ∪ aliases (mirrors host `familyMatchPool`). */
  const BUNDLED_FAMILY_NAMES = BUNDLED_FAMILIES.concat(
    BUNDLED_FAMILY_ALIASES.map((pair) => pair[0]),
  );

  /** Back-compat alias: the family that was the only bundled one before #233. */
  const BUNDLED_FAMILY = BUNDLED_FAMILIES[0];

  // --- Why the two matchers in this file normalize in OPPOSITE directions (#274,
  // --- design #271 R11/R12; review M3). Read this before "fixing" either one.
  //
  // `bundledFamilyOf` does NOT fold an alias to its canonical.
  // `fontFamilyMatchesCurrent` DOES.
  //
  // They disagree because their return values are consumed for different purposes,
  // and each is right for its own consumer:
  //
  //  - `bundledFamilyOf` returns a **CSS `@font-face` name**. Its value is spliced
  //    into `document.fonts.load('14px "X"')` / `.check` (webview-terminal.js,
  //    the `regularSpec`/`boldSpec` pair), so it must name a face the document
  //    actually declared. For an old settings value the face CSS matches is the
  //    ALIAS-named `@font-face` block, so the alias is the correct answer. Folding
  //    to canonical would await a different block than the one being rendered
  //    from — harmless while both names point at the same files, but semantically
  //    a wait on the wrong key, and wrong the moment they diverge.
  //
  //  - `fontFamilyMatchesCurrent` returns an **identity judgement**: "does this
  //    enum option denote the same font as the effective setting?" An alias and its
  //    canonical denote the same font by definition, so not folding would leave the
  //    picker check-mark off and the family chip without its "(font extension)"
  //    label for every user still on an old value — a UI regression under a promise
  //    of no breakage.
  //
  // The host (`src/font-registry.ts`) has this asymmetry too, in the same shape:
  // `matchRegisteredFamily` folds (it answers "which extension"), while the
  // injection site walks canonical AND alias names (it writes CSS identities). Do
  // not "unify" one side onto the other; the disagreement is the design.

  /**
   * The bundled family a resolved `fontFamily` setting selects, or null when it
   * selects none. Matching is by substring (a hand-written settings.json value may
   * name the family in any position), **longest name first**: `Mgen+ 1mn Term` is a
   * substring of `Rounded Mgen+ 1mn Term` (and each alias is a substring of its own
   * canonical), so a list-order scan would load and check the
   * wrong face for a Rounded selection — `document.fonts.check` would then report
   * the wrong face's availability and the terminal could measure against a font it
   * isn't rendering with. Mirrors font-registry's `matchRegisteredFamily`
   * (decision R5). Defensive against non-string input (an absent/malformed config
   * field) so the caller can pass the raw value.
   *
   * The pool it scans is `BUNDLED_FAMILY_NAMES` (canonical ∪ aliases), and the
   * return value is the POOL NAME that matched — an alias stays an alias. See the
   * asymmetry block above.
   */
  function bundledFamilyOf(fontFamily) {
    if (typeof fontFamily !== 'string' || fontFamily.length === 0) {
      return null;
    }
    return (
      BUNDLED_FAMILY_NAMES.slice()
        .sort((a, b) => b.length - a.length)
        .find((family) => fontFamily.includes(family)) || null
    );
  }

  /**
   * Whether a resolved `fontFamily` setting selects a bundled font. Only then does
   * `resolveFontForMeasure` await `document.fonts.load` before
   * building/reconfiguring the terminal; every other family (OS-installed or the
   * editor default) is already available synchronously and needs no wait.
   */
  function usesBundledFont(fontFamily) {
    return bundledFamilyOf(fontFamily) !== null;
  }

  // --- Font picker check-mark matching (#210, plan #207 task 5, design #204 Low-2)
  //
  // The toolbar font picker (webview-terminal.js) marks the currently-selected
  // family/size in a popup built from the host's `fontOptions` payload. The
  // payload carries the *effective* `currentFamily` (a resolved CSS font stack)
  // and each option's enum `value` (also a CSS stack, e.g. `"M PLUS 1 Code Term",
  // monospace`). A naive `value === currentFamily` check falls off the moment the
  // effective value drifts from the enum spelling — which happens whenever a user
  // hand-edits `settings.json` (stray whitespace, different case, single vs double
  // quotes, or a bare family name with no `, monospace` fallback). Design #204
  // Low-2 requires the same inclusion/normalization shape as font-registry's
  // `isBundledFamilySelected` so the check survives that drift.
  //
  // Rather than a substring test (which would false-positive `monospace` — a
  // generic that appears in every stack — against every family), the match keys on
  // the *primary* family token (the first comma-separated segment) normalized:
  // quotes stripped, whitespace collapsed, lowercased. Enum primaries are all
  // distinct, so primary-token equality is precise AND drift-tolerant, and a bare
  // hand-written family name (`M PLUS 1 Code Term`, no fallback) still matches its
  // enum entry.

  /**
   * Normalize a font-family value's *primary* token for comparison: take the first
   * comma-separated segment, strip quotes, collapse internal whitespace, trim, and
   * lowercase. Non-string input normalizes to '' (defensive against a malformed
   * config field). The empty enum value ('' = editor default) normalizes to ''.
   */
  function normalizePrimaryFamily(value) {
    if (typeof value !== 'string') {
      return '';
    }
    const first = value.split(',')[0];
    return first
      .replace(/["']/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // Alias -> canonical, keyed by the NORMALIZED primary token on BOTH sides. The
  // normalization must be applied to the table's keys as well as to the value being
  // looked up: miss it on the key side and a hand-written lowercase settings value
  // never hits the table, so the fold silently becomes a no-op — no error, just the
  // check-mark quietly missing (design #271 R12, review Low). A Map (not an object)
  // keeps a family name that collides with an Object.prototype key out of the way.
  const ALIAS_TO_CANONICAL = new Map(
    BUNDLED_FAMILY_ALIASES.map((pair) => [
      normalizePrimaryFamily(pair[0]),
      normalizePrimaryFamily(pair[1]),
    ]),
  );

  /**
   * The normalized primary token folded onto its canonical family: an alias (a
   * former family name) normalizes to what it was renamed from/to, everything else
   * to itself.
   *
   * It lives here rather than inside `normalizePrimaryFamily` on purpose: that
   * function is a registry-free string normalizer (quotes/whitespace/case) and its
   * tests assert exactly that meaning. Folding is a registry fact, so it sits in
   * the one comparison that wants it — see the asymmetry block near the top of this
   * file for why `bundledFamilyOf` must NOT do the same.
   */
  function canonicalPrimaryFamily(value) {
    const key = normalizePrimaryFamily(value);
    return ALIAS_TO_CANONICAL.get(key) || key;
  }

  /**
   * Whether a fontFamily enum option's `value` names the same family as the
   * effective `currentFamily`, tolerant of settings.json drift (whitespace, case,
   * quotes, missing fallback) AND of a family rename: both sides are folded through
   * `canonicalPrimaryFamily`, so an old settings value still puts the check-mark on
   * the renamed enum entry and still gets the chip's "(font extension)" label
   * (design #271 R12). Compares the folded primary token of each.
   * NOTE: the payload carries the *resolved effective* family, never the raw ''
   * editor-default setting, so the empty ('' → editor default) option is checked
   * only when the effective family is itself empty — in practice the effective
   * family resolves to a concrete face, so the option matching that face (e.g.
   * Menlo) carries the check instead. That reflects what actually renders.
   */
  function fontFamilyMatchesCurrent(optionValue, currentFamily) {
    return canonicalPrimaryFamily(optionValue) === canonicalPrimaryFamily(currentFamily);
  }

  /**
   * Whether a fontSize enum option matches the effective `currentSize`. The
   * payload's `currentSize` is always a concrete resolved number, so the `null`
   * (editor default) option never carries the check — the concrete size that is
   * actually in effect does, which is the useful signal for the user.
   */
  function fontSizeMatchesCurrent(optionSize, currentSize) {
    return typeof optionSize === 'number' && optionSize === currentSize;
  }

  // --- Split family/size chips (#222, plan #221, design #220; was one chip #217)
  //
  // The 2nd toolbar row shows the effective family and size in TWO separate,
  // independently-clickable chips (a re-adoption of design #215's rejected option
  // D, per the #219 user request; family display width shrinks by design and is
  // accepted). These pure helpers compose each chip's text so they are
  // unit-testable without a DOM; the l10n-aware label function (`fontFamilyLabel`,
  // which knows the "editor default"/"font extension" wording) stays in
  // webview-terminal.js and is injected as `familyLabelOf`.

  /**
   * The family option whose value names the effective `currentFamily`, or null
   * when none matches (an OS font the user set by hand that isn't a listed preset)
   * or `families` is malformed. Reuses the drift-tolerant `fontFamilyMatchesCurrent`
   * so a hand-typed settings.json value still resolves to its preset.
   */
  function findFontFamilyOption(families, currentFamily) {
    if (!Array.isArray(families)) {
      return null;
    }
    return families.find((f) => f && fontFamilyMatchesCurrent(f.value, currentFamily)) || null;
  }

  /**
   * Compose the family chip's display text from a fontOptions payload
   * (`{ families, currentFamily, currentSize }`). The label comes from
   * `familyLabelOf` applied to the matched option, or — when the effective family
   * isn't a listed preset — a synthesized `{ value, bundled:false }` so the chip
   * still spells the primary token. Returns '' before the first push (fontOptions
   * null), matching the pre-push no-op the menu already has. The size is a separate
   * chip now (#222), so no ` · {size}` is appended here.
   */
  function fontFamilyChipText(fontOptions, familyLabelOf) {
    if (!fontOptions) {
      return '';
    }
    const match = findFontFamilyOption(fontOptions.families, fontOptions.currentFamily);
    return familyLabelOf(match || { value: fontOptions.currentFamily, bundled: false });
  }

  // --- Fallback composition (#290, plan #287 "方針 B": identity vs. rendering)
  //
  // `tmuxOpener.terminal.fontFallback` names a SECOND family that supplies the
  // glyphs the primary family does not have. Measured with survey.py against the
  // shipped TTFs: `M PLUS 1 Code Term` carries 7 of the 26 everyday symbols this
  // project samples, so 19 of them (`①` among them) are drawn by whatever the OS
  // picks. A refit can move a glyph but never add one, so a fallback family is the
  // only fix — and per-character CSS font matching is what makes it work.
  //
  // WHY THE COMPOSITION LIVES HERE, AND ONLY HERE. `bundledFamilyOf` (and the
  // host's `matchRegisteredFamily`) picks ONE registered family out of a stack by
  // LONGEST match, and `resolveFontForMeasure` preloads and measures against
  // exactly that name. Put the fallback into the value those matchers see and a
  // fallback with a longer name wins: `"Mgen+ 1mn Term"` (14 chars) + `"Rounded
  // Mgen+ 1mn Term"` (22) would measure the Rounded face while rendering the
  // primary. The fix is structural rather than a smarter matcher: the primary
  // (`config.fontFamily`) and the fallback (`config.fontFallback`) are carried as
  // two separate values from the settings all the way here, every identity
  // consumer keeps receiving the PRIMARY value only, and the two are joined once —
  // in `buildFontStack`, whose result goes straight to xterm and to no matcher.
  // A fallback name therefore never reaches a matcher's input, so the mix-up is
  // unreachable rather than guarded against. Do not "simplify" this by composing
  // in the host (`pushWebviewConfig`) — that is exactly the rejected option (c).

  /**
   * Index of the first TOP-LEVEL comma in a CSS font-family value, or -1.
   *
   * Commas inside quotes or parentheses are not separators, and the parenthesis
   * case is load-bearing rather than theoretical: the webview's own
   * `DEFAULT_FONT_FAMILY` is
   * `var(--vscode-editor-font-family, Menlo, Monaco, "Courier New", monospace)`,
   * one single top-level token whose commas all belong to `var()`'s fallback
   * argument. A naive `split(',')` would splice our fallback INTO that argument,
   * where it would apply only when the custom property is unset.
   */
  function firstTopLevelComma(value) {
    let depth = 0;
    let quote = null;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value.charAt(i);
      if (quote !== null) {
        if (ch === quote) {
          quote = null;
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth = depth > 0 ? depth - 1 : 0;
      } else if (ch === ',' && depth === 0) {
        return i;
      }
    }
    return -1;
  }

  /**
   * The whole font-family value split on its TOP-LEVEL commas — the plural of
   * `firstTopLevelComma`, sharing its scanner and therefore its understanding that
   * a comma inside quotes or inside `var()`'s argument is not a separator.
   *
   * `firstTopLevelComma` stays: `buildFontStack` needs the INDEX to splice at, not
   * the pieces, and rebuilding the string from pieces would lose the caller's
   * spacing (`"A" ,   B` → `"A", B`), which #302 must not do.
   */
  function splitTopLevel(value) {
    const out = [];
    let start = 0;
    let depth = 0;
    let quote = null;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value.charAt(i);
      if (quote !== null) {
        if (ch === quote) {
          quote = null;
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth = depth > 0 ? depth - 1 : 0;
      } else if (ch === ',' && depth === 0) {
        out.push(value.slice(start, i));
        start = i + 1;
      }
    }
    out.push(value.slice(start));
    return out;
  }

  // A CSS identifier. NON-ASCII IS INCLUDED ON PURPOSE: css-syntax-3 counts every
  // code point U+0080 and above as an ident code point, so `メイリオ` and `한컴돋움`
  // are unquoted family names a settings.json may legitimately hold — and an
  // ASCII-only class would quote them, which is the very "silently rewrites a value
  // nobody asked to change" this function exists to avoid. (An extension that bundles
  // Japanese fonts getting this wrong was found in review, not by us.) Letting them
  // through costs nothing at the sink: no code point above U+007F can end a CSS
  // string or a declaration, so none of them can leave the font stack.
  //
  // THE `\-` IS LOAD-BEARING. The first cut wrote the hyphen unescaped, right before
  // the high endpoint — `[A-Za-z_-<U+FFFF>-]` — and JS read `_-<U+FFFF>` as a RANGE
  // from U+005F, so `` ` `` `{` `|` `}` `~` all became ident characters and
  // `A} body{` passed through untouched. The sanitizer was a no-op for the simplest
  // possible escape and every gate stayed green (found in review, not by us).
  // Escaping the literal hyphen is what keeps it a MEMBER of the class instead of
  // the start of a range.
  const IDENTIFIER = /^[A-Za-z_\-\u0080-\uFFFF][A-Za-z0-9_\-\u0080-\uFFFF]*$/;

  /**
   * Is this ONE token of a font-family list a single closed CSS token — a `<string>`,
   * a run of identifiers, or a `var()` whose fallback argument is itself a list of
   * such tokens?
   *
   * This is a WHITELIST, which is what makes it sound: anything it does not
   * recognise is unsafe by default, so a shape nobody anticipated cannot pass by
   * omission. (`leavesItsToken` in the test suite is the mirror-image denylist —
   * useful there because a denylist names the reason a payload escaped, which is
   * what an assertion message needs.)
   *
   * Backslashes and C0/DEL are assumed already deleted by the caller — a backslash
   * could escape the closing quote and make "ends with the same quote" a lie.
   */
  function tokenIsClosed(token) {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      return false;
    }
    const first = trimmed.charAt(0);
    if (first === '"' || first === "'") {
      return (
        trimmed.length >= 2 &&
        trimmed.charAt(trimmed.length - 1) === first &&
        trimmed.slice(1, -1).indexOf(first) === -1
      );
    }
    // An unquoted family name is a RUN of identifiers (`Courier New`). Split on the
    // whitespace and test each part with `IDENTIFIER`, rather than nesting a
    // quantifier inside another
    // (`(?:\s+ident)*`) — that shape is what `security/detect-unsafe-regex` flags, and
    //
    // NOTE: `IDENTIFIER` and `quoteFamilyName`'s own identifier test are NO LONGER the
    // same pattern. This one accepts non-ASCII (#304 review); that one stays ASCII, so
    // `fontFallback: メイリオ` is still quoted into `"メイリオ"`. Harmless (the quoted
    // form is correct CSS) but it is the same "rewrites a value nobody asked to
    // change" this function was written to stop, left standing on the #290 side.
    // a security fix that ships a new ReDoS warning is not one worth having. Splitting
    // is linear in the input and needs no reasoning about backtracking.
    if (IDENTIFIER.test(trimmed)) {
      return true;
    }
    if (trimmed.indexOf(' ') !== -1 || trimmed.indexOf('\t') !== -1) {
      const parts = trimmed.split(/[ \t]+/);
      if (parts.every((part) => IDENTIFIER.test(part))) {
        return true;
      }
    }
    // `var(--custom-property)` / `var(--custom-property, <font stack>)`. The webview's
    // own DEFAULT_FONT_FAMILY is exactly this shape, so refusing it would replace the
    // user's default font rather than protect it. Matched by slicing rather than by
    // one regex, for the same ReDoS reason as above.
    // `toLowerCase` because a CSS function name is ASCII case-insensitive: `VAR(--x)`
    // is the same function as `var(--x)`, and a case-sensitive test would quote a
    // legitimate value (found in review).
    if (
      trimmed.slice(0, 4).toLowerCase() === 'var(' &&
      trimmed.charAt(trimmed.length - 1) === ')'
    ) {
      const inner = trimmed.slice(4, -1);
      // A custom-property name holds no comma, so the FIRST comma is the argument
      // separator — no top-level scan needed to find it.
      const comma = inner.indexOf(',');
      const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
      if (!/^--[A-Za-z0-9_-]+$/.test(name)) {
        return false;
      }
      if (comma === -1) {
        return true;
      }
      // `var(--x,)` and `var(--x, )` declare an EMPTY fallback, which css-variables-1
      // allows — and which the recursion below would reject, because an empty token is
      // not a closed one. Answer it here rather than weakening `tokenIsClosed`'s empty
      // case, which is what stops `"A",,"B"` from passing.
      if (inner.slice(comma + 1).trim().length === 0) {
        return true;
      }
      // The fallback argument is a font stack in its own right; recurse rather than
      // inventing a second grammar for it. A token carrying a stray `)` — which is how
      // an attacker would try to end the var() early — fails every branch here, so the
      // `endsWith(')')` anchor cannot be used to smuggle CSS past it.
      return splitTopLevel(inner.slice(comma + 1)).every(tokenIsClosed);
    }
    return false;
  }

  /**
   * The primary `tmuxOpener.terminal.fontFamily` value, made safe to concatenate into
   * xterm's `<style>` (`_injectCss`) — the sink #290 closed for the FALLBACK token and
   * left open for this one (#297).
   *
   * VALIDATE-AND-PASSTHROUGH, not sanitize-and-rebuild. When every token is already
   * closed the input is returned unchanged, so the user's own spacing survives —
   * splitting and rejoining would rewrite `"A" ,   B` into `"A", B`, a change to a
   * value nobody asked to change, and the one thing #302 must not do is disturb a
   * working settings.json.
   *
   * WHAT ROUND-TRIPS IS A MEASURED SET, NOT "everything legitimate" — an earlier
   * revision of this comment claimed the latter and review produced counterexamples
   * within minutes. A token is preserved when it is a closed `<string>`, a run of CSS
   * identifiers (non-ASCII included), or a well-formed `var()`. Outside that:
   *
   *   - `Mgen+ 1mn` unquoted → `"Mgen+ 1mn"`. `+` is no ident code point, so this was
   *     never valid CSS; quoting is a repair.
   *   - a token CSS would accept through some construct this whitelist does not model
   *     is quoted too. That is the deliberate cost of a whitelist, and it is safe
   *     (worst case a family name stops resolving) rather than the reverse.
   *
   * THE REPAIR IS PER TOKEN. A stack is not quoted wholesale because one token in it
   * is bad: `var(--vscode-editor-font-family, …), <bad>` must keep its `var()`, or the
   * repair itself deletes the user's default font — the exact failure this function's
   * design was chosen to avoid.
   */
  function sanitizeFontStack(value) {
    if (typeof value !== 'string' || value.length === 0) {
      return value;
    }
    // eslint-disable-next-line no-control-regex -- deleting C0/DEL is the point
    const stripped = value.replace(/[\\\u0000-\u001f\u007f]/g, "");
    const tokens = splitTopLevel(stripped);
    if (tokens.every(tokenIsClosed)) {
      return stripped;
    }
    return tokens
      .map((token) => (tokenIsClosed(token) ? token.trim() : quoteFamilyName(token)))
      .join(', ');
  }

  /**
   * A family name as it must appear inside a CSS font-family list: already-quoted
   * input is passed through, a bare CSS identifier (`Menlo`, `monospace`) is left
   * unquoted so a generic keyword keeps its meaning, and everything else — any
   * name with a space or a character no identifier may hold, which is every
   * bundled family (`Mgen+ 1mn Term`) — is double-quoted.
   *
   * BACKSLASHES AND C0/DEL CONTROL CHARACTERS ARE DELETED FIRST, before any branch
   * decides (#290 security review Low-1). The result of this function reaches
   * xterm's DOM renderer, which builds a `<style>` element by STRING CONCATENATION
   * (`_injectCss`: `.xterm-rows span { font-family: ${rawOptions.fontFamily}; … }`),
   * and that path runs at least once on every start — `term.open()` precedes the
   * WebGL addon's load, and it is the only renderer when WebGL is unavailable or
   * after a context loss. A CSS string is terminated by a raw newline (bad-string),
   * so a newline in this value escapes the quotes and a following `}` closes the
   * rule block: the reviewer confirmed a `body { background: red; }` of the user's
   * choosing taking effect in headless Chromium. A trailing backslash escapes the
   * closing quote instead and swallows the rules after it.
   *
   * The deletion happens BEFORE the branch test, not inside the last branch, and
   * that placement is measured rather than assumed: the already-quoted passthrough
   * (`"X<LF>} body{…} .x{"`) is a complete escape of its own, and a fix applied only
   * where the quotes are ADDED leaves it open. Quotes are still stripped in the last
   * branch alone, because an already-quoted name must keep its own quotes.
   *
   * DELETING THOSE CHARACTERS IS NOT ENOUGH ON ITS OWN, and the second review round
   * is what proved it. The passthrough branch used to test only that the first and
   * last characters were the same quote — never the middle — so a value that closes
   * its own quote, writes CSS, and re-opens one went through whole, carrying no
   * control character and no backslash for the deletion above to touch. Measured in
   * headless Chromium (150.0.7871.128, `--headless=new`) against a `<style>` built
   * in `_injectCss`'s shape: `"A"} body{background:red} .x{"B"` produced FIVE rules
   * instead of three with `body` painted `rgb(255, 0, 0)`, and
   * `"A"; color: red; font-family: "B"` put a second declaration on
   * `.xterm-rows span`. The single-quoted spellings did the same.
   *
   * So the passthrough additionally requires that the delimiting quote does not
   * occur again between the ends. With backslashes already deleted there is no
   * escape mechanism left inside a CSS string, which is what makes that test EXACT
   * rather than a heuristic: a value that starts with `q`, ends with `q` and holds
   * no other `q` is precisely one closed `<string>` token, and one that fails it is
   * precisely one that is not. The OTHER quote character inside is fine and still
   * passes (`"O'Hara Mono"`), because it is an ordinary character within the token.
   *
   * WHAT IS AND IS NOT CLAIMED. Every branch here returns either a single closed
   * `<string>` token or a bare CSS identifier, so the fallback cannot introduce
   * syntax outside its own token — that is the property, and
   * test/webview-terminal-font.test.js checks it structurally (it tokenizes the
   * composed stack and looks at what lands OUTSIDE the strings) over a payload set
   * built from an explicit matrix. It is NOT a claim that the output is a *valid*
   * font-family value: `""` stays `""`, and Chromium simply drops such a
   * declaration. Nor is it a claim about the primary — see SCOPE below.
   *
   * SCOPE: this narrows the FALLBACK token only — the one value `buildFontStack`
   * passes through here. The primary `family` is narrowed by `sanitizeFontStack`
   * instead (#297), at `fontStackForXterm` in media/webview-terminal.js, BEFORE
   * `buildFontStack` is called. The two are deliberately different functions: a
   * fallback is one family name, while the primary is a whole stack that may hold
   * `var()` and several comma-separated tokens, so quoting it as one name would
   * turn the webview's own default into a string and lose the user's font.
   *
   * Deleting the control characters (rather than replacing them) is the discipline
   * the statusline already uses for externally-controlled values: dropping only
   * `0x00-0x1f`/`0x7f` leaves every UTF-8 sequence intact.
   */
  function quoteFamilyName(name) {
    // eslint-disable-next-line no-control-regex -- deleting C0/DEL is the point
    const trimmed = name.replace(/[\\\u0000-\u001f\u007f]/g, '').trim();
    const first = trimmed.charAt(0);
    if (
      trimmed.length >= 2 &&
      (first === '"' || first === "'") &&
      trimmed.charAt(trimmed.length - 1) === first &&
      // ...and the quote does not re-open inside: one closed <string> token, not
      // two with CSS of the caller's choosing between them. Exact, not heuristic —
      // the backslashes that could have escaped a quote are gone by now.
      trimmed.slice(1, -1).indexOf(first) === -1
    ) {
      return trimmed;
    }
    if (/^[A-Za-z_-][A-Za-z0-9_-]*$/.test(trimmed)) {
      return trimmed;
    }
    return '"' + trimmed.replace(/["']/g, '') + '"';
  }

  /**
   * The CSS font stack to hand xterm: `fallback` inserted immediately after
   * `family`'s first top-level token, so it is consulted per character before any
   * generic tail (`monospace`) the primary stack ends with.
   *
   * IDENTITY (byte-identical passthrough of `family`) in every case where there is
   * nothing to add — no fallback configured (the default `''`), a blank or
   * non-string one, or one naming the same family as the primary
   * (`normalizePrimaryFamily` on both sides, so quoting/case/whitespace drift in a
   * hand-written settings.json still counts as "the same"). That keeps the whole
   * font path byte-identical to its pre-#290 behaviour whenever the setting is
   * untouched.
   *
   * Only the fallback's own PRIMARY token is used, so a value copied from the
   * fontFamily enum (`"Mgen+ 1mn Term", monospace`) contributes one family rather
   * than dragging a second generic into the middle of the stack.
   *
   * A note on the identity test against `DEFAULT_FONT_FAMILY`: for that value
   * `normalizePrimaryFamily` returns `var(--vscode-editor-font-family` (it splits
   * on the first comma, which is inside the `var()`), which cannot equal a family
   * name — so the comparison never suppresses the fallback there. The insertion
   * point is computed by `firstTopLevelComma`, which does understand `var()`, and
   * the two are deliberately different functions: the comparison is the one the
   * plan fixed, and widening it would change what "the same family" means for the
   * picker's normalizer too.
   */
  function buildFontStack(family, fallback) {
    if (typeof family !== 'string' || family.length === 0) {
      return family;
    }
    if (typeof fallback !== 'string') {
      return family;
    }
    const at = firstTopLevelComma(fallback);
    const primary = (at === -1 ? fallback : fallback.slice(0, at)).trim();
    if (primary.length === 0) {
      return family;
    }
    if (normalizePrimaryFamily(primary) === normalizePrimaryFamily(family)) {
      return family;
    }
    const token = quoteFamilyName(primary);
    const cut = firstTopLevelComma(family);
    if (cut === -1) {
      return family + ', ' + token;
    }
    return family.slice(0, cut) + ', ' + token + family.slice(cut);
  }

  /**
   * Compose the size chip's display text: the effective `currentSize` as a string.
   * `currentSize` is always a concrete number in the payload (src/font-options.ts);
   * '' is returned before the first push (fontOptions null) and — defensively —
   * when the size is null/absent, matching the family chip's pre-push no-op.
   */
  function fontSizeChipText(fontOptions) {
    if (!fontOptions || fontOptions.currentSize == null) {
      return '';
    }
    return String(fontOptions.currentSize);
  }

  return {
    BUNDLED_FAMILY,
    BUNDLED_FAMILIES,
    BUNDLED_FAMILY_NAMES,
    BUNDLED_FAMILY_ALIASES,
    bundledFamilyOf,
    usesBundledFont,
    normalizePrimaryFamily,
    canonicalPrimaryFamily,
    fontFamilyMatchesCurrent,
    fontSizeMatchesCurrent,
    findFontFamilyOption,
    fontFamilyChipText,
    fontSizeChipText,
    buildFontStack,
    sanitizeFontStack,
  };
});

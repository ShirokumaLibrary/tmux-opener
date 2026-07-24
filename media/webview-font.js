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
  // The @font-face family name injected by `getHtml` (src/extension.ts). It is
  // the font's *original* name — the TTF the font extension ships is unmodified
  // (#174) — so it must match the `@font-face { font-family }` declaration exactly.
  //
  // CRITICAL: this constant, the `enum` value added in package.json
  // (`"M PLUS 1 Code", monospace`) and the `enumItemLabels` string
  // (`M PLUS 1 Code (bundled)`) must all keep `BUNDLED_FAMILY` as a substring.
  // `usesBundledFont` gates the `document.fonts.load` wait on `.includes()`, so a
  // mismatch here silently skips the wait and the terminal measures against an
  // OS font while the bundled glyphs paint later — the exact metric drift the
  // async gate exists to prevent (plan #173, #174 review).
  const BUNDLED_FAMILY = 'M PLUS 1 Code';

  /**
   * Whether a resolved `fontFamily` setting selects the bundled font, i.e. its
   * value carries `BUNDLED_FAMILY`. Only then does `resolveFontForMeasure` await
   * `document.fonts.load` before building/reconfiguring the terminal; every other
   * family (OS-installed or the editor default) is already available synchronously
   * and needs no wait. Defensive against non-string input (an absent/malformed
   * config field) so the caller can pass the raw value.
   */
  function usesBundledFont(fontFamily) {
    return typeof fontFamily === 'string' && fontFamily.includes(BUNDLED_FAMILY);
  }

  // --- Font picker check-mark matching (#210, plan #207 task 5, design #204 Low-2)
  //
  // The toolbar font picker (webview-terminal.js) marks the currently-selected
  // family/size in a popup built from the host's `fontOptions` payload. The
  // payload carries the *effective* `currentFamily` (a resolved CSS font stack)
  // and each option's enum `value` (also a CSS stack, e.g. `"M PLUS 1 Code",
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
  // hand-written family name (`M PLUS 1 Code`, no fallback) still matches its enum
  // entry.

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

  /**
   * Whether a fontFamily enum option's `value` names the same family as the
   * effective `currentFamily`, tolerant of settings.json drift (whitespace, case,
   * quotes, missing fallback). Compares the normalized primary token of each.
   * NOTE: the payload carries the *resolved effective* family, never the raw ''
   * editor-default setting, so the empty ('' → editor default) option is checked
   * only when the effective family is itself empty — in practice the effective
   * family resolves to a concrete face, so the option matching that face (e.g.
   * Menlo) carries the check instead. That reflects what actually renders.
   */
  function fontFamilyMatchesCurrent(optionValue, currentFamily) {
    return normalizePrimaryFamily(optionValue) === normalizePrimaryFamily(currentFamily);
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
    usesBundledFont,
    normalizePrimaryFamily,
    fontFamilyMatchesCurrent,
    fontSizeMatchesCurrent,
    findFontFamilyOption,
    fontFamilyChipText,
    fontSizeChipText,
  };
});

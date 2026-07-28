// fontOptions payload builder (#209, plan #207 task 3). The extension host posts
// this to the webview so a later picker UI (#210) can offer font choices; this
// module owns the one piece of decision logic in that wiring and is kept free of
// any `vscode`/`fs` import AND of a sibling `font-registry` import so `node --test`
// drives it directly (Node16 module resolution wants `.js` specifiers, which the
// test runner can't map to a sibling `.ts`; the same reason the other tested
// modules stay self-contained). The registry data and the existence check are
// therefore *injected* — the same pattern as font-registry's `getExtension` —
// and src/extension.ts wires FONT_REGISTRY + `resolveExistingFontSource` in.
//
// The rule: a registered bundled family is only a real candidate when the injected
// `isFamilyAvailable` predicate confirms it (which the host backs with #208's
// existence-composed resolver: extension installed AND the file on disk). A
// bundled family that fails that check is dropped from the list entirely (no
// source to render from), while every non-bundled (plain OS) family — and the
// empty "editor default" enum entry — is always selectable.

/** One selectable font-family option in the pushed payload. */
export interface FontFamilyOption {
  /** The enum value written verbatim to `tmuxOpener.terminal.fontFamily`. */
  value: string;
  /** True when the value names a registered bundled family (for UI emphasis). */
  bundled: boolean;
}

/** The `fontOptions` message payload (host -> webview). */
export interface FontOptionsPayload {
  families: FontFamilyOption[];
  sizes: Array<number | null>;
  /** The current effective family/size, so the picker can show the selection. */
  currentFamily: string;
  currentSize: number;
}

/**
 * Build the fontOptions payload from the package.json enums, the registered
 * bundled family names, and an availability predicate.
 *
 * The enum ships bundled families as a CSS stack (`"M PLUS 1 Code Term", monospace`),
 * so a family counts as bundled when a registered family name appears anywhere in
 * the enum value — the same substring rule as `isBundledFamilySelected`. Only
 * bundled families the predicate reports available survive; non-bundled families
 * (and the empty editor-default entry) always do. `isFamilyAvailable` is called
 * only for a bundled family — a plain family has no source to check.
 *
 * Candidates are tried **longest name first** (#233, design #229 decision R5),
 * mirroring font-registry's `matchRegisteredFamily` — which this cannot import
 * (see the self-containment note at the top of the file), so the ordering rule is
 * duplicated here and tested on both sides. It matters because `Mgen+ 1mn Term` is
 * a substring of `Rounded Mgen+ 1mn Term`: in registry order the Rounded enum entry
 * would match Mgen+ and have its inclusion decided by the *Mgen+* extension's presence.
 * This is the THIRD copy of that rule (`matchRegisteredFamily` and the webview's
 * `bundledFamilyOf` are the others).
 *
 * CONTRACT: `registeredFamilies` receives **canonical family names only** — never
 * the aliases a registry entry may declare (#274, design #271 R3). This function
 * scans the settings `enum`, and only canonical names appear there: an alias is a
 * FORMER family name kept alive for hand-written settings values, not an offered
 * option. Passing the aliases in would add candidates that match nothing in the
 * enum, so it would not change the payload — it would only make this look like an
 * alias-aware matcher, and the next reader would have to work out that it isn't.
 * `src/extension.ts` wires this with `FONT_REGISTRY.map(e => e.family)`; keep it
 * that way.
 */
export function buildFontOptions(
  fontFamilyEnum: ReadonlyArray<string>,
  fontSizeEnum: ReadonlyArray<number | null>,
  currentFamily: string,
  currentSize: number,
  registeredFamilies: ReadonlyArray<string>,
  isFamilyAvailable: (family: string) => boolean,
): FontOptionsPayload {
  const families: FontFamilyOption[] = [];
  const byLongestName = [...registeredFamilies].sort((a, b) => b.length - a.length);
  for (const value of fontFamilyEnum) {
    const registered = byLongestName.find((family) => value.includes(family));
    if (registered === undefined) {
      families.push({ value, bundled: false });
      continue;
    }
    if (isFamilyAvailable(registered)) {
      families.push({ value, bundled: true });
    }
    // else: no supplying source, so it is not a selectable candidate — dropped.
  }
  return { families, sizes: [...fontSizeEnum], currentFamily, currentSize };
}

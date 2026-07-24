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
 * The enum ships bundled families as a CSS stack (`"M PLUS 1 Code", monospace`),
 * so a family counts as bundled when a registered family name appears anywhere in
 * the enum value — the same substring rule as `isBundledFamilySelected`. Only
 * bundled families the predicate reports available survive; non-bundled families
 * (and the empty editor-default entry) always do. `isFamilyAvailable` is called
 * only for a bundled family — a plain family has no source to check.
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
  for (const value of fontFamilyEnum) {
    const registered = registeredFamilies.find((family) => value.includes(family));
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

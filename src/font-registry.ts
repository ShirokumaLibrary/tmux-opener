// Cross-extension font registry (#185, design #181 case A; vendored fallback
// removed in #199). The Tmux Opener terminal offers a bundled monospace face
// ("M PLUS 1 Code"). Its bytes come from a dedicated *font extension*
// (`shirokuma-library.font-mplus1code`, #184, renamed to a generic id in #192)
// that ships the TTF and declares a `providedFont` contract in its
// `package.json`. When installed, the webview borrows the font from that
// extension's `extensionUri` (the cross-extension path SUB-A/#183 verified
// renders under the existing production CSP — see `resolveWebviewView`'s
// `localResourceRoots`, which is the real access-control requirement).
//
// When no such font extension supplies the face, the resolver returns
// `{ source: 'none' }`: getHtml injects no `@font-face` at all and the terminal
// falls to the OS monospace (`"M PLUS 1 Code", monospace` → `monospace`). The
// body no longer vendors a TTF under `media/fonts/`.
//
// This module is deliberately free of any `vscode` import so `node --test` can
// drive the resolver directly with a mocked `getExtension` (test/font-registry.test.js).
// The URI work (asWebviewUri, joinPath) stays in `src/extension.ts`, which reads
// the plain-data `FontResolution` this returns and builds the webview URIs from it.

/** The bundled family the terminal exposes as a fontFamily option (#174/#175). */
export const BUNDLED_FONT_FAMILY = 'M PLUS 1 Code';

/** Extension id of the shipped M PLUS 1 Code font extension (#184, renamed #192). */
export const MPLUS1CODE_EXTENSION_ID = 'shirokuma-library.font-mplus1code';

/**
 * The `font-weight` axis the shipped face declares (fvar wght 100–700, verified
 * in #176), used as the default when a font extension supplies a `file` but
 * omits `weight` from its `providedFont` contract.
 */
const DEFAULT_FONT_WEIGHT = '100 700';

/** Static registry: bundled family -> the extension id that supplies it. */
export const FONT_REGISTRY: ReadonlyArray<{ family: string; extensionId: string }> = [
  { family: BUNDLED_FONT_FAMILY, extensionId: MPLUS1CODE_EXTENSION_ID },
];

/** The `providedFont` contract a font extension declares in its package.json. */
export interface FontContract {
  family?: string;
  file?: string;
  weight?: string;
  license?: string;
}

/** Minimal shape of `vscode.Extension` this resolver reads (kept vscode-free). */
export interface ExtensionLike {
  extensionUri?: unknown;
  packageJSON?: { providedFont?: FontContract };
}

/** Injected lookup — `vscode.extensions.getExtension` in production, a mock in tests. */
export type GetExtension = (id: string) => ExtensionLike | undefined;

/** Where the bundled face's bytes resolve from, as plain data (no vscode.Uri). */
export type FontResolution =
  | { source: 'extension'; extensionId: string; file: string; weight: string }
  | { source: 'none' };

/**
 * Resolve where the given font family's bytes should come from.
 *
 * If `family` is a registered bundled family AND its supplying extension is
 * installed with a usable `providedFont.file`, borrow from that extension. A
 * missing `weight` in the contract defaults to the shipped face's axis so the
 * injected `@font-face` always declares the correct range. Otherwise — no font
 * extension, no contract, an empty/absent `file`, or a non-registered family —
 * there is no supplying source and the result is `{ source: 'none' }`, on which
 * getHtml injects no `@font-face` at all (#199).
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
  const contract = ext?.packageJSON?.providedFont;
  if (!ext || !contract || typeof contract.file !== 'string' || contract.file.length === 0) {
    return { source: 'none' };
  }

  const weight =
    typeof contract.weight === 'string' && contract.weight.length > 0
      ? contract.weight
      : DEFAULT_FONT_WEIGHT;

  return { source: 'extension', extensionId: entry.extensionId, file: contract.file, weight };
}

/**
 * Resolve where the given family's bytes come from AND confirm the borrowed file
 * is actually on disk (#208, plan #207 task 1). Composes the unchanged
 * `resolveBundledFontSource` with an injected `fileExists` predicate: a borrowed
 * `extension` source whose `file` the predicate reports missing is downgraded to
 * `{ source: 'none' }`, so getHtml never injects an `@font-face` pointing at a
 * file the extension declares but does not ship. A `none` resolution passes
 * through untouched — there is no file to check, so the predicate is not called.
 *
 * The predicate is injected (not an `fs` import) to keep this module vscode/fs-free
 * so `node --test` drives it with a mock — the same pattern as the injected
 * `getExtension`. The caller (`src/extension.ts`) supplies a closure that joins
 * the contract-relative `file` against the supplying extension's `extensionUri`
 * and stats it; the `path` the predicate receives is that contract-relative
 * `file` string.
 */
export function resolveExistingFontSource(
  family: string,
  getExtension: GetExtension,
  fileExists: (path: string) => boolean,
): FontResolution {
  const resolution = resolveBundledFontSource(family, getExtension);
  if (resolution.source !== 'extension') {
    return resolution;
  }
  return fileExists(resolution.file) ? resolution : { source: 'none' };
}

/** Every extension id in the registry — used to widen `localResourceRoots`. */
export function fontExtensionIds(): string[] {
  return FONT_REGISTRY.map((e) => e.extensionId);
}

/**
 * Whether the given `tmuxOpener.terminal.fontFamily` value selects the bundled
 * family. The enum ships it as `"M PLUS 1 Code", monospace`, but a user may also
 * type a custom settings.json value that names the family, so this matches on the
 * family name appearing anywhere in the string rather than the exact enum entry.
 */
export function isBundledFamilySelected(fontFamily: string): boolean {
  return fontFamily.includes(BUNDLED_FONT_FAMILY);
}

/**
 * Decide whether to fire the "font extension not installed" nudge (#186, design
 * #181 case A / plan #182 task 4). It fires only when the bundled family is
 * selected AND its supplying font extension is not supplying the face — i.e. the
 * webview is rendering with no bundled `@font-face`
 * (`resolveBundledFontSource` → `none`) — and never twice in one session
 * (`alreadyNotified`). This is the decision half, kept vscode-free so
 * `node --test` can drive it; the actual `showInformationMessage` lives in
 * `src/extension.ts`.
 */
export function shouldNotifyFontExtensionMissing(
  fontFamily: string,
  getExtension: GetExtension,
  alreadyNotified: boolean,
): boolean {
  if (alreadyNotified) {
    return false;
  }
  if (!isBundledFamilySelected(fontFamily)) {
    return false;
  }
  return resolveBundledFontSource(BUNDLED_FONT_FAMILY, getExtension).source === 'none';
}

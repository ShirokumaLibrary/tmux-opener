# M PLUS 1 Code (font resource for extensions)

*[日本語](README.ja.md)*

Extension ID: `shirokuma-library.font-mplus1code`

A general-purpose font resource extension that **supplies the M PLUS 1 Code
font to other extensions**. It has no UI and no commands of its own
(`contributes` is empty, `activationEvents` is empty, and `main` is a no-op),
and it **does not install the font into the OS**. Its sole purpose is to let a
consuming extension load the bundled TTF from its own webview via
`vscode-resource`.

## Bundled font

| family | file | weight axis | license |
|---|---|---|---|
| `M PLUS 1 Code` | `fonts/MPLUS1Code.ttf` | `100 700` (fvar wght 100–700) | OFL-1.1 |

See `fonts/OFL.txt` for the full license text.

## Scope limitation: it does not work in `editor.fontFamily` / `terminal.integrated.fontFamily`

**A font supplied this way cannot be used by writing the font name
`M PLUS 1 Code` into VS Code's settings (`editor.fontFamily` or
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
  own webview and implements the borrowing steps below (`getExtension` →
  `localResourceRoots` → `asWebviewUri` → `@font-face`) itself**. tmux-opener is
  exactly this case (by design it does not use VS Code's standard Terminal
  panel; it hosts xterm.js in its own webview), so it can use this font. But for
  the ordinary use case — wanting this font in the editor or the standard
  terminal — it does not work, and the only way to get it there is to install
  the font into the OS.

## How other extensions use this font (the convention)

**Note:** this is not an official VS Code mechanism for sharing fonts between
extensions. **No such official mechanism exists.** What follows is an unofficial,
homegrown convention defined by this extension, and it assumes the exact shape
of this extension's ID and of the `providedFont` contract field in
`package.json`. If this extension later changes the file layout, the ID, or the
contract field, consumers will break silently.

The contract itself is the `providedFont` field in `package.json`:

```json
"providedFont": {
  "family": "M PLUS 1 Code",
  "file": "fonts/MPLUS1Code.ttf",
  "weight": "100 700",
  "license": "OFL-1.1"
}
```

A consumer reads these four fields (`family` / `file` / `weight` / `license`)
to borrow the font.

### 1. Check that this extension is present

```js
const vscode = require('vscode');

const FONT_EXTENSION_ID = 'shirokuma-library.font-mplus1code';
const fontExt = vscode.extensions.getExtension(FONT_EXTENSION_ID);

if (!fontExt) {
  // Not installed. Always handle the undefined case — hide the font option,
  // fall back to another font, and so on (see "Fallback when not installed").
  return;
}
```

`vscode.extensions.getExtension()` returns metadata (`extensionUri`,
`packageJSON`, and so on) for an installed extension **even when it has not been
activated**. This extension has an empty `activationEvents` and no trigger to
activate — it is supply-only — so it relies on this "metadata is readable
without activation" property.

### 2. Read the file path and weight from the `providedFont` contract

```js
const contract = fontExt.packageJSON.providedFont;
// contract.family  === 'M PLUS 1 Code'
// contract.file    === 'fonts/MPLUS1Code.ttf'
// contract.weight  === '100 700'
// contract.license === 'OFL-1.1'
```

Do not hardcode the file path; always read it from `contract.file` (that is what
the contract field is for — so consumers can follow a future layout change).

### 3. Add this font extension's directory to the webview's `localResourceRoots`

**This is the actual access control.** Unless you add this extension's
`extensionUri` to `localResourceRoots`, VS Code refuses to serve an
`asWebviewUri` URL for a file under another extension — before it even evaluates
the CSP. Conversely, once you add it, **there is no need to widen the CSP's
`font-src`**: `asWebviewUri` rewrites the borrowed file to the consuming
webview's own resource authority (what `webview.cspSource` returns), so an
existing `font-src ${webview.cspSource}` already covers both (your own vendored
font and the borrowed font). (Verified on real hardware in tmux-opener itself;
see the header comment of `src/font-registry.ts` and the corresponding invariant
in `CLAUDE.md`.)

```js
const fontExtensionRoots = fontExt ? [fontExt.extensionUri] : [];

webviewView.webview.options = {
  enableScripts: true,
  localResourceRoots: [
    vscode.Uri.joinPath(context.extensionUri, 'media'), // your own resource root
    ...fontExtensionRoots,                              // the borrowed font extension's root
  ],
};
```

`localResourceRoots` entries need not be under your own extension; any
`vscode.Uri` is accepted. When the font extension is not installed you simply add
an empty array, which does not affect any other fallback path.

### 4. Convert the URI with `asWebviewUri` and load it with `@font-face`

```js
const fontFileUri = vscode.Uri.joinPath(
  fontExt.extensionUri,
  ...contract.file.split('/'), // 'fonts/MPLUS1Code.ttf' → ['fonts', 'MPLUS1Code.ttf']
);
const fontUri = webview.asWebviewUri(fontFileUri);

const html = `
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource};">
  <style>
    @font-face {
      font-family: '${contract.family}';
      src: url(${fontUri}) format('truetype');
      font-weight: ${contract.weight};
      font-display: block;
    }
    .term { font-family: '${contract.family}', monospace; }
  </style>
  ...
`;
```

This renders a font file owned by another extension inside your webview, with no
OS-level font installation. In tmux-opener itself, `resolveBundledFontSource()`
in `src/font-registry.ts` resolves to a single source: it borrows from the font
extension when it is installed, and otherwise returns `none` — in which case
`getHtml` injects no `@font-face` at all and the terminal falls to the OS's
standard monospace (tmux-opener no longer vendors its own copy of the TTF). The
actual URI construction lives in `getHtml` in `src/extension.ts` (the same
`joinPath` → `asWebviewUri` → `@font-face` flow as the code above).

## Fallback when not installed

The consumer **must always handle** the case where
`vscode.extensions.getExtension(FONT_EXTENSION_ID)` returns `undefined`. This
font extension is a soft dependency (use it if present), and the consumer must
not break without it.

- To keep it a soft dependency, use a runtime check plus a fallback as shown
  above (drop to your own vendored font or another font, hide the font option,
  and so on), and **do not** put it in `package.json`'s `extensionDependencies`.
  `extensionDependencies` is a hard "won't run without it" dependency; it cannot
  express an "use it if present" soft dependency.
- tmux-opener itself renders with the OS's standard monospace (injecting no
  `@font-face`) when this font extension is not installed, and — only when the
  bundled font is the selected one — shows a one-time notification prompting
  installation (`shouldNotifyFontExtensionMissing` in `src/font-registry.ts`).

## About this convention

To repeat: VS Code has **no official mechanism** for sharing fonts between
extensions. The steps in this document are an unofficial, homegrown convention
agreed between the supplier (this extension) and the consumer (tmux-opener and
the like), and the `providedFont` contract field is the source of truth for that
agreement. If you change the shape of the contract field
(`family` / `file` / `weight` / `license`) or the location of the font file,
update both sides together, keeping in mind that consumers will break silently.

# Contributing

## Build

```sh
npm install          # node-pty compiles a native module here
npm run compile      # esbuild bundle + copy xterm.js and codicon assets into media/
npm run watch        # esbuild in watch mode (does not re-copy the assets)
npm run check-types  # tsc --noEmit
npm run lint         # eslint src
```

There is no test suite.

## Run

Press `F5` to launch an Extension Development Host with the extension loaded.

To install a build into the current window instead:

```sh
npm run vsix     # builds out/tmux-opener-<version>.vsix
code --install-extension out/tmux-opener-0.0.1.vsix --force
```

Then run **Developer: Reload Window**.

`npm run vsix` passes `--dependencies`, which is required: `node-pty`'s compiled
`.node` binary must ship inside the VSIX. `.vscodeignore` trims the package down
to `build/Release` and `lib/`, dropping prebuilds for other platforms and the
C++ sources.

## Debug the webview

Run **Developer: Open Webview Developer Tools**, then switch the Console's
context dropdown from `top` to the `active-frame` (`vscode-webview://`) frame.
The xterm.js `Terminal` instance is exposed as `window.__tmuxTerm`.

## Translations

Two separate mechanisms, both required:

- **`package.json` contributions** (command titles, setting descriptions) use
  `%key%` placeholders resolved from `package.nls.json` and, per locale,
  `package.nls.<locale>.json`.
- **Runtime strings** use `vscode.l10n.t()` in `src/extension.ts`, resolved from
  `l10n/bundle.l10n.<locale>.json`. The English source string *is* the key.

The webview can use neither: it builds DOM at runtime and has no access to
`vscode.l10n`. The extension host translates its strings and posts them across
in the `l10n` message; `media/webview-terminal.js` keeps the English source
strings as fallbacks.

`README.md` has a hand-maintained `README.ja.md` beside it. The Marketplace
only ever renders `README.md`.

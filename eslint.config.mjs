// ESLint 10 flat config. Replaces the old .eslintrc.json (eslint:recommended +
// @typescript-eslint/recommended) and adds the SAST layer-1 rules (SAST rule
// sast-operation: ESLint security is the edit-time first layer; Semgrep CE is
// the second). Layer 1 lives here; the second layer (Semgrep) is wired
// separately and is not touched by this file.
//
// Baseline severity policy (sast-operation "warn baseline"):
//   - every rule eslint-plugin-security ships runs at "warn" — derived from the
//     plugin's own rule list, not from its `recommended` config (in
//     eslint-plugin-security@4 the two coincide, but the derivation stays
//     correct if a future release adds a rule outside recommended). Warn, so we
//     don't block the edit loop on likely false positives.
//   - A curated set is promoted to "error" (high true-positive confidence when
//     they fire). Promotions are human-decided (delegation brief), not chosen
//     autonomously by the worker.
//   - no-unsanitized/method and /property stay at "warn".
// True false positives are suppressed only with line-level, Why-commented
// `// eslint-disable-next-line security/<rule>` — never file- or rule-level off.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import nounsanitized from 'eslint-plugin-no-unsanitized';
import globals from 'globals';

// Enable every rule eslint-plugin-security ships at "warn", then promote the
// curated high-confidence rules to "error". The warn set is derived from the
// plugin's own rule list (Object.keys(security.rules)) rather than from its
// `recommended` config: the two are equivalent in eslint-plugin-security@4, but
// deriving from the full list keeps the baseline correct if a later release
// adds a rule that recommended doesn't yet enable.
const securityWarnAll = Object.fromEntries(
  Object.keys(security.rules).map((name) => [`security/${name}`, 'warn']),
);

const securityErrorPromotions = {
  'security/detect-child-process': 'error',
  'security/detect-eval-with-expression': 'error',
  'security/detect-non-literal-require': 'error',
  'security/detect-pseudoRandomBytes': 'error',
  'security/detect-disable-mustache-escape': 'error',
  'security/detect-bidi-characters': 'error',
  'security/detect-buffer-noassert': 'error',
};

// The set of files the SAST layer lints. Vendored/generated trees (xterm,
// codicons, dist, out) and tooling scratch (tmp, .shirokuma) are excluded via
// the global ignores below.
const lintTargets = [
  'src/**/*.ts',
  'media/webview-terminal.js',
  'media/webview-keymap.js',
  'media/webview-sound.js',
  'test/**/*.js',
  'scripts/**/*.js',
];

const securityBlock = {
  name: 'sast/security',
  files: lintTargets,
  plugins: { security, 'no-unsanitized': nounsanitized },
  rules: {
    ...securityWarnAll,
    ...securityErrorPromotions,
    'no-unsanitized/method': 'warn',
    'no-unsanitized/property': 'warn',
  },
};

export default tseslint.config(
  {
    // Global ignores: vendored xterm/codicon UMD bundles (copied in at compile
    // time, gitignored), build output, and tooling scratch.
    ignores: [
      'media/xterm/**',
      'media/codicons/**',
      'dist/**',
      'out/**',
      'tmp/**',
      '.shirokuma/**',
      'node_modules/**',
    ],
  },
  securityBlock,
  {
    // src is TypeScript, Node-hosted (the extension host). Equivalent to the old
    // eslint:recommended + @typescript-eslint/recommended, with no-unused-vars
    // kept at "warn" as before.
    name: 'src/typescript',
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  {
    // Node CommonJS files: the `node --test` suite (require/module/process) and
    // our build scripts (scripts/esbuild.js, scripts/copy-webview-assets.js).
    name: 'node/commonjs',
    files: ['test/**/*.js', 'scripts/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // JS files never went through the TS no-unused-vars override before (only
      // src was linted); keep unused vars non-blocking here too.
      'no-unused-vars': 'warn',
    },
  },
  {
    // Webview scripts: plain browser <script>s (not bundled, not modules). They
    // need the DOM globals plus the xterm.js UMD globals and acquireVsCodeApi,
    // none of which are declared in-file. `module` is deliberately NOT given
    // here — only the UMD-guarded files have it (next block), so a stray `module`
    // reference in webview-terminal.js (a bare webview script) is still caught
    // by no-undef.
    name: 'media/webview',
    files: ['media/webview-terminal.js', 'media/webview-keymap.js', 'media/webview-sound.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        acquireVsCodeApi: 'readonly',
        // The UMD guards in webview-keymap.js / webview-sound.js expose
        // window.TmuxKeymap / window.TmuxSound, which webview-terminal.js
        // consumes.
        TmuxKeymap: 'readonly',
        TmuxSound: 'readonly',
        // xterm.js + addon UMD globals loaded from media/xterm/ before these run.
        Terminal: 'readonly',
        FitAddon: 'readonly',
        SearchAddon: 'readonly',
        WebLinksAddon: 'readonly',
        Unicode11Addon: 'readonly',
        WebglAddon: 'readonly',
        ClipboardAddon: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'warn',
    },
  },
  {
    // The pure webview modules carry a UMD guard (`typeof module !== 'undefined'
    // && module.exports`) so the same file can be require()d from the Node
    // tests. Only they may reference `module`; `exports` is never touched (the
    // guard writes module.exports), so it is not declared.
    name: 'media/webview-umd',
    files: ['media/webview-keymap.js', 'media/webview-sound.js'],
    languageOptions: {
      globals: {
        module: 'readonly',
      },
    },
  },
);

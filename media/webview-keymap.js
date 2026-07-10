// Pure decision logic for the terminal's custom key-event handler, split out of
// webview-terminal.js so it can be unit-tested with `node --test` without a
// browser, xterm.js, or a pty.
//
// This file is loaded into the webview as a plain <script> (NOT an ES module,
// NOT bundled by esbuild — see CLAUDE.md), so it must not put bare `export` /
// `require` / `import` at top level. The UMD guard below attaches
// `window.TmuxKeymap` in the webview and sets `module.exports` under Node; the
// `module` reference lives only inside a `typeof` check, which is safe in a
// browser where `module` is undefined.
//
// The function is pure w.r.t. xterm/DOM: every observable effect (copy,
// clearSelection, preventDefault, paste request, find bar open/close) is
// injected through `ctx`, and every input it reads (isMac, hasSelection,
// findbarVisible) is a plain value on `ctx`. It returns the boolean xterm's
// attachCustomKeyEventHandler expects: `true` lets the key reach the terminal
// (and the shell), `false` swallows it.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.TmuxKeymap = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function decideTerminalKeyEvent(e, ctx) {
    // Only keydown drives shortcuts; keypress/keyup pass straight through.
    if (e.type !== 'keydown') {
      return true;
    }
    const key = e.key.toLowerCase();

    if ((e.ctrlKey || e.metaKey) && key === 'f') {
      ctx.openFind();
      return false;
    }
    if (e.key === 'Escape' && ctx.findbarVisible) {
      ctx.closeFind();
      return false;
    }

    // Matches VS Code's terminal: the platform's copy chord copies only when
    // something is selected, so a bare Ctrl+C still reaches the shell as
    // SIGINT. Ctrl+Shift+C copies everywhere, including macOS.
    const copyChord = ctx.isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.shiftKey;
    if ((copyChord || (e.ctrlKey && e.shiftKey)) && key === 'c' && ctx.hasSelection) {
      // Clearing is what makes the *next* Ctrl+C an interrupt again; VS Code
      // binds copyAndClearSelection, not copySelection, for exactly this.
      // Without it a stale selection swallows SIGINT forever.
      ctx.copySelection();
      ctx.clearSelection();
      return false;
    }

    // preventDefault is load-bearing: xterm's _keyDown returns early when this
    // handler returns false, and never suppresses the default. Chromium would
    // still run its own paste-and-match-style on the hidden textarea, whose
    // paste event xterm also handles — pasting the clipboard twice. Cmd+V and
    // Ctrl+V are left alone precisely so that native path serves them.
    if (e.ctrlKey && e.shiftKey && key === 'v') {
      ctx.preventDefault();
      ctx.paste();
      return false;
    }

    return true;
  }

  return { decideTerminalKeyEvent };
});

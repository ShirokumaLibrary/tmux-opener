(function () {
  const vscodeApi = acquireVsCodeApi();
  const container = document.getElementById('terminal');
  const defaultView = document.getElementById('default-view');
  const defaultViewNotice = document.getElementById('default-view-notice');
  const defaultViewMessage = document.getElementById('default-view-message');
  const defaultViewHint = document.getElementById('default-view-hint');
  const defaultViewNew = document.getElementById('default-view-new');
  const sidebar = document.getElementById('sidebar');
  const sessionList = document.getElementById('session-list');
  const sessionTitle = document.getElementById('session-title');
  const contextMenu = document.getElementById('context-menu');
  const resizer = document.getElementById('resizer');
  const bootError = document.getElementById('boot-error');
  const DEFAULT_FONT_FAMILY =
    'var(--vscode-editor-font-family, Menlo, Monaco, "Courier New", monospace)';

  function showBootError(err) {
    bootError.style.display = 'block';
    bootError.textContent =
      'Tmux Opener failed to start the terminal view:\n' + (err && err.stack ? err.stack : String(err));
  }

  function cssColor(varName, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return v || fallback;
  }

  // Like cssColor but with no fallback: absent theme colors stay undefined so
  // xterm.js applies its own default, the same way VS Code's getXtermTheme()
  // passes `color?.toString()`.
  function cssColorOpt(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || undefined;
  }

  function buildXtermTheme() {
    return {
      background: cssColor('--vscode-terminal-background', cssColor('--vscode-editor-background', '#1e1e1e')),
      foreground: cssColor('--vscode-terminal-foreground', cssColor('--vscode-editor-foreground', '#cccccc')),
      cursor: cssColor('--vscode-terminalCursor-foreground', '#cccccc'),
      cursorAccent: cssColor('--vscode-terminalCursor-background', '#1e1e1e'),
      selectionBackground: cssColor('--vscode-terminal-selectionBackground', 'rgba(255,255,255,0.3)'),
      selectionInactiveBackground: cssColorOpt('--vscode-terminal-inactiveSelectionBackground'),
      selectionForeground: cssColorOpt('--vscode-terminal-selectionForeground'),
      scrollbarSliderBackground: cssColorOpt('--vscode-scrollbarSlider-background'),
      scrollbarSliderHoverBackground: cssColorOpt('--vscode-scrollbarSlider-hoverBackground'),
      scrollbarSliderActiveBackground: cssColorOpt('--vscode-scrollbarSlider-activeBackground'),
      black: cssColor('--vscode-terminal-ansiBlack', '#000000'),
      red: cssColor('--vscode-terminal-ansiRed', '#cd3131'),
      green: cssColor('--vscode-terminal-ansiGreen', '#0dbc79'),
      yellow: cssColor('--vscode-terminal-ansiYellow', '#e5e510'),
      blue: cssColor('--vscode-terminal-ansiBlue', '#2472c8'),
      magenta: cssColor('--vscode-terminal-ansiMagenta', '#bc3fbc'),
      cyan: cssColor('--vscode-terminal-ansiCyan', '#11a8cd'),
      white: cssColor('--vscode-terminal-ansiWhite', '#e5e5e5'),
      brightBlack: cssColor('--vscode-terminal-ansiBrightBlack', '#666666'),
      brightRed: cssColor('--vscode-terminal-ansiBrightRed', '#f14c4c'),
      brightGreen: cssColor('--vscode-terminal-ansiBrightGreen', '#23d18b'),
      brightYellow: cssColor('--vscode-terminal-ansiBrightYellow', '#f5f543'),
      brightBlue: cssColor('--vscode-terminal-ansiBrightBlue', '#3b8eea'),
      brightMagenta: cssColor('--vscode-terminal-ansiBrightMagenta', '#d670d6'),
      brightCyan: cssColor('--vscode-terminal-ansiBrightCyan', '#29b8db'),
      brightWhite: cssColor('--vscode-terminal-ansiBrightWhite', '#e5e5e5'),
    };
  }

  function debounce(fn, delayMs) {
    let handle;
    return () => {
      clearTimeout(handle);
      handle = setTimeout(fn, delayMs);
    };
  }

  let term;
  let fitAddon;
  let searchAddon;
  let debouncedFit;
  let ready = false;
  const pending = [];

  function fitAndNotify() {
    try {
      fitAddon.fit();
    } catch {
      return;
    }
    vscodeApi.postMessage({ type: 'resize', cols: term.cols, rows: term.rows });
  }

  // Terminal construction is deferred until the extension host sends the
  // real font config (message type 'config'). Building it once, with the
  // right fontFamily/fontSize from the start, avoids a font swap after
  // xterm.js has already measured/painted a cell grid at the wrong size —
  // that swap is what caused typed characters to render at drifted
  // positions.
  function initTerminal(fontConfig) {
    try {
      // NOTE: convertEol must stay OFF (default). This terminal is attached
      // to a real pty: the tty driver already performs ONLCR translation,
      // and tmux relies on bare \n meaning "cursor down, same column" when
      // it optimizes redraws. convertEol=true silently added a carriage
      // return to every \n, so glyphs tmux wrote after a linefeed landed at
      // column 0 — the "ghost characters at the left edge" bug.
      // Options mirror VS Code's xtermTerminal.ts constructor with its
      // default settings (cursor blink off, scrollback 1000, contrast 4.5,
      // rescaleOverlappingGlyphs on, scrollOnEraseInDisplay hardcoded true,
      // VS Code's word separators for double-click selection).
      term = new Terminal({
        allowProposedApi: true,
        fontFamily: fontConfig.fontFamily || DEFAULT_FONT_FAMILY,
        fontSize: fontConfig.fontSize || 14,
        theme: buildXtermTheme(),
        scrollback: 1000,
        altClickMovesCursor: true,
        // With tmux in mouse mode the pty consumes drags, so xterm never forms
        // a selection. Shift+drag always bypasses mouse reporting; this makes
        // Option+drag do the same on macOS, matching VS Code's default for
        // terminal.integrated.macOptionClickForcesSelection.
        macOptionClickForcesSelection: true,
        minimumContrastRatio: 4.5,
        rescaleOverlappingGlyphs: true,
        scrollOnEraseInDisplay: true,
        wordSeparator: ' ()[]{}\',"`─‘’“”|',
      });
      // Exposed for debugging via the webview's DevTools console only.
      window.__tmuxTerm = term;

      fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);

      try {
        term.loadAddon(new Unicode11Addon.Unicode11Addon());
      } catch (err) {
        console.error('Failed to load Unicode11Addon', err);
      }

      try {
        searchAddon = new SearchAddon.SearchAddon();
        term.loadAddon(searchAddon);
      } catch (err) {
        console.error('Failed to load SearchAddon', err);
      }

      try {
        term.loadAddon(
          new WebLinksAddon.WebLinksAddon((_event, uri) => {
            vscodeApi.postMessage({ type: 'openLink', uri });
          }),
        );
      } catch (err) {
        console.error('Failed to load WebLinksAddon', err);
      }

      term.open(container);

      try {
        term.unicode.activeVersion = '11';
      } catch (err) {
        console.error('Failed to activate unicode11', err);
      }

      // OSC 52 is how a program inside the pty — tmux's copy-mode, vim, a
      // remote shell — asks the terminal to put text on the system clipboard.
      // tmux's own paste buffer is invisible to the host, so without this the
      // copied text never leaves tmux. VS Code loads the same addon
      // (xtermTerminal.ts) with its own provider, for the same reason.
      try {
        term.loadAddon(
          new ClipboardAddon.ClipboardAddon(undefined, {
            // The addon's default provider calls navigator.clipboard directly,
            // which a webview may refuse and which in any case needs a user
            // gesture an escape sequence from the pty does not have.
            writeText: (_type, text) => {
              copyText(text);
              return Promise.resolve();
            },
            // Answering a read request would hand the clipboard to whatever is
            // running in the terminal. VS Code allows it; we don't.
            readText: () => Promise.resolve(''),
          }),
        );
      } catch (err) {
        console.error('Failed to load ClipboardAddon', err);
      }

      // Without an accelerated renderer addon, xterm.js falls back to
      // rendering each cell as DOM nodes, which is what was causing the
      // scroll ghosting / drifting glyph positions — VS Code's own terminal
      // always loads WebGL (see xtermTerminal.ts) for exactly this reason.
      // Fall back to the DOM renderer (do nothing) if WebGL is unavailable.
      try {
        const webglAddon = new WebglAddon.WebglAddon();
        webglAddon.onContextLoss(() => {
          console.warn('Tmux Opener: WebGL context lost, falling back to the DOM renderer');
          webglAddon.dispose();
        });
        term.loadAddon(webglAddon);
      } catch (err) {
        console.warn('Tmux Opener: WebGL renderer unavailable, using the DOM renderer', err);
      }
    } catch (err) {
      showBootError(err);
      throw err;
    }

    // VS Code swaps theme classes on <body> when the color theme changes;
    // there's no dedicated message for it, so watch for that instead. This
    // is debounced hard: re-assigning term.options.theme forces a full
    // repaint, and body's class/style can mutate for reasons unrelated to
    // theme (focus state, etc.) — doing that during active output writes
    // was a suspected cause of stray leftover glyphs after scrolling.
    const debouncedThemeRefresh = debounce(() => {
      term.options.theme = buildXtermTheme();
    }, 500);
    new MutationObserver(debouncedThemeRefresh).observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    debouncedFit = debounce(fitAndNotify, 100);

    window.addEventListener('resize', debouncedFit);
    new ResizeObserver(debouncedFit).observe(container);

    term.onData((data) => {
      vscodeApi.postMessage({ type: 'input', data });
    });

    term.onBell(() => {
      vscodeApi.postMessage({ type: 'bell' });
    });

    setupFindBar();
    setupSidebarResize();

    setTimeout(fitAndNotify, 0);
    // No term.focus() here: on window reload the host re-attaches via the
    // non-focus-stealing attachSession path, so grabbing focus on startup would
    // pull it out of the editor. Focus is taken only when the terminal actually
    // becomes visible from the default screen (hideDefaultView).

    ready = true;
    for (const msg of pending.splice(0)) {
      handleReadyMessage(msg);
    }
  }

  function applyFontConfig(config) {
    term.options.fontFamily = config.fontFamily || DEFAULT_FONT_FAMILY;
    term.options.fontSize = config.fontSize || 14;
    fitAndNotify();
  }

  // Creating sessions lives entirely in the view title bar (+ and its profile
  // dropdown), so the list itself is only ever a list.
  function renderSessionList(sessions) {
    const current = sessions.find((s) => s.current);
    sessionTitle.textContent = current ? current.name : strings.noSession;
    sessionTitle.title = current ? current.name : '';
    sessionTitle.classList.toggle('empty', !current);

    sessionList.replaceChildren();

    for (const s of sessions) {
      const item = document.createElement('div');
      item.className = 'session-item' + (s.current ? ' active' : '');
      item.title =
        s.attached && !s.current ? format(strings.attachedElsewhere, s.name) : s.name;

      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = '▸';
      item.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = s.name;
      item.appendChild(label);

      const close = document.createElement('span');
      close.className = 'close';
      close.textContent = '×';
      close.title = strings.killSession;
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        vscodeApi.postMessage({ type: 'killSession', name: s.name });
      });
      item.appendChild(close);

      item.addEventListener('click', () => {
        if (!s.current) {
          vscodeApi.postMessage({ type: 'switchSession', name: s.name });
        }
      });
      // Kill on middle click, matching the built-in terminal tab list.
      item.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          vscodeApi.postMessage({ type: 'killSession', name: s.name });
        }
      });
      sessionList.appendChild(item);
    }
  }

  // Profiles arrive from the extension host, which owns tmuxOpener.profiles.
  let profiles = [];

  // Translations, likewise: vscode.l10n only exists on the extension host. The
  // fallbacks are the English source strings, used until the message lands.
  let strings = {
    noSession: 'No session',
    newSession: 'New Session',
    noActiveSession: 'No active session',
    startNewSessionHint: 'Start a tmux session to get going.',
    configureProfiles: 'Configure Profiles...',
    killSession: 'Kill session',
    attachedElsewhere: '{0} (attached elsewhere)',
    notFoundOnPath: '"{0}" was not found on PATH',
  };
  const format = (template, value) => template.replace('{0}', value);

  // The default screen fills the pane when no session is running. It is
  // exclusive with the terminal (never both visible), but the terminal
  // instance keeps existing so the next attach can reuse it. Showing it neither
  // reveals nor focuses the view — no focus is stolen from the editor.
  function applyDefaultViewStrings() {
    defaultViewMessage.textContent = strings.noActiveSession;
    defaultViewHint.textContent = strings.startNewSessionHint;
    defaultViewNew.textContent = strings.newSession;
  }
  function showDefaultView(notice) {
    if (notice) {
      defaultViewNotice.textContent = notice;
      defaultViewNotice.style.display = '';
    } else {
      defaultViewNotice.textContent = '';
      defaultViewNotice.style.display = 'none';
    }
    defaultView.classList.add('visible');
    container.style.display = 'none';
    // Release keyboard focus from the now-hidden terminal textarea. The terminal
    // takes focus when it becomes visible (hideDefaultView), so by the time the
    // default screen comes up focus may still sit there — but with the default
    // screen up there is nothing to type into: a focus stuck in the
    // invisible textarea keeps the visible "New Session" button unreachable and
    // swallows keystrokes into an element the user can't see. Blur only — no
    // programmatic focus of the button. Pulling focus onto the button from an
    // unfocused webview could steal focus from the editor on window reload
    // (the same reason the host attaches via attachSession, not the focus-
    // stealing openSession). The button is a native <button>, so it stays
    // reachable by Tab without us forcing focus.
    if (term) {
      try {
        term.blur();
      } catch {
        // Terminal may be mid-teardown; a failed blur is harmless here.
      }
    }
  }
  function hideDefaultView() {
    if (!defaultView.classList.contains('visible')) {
      return;
    }
    defaultView.classList.remove('visible');
    container.style.display = '';
    // The terminal container had zero size while hidden, so re-measure now
    // that it is back — otherwise xterm keeps the stale fit.
    if (debouncedFit) {
      fitAndNotify();
    }
    // The terminal is visible again (a session is attaching), so it is safe to
    // take keyboard focus. This is the only programmatic focus: it runs solely
    // on the transition off the default screen (the early return above guards
    // it), never on startup — so it can't steal focus from the editor on a
    // window reload where no default screen was up.
    if (term) {
      try {
        term.focus();
      } catch {
        // Terminal may be mid-teardown; a failed focus is harmless here.
      }
    }
  }

  function closeContextMenu() {
    contextMenu.classList.remove('visible');
  }

  function addMenuItem(label, detail, onPick) {
    const item = document.createElement('div');
    item.className = 'menu-item' + (detail ? ' unavailable' : '');
    item.textContent = label;
    if (detail) {
      item.title = detail;
    }
    item.addEventListener('click', () => {
      closeContextMenu();
      onPick();
    });
    contextMenu.appendChild(item);
  }

  function addMenuSeparator() {
    const sep = document.createElement('div');
    sep.className = 'menu-separator';
    contextMenu.appendChild(sep);
  }

  function openNewSessionMenu(anchor) {
    contextMenu.replaceChildren();

    addMenuItem(strings.newSession, null, () => vscodeApi.postMessage({ type: 'newSession' }));
    if (profiles.length > 0) {
      addMenuSeparator();
      for (const profile of profiles) {
        addMenuItem(
          profile.label,
          profile.available ? null : format(strings.notFoundOnPath, profile.command),
          () => vscodeApi.postMessage({ type: 'newSession', profile: profile.label }),
        );
      }
    }
    addMenuSeparator();
    addMenuItem(strings.configureProfiles, null, () =>
      vscodeApi.postMessage({ type: 'openProfileSettings' }),
    );

    // Show before measuring, then flip to stay inside the view. The menu is
    // right-aligned to the button because the sidebar hugs the right edge.
    contextMenu.classList.add('visible');
    const rect = anchor.getBoundingClientRect();
    const width = contextMenu.offsetWidth;
    const height = contextMenu.offsetHeight;
    const left = Math.max(2, Math.min(rect.right - width, window.innerWidth - width - 2));
    const below = rect.bottom + 2;
    const top = below + height > window.innerHeight ? Math.max(2, rect.top - height - 2) : below;
    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
  }

  document.getElementById('newSession').addEventListener('click', () => {
    closeContextMenu();
    vscodeApi.postMessage({ type: 'newSession' });
  });
  // The default view's button uses the same path as the toolbar +, so the host
  // reveals/focuses the view and creates a session (openNewSession).
  defaultViewNew.addEventListener('click', () => {
    vscodeApi.postMessage({ type: 'newSession' });
  });
  document.getElementById('newSessionMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    if (contextMenu.classList.contains('visible')) {
      closeContextMenu();
    } else {
      openNewSessionMenu(e.currentTarget.parentElement);
    }
  });
  document.getElementById('killSession').addEventListener('click', () => {
    closeContextMenu();
    vscodeApi.postMessage({ type: 'killCurrentSession' });
  });
  document.getElementById('openSettings').addEventListener('click', () => {
    closeContextMenu();
    vscodeApi.postMessage({ type: 'openSettings' });
  });
  window.addEventListener('mousedown', (e) => {
    if (!contextMenu.contains(e.target)) {
      closeContextMenu();
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeContextMenu();
    }
  });
  window.addEventListener('blur', closeContextMenu);

  // Mirrors TerminalTabsListSizes thresholds: label text hides below
  // MidpointViewWidth (63px), the close action hides at/below
  // ActionbarMinimumWidth (105px).
  function updateSidebarDensity() {
    const width = sidebar.clientWidth;
    sidebar.classList.toggle('icon-only', width < 63);
    sidebar.classList.toggle('compact', width <= 105);
  }
  new ResizeObserver(updateSidebarDensity).observe(sidebar);
  updateSidebarDensity();

  let sidebarVisible = true;
  let sidebarWidthBeforeHide = null;
  function toggleSidebar() {
    sidebarVisible = !sidebarVisible;
    closeContextMenu();
    if (sidebarVisible) {
      sidebar.style.display = '';
      resizer.style.display = '';
      if (sidebarWidthBeforeHide) {
        sidebar.style.width = sidebarWidthBeforeHide;
      }
    } else {
      sidebarWidthBeforeHide = sidebar.style.width || null;
      sidebar.style.display = 'none';
      resizer.style.display = 'none';
    }
    updateSidebarDensity();
    if (debouncedFit) {
      fitAndNotify();
    }
  }
  document.getElementById('toggleSidebar').addEventListener('click', toggleSidebar);

  function setupSidebarResize() {
    const SIDEBAR_MIN = 46;
    const SIDEBAR_MAX = 500;
    let dragStartX = 0;
    let dragStartWidth = 0;

    function onDragMove(e) {
      const delta = dragStartX - e.clientX; // sidebar is on the right: dragging left grows it
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, dragStartWidth + delta));
      sidebar.style.width = `${next}px`;
      updateSidebarDensity();
      debouncedFit();
    }
    function onDragEnd() {
      resizer.classList.remove('dragging');
      window.removeEventListener('mousemove', onDragMove);
      window.removeEventListener('mouseup', onDragEnd);
      fitAndNotify();
    }
    resizer.addEventListener('mousedown', (e) => {
      dragStartX = e.clientX;
      dragStartWidth = sidebar.clientWidth;
      resizer.classList.add('dragging');
      window.addEventListener('mousemove', onDragMove);
      window.addEventListener('mouseup', onDragEnd);
      e.preventDefault();
    });
  }

  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

  // Clipboard access from a webview is gated on transient user activation and
  // on permissions the host may withhold. The extension host has neither
  // problem, so both directions go through it.
  function copyText(text) {
    if (!text) {
      return false;
    }
    vscodeApi.postMessage({ type: 'copy', text });
    return true;
  }

  function copySelection() {
    return copyText(term.getSelection());
  }
  // Exposed for debugging via the webview's DevTools console only.
  window.__tmuxCopy = copySelection;

  function pasteFromClipboard() {
    vscodeApi.postMessage({ type: 'paste' });
  }

  let findbar, findInput, findNext, findPrev, findClose;
  function openFind() {
    findbar.classList.add('visible');
    findInput.focus();
    findInput.select();
  }
  function closeFind() {
    findbar.classList.remove('visible');
    searchAddon?.clearDecorations();
    term.focus();
  }
  function runSearch(next) {
    const query = findInput.value;
    if (!query || !searchAddon) {
      return;
    }
    if (next) {
      searchAddon.findNext(query);
    } else {
      searchAddon.findPrevious(query);
    }
  }
  function setupFindBar() {
    findbar = document.getElementById('findbar');
    findInput = document.getElementById('findInput');
    findNext = document.getElementById('findNext');
    findPrev = document.getElementById('findPrev');
    findClose = document.getElementById('findClose');

    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        runSearch(!e.shiftKey);
      } else if (e.key === 'Escape') {
        closeFind();
      }
    });
    findNext.addEventListener('click', () => runSearch(true));
    findPrev.addEventListener('click', () => runSearch(false));
    findClose.addEventListener('click', closeFind);

    // xterm.js allows only one custom key handler, so every shortcut lives
    // here. The decision logic is in webview-keymap.js (loaded as a separate
    // <script> that sets window.TmuxKeymap) so it can be unit-tested without a
    // browser; this closure only supplies the injected effects and live state.
    term.attachCustomKeyEventHandler((e) =>
      TmuxKeymap.decideTerminalKeyEvent(e, {
        isMac,
        hasSelection: term.hasSelection(),
        findbarVisible: findbar.classList.contains('visible'),
        openFind,
        closeFind,
        copySelection,
        clearSelection: () => term.clearSelection(),
        preventDefault: () => e.preventDefault(),
        paste: pasteFromClipboard,
      }),
    );
  }

  // --- Bell notification sound (Web Audio synthesis) ---------------------
  // The host only tells us which preset to play (`{ type: 'playSound', preset }`
  // from `notifyBell`); everything below turns that id into audio. Synthesizing
  // in the webview — which always runs on the *local* machine — is what makes
  // the bell audible at the keyboard even when the extension host is remote
  // (Remote-SSH). No audio files, so no CSP/`media-src` or bundle-size cost.
  let audioCtx = null;
  let bitcrushCurve = null;

  // Built lazily, and deliberately without a `resume()` here. A context
  // constructed once the Window has sticky activation is born `running` (Web
  // Audio §1.2.1 evaluates "allowed to start" in the constructor), and one
  // constructed before that is not going to be revived by a resume nobody is
  // allowed to make. Whoever needs it running handles that: see `unlockAudio`
  // (gesture-driven) and `playNotifySound` (time-boxed).
  function getAudioContext() {
    if (audioCtx === null) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) {
        return null;
      }
      audioCtx = new Ctor();
    }
    return audioCtx;
  }

  // Unlock the context from a real user gesture. Three facts drive the shape of
  // this, all of them read out of the specs and Blink rather than guessed at:
  //
  // 1. A `resume()` that is not allowed to start does not fail — it hangs. Web
  //    Audio §1.2.4 appends the promise to the context's pending-resume list and
  //    aborts: it neither resolves nor settles as an error. Rejection is reserved
  //    for `closed`/`interrupted` (Blink's `ResumeError` has no "not allowed"
  //    value at all). Silence here is a promise nobody will ever settle, not an
  //    error somebody swallowed.
  // 2. The permission is *sticky* activation (HTML §6.3), not transient: one
  //    interaction anywhere in the Window arms it for that Window's lifetime, and
  //    VS Code hands the webview iframe `allow="autoplay"`, so a click in the
  //    editor — outside this webview entirely — already lets audio start. A
  //    Reload Window resets it, which is what made #70 look intermittent.
  // 3. This frame cannot observe (2): under `allow="autoplay"` the iframe's own
  //    `navigator.userActivation` stays false even while audio is permitted. So
  //    never try to predict whether the context may start — resume and find out.
  //
  // This resumes an existing context but never builds one. Building here would
  // hand every window that opens this view a real AudioContext (audio device +
  // render thread) on its first keystroke, even for users who disabled
  // `tmuxOpener.notifySound` or never hear a bell — and it would buy nothing,
  // because by (2) a context built after the gesture is born `running` anyway.
  // The bell is what constructs it; this only rescues one the bell left behind.
  //
  // The listeners stay installed rather than firing once, because a context can
  // fall back to `suspended`/`interrupted` later and re-resuming a `running` one
  // is a no-op. The test is `!== 'running'`, not `=== 'suspended'`: an
  // `interrupted` context is poked too, and that call *is* turned down — which is
  // the point, `.catch` drops the attempt and the platform owns un-interrupting.
  // `capture: true` sees keys even though xterm stops propagation on the ones it
  // handles; `passive: true` makes the listener incapable of altering the event.
  //
  // `pointerup` is in the list because it, not `pointerdown`, is what arms touch:
  // HTML §6.3 counts `pointerdown` only for pointerType "mouse", and `pointerup`
  // for the rest. Listening on events that grant no activation (a touch
  // `pointerdown`, `Esc`, a bare modifier — all routine in a terminal) is
  // harmless precisely because we no longer construct a context here: the resume
  // is skipped when there is nothing to resume, so no hanging resume is
  // manufactured, and the next qualifying gesture does the real work.
  function unlockAudio() {
    if (audioCtx && audioCtx.state !== 'running') {
      audioCtx.resume().catch(() => {});
    }
  }
  for (const type of ['pointerdown', 'pointerup', 'keydown']) {
    window.addEventListener(type, unlockAudio, { capture: true, passive: true });
  }

  // A stair-step transfer curve for the WaveShaperNode: quantizing the sample
  // values approximates a bit-crusher, giving every preset the same slightly
  // gritty, retro-alarm timbre without a real bitcrush node.
  function getBitcrushCurve() {
    if (bitcrushCurve === null) {
      const n = 1024;
      const steps = 6;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = Math.round(x * steps) / steps;
      }
      bitcrushCurve = curve;
    }
    return bitcrushCurve;
  }

  // Schedule one tone burst on the shared chain:
  //   harmonic OscillatorNodes -> mix Gain -> tremolo (LFO-modulated Gain)
  //   -> WaveShaper (bitcrush) -> envelope Gain -> dest.
  // `freqs` is either a flat frequency per layer, or an array of
  // `{ f, t }` ramp points (relative seconds) for a continuous glide (siren).
  function scheduleBurst(ctx, dest, opts) {
    const start = opts.start;
    const end = start + opts.duration;
    const peak = opts.peak != null ? opts.peak : 0.25;
    const attack = 0.008;
    const release = Math.min(0.06, opts.duration * 0.4);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + attack);
    env.gain.setValueAtTime(peak, end - release);
    env.gain.linearRampToValueAtTime(0, end);

    const shaper = ctx.createWaveShaper();
    shaper.curve = getBitcrushCurve();
    shaper.oversample = 'none';

    const depth = opts.tremoloDepth || 0;
    const trem = ctx.createGain();
    trem.gain.value = 1 - depth;
    if (depth > 0) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = opts.tremoloHz || 6;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = depth;
      lfo.connect(lfoGain);
      lfoGain.connect(trem.gain);
      lfo.start(start);
      lfo.stop(end);
    }

    const mix = ctx.createGain();
    mix.gain.value = 1;
    for (const layer of opts.freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      if (Array.isArray(layer.f)) {
        osc.frequency.setValueAtTime(layer.f[0].f, start);
        for (const point of layer.f) {
          osc.frequency.linearRampToValueAtTime(point.f, start + point.t);
        }
      } else {
        osc.frequency.value = layer.f;
      }
      const g = ctx.createGain();
      g.gain.value = layer.gain;
      osc.connect(g);
      g.connect(mix);
      osc.start(start);
      osc.stop(end);
    }

    mix.connect(trem);
    trem.connect(shaper);
    shaper.connect(env);
    env.connect(dest);
  }

  // Base + 3rd + 5th harmonic layers for a rich, ring-like tone.
  function harmonics(base) {
    return [
      { f: base, gain: 1 },
      { f: base * 3, gain: 0.4 },
      { f: base * 5, gain: 0.2 },
    ];
  }

  // RESUME_GRACE_MS (250ms — how long a bell may wait on a resume before it
  // stops being news) and the predicate that applies it,
  // `TmuxSound.shouldScheduleAfterResume`, live in webview-sound.js: a separate
  // <script> that sets window.TmuxSound, so the #70 invariant can be driven
  // under `node --test` without Web Audio — the same split, for the same reason,
  // as webview-keymap.js. The value is unchanged by that move; this file just
  // stopped being its home.

  // Play `preset`. A bell is a "now" signal: one we cannot play is dropped, not
  // queued.
  //
  // Never continue straight from `resume()` into a schedule without a deadline
  // on it. A resume that is not allowed to start stays pending forever (see
  // `unlockAudio` (1)), so an untimed continuation parks one resolver per bell —
  // and the moment a gesture finally arms the context they all resolve together,
  // schedule against the same `currentTime`, and every bell that ever went
  // unheard plays as a single blast. Suspension does not lose scheduled sound:
  // `currentTime` freezes rather than advances, so `t0` is still ahead of the
  // clock on resume. Pile-up is the failure mode, not silence.
  //
  // So the continuation is time-boxed — it schedules only if the resume lands
  // within RESUME_GRACE_MS. That saves the bell that follows a gesture made
  // outside this webview (an editor click arms sticky activation but does not run
  // `unlockAudio`, so the context is still suspended when the next bell arrives,
  // and its resume then resolves in milliseconds), while a resume that never
  // lands — or lands late — leaves behind a no-op and the bell is discarded. A
  // late resolve therefore degrades to "drop the bell", never to a delayed one.
  //
  // The deadline is measured against `performance.now()`, and NOT by expiring a
  // flag from a `setTimeout`. A timer would be throttled in exactly the state
  // this code exists for: the window nobody has touched is frequently hidden or
  // minimized, and Chromium stretches hidden-page timers to >=1s (to ~1/minute
  // once intensively throttled). The expiry callback could then still be pending
  // when the user's first click settles every parked resume at once, so bells
  // whose timer had not fired would see a live flag and schedule against the same
  // frozen `currentTime` — reproducing the pile-up in miniature. A monotonic
  // clock cannot be stretched by the platform, so the deadline holds by
  // construction rather than by scheduling luck. Do not go back to a timer.
  //
  // The rejection handler is `then`'s second argument, not a trailing `.catch`:
  // a `.catch` after the continuation would also swallow anything thrown inside
  // `scheduleNotifySound`, hiding synthesis bugs in the least reproducible path.
  // Written this way, only the resume itself — `closed`/`interrupted` — is
  // dropped, and a throw from the continuation escapes as an unhandled
  // rejection. Escaping is not enough on its own: an uncaught *rejection* fires
  // `unhandledrejection`, not `error`, so it reaches the banner only because
  // both listeners are installed at the bottom of this file. Keep them in step —
  // drop the `unhandledrejection` one and this path goes back to being silent in
  // the UI while the synchronous call below still reports.

  // Tell the host what became of one bell (#81). The contract is: exactly one
  // *conclusive* `soundResult` per `playSound` id. The host judges "blocked"
  // from this positive signal alone — never from our silence, which it cannot
  // tell apart from a slow link or a busy renderer (Remote-SSH puts a network
  // between us; ADR #34). `resume-pending` is the one non-final message: it
  // reports the fact that we just parked, and is later corrected by `played` or
  // `grace-exceeded`.
  //
  // An `id`-less `playSound` is a bell the host is not tracking: it holds no ack
  // entry for it, so any reply would be dropped on arrival as an unknown id. The
  // host therefore *omits* the id in exactly that case (`postPlaySound`'s
  // `track: false`, which covers the toast/view-less bell and the `Play Sound`
  // replay), and this guard is what turns the omission into silence on the wire
  // instead of 1-2 postMessages per bell that the host throws away — over
  // Remote-SSH that is the same link the pty output is already blocking on. Keep
  // the two halves of the contract together: if the host ever starts sending an
  // id for an untracked bell, it must also start holding an entry for it.
  function postSoundResult(id, played, reason) {
    if (id === undefined) {
      return;
    }
    vscodeApi.postMessage({ type: 'soundResult', id, played, reason });
  }

  // Ring `preset` and report that it rang. `scheduleNotifySound` is allowed to
  // throw — a synthesis bug must reach the banner, not be swallowed (see the
  // comment above about `then`'s second argument) — but since #81 that throw also
  // strands the host: with no first word at all it waits out SOUND_ACK_TIMEOUT_MS
  // (3s) and only then falls back to `unknown`, so a broken preset would cost the
  // sound *and* delay the toast by three seconds. Reporting `unavailable` before
  // rethrowing settles the ack immediately (no action, the same fail-safe as
  // silence) while leaving the throw's path to the banner exactly as it was.
  // Never report `played` here: a bell that threw did not ring.
  function playAndReport(ctx, preset, id) {
    try {
      scheduleNotifySound(ctx, preset);
    } catch (err) {
      postSoundResult(id, false, 'unavailable');
      throw err;
    }
    postSoundResult(id, true);
  }

  function playNotifySound(preset, id, userInitiated) {
    const ctx = getAudioContext();
    if (!ctx) {
      postSoundResult(id, false, 'unavailable');
      return;
    }
    if (ctx.state !== 'running') {
      const at = performance.now();
      ctx.resume().then(
        () => {
          // The deadline itself is `TmuxSound.shouldScheduleAfterResume`, pure
          // and unit-tested (webview-sound.js): `userInitiated` drops it for this
          // one bell and no other, because the flag lives in the closure of the
          // message that carried it. Bells parked earlier cannot see it — when a
          // gesture finally settles them all at once they still measure their own
          // `performance.now() - at` against the grace and drop themselves, which
          // is what keeps the pile-up (#70) from coming back.
          if (TmuxSound.shouldScheduleAfterResume(performance.now() - at, userInitiated)) {
            playAndReport(ctx, preset, id);
            return;
          }
          // The dropped bell used to end here in silence, which left the host
          // nothing to conclude from. Saying so closes the contract.
          postSoundResult(id, false, 'grace-exceeded');
        },
        () => {
          postSoundResult(id, false, 'resume-rejected');
        },
      );
      // Synchronously, before returning: we report *that we parked*, not how long
      // we waited. Evaluating the deadline here would need a renderer timer, and
      // a renderer timer is throttled in exactly the state this whole path exists
      // for (see above). The host owns this deadline; its clock is not throttled.
      postSoundResult(id, false, 'resume-pending');
      return;
    }
    playAndReport(ctx, preset, id);
  }

  function scheduleNotifySound(ctx, preset) {
    const t0 = ctx.currentTime + 0.02;
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    if (preset === 'siren') {
      // The only continuous glide: 600<->1400Hz swept twice, no discrete bursts.
      const points = [
        { f: 600, t: 0 },
        { f: 1400, t: 0.6 },
        { f: 600, t: 1.2 },
        { f: 1400, t: 1.8 },
        { f: 600, t: 2.4 },
      ];
      scheduleBurst(ctx, master, {
        start: t0,
        duration: 2.4,
        peak: 0.28,
        tremoloHz: 5,
        tremoloDepth: 0.2,
        freqs: [
          { f: points, gain: 1 },
          { f: points.map((p) => ({ f: p.f * 3, t: p.t })), gain: 0.25 },
        ],
      });
    } else if (preset === 'trill') {
      // Lightweight: base tone only (no harmonics), no tremolo, just bitcrush.
      // 950/1250Hz alternating, eight notes.
      const spacing = 0.18;
      const dur = 0.16;
      for (let i = 0; i < 8; i++) {
        scheduleBurst(ctx, master, {
          start: t0 + i * spacing,
          duration: dur,
          peak: 0.26,
          freqs: [{ f: i % 2 === 0 ? 950 : 1250, gain: 1 }],
        });
      }
    } else if (preset === 'cascade') {
      // Three descending notes, each with 3rd/5th harmonics.
      const notes = [1400, 1050, 700];
      const dur = 0.4;
      const spacing = 0.42;
      notes.forEach((f, i) => {
        scheduleBurst(ctx, master, {
          start: t0 + i * spacing,
          duration: dur,
          peak: 0.26,
          tremoloHz: 6,
          tremoloDepth: 0.2,
          freqs: harmonics(f),
        });
      });
    } else if (preset === 'sos') {
      // Same timbre as classic; Morse-ish short-short-short-long.
      const short = 0.12;
      const long = 0.4;
      const gap = 0.09;
      let cursor = t0;
      const lengths = [short, short, short, long];
      lengths.forEach((len, i) => {
        scheduleBurst(ctx, master, {
          start: cursor,
          duration: len,
          peak: 0.26,
          tremoloHz: 6,
          tremoloDepth: 0.25,
          freqs: harmonics(950),
        });
        cursor += len + (i === 2 ? gap * 1.6 : gap);
      });
    } else {
      // classic (default): 950Hz + 3rd + 5th, three equal bursts.
      const dur = 0.45;
      const spacing = 0.63;
      for (let i = 0; i < 3; i++) {
        scheduleBurst(ctx, master, {
          start: t0 + i * spacing,
          duration: dur,
          peak: 0.26,
          tremoloHz: 6,
          tremoloDepth: 0.25,
          freqs: harmonics(950),
        });
      }
    }
  }

  function handleReadyMessage(msg) {
    if (msg.type === 'output') {
      // Terminal activity means a session is attaching/running: swap the
      // default screen back out for the terminal.
      hideDefaultView();
      term.write(msg.data);
    } else if (msg.type === 'pasteText') {
      term.paste(msg.text);
    } else if (msg.type === 'clear') {
      term.reset();
    } else if (msg.type === 'info') {
      hideDefaultView();
      term.reset();
      term.write(`\x1b[2m${msg.text}\x1b[0m`);
    } else if (msg.type === 'defaultView') {
      showDefaultView(msg.notice);
    } else if (msg.type === 'config') {
      applyFontConfig(msg);
    } else if (msg.type === 'requestResize') {
      fitAndNotify();
    } else if (msg.type === 'toggleSidebar') {
      toggleSidebar();
    }
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'sessions') {
      // Doesn't touch the terminal — safe before init completes.
      renderSessionList(msg.sessions);
      return;
    }
    if (msg.type === 'l10n') {
      strings = msg.strings;
      applyDefaultViewStrings();
      return;
    }
    if (msg.type === 'profiles') {
      profiles = msg.profiles;
      closeContextMenu();
      return;
    }
    if (msg.type === 'playSound') {
      // Sound synthesis is independent of the terminal, so play it here rather
      // than queuing it behind terminal init — a bell can ring before `ready`.
      // `msg.id` is what the reply is keyed by; `msg.userInitiated` marks the
      // replay behind the toast's `Play Sound` action.
      playNotifySound(msg.preset, msg.id, msg.userInitiated);
      return;
    }
    if (msg.type === 'config' && !ready) {
      initTerminal(msg);
      return;
    }
    if (!ready) {
      pending.push(msg);
      return;
    }
    handleReadyMessage(msg);
  });

  // Both listeners, not just `error`. They outlive boot (despite the name they
  // call): any uncaught throw at any point in the view's life paints the banner,
  // which is the only surface this webview has for a bug that isn't a boot
  // failure. `error` does not fire for a rejected promise, so without the second
  // one every async path here reports failures to the console and nowhere else —
  // a synthesis bug in `scheduleNotifySound` would be visible when a bell took
  // the synchronous path and invisible when the same bell had to resume the
  // context first (see `playNotifySound`). Nothing rethrows into a rejection on
  // purpose; the point is that a bug that does gets seen.
  window.addEventListener('error', (e) => showBootError(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => showBootError(e.reason));

  vscodeApi.postMessage({ type: 'ready' });
})();

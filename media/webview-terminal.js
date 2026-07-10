(function () {
  const vscodeApi = acquireVsCodeApi();
  const container = document.getElementById('terminal');
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

    setupFindBar();
    setupSidebarResize();

    setTimeout(fitAndNotify, 0);
    term.focus();

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
    configureProfiles: 'Configure Profiles...',
    killSession: 'Kill session',
    attachedElsewhere: '{0} (attached elsewhere)',
    notFoundOnPath: '"{0}" was not found on PATH',
  };
  const format = (template, value) => template.replace('{0}', value);

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

    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        openFind();
        return false;
      }
      if (e.type === 'keydown' && e.key === 'Escape' && findbar.classList.contains('visible')) {
        closeFind();
        return false;
      }
      return true;
    });
  }

  function handleReadyMessage(msg) {
    if (msg.type === 'output') {
      term.write(msg.data);
    } else if (msg.type === 'clear') {
      term.reset();
    } else if (msg.type === 'info') {
      term.reset();
      term.write(`\x1b[2m${msg.text}\x1b[0m`);
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
      return;
    }
    if (msg.type === 'profiles') {
      profiles = msg.profiles;
      closeContextMenu();
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

  window.addEventListener('error', (e) => showBootError(e.error || e.message));

  vscodeApi.postMessage({ type: 'ready' });
})();

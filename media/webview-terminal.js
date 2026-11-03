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
  // Guards the deferred first init (below). Terminal construction now awaits
  // `resolveFontForMeasure` before it runs, so `ready` stays false across that
  // await — a second `config` arriving in the gap would otherwise match the
  // `!ready` branch and start a *second* init. `initStarted` flips the instant
  // the first init is scheduled, so only one ever runs; the second config still
  // applies its notify-sound state, it just doesn't re-init.
  let initStarted = false;
  const pending = [];

  // Monotonic request token for the runtime font swap (`applyFontConfig`). Its
  // `await resolveFontForMeasure` can run up to FONT_LOAD_TIMEOUT_MS, so two
  // `config` messages arriving close together can finish out of order: a switch
  // TO the bundled font awaits while a following switch to an OS font resolves
  // synchronously and applies first, then the bundled resolution lands and
  // overwrites it — completion order winning over arrival order, leaving the
  // stale font. Each call takes the next token and discards its result if a
  // newer call has since started, so only the latest request ever applies.
  let fontConfigGeneration = 0;

  // How long to wait for the bundled font's `document.fonts.load` before giving
  // up and measuring against the OS fallback instead. The vendored TTF is ~3.9MB
  // (full CJK glyph set, #174); a local read of it is ~1ms on this machine, and
  // the in-browser parse adds tens of ms more, so 1500ms is generous for the
  // common (local) case. It is deliberately conservative for the slow case: under
  // Remote-SSH the webview is local but this resource is served from the remote
  // host across the channel (ADR #34), and it may queue behind pty output. The
  // error is asymmetric and both sides are benign — too short falls back to the
  // OS font for that measure (no drift: xterm is handed the fallback family, not
  // a half-loaded bundled one), too long only delays the first paint by the
  // timeout. This is a reasoned value, not a measured one: the Bash tool has no
  // browser/DevTools to time `document.fonts.load`, so the human verification
  // step (#175 acceptance criteria) is what confirms it on a real webview — same
  // "choose a conservative value and record why" discipline as RESUME_GRACE_MS.
  const FONT_LOAD_TIMEOUT_MS = 1500;

  /**
   * Resolve the fontFamily to actually hand xterm for measurement. For an
   * OS/editor-default family this is a synchronous pass-through. For the bundled
   * family (`TmuxFont.bundledFamilyOf`) it awaits `document.fonts.load` for both
   * the regular and the bold face — bounded by `FONT_LOAD_TIMEOUT_MS` — and
   * returns the bundled family only when `document.fonts.check` then confirms
   * the *regular* face is available. If the *regular* face is still unavailable
   * when the wait ends (timeout or load failure) it returns
   * `DEFAULT_FONT_FAMILY` so the terminal is built/reconfigured against a font
   * that is present *now*, never against metrics that change when the bundled
   * glyphs finish loading (the build-once-at-the-right-metrics invariant this
   * whole deferral exists to keep). A timeout alone does not force that
   * fallback: the verdict is the 400 face only, so a regular face that arrived
   * while a slow bold one was still pending still yields the bundled family.
   */
  async function resolveFontForMeasure(fontFamily, fontSize) {
    const family = fontFamily || DEFAULT_FONT_FAMILY;
    // Which bundled family the value selects decides which face we wait for
    // (#233): with several bundled families, loading a fixed one would await and
    // check the wrong face for every other selection.
    const bundled = TmuxFont.bundledFamilyOf(family);
    if (!bundled) {
      return family;
    }
    // document.fonts wants a CSS font shorthand: "<size>px <family>".
    // Only `bundled` — the single family name `bundledFamilyOf` matched — may go
    // inside the quotes. `family` is the raw setting value, i.e. a CSS *stack*
    // ("Mgen+ 1mn Term", monospace), and expanding it here yields the invalid spec
    // `bold 14px ""Mgen+ 1mn Term", monospace"`. load() rejects an unparsable
    // shorthand, the .catch below swallows that rejection, and the bold preload
    // then disappears *silently* — no error, no fallback, just an unloaded 700
    // face and a first bold row painted with whatever was there. That silence is
    // exactly why the spec is built from `bundled`, not from `family`.
    //
    // This is also the consumption point that decides `bundledFamilyOf`'s return
    // contract (#274, design #271 R11): what goes in the quotes is a CSS
    // `@font-face` NAME being awaited, so for a settings value naming a former
    // family (an alias) it must be the alias — that is the block getHtml injected
    // for it — and not the canonical name the host's `matchRegisteredFamily`
    // returns. The full reasoning for the two matchers pointing opposite ways is
    // the asymmetry comment block in media/webview-font.js; do not fold here.
    const regularSpec = `${fontSize || 14}px "${bundled}"`;
    const boldSpec = `bold ${fontSize || 14}px "${bundled}"`;
    // Preload the 700 face alongside the 400 one: xterm paints into canvas/WebGL,
    // which does not wait for a font to load, so a bold cell drawn before its face
    // arrives is drawn with a fallback (font-display cannot save it on that path).
    //
    // FORBIDDEN SHAPE — do not "shorten" this to
    //   Promise.race([load(regularSpec), load(boldSpec), timeout])
    // The moment bold settles the race resolves, check() runs without the regular
    // face having loaded, and we hand xterm DEFAULT_FONT_FAMILY even though the
    // bundled font was perfectly usable — a direct violation of the
    // build-once-at-the-right-metrics invariant above. Regular and bold are
    // separate files and separate downloads with no ordering guarantee (under
    // Remote-SSH they share the channel with pty output), so "bold first" is not
    // a corner case. Both faces are awaited by Promise.all; only the timeout is
    // raced against them.
    await Promise.race([
      // Each load is caught individually so a failing bold face cannot drag the
      // 400 face's wait down with it. load() rejects only on an unparsable
      // shorthand or a fetch failure — an old contract that ships no 700 face
      // does not reject: CSS font matching picks the nearest weight, so the bold
      // request resolves against the 400 face and costs no extra fetch.
      Promise.all([
        document.fonts.load(regularSpec).catch(() => {}),
        document.fonts.load(boldSpec).catch(() => {}),
      ]),
      new Promise((resolve) => setTimeout(resolve, FONT_LOAD_TIMEOUT_MS)),
    ]);
    // The verdict is taken from the 400 face alone: a missing bold face (old
    // contract) must not drop the whole family, because cell measurement depends
    // on the regular metrics only.
    return document.fonts.check(regularSpec) ? family : DEFAULT_FONT_FAMILY;
  }

  /**
   * Fire-and-forget preload of the fallback family's faces (#290, plan #287
   * "方針 B"). A fallback face is only fetched when CSS first needs a character
   * from it, so without this the glyphs it exists to supply blink in a moment
   * late; asking for them up front shortens that window.
   *
   * It is NOT a gate, and that is the whole point: nothing awaits it, its result
   * never reaches a verdict, and `resolveFontForMeasure`'s `check` still looks at
   * the PRIMARY family's 400 face alone (the FORBIDDEN SHAPE note there is about
   * what may be raced into that verdict — this call is outside it entirely).
   * Cell measurement must depend on the primary face only; the fallback supplies
   * characters the primary has no glyph for, which by definition are not the ones
   * the grid is measured from.
   *
   * `bundledFamilyOf` is applied to the FALLBACK VALUE ON ITS OWN. That is not the
   * longest-match trap resurfacing: the trap is a matcher fed a stack that holds
   * both names and returning the wrong one. Here the two values are still
   * separate, each matcher call sees exactly one of them, and this one's answer is
   * used for nothing but a preload.
   *
   * Wrapped in try/catch because one of its callers is the fail-safe path below,
   * whose reason for existing is an environment where `document.fonts` may be
   * missing or throwing.
   */
  function preloadFallbackFace(fontFallback, fontSize) {
    try {
      const bundled = TmuxFont.bundledFamilyOf(fontFallback);
      if (!bundled) {
        return;
      }
      const size = fontSize || 14;
      document.fonts.load(`${size}px "${bundled}"`).catch(() => {});
      document.fonts.load(`bold ${size}px "${bundled}"`).catch(() => {});
    } catch {
      // Preloading is an optimization; a hostile/absent FontFaceSet must not take
      // the terminal down with it. CSS still fetches the face on first use.
    }
  }

  /**
   * THE single composition point (#290, plan #287 "方針 B"): the family xterm is
   * configured with, built from the measurement verdict and the fallback setting.
   *
   * Every consumer that judges family IDENTITY — the host's nudge and font picker
   * (`matchRegisteredFamily`), this file's measurement target
   * (`TmuxFont.bundledFamilyOf`), the toolbar chip — keeps receiving the raw
   * PRIMARY value, because the two values are only ever joined here and this
   * result is handed to xterm and to nothing else. Never feed it back into a
   * matcher, and never move the join into the host: a matcher that can see the
   * fallback name is a matcher that can pick it (the longest-match trap).
   *
   * Applied UNIFORMLY to whatever `resolveFontForMeasure` returned — including the
   * `DEFAULT_FONT_FAMILY` verdict, and including the fail-safe path that never
   * reaches a verdict at all. Whether the primary face loaded is independent of
   * whether the user wants a second family for the characters it lacks, so a
   * fallback dropped on either of those branches would go missing silently.
   */
  function fontStackForXterm(measuredFamily, fontFallback, fontSize) {
    preloadFallbackFace(fontFallback, fontSize);
    // The primary is narrowed HERE, before `buildFontStack` splices anything into
    // it (#297): this is the sole composition point, and what leaves it goes
    // straight into xterm's `_injectCss`, which builds a <style> by string
    // concatenation. `buildFontStack` already narrows the fallback token (#290).
    return TmuxFont.buildFontStack(
      TmuxFont.sanitizeFontStack(measuredFamily),
      fontFallback,
    );
  }

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

  // Runtime font swap (a `config` after the terminal is already built). Awaits
  // the bundled font the same way the first init does, then swaps xterm's options
  // and re-measures — so a live switch to the bundled font also fits against the
  // loaded metrics rather than the OS fallback's.
  async function applyFontConfig(config) {
    const generation = ++fontConfigGeneration;
    const family = await resolveFontForMeasure(config.fontFamily, config.fontSize);
    // A newer applyFontConfig started while we awaited: its result is the one
    // the user wants, so drop ours rather than let completion order overwrite it.
    if (generation !== fontConfigGeneration) {
      return;
    }
    term.options.fontFamily = fontStackForXterm(family, config.fontFallback, config.fontSize);
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
    notifySoundOn: 'Notification sound: on',
    notifySoundOff: 'Notification sound: off',
    selectFont: 'Select Font',
    fontFamilyHeader: 'Font Family',
    fontSizeHeader: 'Font Size',
    fontEditorDefault: 'Editor default',
    fontBundledSuffix: 'font extension',
    updateTool: 'Update {0}',
    restartTool: 'Restart {0}',
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
    // Stop a later fontOptions re-push from reopening a menu the user dismissed.
    fontMenuAnchor = null;
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

  // A non-clickable section header inside the reused #context-menu (#210 font
  // picker). Keeps the popup a single mechanism rather than a second dropdown.
  function addMenuHeader(label) {
    const header = document.createElement('div');
    header.className = 'menu-header';
    header.textContent = label;
    contextMenu.appendChild(header);
  }

  // A menu row with a leading check gutter for the font picker (#210). The check
  // codicon renders only when `checked`, so the selected family/size is marked.
  function addFontMenuItem(label, checked, onPick) {
    const item = document.createElement('div');
    item.className = 'menu-item font-item' + (checked ? ' checked' : '');
    const check = document.createElement('span');
    check.className = 'check codicon codicon-check';
    item.appendChild(check);
    const text = document.createElement('span');
    text.className = 'label';
    text.textContent = label;
    item.appendChild(text);
    item.addEventListener('click', () => {
      closeContextMenu();
      onPick();
    });
    contextMenu.appendChild(item);
  }

  // Anchor-relative placement shared by every #context-menu popup: show first so
  // it can be measured, then flip to stay inside the view. Right-aligned to the
  // button because the sidebar hugs the right edge.
  function positionContextMenu(anchor) {
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

    positionContextMenu(anchor);
  }

  // Latest fontOptions payload from the host (#210, #209 protocol). Null until the
  // first push lands; the button no-ops (opens an empty-ish menu) only in that
  // brief pre-push window. `fontMenuAnchor` (and `fontMenuKind`, #222) are
  // remembered so a re-push (after a selection writes back through config ->
  // pushFontOptions) can refresh the same filtered menu in place while it is still
  // open — with the check marks following the new effective font.
  let fontOptions = null;
  let fontMenuAnchor = null;
  let fontMenuKind;

  // Derive a human label for a fontFamily enum value. The payload carries only
  // `{ value, bundled }`, so the label is the value's primary family token (the
  // first comma-separated segment, quotes stripped); the empty value is the
  // editor default. Bundled families are tagged so the user can tell the
  // font-extension-supplied face apart from an OS one.
  function fontFamilyLabel(option) {
    if (option.value === '') {
      return strings.fontEditorDefault;
    }
    const primary = option.value.split(',')[0].replace(/["']/g, '').trim();
    return option.bundled ? `${primary} (${strings.fontBundledSuffix})` : primary;
  }

  // Open the reused #context-menu as a font picker. `kind` (#222) narrows it to a
  // single section: 'family' builds only the Font Family list, 'size' only the
  // Font Size list. Omitting `kind` (undefined) falls back to building BOTH
  // sections (with the separator between them) — the pre-#222 behavior — so a
  // caller that forgets to pass it never gets an empty menu. `addMenuHeader` /
  // `addFontMenuItem` / the check-mark match / the `size === null` skip are reused
  // unchanged; only which sections are built (and the remembered `kind`) is new.
  function openFontMenu(anchor, kind) {
    contextMenu.replaceChildren();
    if (!fontOptions) {
      // No options yet (pre-push). Nothing to show; leave the menu closed and the
      // anchor unset so a later push can't pop an unprompted menu open.
      fontMenuAnchor = null;
      return;
    }
    fontMenuAnchor = anchor;
    fontMenuKind = kind;

    const showFamily = kind === 'family' || kind === undefined;
    const showSize = kind === 'size' || kind === undefined;

    if (showFamily) {
      addMenuHeader(strings.fontFamilyHeader);
      for (const family of fontOptions.families) {
        const checked = TmuxFont.fontFamilyMatchesCurrent(family.value, fontOptions.currentFamily);
        addFontMenuItem(fontFamilyLabel(family), checked, () =>
          vscodeApi.postMessage({ type: 'selectFont', family: family.value }),
        );
      }
    }

    if (showFamily && showSize) {
      addMenuSeparator();
    }

    if (showSize) {
      addMenuHeader(strings.fontSizeHeader);
      for (const size of fontOptions.sizes) {
        // The host's selectFont (#209) persists a size only when it is a concrete
        // number — a `null` (editor-default) selection is a no-op there — so the
        // null entry is omitted rather than shown as a dead row. Clearing the size
        // override stays a Settings-UI action. (Family differs: its '' editor-
        // default DOES persist, so it is offered above.)
        if (size === null) {
          continue;
        }
        const checked = TmuxFont.fontSizeMatchesCurrent(size, fontOptions.currentSize);
        addFontMenuItem(String(size), checked, () =>
          vscodeApi.postMessage({ type: 'selectFont', size }),
        );
      }
    }

    positionContextMenu(anchor);
  }

  // The always-on font chips on the 2nd toolbar row (#222, plan #221, design #220;
  // one chip since #217, now split into two). The family chip displays the
  // effective family (ellipsized, remaining width) and opens the Font Family
  // section; the size chip displays the effective size (content width) and opens
  // the Font Size section. updateFontChip refreshes both from the latest
  // fontOptions payload; the pure composition lives in TmuxFont.fontFamilyChipText /
  // fontSizeChipText so it is unit-tested without a DOM.
  const fontChip = document.getElementById('fontChip');
  const fontChipLabel = document.getElementById('fontChipLabel');
  const fontSizeChip = document.getElementById('fontSizeChip');
  const fontSizeChipLabel = document.getElementById('fontSizeChipLabel');
  function updateFontChip() {
    if (!fontOptions) {
      return;
    }
    const familyText = TmuxFont.fontFamilyChipText(fontOptions, fontFamilyLabel);
    fontChipLabel.textContent = familyText;
    // A long family is ellipsized by CSS; the full text stays reachable on hover,
    // so the family chip's title is the dynamic full text (its static "Font Family"
    // affordance is the aria/role). The size chip keeps its static title only.
    fontChip.title = familyText;
    fontSizeChipLabel.textContent = TmuxFont.fontSizeChipText(fontOptions);
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
  document.getElementById('refreshSessions').addEventListener('click', () => {
    closeContextMenu();
    vscodeApi.postMessage({ type: 'refreshSessions' });
  });
  document.getElementById('killSession').addEventListener('click', () => {
    closeContextMenu();
    vscodeApi.postMessage({ type: 'killCurrentSession' });
  });
  document.getElementById('openSettings').addEventListener('click', () => {
    closeContextMenu();
    vscodeApi.postMessage({ type: 'openSettings' });
  });

  // The tool-action buttons (#136): update and restart the AI tool running as the
  // attached session. Both are hidden by default and only revealed by a
  // `toolActions` message (#134) — the host resolves what the current session
  // earns (a matched profile earns restart; one declaring an updateCommand also
  // earns update) and is the source of truth, so an unknown/plain-shell session
  // shows neither. The click only *asks* the host to act; the host owns the
  // restart/update logic (#134/#135). `toolLabel` names the tool in each title.
  const updateToolBtn = document.getElementById('updateTool');
  const restartToolBtn = document.getElementById('restartTool');
  // Remembered so a later `l10n` message can re-render the titles (the tool
  // label is the host's, but the "Update"/"Restart" wording comes from strings).
  let lastToolActions = { canUpdate: false, canRestart: false, toolLabel: '' };
  function applyToolActions(actions) {
    lastToolActions = actions;
    updateToolBtn.hidden = !actions.canUpdate;
    restartToolBtn.hidden = !actions.canRestart;
    const label = actions.toolLabel || '';
    if (actions.canUpdate) {
      updateToolBtn.title = format(strings.updateTool, label);
    }
    if (actions.canRestart) {
      restartToolBtn.title = format(strings.restartTool, label);
    }
  }
  updateToolBtn.addEventListener('click', () => {
    closeContextMenu();
    vscodeApi.postMessage({ type: 'updateTool' });
  });
  restartToolBtn.addEventListener('click', () => {
    closeContextMenu();
    vscodeApi.postMessage({ type: 'restartSession' });
  });

  // The toolbar bell toggle for tmuxOpener.notifySound (#127). The webview has no
  // Configuration API, so the click only *asks* the host to flip the setting; the
  // host is the source of truth and echoes the new value back through the `config`
  // message (applyNotifySoundState), which is what actually updates the icon —
  // so the button always mirrors the persisted setting, including a change made
  // from the Settings UI. The one-shot confirmation sound on OFF->ON is played by
  // the host (this click is the user gesture that arms audio; unlockAudio's
  // window-level capture listener already resumed the context off the same
  // pointerdown/keydown).
  const notifySoundBtn = document.getElementById('toggleNotifySound');
  const notifySoundIcon = notifySoundBtn.querySelector('.codicon');
  // Unknown until the first `config` message lands (#127). The HTML placeholder
  // renders the safe (off) state — a muted bell that turns out enabled is a
  // harmless correction, whereas showing an enabled bell that is really muted
  // would misrepresent the setting. Nothing here asserts a definitive state
  // before the host echoes the real value.
  let notifySoundEnabled;
  function applyNotifySoundState(enabled) {
    notifySoundEnabled = enabled;
    notifySoundIcon.classList.toggle('codicon-bell', enabled);
    notifySoundIcon.classList.toggle('codicon-bell-slash', !enabled);
    notifySoundBtn.setAttribute('aria-pressed', String(enabled));
    notifySoundBtn.title = enabled ? strings.notifySoundOn : strings.notifySoundOff;
  }
  notifySoundBtn.addEventListener('click', () => {
    closeContextMenu();
    vscodeApi.postMessage({ type: 'toggleNotifySound' });
  });
  // The two font chips on the 2nd toolbar row (#222; one chip since #217). Each
  // reuses the #context-menu popup (no new dropdown DOM) to list only its own
  // section from the host's `fontOptions` (#209): the family chip opens the Font
  // Family list ('family'), the size chip opens the Font Size list ('size'), both
  // via openFontMenu. Each toggles like the profile split-button's chevron.
  fontChip.addEventListener('click', (e) => {
    if (contextMenu.classList.contains('visible')) {
      closeContextMenu();
    } else {
      openFontMenu(e.currentTarget, 'family');
    }
  });
  fontSizeChip.addEventListener('click', (e) => {
    if (contextMenu.classList.contains('visible')) {
      closeContextMenu();
    } else {
      openFontMenu(e.currentTarget, 'size');
    }
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
      if (msg.notifySound !== undefined) {
        applyNotifySoundState(msg.notifySound);
      }
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
      // The bell toggle's title comes from `strings`, so refresh it for the
      // current state now that the translations have landed (#127) — but only
      // once the state is known, so an l10n message arriving before the first
      // `config` can't assert a wrong (on/off) state.
      if (notifySoundEnabled !== undefined) {
        applyNotifySoundState(notifySoundEnabled);
      }
      // Re-render the tool-action titles with the landed wording (#136), keeping
      // their current shown/hidden state.
      applyToolActions(lastToolActions);
      return;
    }
    if (msg.type === 'profiles') {
      profiles = msg.profiles;
      closeContextMenu();
      return;
    }
    if (msg.type === 'fontOptions') {
      // Host's font picker choices (#210, #209 protocol). Doesn't touch the
      // terminal, so it's safe before init completes. Pass only the fields the
      // picker renders. If the font menu is open (a selection just wrote back and
      // the host re-pushed), rebuild it in place so the check marks follow.
      fontOptions = {
        families: msg.families,
        sizes: msg.sizes,
        currentFamily: msg.currentFamily,
        currentSize: msg.currentSize,
      };
      // Refresh the always-on chip's label (#217) on both the first push and the
      // re-push that follows a selection (config -> pushFontOptions), so the chip
      // follows the effective font like the menu's check marks do.
      updateFontChip();
      if (fontMenuAnchor) {
        // Rebuild the SAME filtered menu in place (#222): pass the remembered
        // `fontMenuKind` so a family-only / size-only menu stays that way as its
        // check marks follow the just-applied selection.
        openFontMenu(fontMenuAnchor, fontMenuKind);
      }
      return;
    }
    if (msg.type === 'toolActions') {
      // Doesn't touch the terminal — safe before init completes, like `sessions`.
      // Pass only the fields we act on, so `lastToolActions` never carries `type`.
      applyToolActions({
        canUpdate: msg.canUpdate,
        canRestart: msg.canRestart,
        toolLabel: msg.toolLabel,
      });
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
      if (msg.notifySound !== undefined) {
        applyNotifySoundState(msg.notifySound);
      }
      // Defer construction until the chosen font is loadable, so the first cell
      // measurement uses the real font (see resolveFontForMeasure). `initStarted`
      // makes this fire exactly once even if a second config lands during the
      // await; other pre-ready messages keep flowing into `pending` as before.
      if (!initStarted) {
        initStarted = true;
        resolveFontForMeasure(msg.fontFamily, msg.fontSize)
          .then((family) => {
            initTerminal({
              ...msg,
              fontFamily: fontStackForXterm(family, msg.fontFallback, msg.fontSize),
            });
          })
          // `initStarted` is already latched with no retry path, so a rejection
          // (e.g. a synchronous throw where `document.fonts` is absent — the
          // per-load `.catch` inside resolveFontForMeasure attaches to the
          // returned promise, so it covers neither `.load`'s nor `.check`'s own
          // throw) would leave the terminal permanently unbuilt. Fail safe: build it against
          // the raw config font, which is present now, rather than not at all.
          //
          // The fallback is composed in here too (#290, plan #287 review L1): this
          // branch never reaches a verdict, so leaving it as a bare
          // `initTerminal(msg)` would drop the user's fallback family without a
          // word in exactly the degraded environment they are most likely to need
          // it. `initTerminal` would apply the same `|| DEFAULT_FONT_FAMILY`
          // itself; it is spelled out here so the composed value is what it sees.
          .catch(() => {
            initTerminal({
              ...msg,
              fontFamily: fontStackForXterm(
                msg.fontFamily || DEFAULT_FONT_FAMILY,
                msg.fontFallback,
                msg.fontSize,
              ),
            });
          });
      }
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

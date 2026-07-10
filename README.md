# Tmux Opener

*[日本語](README.ja.md)*

A tmux terminal that lives in VS Code's Secondary Side Bar. It opens — or
re-attaches to — a session named after your workspace folder, and keeps as many
extra sessions as you like.

Unlike other tmux extensions, this is not a wrapper around VS Code's Integrated
Terminal. The view is its own terminal, so a tmux session and its window layout
survive being detached, reattached, or reopened after a window reload.

## Requirements

`tmux` must be installed and on your `PATH`.

## Usage

Open the **Tmux** view from the Secondary Side Bar (the right-hand panel).

- The toolbar at the top shows the current session name, a `+ ⌄` button to
  create sessions, and actions to show/hide the session list, kill the current
  session, and open settings.
- The session list on the right works like VS Code's terminal tabs: click a
  session to switch to it, click **×** (or middle-click) to kill it, drag its
  edge to resize.
- Only one session is attached at a time. Switching detaches the previous one;
  the session itself keeps running.
- Opening the view attaches to the topmost session. Killing a session — or
  quitting it with `exit` — moves you to the next one.
- `Ctrl`/`Cmd`+`F` opens a find bar. URLs in the output are clickable.

The same actions are in the Command Palette under **Tmux:**.

## Profiles

`+` starts a plain shell session. The chevron beside it opens a dropdown of
**profiles** — commands to run as the session itself, so quitting the command
ends the session.

Profiles for **Claude Code**, **Codex**, **Gemini**, **Cursor** and **Grok**
ship by default. `tmuxOpener.profiles` is merged over them: set a key to `null`
to hide one, or add your own key to define a new one.

```jsonc
"tmuxOpener.profiles": {
  "Gemini": null,                                    // hide a built-in
  "Claude Code": { "command": "claude --continue" }, // override one
  "Build": { "command": "npm run watch", "sessionSuffix": "build" }
}
```

Sessions are named after the workspace folder: `myrepo`, then `myrepo-2`,
`myrepo-3`… Profile sessions get their own name (`myrepo-claude-code`), so they
never take a number in that sequence.

A profile whose command isn't on your `PATH` is marked in the dropdown but stays
selectable — the login shell tmux starts may resolve it differently.

## Settings

| Setting | Description |
| --- | --- |
| `tmuxOpener.terminal.fontFamily` | Terminal font. Follows `editor.fontFamily` when empty. |
| `tmuxOpener.terminal.fontSize` | Terminal font size. Follows `editor.fontSize` when unset. |
| `tmuxOpener.profiles` | Commands offered by the `⌄` dropdown. |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to build and run the extension
locally.

## License and attribution

MIT. See the `LICENSE` file for the full text and for the attributions
summarized below.

The session list's layout (default/min/max width, the width breakpoints where
labels and close buttons hide, right-side default placement, middle-click to
kill) and the split button are modeled on Microsoft's Visual Studio Code source,
also MIT licensed. No code was copied verbatim.

The extension icon is the official tmux logo by Jason Long, used unmodified
under its ISC license. The view container icon is a monochrome redraw of that
design, because VS Code renders view container icons as a single-color mask.
Toolbar icons are Microsoft's Codicons, under CC BY 4.0.

**tmux-opener is unofficial and is not affiliated with or endorsed by the tmux
project.**

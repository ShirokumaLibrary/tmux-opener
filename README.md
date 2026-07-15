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
  create sessions, and actions to toggle the notification sound
  (`tmuxOpener.notifySound`), show/hide the session list, kill the current
  session, and open settings.
- The session list on the right works like VS Code's terminal tabs: click a
  session to switch to it, click **×** (or middle-click) to kill it, drag its
  edge to resize.
- Only one session is attached at a time. Switching detaches the previous one;
  the session itself keeps running.
- Opening the view attaches to the topmost session. Killing a session — or
  quitting it with `exit` — moves you to the next one.
- `Ctrl`/`Cmd`+`F` opens a find bar. URLs in the output are clickable.
- Copying works from tmux's own copy-mode (via OSC 52), and from a terminal
  selection made with `Shift`+drag or `Option`+drag. `Ctrl`/`Cmd`+`C` copies
  when text is selected, and passes through as `SIGINT` when it isn't.

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

## Notifications

The view watches each session for the terminal bell (BEL, `\a`) and raises a
native VS Code notification naming the session that rang it — so you can leave an
AI CLI working in a background session and be told the moment it stops for a
prompt or finishes. The notification's **Open** button jumps to that session.
This is on by default; set `tmuxOpener.notifyOnBell` to `false` to turn it off.

A sound plays alongside the notification so you notice it even away from the
screen. Because the sound is synthesized in the webview — which always runs on
your local machine — you hear it at your keyboard even when the session lives on
a remote host (Remote-SSH). It's on by default; set `tmuxOpener.notifySound` to
`false` to silence it. `tmuxOpener.notifySoundPreset` picks the sound from five
presets — `classic` (Classic Ring, default), `siren` (Siren Sweep), `sos` (SOS
Pulse), `cascade` (Falling Cascade) and `trill` (Rapid Trill); preview one by
changing the setting and triggering a bell.

Browsers won't let a page play audio until the window has been interacted with at
least once, so a bell that rings in a freshly reloaded window you haven't touched
yet stays silent. When that happens the notification carries a **Play Sound**
button: click it to hear the bell you missed — and every bell after it rings on
its own.

For it to fire, the tool in the session has to ring the bell when it wants
attention. Most AI CLIs can, though not always by default.

### Choosing the BEL source (pick one — they don't add up)

For Claude Code there are three ways to arrange it, and they are **alternatives,
not additions**. The reference hook scripts described further down do not put a
bell *on top of* Claude Code's own — they **replace** it as the source of the
BEL. Exactly one thing should be ringing it, and which one you pick decides what
`preferredNotifChannel` must be in `~/.claude/settings.json`:

| Setup | What rings the BEL | `preferredNotifChannel` |
| --- | --- | --- |
| **A. No scripts** (the default) | Claude Code itself | `"terminal_bell"` — **required**; nothing else would ring |
| **B. Bell-reason sound** (a distinct sound for "waiting for input") | `tmux-opener-bell.sh`, from the `Stop` and `Notification` hooks | a **non-bell** channel, e.g. `"notifications_disabled"` |
| **C. Subagent-aware idle gate** (ring only on *true* idle) | `subagent-idle-gate.sh` → `tmux-opener-bell.sh` | a **non-bell** channel, e.g. `"notifications_disabled"` |

C builds on B — it keeps B's `Notification` → ask wiring and routes only the
*completion* bell through the gate — so those two stack with each other. What
doesn't stack is **A with either of them**: leaving `terminal_bell` on while a
hook script also rings the bell is the mistake this table exists to prevent.

**A — no scripts.** Claude Code rings the bell itself, but only if you ask it to:
add `"preferredNotifChannel": "terminal_bell"` to `~/.claude/settings.json`, or
run `/config preferredNotifChannel=terminal_bell` inside a session (there is no
`claude config` CLI subcommand). This is the whole setup; everything below is
optional.

**B and C — switch `terminal_bell` back off.** Once a hook script rings the BEL,
Claude Code's built-in bell is a *second* source firing for the same event, and
the two race:

- The extension folds a pair of BELs into one notification (a per-session
  cooldown of 5s), so you don't get two toasts or two sounds. But that also means
  **only the first BEL of the pair is ever judged** — and VS Code cannot amend a
  notification it has already shown.
- The hook writes its reason file (`stop` / `ask`) *before* it rings; Claude
  Code's built-in bell writes nothing. Often that costs you nothing. If a reason
  file written in the last 30s is already on disk when the bell is judged, the
  extension waits **250ms** and re-reads it (the settle described further down) —
  so the hook's file, a few milliseconds behind the built-in bell, still lands in
  time and the right sound plays.
- **But the settle only runs when there was already something to notice.** If no
  reason file is fresh — nothing written for 30s, which is exactly what a long
  tool call before a permission prompt looks like — the built-in bell is judged
  on the spot, with no reason attached: the completion preset and the neutral
  toast. The hook's own BEL, its `ask` file now on disk, arrives inside the
  cooldown and is dropped, so nothing corrects the verdict. The "waiting for
  input" sound that setup B exists for goes missing on exactly the prompts you
  had stepped away from.
- With the gate (C), the built-in bell doesn't just risk the wrong sound: it
  bypasses the gate completely and notifies while subagents are still working —
  precisely what the gate is there to prevent. No race is needed for that one;
  the built-in bell simply never consults the gate.

Set it to `"notifications_disabled"` (or another non-bell channel) so the scripts
are the single source of the BEL. Nothing is lost by turning it off: the hooks
ring for both reasons — a finished turn and a prompt waiting on you.

Other CLIs have their own switch (the scripts here are Claude Code-specific):

- **Gemini CLI** — enable `enableTerminalBell` (Settings → Accessibility; off by
  default)
- **Codex CLI** — on Linux it may already ring the bell on completion
  (environment-dependent)
- **aider** — `aider --notifications-command 'printf "\a"'` routes its
  notification to the bell

Because BEL is not an AI-only signal, other sources ring it too — a shell's
completion bell, vim's error beep, `tput bel` — and each of those also raises a
notification. If that gets noisy, turn off your shell's completion bell (for
readline shells, `set bell-style none` in `~/.inputrc`), or look at tmux's own
`bell-action` (`man tmux`) to control which bells tmux reacts to.

### Installing the reference scripts

The three optional features below — the **statusline bridge**, the
**bell-reason sound** and the **subagent-aware idle gate** — are driven by small
scripts that live in [`claude/`](claude/) and are installed into `~/.claude`,
mirroring that directory one-for-one:

```
claude/statusline.sh                ->  ~/.claude/statusline.sh
claude/hooks/session-state.sh       ->  ~/.claude/hooks/session-state.sh
claude/hooks/subagent-idle-gate.sh  ->  ~/.claude/hooks/subagent-idle-gate.sh
claude/hooks/tmux-opener-bell.sh    ->  ~/.claude/hooks/tmux-opener-bell.sh
```

They all need `jq` on your `PATH`, and all of them are optional — but they are
not all *additive*. Only the **statusline bridge** is a true extra: it rings no
bell, it just adds context% and cost to the notification, so it stacks with any
of the three setups above. The two **bell hooks** (`tmux-opener-bell.sh`,
`subagent-idle-gate.sh`) take over as the source of the BEL, which is why setups
B and C require Claude Code's own `terminal_bell` to be switched off. Install
nothing and you are in setup A: the bell still rings and the notification still
appears — because `terminal_bell` is what rings it. Keep the layout as shown, in
particular the two hooks in the same directory: the idle gate resolves the bell
script relative to itself.

**From a clone** (the repository is the source of truth for these scripts):

```bash
git clone https://github.com/ShirokumaLibrary/tmux-opener.git
cd tmux-opener
npm run claude:install
```

The installer backs up anything it overwrites into
`~/.claude/backup-<timestamp>/`, sets the executable bit, and **prints** the
`settings.json` snippet for you to paste — it never edits `settings.json` itself.
`npm run claude:install -- --dry-run` shows what it would do and writes nothing
(the `--` matters: npm swallows flags placed before it).

If one of the destinations is a **symlink** — because you keep these scripts in a
dotfiles repository, say — the installer stops and tells you rather than writing
through it, since copying onto a link overwrites its target somewhere outside
`~/.claude` and a backup of a link would restore nothing. `--force` proceeds, and
in that case it saves the linked file's *contents* first, then replaces the link
with a regular file.

**Without a clone** — if you installed the extension from the Marketplace, the
scripts are not in the VSIX. The same installer can fetch them straight from the
repository: grab it, then run it pointed at the published `claude/` scripts.

```bash
curl -fsSL https://raw.githubusercontent.com/ShirokumaLibrary/tmux-opener/main/scripts/install-claude.sh -o install-claude.sh
bash install-claude.sh --src https://raw.githubusercontent.com/ShirokumaLibrary/tmux-opener/main/claude
```

This fetches the scripts into a temporary directory and installs them exactly as
the clone path above does — the same backup, the same refusals for a symlinked or
legacy layout, the same executable bit, and the same `settings.json` snippet
printed for you to paste (never written). Add `--dry-run` to see the plan without
writing anything. If you prefer the [`gh` CLI](https://cli.github.com/) — for a
private mirror, or when `raw.githubusercontent.com` is blocked — fetch through it
instead:

```bash
gh api repos/ShirokumaLibrary/tmux-opener/contents/scripts/install-claude.sh -H "Accept: application/vnd.github.raw" > install-claude.sh
bash install-claude.sh --src gh:ShirokumaLibrary/tmux-opener/claude
```

Each feature below shows the `~/.claude/settings.json` wiring it needs — and, for
the two that ring the bell, restates which `preferredNotifChannel` that implies.
Enable only the ones you want.

### Statusline bridge (context % and cost in the notification)

Optionally, the notification can also say **how much context the session has
used and what it has cost so far** — e.g. `Session "myproject" needs attention.
(context 82%, cost $0.45)`. The extension can't see Claude Code's internal JSON, but
your statusline script can: it receives that JSON on stdin. So a reference
`statusline.sh` writes a small excerpt into
`${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener/status-<session>.json`, and the
extension reads it (when fresh, within 30s) as a bell fires. It's entirely
opt-in — with no script installed, nothing changes.

Both sides resolve that path from `XDG_CACHE_HOME` (falling back to
`$HOME/.cache`): the script from your interactive shell, the extension from
the environment VS Code was launched in. **These have to agree.** If you set
`XDG_CACHE_HOME` only in your shell rc (`~/.bashrc`, `~/.zshrc`), the script
writes under `$XDG_CACHE_HOME` while the extension still reads `$HOME/.cache`,
so it silently finds nothing — the notification just drops the detail; no wrong
data is ever shown. Either leave `XDG_CACHE_HOME` unset on both sides (the
common case, and they match), or make sure VS Code is started with the same
value.

To enable it, install the scripts (above) and register the statusline in
`~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "~/.claude/statusline.sh" }
```

The statusline also renders a **working / idle indicator** — a spinner
(`⠋ working`) turning while Claude is generating, `✅ idle` once it is done.
Whether it appears is hook state, not the clock; only the frame it turns on comes
from the clock, so the turning says one narrow thing: *this statusline is still
being redrawn*. That tells a live line from a still picture of one (a detached
pane, a frozen terminal) — but not from a wedged hook, which leaves `running` on
disk while the statusline goes on being called, spinner and all. That state can't
be derived from the statusline's own stdin, so it comes from a second script,
[`claude/hooks/session-state.sh`](claude/hooks/session-state.sh), which two hooks
drive. It is optional: without it the indicator stays a neutral `○` and
everything else on the statusline still works. To enable it, register the hooks
— and `refreshInterval` — in `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "~/.claude/statusline.sh",
  "refreshInterval": 1
},
"hooks": {
  "UserPromptSubmit": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/session-state.sh running" } ] }
  ],
  "Stop": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/session-state.sh stopped" } ] }
  ]
}
```

`refreshInterval` is what makes the indicator flip promptly. `UserPromptSubmit`
is not itself one of the statusline's refresh triggers (those are: after each
assistant message, after `/compact`, on permission-mode change, on vim-mode
toggle), so without a timer the `running` state the hook just wrote wouldn't be
picked up until whatever trigger fires next — usually long after it mattered.

The indicator also keeps spinning while a subagent is still running, even
after the main turn stops, by reading the same marker set as the idle gate below
— so it and the bell can never disagree about whether the session is truly idle.

Beside it, the statusline shows the **git branch and its state** — `🌿 main ↑2 ✚ …`
is "two commits ahead of the upstream, with uncommitted changes to tracked files,
and some untracked files lying around" (`↓` is behind; both arrows appear when the
branch has diverged). It comes from a single `git status --porcelain=v2 --branch`
per render, run with `--no-optional-locks` so it never takes `index.lock` out from
under a git command of your own.

`✚` and `…` are deliberately **two markers, not one**. They call for different
things — tracked changes are work you have to commit, untracked files usually are
not — and a repository that keeps some directory untracked on purpose would light a
combined marker permanently, which is the same as having no marker at all.

Turn the appended detail off (while keeping the notification) with
`tmuxOpener.notifyBridgeStatusline: false`. The stdin field names
(`.context_window.used_percentage`, `.cost.total_cost_usd`) target Claude Code's
statusline schema; the `// empty` / `// 0` fallbacks keep the script working if
a field is absent, and the extension falls back to the plain notification
whenever the file is missing, stale, or unreadable.

### Bell-reason sound (a distinct sound for "waiting for input")

Optionally, the notification can play a **different sound depending on why the
bell rang** — one preset when a turn *finishes*, another when the CLI is
*waiting for your input* (a permission prompt, for example). Told apart by ear,
you know whether you can keep working or need to switch over. Like the
statusline bridge, this is entirely opt-in — with no hook script installed,
every bell uses the plain `tmuxOpener.notifySoundPreset` and nothing changes.

The extension can't see *why* Claude Code rang the bell, but Claude Code's hooks
can: its `Stop` hook fires on completion, and its `Notification` hook fires on
the events that want something from you. A reference `tmux-opener-bell.sh` —
called with a `stop` or `ask` argument from each hook — writes a reason file
(`${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener/bell-<session>.<reason>.json`) and
then rings the bell. The two reasons write **separate files**, so a `stop` and an
`ask` landing close together never overwrite each other; the reader resolves the
pair instead (by notification type, or by mtime — see below).

As the bell arrives, the extension reads both reason files and picks the sound:

- Neither file fresh (within **30s**) → the plain `notifySoundPreset` (the
  no-hooks default; no added latency).
- Exactly one fresh → that reason's sound.
- Both fresh and written within **3s** of each other (a co-fire) → the ask
  sound **if** the ask reason file names a "waiting on you" notification type
  (`permission_prompt`, `agent_needs_input`, `elicitation_dialog`), otherwise
  **`stop` wins**. The `matcher` wiring only ever lets those three types reach
  the ask hook, so an ask carrying one is a genuine approval wait even this close
  to a completion; an ask with no recorded type (a legacy hook that predates the
  field) folds into the completion as before.
- Both fresh but more than **3s** apart → the more recent one wins (a genuinely
  separate ask, or — with a *newer* stop — a completion that resolved an earlier
  prompt). The notification type only tips the **3s** co-fire above; it never
  overrides a newer stop here.

When at least one reason file is fresh, the extension waits **250ms** for the
co-firing sibling to land before choosing; a bell with no fresh reason file
skips that wait entirely.

The **3s** tie-break exists because `Notification` also fires when a turn
*completes*, so one finished turn could write both files milliseconds apart and
the pair had to resolve to `stop` rather than let the ask sound hijack a
completion. To tell a **genuine** ask apart from that co-fire, the ask hook now
records *which* notification type rang it — read from the `Notification` stdin —
into the reason file, and the reader trusts that type **inside the 3s co-fire
window**: a fresh ask naming one of the three "waiting on you" types (the
`matcher` below admits only those three) plays as an ask even when its mtime
sits right on a completion's. So a permission prompt arriving right after a turn
finished now rings the ask sound with the "waiting for your input" toast — where
it used to resolve to `stop` and claim the turn had finished.

The type only tips that **3s** window; it does not override the newer-mtime rule.
An ask whose prompt was answered long ago — a *newer* `stop` sits more than 3s
after it — resolves to `stop`, so a completed turn is never mis-played as "waiting
for your input" just because a real prompt fired earlier in the same turn.

Within the co-fire window, an ask with **no recognizable type** still folds into
`stop`: a legacy hook that predates the type field, or an ask a matcher-*less*
`Notification` wiring co-fired from a completion (its recorded type is a
completion type, not one of the three). So the completion-never-hijacked
protection a matcher-less user relies on is unchanged.

To enable it, install the scripts (above) and register the hooks in
`~/.claude/settings.json`:

```json
"hooks": {
  "Stop": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/tmux-opener-bell.sh stop" } ] }
  ],
  "Notification": [
    {
      "matcher": "permission_prompt|agent_needs_input|elicitation_dialog",
      "hooks": [ { "type": "command", "command": "~/.claude/hooks/tmux-opener-bell.sh ask" } ]
    }
  ]
}
```

**This is setup B, so set `preferredNotifChannel` to a non-bell channel** (see
the table above): from here on `tmux-opener-bell.sh` is what rings the BEL, and
leaving Claude Code's own `terminal_bell` on adds a second, reason-less bell that
can win the race for the shared cooldown and rob the ask of its sound.

**The `matcher` is not optional.** `Notification` fires for *every* notification
type Claude Code has — the completions and the idle reminder included — so a hook
registered without one rings the "waiting for input" bell for events that are not
waiting on you at all. The three types matched above are the ones that are: a
permission prompt, an agent asking for input, an elicitation dialog.

**Don't add the completion or idle types to it either** (`agent_completed`,
`elicitation_complete`, `idle_prompt`). The completion bell already has exactly
one owner — the `Stop` hook, or `subagent-idle-gate.sh main-stop` once you add
the gate below — and a second source for it is how the premature bell the gate
exists to prevent comes back.

Pick the "waiting for input" sound with `tmuxOpener.notifySoundPresetOnAsk`
(defaults to `siren`, so it stands out from the completion preset). It uses the
same five presets as `notifySoundPreset`. The reason files resolve their path
from `XDG_CACHE_HOME` exactly like the statusline bridge above, so the same
"both sides must agree" caveat applies.

### Subagent-aware idle (fire the bell only on *true* idle)

By default the `Stop` hook rings the bell the moment the **main turn** stops —
but if that turn spawned subagents (a `Task` fan-out), the session isn't really
idle yet: the subagents are still working. Optionally, a small gate can hold the
notification back until the main turn has stopped **and every subagent has
finished**, so the bell means "actually done", not "the coordinator paused".

The reference `subagent-idle-gate.sh` tracks the running subagents as marker
files under
`${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener/subagents-<session>/` (one file per
subagent, keyed by Claude Code's `session_id`) and only fires when that set is
empty:

- `PreToolUse` (matcher `Agent`) → adds a *provisional* marker the moment an
  Agent-tool call is about to launch a subagent (see the ordering note below).
- `SubagentStart` → adds the subagent's real marker (and retires one provisional
  one, so the same subagent isn't counted twice).
- `SubagentStop` → removes the subagent's marker (from both the live set and the
  quarantine set). It deliberately does **not** fire idle: a background
  subagent's completion always wakes the main loop for a fresh follow-up turn, so
  firing here would ring one turn too early.
- `Stop` (main turn) → first sweeps (see below), then fires idle **only** if no
  live markers remain; otherwise a subagent is still in flight and its completion
  will wake another main turn whose `Stop` fires once the set is finally empty.
- `UserPromptSubmit` → also sweeps at the start of each new turn.

The sweep no longer decides staleness by a marker's age. A running subagent is
observed as **alive** whenever Claude Code is still appending to its transcript
(`${transcript_path%.jsonl}/subagents/agent-<agent_id>.jsonl`), so a subagent
that has run for hours keeps its marker as long as it is still writing. A marker
whose transcript has gone silent past the threshold is **quarantined** (moved to
a sibling dir), not deleted — if that subagent writes again it is restored to the
live set on the next hook event, so a mis-judged sweep costs one stray bell that
self-heals rather than ringing every turn. Sweeping runs on **both** `Stop` and
`UserPromptSubmit`, so a leaked marker (a lost `SubagentStop`) is reclaimed even
while you wait silently for the bell. When the transcript can't be observed (an
older Claude Code, or `jq` absent) the sweep falls back to an age gate.

**Ordering note (why `PreToolUse`).** The Agent tool launches subagents
*asynchronously*, so `SubagentStart` does not fire before the `Stop` of the turn
that launched it — in a real run `Stop` fired (and idle notified) ~25s before
the matching `SubagentStart` even created its marker. `PreToolUse` on the Agent
tool call fires in the launching turn itself, before that turn's own `Stop`, so
marking the subagent as pending there closes the race: `main-stop` no longer
sees an empty set for a subagent that is about to exist but hasn't announced
itself yet. If you skip the `PreToolUse` hook the gate still works for
already-running subagents, but this specific launch-then-immediately-stop race
can slip a premature bell through.

When it fires, the gate delegates the actual bell to `tmux-opener-bell.sh stop`
in its own directory (it does not re-resolve the session or re-ring the bell
itself), and de-dupes with a 3s cooldown (mirroring the completion-vs-ask window)
so concurrent `main-stop` events never double-notify. This is why both scripts
must sit in `~/.claude/hooks/`: the gate resolves the bell relative to itself,
with no configured path. The reference `statusline.sh` reads the same marker set:
while any subagent is still running it keeps showing `working` rather than `idle`,
so it never reads as done while the gate is still holding the bell back. It shows
no count — Claude Code already reports the subagents it launched.

**Backwards compatible / opt-in.** This is a separate script; if you don't
register these hooks, nothing changes — the plain `Stop → tmux-opener-bell.sh
stop` wiring above still treats the main-turn stop as idle exactly as before.

To enable it, install the scripts (above), then point the `Stop` hook at the gate
instead of the bell directly and add the `PreToolUse` / `SubagentStart` /
`SubagentStop` / `UserPromptSubmit` hooks, in `~/.claude/settings.json`:

```json
"hooks": {
  "Stop": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/subagent-idle-gate.sh main-stop" } ] }
  ],
  "PreToolUse": [
    {
      "matcher": "Agent",
      "hooks": [ { "type": "command", "command": "~/.claude/hooks/subagent-idle-gate.sh pending" } ]
    }
  ],
  "SubagentStart": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/subagent-idle-gate.sh start" } ] }
  ],
  "SubagentStop": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/subagent-idle-gate.sh stop" } ] }
  ],
  "UserPromptSubmit": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/subagent-idle-gate.sh reset" } ] }
  ],
  "Notification": [
    {
      "matcher": "permission_prompt|agent_needs_input|elicitation_dialog",
      "hooks": [ { "type": "command", "command": "~/.claude/hooks/tmux-opener-bell.sh ask" } ]
    }
  ]
}
```

The `PreToolUse` hook is scoped with `"matcher": "Agent"` so it marks a subagent
as pending only for Agent-tool calls, not every tool use; it is what closes the
async launch-then-stop race described above. Keep the `Notification` hook pointed
at `tmux-opener-bell.sh ask`, with the same matcher as in setup B — the gate only
governs completion (idle), not the "waiting for input" reason, and the matcher is
what keeps that hook from firing on the completion and idle types the gate owns.

**Route every BEL through the gate — don't let a second source bypass it.**
This is setup C, and it has two sources to shut off, not one:

- The `Stop` hook must call `subagent-idle-gate.sh main-stop`, **not**
  `tmux-opener-bell.sh stop`. The two are mutually exclusive: keeping the direct
  wiring from setup B alongside the gate would ring on every main-turn stop and
  defeat the whole point. The gate calls `tmux-opener-bell.sh stop` itself, once
  it decides the session is *truly* idle.
- Claude Code's own `preferredNotifChannel` must not be `"terminal_bell"`, or
  Claude Code rings its built-in bell directly — bypassing the gate entirely and
  notifying at the wrong moment. Set it to `"notifications_disabled"` (or another
  non-bell channel) so the gate is the single source of the completion BEL.

## Settings

| Setting | Description |
| --- | --- |
| `tmuxOpener.terminal.fontFamily` | Terminal font. Follows `editor.fontFamily` when empty. |
| `tmuxOpener.terminal.fontSize` | Terminal font size. Follows `editor.fontSize` when unset. |
| `tmuxOpener.profiles` | Commands offered by the `⌄` dropdown. |
| `tmuxOpener.notifyOnBell` | Notify when a session rings the terminal bell. On by default. |
| `tmuxOpener.notifySound` | Play a sound with the bell notification. On by default. |
| `tmuxOpener.notifyToast` | Show the pop-up notification (toast). On by default; turn off to keep only the sound. Set `notifyOnBell` to false to silence both. |
| `tmuxOpener.notifySoundPreset` | Which sound to play: `classic`, `siren`, `sos`, `cascade` or `trill`. |
| `tmuxOpener.notifySoundPresetOnAsk` | Sound to play when the bell is an "ask" (waiting for input) rather than a completed turn. Defaults to `siren`; needs the reference `tmux-opener-bell.sh` hook. |
| `tmuxOpener.notifyBridgeStatusline` | Append context % and cost from the statusline bridge to the notification. On by default; needs the reference `statusline.sh`. |

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

# Tmux Opener

*[日本語](README.ja.md)*

A tmux terminal that lives in VS Code's Secondary Side Bar. It opens (or
re-attaches to) a session named after your workspace folder, and keeps as many
extra sessions as you like.

It is not a wrapper around VS Code's Integrated Terminal — the view is its own
terminal. That's why a tmux session and its window layout survive being
detached, reattached, or reopened after a window reload.

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

The view watches every session for the terminal bell (BEL, `\a`). When one
rings, it raises a native VS Code notification naming that session — so you
can leave an AI CLI running in the background and find out the moment it needs
you or finishes. Click **Open** on the notification to jump to that session.

- On by default. Turn it off with `tmuxOpener.notifyOnBell: false`.
- A sound plays alongside the notification, so you'll notice it even when
  you're away from the screen. It's synthesized in the webview, which always
  runs on your local machine — so you hear it at your keyboard even if the
  session itself lives on a remote host over Remote-SSH.
- Turn the sound off with `tmuxOpener.notifySound: false`. Pick from five
  presets with `tmuxOpener.notifySoundPreset`: `classic` (Classic Ring,
  default), `siren` (Siren Sweep), `sos` (SOS Pulse), `cascade` (Falling
  Cascade), `trill` (Rapid Trill). Change the setting and trigger a bell to
  preview one.

Browsers only allow audio after the window has been interacted with at least
once. A bell that rings in a freshly reloaded window you haven't touched yet
stays silent — but the notification then carries a **Play Sound** button.
Click it once to hear the bell you missed; every bell after that plays on its
own.

For any of this to fire, the tool running in the session has to ring the bell
when it wants your attention. Most AI CLIs can — though not always by default.

### Choosing the BEL source (pick one — they don't add up)

Claude Code can ring the bell three ways, and they are **alternatives, not
additions**. The reference hook scripts below don't add a bell on top of
Claude Code's own — they **replace** it. Exactly one thing should ring the
BEL, and your pick decides what `preferredNotifChannel` must be in
`~/.claude/settings.json`:

| Setup | What rings the BEL | `preferredNotifChannel` |
| --- | --- | --- |
| **A. No scripts** (the default) | Claude Code itself | `"terminal_bell"` — **required**; nothing else would ring |
| **B. Bell-reason sound** (a distinct sound for "waiting for input") | `tmux-opener-bell.sh`, from the `Stop` and `Notification` hooks | a **non-bell** channel, e.g. `"notifications_disabled"` |
| **C. Subagent-aware idle gate** (ring only on *true* idle) | `tmux-opener-subagent-idle-gate.sh` → `tmux-opener-bell.sh` | a **non-bell** channel, e.g. `"notifications_disabled"` |

C builds on B: it keeps B's `Notification` → ask wiring and routes only the
*completion* bell through the gate, so B and C stack. **A does not stack with
either one** — leaving `terminal_bell` on while a hook script also rings the
bell is the mistake this table exists to prevent.

**Setup A — no scripts.** Claude Code rings the bell itself, but only if you
ask it to: add `"preferredNotifChannel": "terminal_bell"` to
`~/.claude/settings.json`, or run `/config preferredNotifChannel=terminal_bell`
inside a session (there's no `claude config` CLI subcommand). That's the whole
setup — everything below is optional.

**Setups B and C — turn `terminal_bell` back off.** Once a hook script rings
the BEL, Claude Code's built-in bell becomes a second source firing for the
same event, and the two race:

- The extension folds a pair of BELs into one notification (a 5s per-session
  cooldown), so you never get two toasts or two sounds. But that also means
  **only the first BEL of the pair is ever judged** — VS Code can't amend a
  notification it already showed.
- The hook writes a reason file (`stop` / `ask`) *before* it rings; Claude
  Code's built-in bell writes nothing. Usually that costs you nothing: if a
  reason file written in the last 30s is already on disk when the bell is
  judged, the extension waits 250ms and re-reads it (the "settle" described
  further down), so the hook's file — a few milliseconds behind the built-in
  bell — still lands in time and the right sound plays.
- **But that settle only runs when there was already something to notice.**
  A long tool call before a permission prompt looks, at first, like nothing
  written for 30s. If no reason file is fresh at that moment, the built-in
  bell gets judged immediately with no reason attached — the plain completion
  sound and a neutral toast. The hook's own BEL then arrives with its `ask`
  file on disk, but it's inside the cooldown and gets dropped, so nothing
  corrects the verdict. The result: the "waiting for input" sound setup B
  exists for goes missing on exactly the prompts you'd stepped away from.
- With the gate (setup C), the built-in bell does worse than risk the wrong
  sound — it bypasses the gate entirely and notifies while subagents are
  still working, which is exactly what the gate exists to prevent. No race is
  needed for that; the built-in bell simply never consults the gate.

Set `preferredNotifChannel` to `"notifications_disabled"` (or another non-bell
channel) so the scripts are the only source of the BEL. Nothing is lost by
turning it off — the hooks ring for both reasons: a finished turn, and a
prompt waiting on you.

Other CLIs have their own switch (the scripts here are Claude Code-specific):

- **Gemini CLI** — enable `enableTerminalBell` (Settings → Accessibility; off
  by default)
- **Codex CLI** — on Linux it may already ring the bell on completion
  (environment-dependent)
- **aider** — `aider --notifications-command 'printf "\a"'` routes its
  notification to the bell

BEL isn't an AI-only signal — a shell's completion bell, vim's error beep,
`tput bel`, and others all ring it too, and the extension notifies on every
one. If that gets noisy, turn off your shell's completion bell (readline
shells: `set bell-style none` in `~/.inputrc`), or check tmux's own
`bell-action` (`man tmux`) to control which bells tmux reacts to.

### Installing the reference scripts

Three optional features — the **statusline bridge**, the **bell-reason
sound**, and the **subagent-aware idle gate** — are driven by small scripts
that live in [`claude/`](claude/) and install into `~/.claude`, mirroring
that directory one-for-one:

```
claude/tmux-opener-statusline.sh                ->  ~/.claude/tmux-opener-statusline.sh
claude/hooks/tmux-opener-session-state.sh       ->  ~/.claude/hooks/tmux-opener-session-state.sh
claude/hooks/tmux-opener-subagent-idle-gate.sh  ->  ~/.claude/hooks/tmux-opener-subagent-idle-gate.sh
claude/hooks/tmux-opener-bell.sh                ->  ~/.claude/hooks/tmux-opener-bell.sh
```

**Prefer to hand this to an AI coding agent?** Paste this prompt (it covers
installing the extension itself too, in case that part isn't done yet):

> Install the "Tmux Opener" VS Code extension (`shirokuma-library.tmux-opener`)
> if it isn't installed yet. Then set up its companion Claude Code scripts:
> fetch
> `https://raw.githubusercontent.com/ShirokumaLibrary/tmux-opener/main/scripts/install-claude.sh`
> and run it with
> `--src https://raw.githubusercontent.com/ShirokumaLibrary/tmux-opener/main/claude`
> (or clone `https://github.com/ShirokumaLibrary/tmux-opener` and run
> `npm run claude:install` from inside it). Show me the `settings.json` snippet
> it prints — don't edit `settings.json` yourself — and ask me which of the
> three optional features (statusline bridge, bell-reason sound,
> subagent-aware idle gate) I want wired up before touching anything else.

They all need `jq` on your `PATH`. They're all optional, but not all
*additive*:

- The **statusline bridge** is a true extra — it rings no bell, it just adds
  context% and cost to the notification — so it stacks with any setup above.
- The two **bell hooks** (`tmux-opener-bell.sh`, `tmux-opener-subagent-idle-gate.sh`) take
  over as the source of the BEL. That's why setups B and C require Claude
  Code's own `terminal_bell` to be switched off.

Install nothing and you're in setup A: the bell still rings and the
notification still appears, because `terminal_bell` is what rings it.

Keep the layout as shown — in particular, keep the two hooks in the same
directory. The idle gate resolves the bell script relative to itself.

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

If a destination is a **symlink** — say, because you keep these scripts in a
dotfiles repo — the installer stops instead of writing through it: copying
onto a link would overwrite its target somewhere outside `~/.claude`, and a
backup of a link would restore nothing. `--force` proceeds anyway — it saves
the linked file's *contents* first, then replaces the link with a regular
file.

**Without a clone.** If you installed the extension from the Marketplace, the
scripts aren't in the VSIX. The same installer can fetch them straight from
the repository:

```bash
curl -fsSL https://raw.githubusercontent.com/ShirokumaLibrary/tmux-opener/main/scripts/install-claude.sh -o install-claude.sh
bash install-claude.sh --src https://raw.githubusercontent.com/ShirokumaLibrary/tmux-opener/main/claude
```

This installs the scripts exactly as the clone path above does: the same
backup, the same refusals for a symlinked or legacy layout, the same
executable bit, and the same `settings.json` snippet printed for you to paste
(never written). Add `--dry-run` to see the plan without writing anything.

Prefer the [`gh` CLI](https://cli.github.com/) — for a private mirror, or when
`raw.githubusercontent.com` is blocked — fetch through it instead:

```bash
gh api repos/ShirokumaLibrary/tmux-opener/contents/scripts/install-claude.sh -H "Accept: application/vnd.github.raw" > install-claude.sh
bash install-claude.sh --src gh:ShirokumaLibrary/tmux-opener/claude
```

Each feature below shows the `~/.claude/settings.json` wiring it needs — and, for
the two that ring the bell, restates which `preferredNotifChannel` that implies.
Enable only the ones you want.

### Statusline bridge (context % and cost in the notification)

Optionally, the notification can say **how much context the session has used
and what it has cost so far** — e.g. `Session "myproject" needs attention.
(context 82%, cost $0.45)`.

The extension can't see Claude Code's internal JSON, but your statusline
script can, since Claude Code sends it that JSON on stdin. A reference
`tmux-opener-statusline.sh` writes a small excerpt to
`${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener/status-<session>.json`, and the
extension reads it — if it's fresh (within 30s) — when a bell fires. It's
entirely opt-in: with no script installed, nothing changes.

**Both sides must agree on `XDG_CACHE_HOME`.** The script resolves that path
from your interactive shell; the extension resolves it from the environment
VS Code was launched in. If you set `XDG_CACHE_HOME` only in a shell rc file
(`~/.bashrc`, `~/.zshrc`), the script writes under `$XDG_CACHE_HOME` while the
extension still reads `$HOME/.cache` — it silently finds nothing, and the
notification just drops the detail (no wrong data is ever shown). Either
leave `XDG_CACHE_HOME` unset on both sides (the common case — they already
agree), or make sure VS Code starts with the same value.

To enable it, install the scripts (above) and register the statusline in
`~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "~/.claude/tmux-opener-statusline.sh" }
```

**Working / idle indicator.** The statusline also renders a spinner
(`⠋ working`) that turns while Claude is generating, and `✅ idle` once it's
done.

- Whether the indicator appears is hook state, not the clock — only the frame
  it turns on comes from the clock. So the turning proves one narrow thing:
  *this statusline is still being redrawn*. That's enough to tell a live line
  from a frozen one (a detached pane, a stuck terminal) — but **not** from a
  wedged hook, which leaves `running` on disk while the statusline keeps
  spinning right through it.
- That state can't be derived from the statusline's own stdin, so it comes
  from a second script, [`claude/hooks/tmux-opener-session-state.sh`](claude/hooks/tmux-opener-session-state.sh),
  driven by two hooks. It's optional — without it the indicator stays a
  neutral `○`, and everything else on the statusline still works.
- The indicator keeps spinning while a subagent is still running, even after
  the main turn stops, by reading the same marker set as the idle gate
  further down — so the indicator and the bell can never disagree about
  whether the session is truly idle.

To enable it, register the hooks — and `refreshInterval` — in
`~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "~/.claude/tmux-opener-statusline.sh",
  "refreshInterval": 1
},
"hooks": {
  "UserPromptSubmit": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/tmux-opener-session-state.sh running" } ] }
  ],
  "Stop": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/tmux-opener-session-state.sh stopped" } ] }
  ]
}
```

`refreshInterval` is what makes the indicator flip promptly. `UserPromptSubmit`
isn't itself one of the statusline's refresh triggers (those are: after each
assistant message, after `/compact`, on a permission-mode change, on a
vim-mode toggle) — so without the timer, the `running` state the hook just
wrote wouldn't be picked up until whatever trigger fired next, usually long
after it mattered.

**Git branch state.** Beside the indicator, the statusline shows the git
branch and its state: `🌿 main ↑2 ✚ …` means "two commits ahead of upstream,
with uncommitted changes to tracked files, and some untracked files lying
around" (`↓` is behind; both arrows appear once the branch has diverged). It
comes from one `git status --porcelain=v2 --branch` per render, run with
`--no-optional-locks` so it never takes `index.lock` out from under a git
command of your own.

`✚` and `…` are deliberately two separate markers. Tracked changes are work
you have to commit; untracked files usually aren't. A repo that keeps some
directory untracked on purpose would otherwise leave a combined marker lit
permanently — which is the same as having no marker at all.

Turn the appended detail off (while keeping the notification itself) with
`tmuxOpener.notifyBridgeStatusline: false`. The stdin field names
(`.context_window.used_percentage`, `.cost.total_cost_usd`) target Claude
Code's statusline schema; `// empty` / `// 0` fallbacks keep the script
working if a field is absent, and the extension falls back to the plain
notification whenever the file is missing, stale, or unreadable.

### Bell-reason sound (a distinct sound for "waiting for input")

Optionally, the notification can play a **different sound depending on why
the bell rang**: one preset when a turn *finishes*, another when the CLI is
*waiting for your input* (a permission prompt, for example). Told apart by
ear, you know at a glance whether you can keep working or need to switch
over. Like the statusline bridge, this is entirely opt-in — with no hook
script installed, every bell uses the plain `tmuxOpener.notifySoundPreset`
and nothing changes.

The extension can't see *why* Claude Code rang the bell, but Claude Code's
hooks can: its `Stop` hook fires on completion, its `Notification` hook fires
on events that want something from you. A reference `tmux-opener-bell.sh` —
called with a `stop` or `ask` argument from each hook — writes a reason file
(`${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener/bell-<session>.<reason>.json`)
and then rings the bell. The two reasons write **separate files**, so a
`stop` and an `ask` landing close together never overwrite each other — the
reader resolves the pair instead, by notification type or by mtime (below).

**How the extension picks a sound**, when the bell arrives and it reads both
reason files:

1. **Neither file fresh** (within 30s) → the plain `notifySoundPreset` — the
   no-hooks default, with no added latency.
2. **Exactly one fresh** → that reason's sound.
3. **Both fresh, within 3s of each other** (a co-fire) → the ask sound *if*
   the ask file names a "waiting on you" notification type
   (`permission_prompt`, `agent_needs_input`, `elicitation_dialog`),
   otherwise **`stop` wins**. The `matcher` wiring (below) only ever lets
   those three types reach the ask hook, so an ask carrying one is a genuine
   approval wait even this close to a completion. An ask with no recorded
   type — a legacy hook that predates the field — folds into the completion
   as before.
4. **Both fresh, more than 3s apart** → the more recent one wins: a
   genuinely separate ask, or, with a newer `stop`, a completion that
   resolved an earlier prompt. The notification type only tips rule 3's 3s
   window — it never overrides a newer `stop` here.

When at least one reason file is fresh, the extension waits 250ms for the
co-firing sibling to land before choosing. A bell with no fresh reason file
skips that wait entirely.

**Why the 3s window exists.** `Notification` also fires when a turn
*completes*, so one finished turn can write both files milliseconds apart —
that pair has to resolve to `stop`, not let the ask sound hijack a
completion. To tell a genuine ask apart from that co-fire, the ask hook
records *which* notification type rang it (read from the `Notification`
stdin) into the reason file. The reader trusts that type only inside the 3s
window: a fresh ask naming one of the three "waiting on you" types plays as
an ask even when its mtime sits right on a completion's. So a permission
prompt arriving right after a turn finishes now rings the ask sound with the
"waiting for your input" toast — where it used to resolve to `stop` and
claim the turn had finished.

Two guardrails keep that from overreaching:

- The type only tips the 3s window — it never overrides the newer-mtime
  rule. An ask whose prompt was answered long ago (a newer `stop` sits more
  than 3s after it) still resolves to `stop`, so a completed turn is never
  mis-played as "waiting for your input" just because a real prompt fired
  earlier in the same turn.
- Within the co-fire window, an ask with **no recognizable type** still
  folds into `stop` — whether it's a legacy hook that predates the type
  field, or an ask a matcher-*less* `Notification` wiring co-fired from a
  completion (its recorded type is a completion type, not one of the
  three). So the completion-never-hijacked protection a matcher-less user
  relies on is unchanged.

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
one owner — the `Stop` hook, or `tmux-opener-subagent-idle-gate.sh main-stop` once you add
the gate below — and a second source for it is how the premature bell the gate
exists to prevent comes back.

Pick the "waiting for input" sound with `tmuxOpener.notifySoundPresetOnAsk`
(defaults to `siren`, so it stands out from the completion preset). It uses the
same five presets as `notifySoundPreset`. The reason files resolve their path
from `XDG_CACHE_HOME` exactly like the statusline bridge above, so the same
"both sides must agree" caveat applies.

### Subagent-aware idle (fire the bell only on *true* idle)

By default, the `Stop` hook rings the bell the moment the **main turn**
stops. But if that turn spawned subagents (a `Task` fan-out), the session
isn't really idle yet — the subagents are still working. Optionally, a small
gate can hold the notification back until the main turn has stopped **and**
every subagent has finished, so the bell means "actually done," not "the
coordinator paused."

The reference `tmux-opener-subagent-idle-gate.sh` tracks running subagents as marker
files under `${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener/subagents-<session>/`
(one file per subagent, keyed by Claude Code's `session_id`), and fires only
once that set is empty:

- `PreToolUse` (matcher `Agent`) — adds a *provisional* marker the moment an
  Agent-tool call is about to launch a subagent (see the ordering note
  below).
- `SubagentStart` — adds the subagent's real marker, retiring one
  provisional marker so the same subagent isn't counted twice.
- `SubagentStop` — removes the subagent's marker, from both the live set
  and the quarantine set. It deliberately does **not** fire idle: a
  background subagent's completion always wakes the main loop for a fresh
  follow-up turn, so firing here would ring one turn too early.
- `Stop` (main turn) — sweeps first (below), then fires idle **only** if
  no live markers remain. Otherwise a subagent is still in flight, and its
  completion will wake another main turn whose `Stop` fires once the set is
  finally empty.
- `UserPromptSubmit` — also sweeps, at the start of each new turn.

**The sweep.** A running subagent counts as alive whenever Claude Code is
still appending to its transcript
(`${transcript_path%.jsonl}/subagents/agent-<agent_id>.jsonl`) — not by a
marker's age. So a subagent that's run for hours keeps its marker as long as
it's still writing.

- A marker whose transcript has gone silent past the threshold is
  **quarantined** (moved to a sibling directory), not deleted. If that
  subagent writes again, it's restored to the live set on the next hook
  event — so a mis-judged sweep costs one stray bell that self-heals, rather
  than ringing on every turn.
- Sweeping runs on **both** `Stop` and `UserPromptSubmit`, so a leaked
  marker (a lost `SubagentStop`) is reclaimed even while you're waiting
  silently for the bell.
- When the transcript can't be observed (an older Claude Code, or `jq`
  absent), the sweep falls back to an age gate.

**Ordering note — why `PreToolUse`.** The Agent tool launches subagents
*asynchronously*, so `SubagentStart` doesn't fire before the `Stop` of the
turn that launched it. In a real run, `Stop` fired — and idle notified —
about 25s before the matching `SubagentStart` even created its marker.
`PreToolUse` on the Agent tool call fires in the launching turn itself,
before that turn's own `Stop`, so marking the subagent as pending there
closes the race: `main-stop` no longer sees an empty set for a subagent
that's about to exist but hasn't announced itself yet. Skip the
`PreToolUse` hook and the gate still works for already-running subagents,
but this specific launch-then-immediately-stop race can slip a premature
bell through.

When the gate fires, it delegates the actual bell to `tmux-opener-bell.sh
stop` in its own directory (it doesn't re-resolve the session or re-ring
the bell itself), and de-dupes with a 3s cooldown — mirroring the
completion-vs-ask window — so concurrent `main-stop` events never
double-notify. This is why both scripts must sit in `~/.claude/hooks/`: the
gate resolves the bell relative to itself, with no configured path.

The reference `tmux-opener-statusline.sh` reads the same marker set: while any subagent
is still running, it keeps showing `working` rather than `idle`, so it
never reads as done while the gate is still holding the bell back. It shows
no count — Claude Code already reports the subagents it launched.

**Backwards compatible, opt-in.** This is a separate script. If you don't
register these hooks, nothing changes — the plain `Stop → tmux-opener-bell.sh
stop` wiring above still treats the main-turn stop as idle, exactly as
before.

To enable it, install the scripts (above), then point the `Stop` hook at the gate
instead of the bell directly and add the `PreToolUse` / `SubagentStart` /
`SubagentStop` / `UserPromptSubmit` hooks, in `~/.claude/settings.json`:

```json
"hooks": {
  "Stop": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/tmux-opener-subagent-idle-gate.sh main-stop" } ] }
  ],
  "PreToolUse": [
    {
      "matcher": "Agent",
      "hooks": [ { "type": "command", "command": "~/.claude/hooks/tmux-opener-subagent-idle-gate.sh pending" } ]
    }
  ],
  "SubagentStart": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/tmux-opener-subagent-idle-gate.sh start" } ] }
  ],
  "SubagentStop": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/tmux-opener-subagent-idle-gate.sh stop" } ] }
  ],
  "UserPromptSubmit": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/tmux-opener-subagent-idle-gate.sh reset" } ] }
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

- The `Stop` hook must call `tmux-opener-subagent-idle-gate.sh main-stop`, **not**
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
| `tmuxOpener.notifyBridgeStatusline` | Append context % and cost from the statusline bridge to the notification. On by default; needs the reference `tmux-opener-statusline.sh`. |

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

#!/usr/bin/env bash
# tmux-opener reference statusline for Claude Code CLI.
#
# Install:
#   From a clone of the repository:  npm run claude:install
#   It installs this file as ~/.claude/statusline.sh and the hook scripts as
#   ~/.claude/hooks/*.sh, with the executable bit set. Don't edit the installed
#   copies — they are generated from claude/ in the repository; edit there and
#   install again.
#
#   Then register it in ~/.claude/settings.json:
#        "statusLine": { "type": "command", "command": "~/.claude/statusline.sh",
#                        "refreshInterval": 1 }
#
#   The working/idle indicator (below) additionally needs hooks/session-state.sh
#   wired to two hooks — without them the indicator just shows a neutral ○ and
#   everything else still works:
#        "hooks": {
#          "UserPromptSubmit": [{ "hooks": [{ "type": "command",
#            "command": "~/.claude/hooks/session-state.sh running" }] }],
#          "Stop": [{ "hooks": [{ "type": "command",
#            "command": "~/.claude/hooks/session-state.sh stopped" }] }]
#        }
#
# Effect:
#   - Renders a statusline with an emoji marker per segment so each one reads at
#     a glance. Line 1: ⠋/✅ working-or-idle (a spinner while working), 🤖 model
#     (+ 🎚️ reasoning effort), 📁 dir, 🌿 git branch with its state (↑ahead
#     ↓behind; ✚ uncommitted changes to tracked files; … untracked files — two
#     markers, not one, because ✚ means "commit this" and … usually means
#     "nothing to do", and a repo that keeps files untracked on purpose would
#     otherwise light ✚ forever). Line 2: 🧠 color-coded context-usage bar
#     (+ token count), 💰 cost, ⏱️ elapsed time (45s / 12m /
#     2h 3m). The bars are ten cells of eighths — █ full, ▏▎▍▌▋▊▉ for the
#     partial cell — so ten columns carry 80 steps (1.25% each) instead of 10.
#     The empty groove is a bright-black *background* (a palette color, so it
#     follows the user's theme), which keeps the bar continuous across the
#     part-inked partial cell. Lines 3-4 appear only
#     when the fields behind them are present, so a
#     plan or a Claude Code version that doesn't report them costs no blank
#     lines: ⏳/📅 rate-limit usage; 💭 thinking, 🌳 worktree, ⌨️ vim mode,
#     🧑‍💻 agent, 🏷️ session name.
#   - When running inside a tmux session, writes a bridge JSON into the cache so
#     the tmux-opener extension can reflect it in the bell notification. The
#     bridge write is best-effort: if any step fails it is skipped, and the
#     statusline still renders normally.
# Requires: jq
#
# refreshInterval is what makes the working indicator switch promptly:
# UserPromptSubmit is not itself a statusline refresh trigger (those are: after
# each assistant message, after /compact, on permission-mode change, on vim-mode
# toggle), so without a timer the "running" state the hook just wrote would not
# be picked up until whatever trigger fires next — usually too late to be useful.
#
# Note: the stdin JSON field names below (.context_window.used_percentage,
# .cost.total_cost_usd, ...) target the Claude Code statusline schema. Absent
# fields come back as the empty string and the segment behind them is simply not
# rendered — never a made-up value. A missing context_window_size once
# defaulted to 200000, which on a 1M-context model printed a confident
# `(450k/200k)`: a wrong denominator is worse than no denominator, because the
# reader cannot tell it apart from a real one. Show nothing rather than a guess.
set -euo pipefail

# A real ESC byte, so the colors below can be printed with printf '%s' (never
# '%b'). '%b' interprets backslash escapes *in its argument*, and this script's
# output concatenates externally-controlled values — a git branch name, a
# checkout directory name, JSON fields — into that argument. Backslashes are
# legal in both, so a branch literally named `main\033[2J` would be converted
# into a real escape sequence and hand control of the terminal to whoever named
# it, once a second (refreshInterval: 1). Keeping the escapes as bytes lets the
# sink be '%s', which interprets nothing.
esc=$(printf '\033')
nl=$'\n'

# Belt and braces for the same sink: '%s' passes a *raw* control byte through
# untouched, and unlike a git ref (which forbids control characters) a directory
# name or a JSON string may legally contain one. Every value that comes from
# outside this script is stripped of C0 controls and DEL before it is displayed.
# Deleting only 0x00-0x1f/0x7f is byte-safe for UTF-8 — continuation bytes are
# all >= 0x80 — so CJK and emoji names survive intact.
sanitize_display() { printf '%s' "$1" | tr -d '\000-\037\177'; }

# to_int <varname> <value> — <value>'s integer part, guarded to a non-negative
# integer, assigned to <varname>.
#
# EVERY value this script feeds to bash arithmetic goes through here, whatever it
# came from: the git porcelain (ahead/behind) and the stdin JSON (context
# percentage, token counts, elapsed duration, rate-limit percentages) alike.
# Arithmetic — and `[ -ge ]` — accept only integers and abort the whole script
# under `set -e` on anything else, so a value that is merely *expected* to be a
# number is not a value this script trusts. The git counts already followed that
# rule and the JSON ones did not, which is a norm applied to half the inputs and
# therefore not a norm at all (#96, the LOW left over from PR #94's review). One
# function, so there is one guard to read and one to change.
#
# Truncation comes first and is separate from the guard: the schema really does
# report percentages and durations as floats (82.5, 1000.0), and those are values
# to truncate, not to reject.
#
# `printf -v`, never `$(...)`: a command substitution is a fork, and this function
# was added to a script whose entire point this round was to stop forking.
to_int() {
  local v=${2%%.*}
  case "$v" in ''|*[!0-9]*) v=0 ;; esac
  printf -v "$1" '%s' "$v"
}

input=$(cat)

# --- stdin: every value read from the JSON, from ONE jq call ---
# This was sixteen `printf '%s' "$input" | jq -r ...` pipelines — sixteen jq
# processes parsing the same document sixteen times, once a second
# (refreshInterval: 1). Measured on one dev machine: 22ms of a 62ms render was
# those forks, and the same sixteen values through a single jq took 1.4ms. 94% of
# jq's cost here was the fork, not the JSON (#96).
#
# The values come back NUL-separated, and that is load-bearing — @tsv, the obvious
# choice, is wrong here. @tsv *escapes* its cells: a tab becomes `\t`, a newline
# `\n`, and a backslash `\\`. Every string below is externally controlled, and a
# checkout directory literally named `evil\033[2J` would come back with its
# backslash doubled — the script would print a value that is not the one it was
# handed. This script alters external values in exactly one way (sanitize_display
# deletes C0 controls, and nothing else); an escape introduced by the transport is
# not one of them. NUL is the one separator that needs no escaping, because a bash
# variable cannot contain it in the first place. jq emits it (`[0] | implode` —
# a literal NUL cannot be written into a shell string) and `read -d ''` takes the
# stream back apart byte for byte.
#
# `// ""` is what `// empty` already was in practice: jq -r prints nothing for
# `empty`, so the shell variable was the empty string either way, and every reader
# below tests it with `[ -n ... ]`. .thinking.enabled is the one field that cannot
# use `//` AT ALL — jq's `//` treats a reported `false` as absent, and "reported as
# off" and "not reported" must render differently (see line 4) — so it keeps the
# explicit null test it has always had.
#
# The order of the array IS the wire format: the values are unpacked positionally
# and the index beside each field is the index it is read back at. Add a field here
# and it must be added to the unpacking below.
stdin_json='
  [ .model.display_name // "Claude",                # 0  model
    .workspace.current_dir // .cwd // "",           # 1  cwd
    .cost.total_cost_usd // 0,                      # 2  cost
    .cost.total_duration_ms // 0,                   # 3  dur_ms
    .context_window.used_percentage // "",          # 4  ctx
    .context_window.total_input_tokens // "",       # 5  ctx_tokens
    .context_window.context_window_size // "",      # 6  ctx_size
    .session_id // "",                              # 7  sid
    .rate_limits.five_hour.used_percentage // "",   # 8  five_h
    .rate_limits.seven_day.used_percentage // "",   # 9  week
    .effort.level // "",                            # 10 effort
    (if .thinking.enabled == null then ""           # 11 thinking (see above)
     else (.thinking.enabled | tostring) end),
    .session_name // "",                            # 12 session_name
    .worktree.name // "",                           # 13 worktree
    .vim.mode // "",                                # 14 vim_mode
    .agent.name // ""                               # 15 agent_name
  ]
  | map(tostring + ([0] | implode))
  | add
'
fields=()
while IFS= read -r -d '' value; do
  # A command substitution strips trailing newlines, and these sixteen values came
  # out of sixteen of them until now. `read -d ''` strips nothing, so do it here:
  # the whole claim of this change is that the values are the same values.
  while [ "${value%$'\n'}" != "$value" ]; do value=${value%$'\n'}; done
  fields+=("$value")
done < <(printf '%s' "$input" | jq -j "$stdin_json")

# jq's exit status cannot be seen through a process substitution, and a failed parse
# leaves exactly one symptom: fewer than sixteen values. Before this change a failing
# jq took the script down with it under `set -e`, printing nothing — keep that. A
# statusline assembled out of blanks would look like a real one, which is the wrong
# answer this script refuses to give everywhere else.
if [ "${#fields[@]}" -ne 16 ]; then
  exit 1
fi

model=${fields[0]}
cwd=${fields[1]}
cost=${fields[2]}
dur_ms=${fields[3]}
ctx=${fields[4]}
ctx_tokens=${fields[5]}
ctx_size=${fields[6]}
sid=${fields[7]}
five_h=${fields[8]}
week=${fields[9]}
effort=${fields[10]}
thinking=${fields[11]}
session_name=${fields[12]}
worktree=${fields[13]}
vim_mode=${fields[14]}
agent_name=${fields[15]}

# --- git: branch name + its state, from ONE call ---
# `status --porcelain=v2 --branch` reports the branch name (# branch.head), the
# ahead/behind counts against the upstream (# branch.ab, a line that simply does
# not appear when there is no upstream — which is exactly this script's "no value,
# no segment" rule, for free) and the changed entries, all at once. So it replaces
# the old `rev-parse --abbrev-ref HEAD` rather than joining it: the number of git
# invocations per render stays 1, which matters at refreshInterval: 1.
#
# --no-optional-locks is required, not a nicety: a plain `git status` refreshes
# the index and takes index.lock to do it, and this runs every second beside a
# human's own git commands. (VS Code passes it for the same reason.)
#
# -c core.fsmonitor= disables the repo's file-system-monitor hook: unlike the
# rev-parse this replaced, `git status` *runs* core.fsmonitor as a command, so a
# repo whose .git/config sets it would have that command executed once a second
# by merely being the cwd. Whoever controls .git/config already controls plenty,
# so this is not a live attack path — and it is not the only command `git status`
# can be made to run from .git/config either (filter.<driver>.clean is another).
# It is the most direct execution edge the switch to `status` newly opened, and
# closing it costs a flag.
#
# --untracked-files=normal, and the story of that flag is worth the paragraph.
# It was first written as `=no`, justified in a comment as "the deliberate
# cost/benefit of running every second: walking the worktree for untracked files is
# by far the most expensive part of `git status`". That reasoning was never measured
# — and when it finally was, it did not hold:
#
#     repo                      =no        =normal
#     tmux-opener (70 files)    2.5ms      2.9ms
#     vscode (16,306 files)     10.3ms     10.0ms
#
# At 16k files the difference is below the run-to-run noise. So `=no` was dropping a
# real feature — a worktree holding ONLY new files reported itself clean — to buy a
# saving too small to measure. Restored to `=normal` (#92). If a repository ever does
# show a cost here, measure it before trading a feature away for it; that is the whole
# lesson, and it is the only claim these numbers support.
#
# WHY it is that cheap is not explained here, because it has not been established, and
# this comment is not going to repeat the mistake it just finished describing. What
# *was* checked is only this: the walk really does happen — git's untracked cache is
# not what makes it cheap. Neither measured repo has one (`core.untrackedCache` unset,
# no UNTR extension in .git/index; git's default `keep` uses a cache but never creates
# one), and this command could not use one anyway: `--no-optional-locks` prevents the
# index write that would persist it, so even with `core.untrackedCache=true` the UNTR
# extension never appears. Verified, not reasoned.
#
# Which settles the "optimization" that suggests itself here: drop --no-optional-locks
# and let the untracked cache work. No. That flag is the whole reason this can run once
# a second next to a human's git commands without fighting them for index.lock, and it
# is protecting a real user against a cost that does not show up in the measurements.
# Losing the cache is the price of the flag, knowingly paid.
#
# The entries are then split by kind rather than counted together, because the two
# kinds call for different actions and one of them fires constantly. This repo keeps
# an intentionally untracked `.shirokuma/notes/`, so folding untracked files into ✚
# would light it permanently — and a marker that is always on says nothing. Tracked
# changes are work to commit (✚); untracked files are usually just lying around (…).
#
# Hence the case below branches on the porcelain=v2 entry type, and the old
# `?*) dirty=1` catch-all ("every line that isn't a header is dirty") is gone: it
# could not tell a `? ` line from a `1 ` line, which is exactly the distinction.
#
# Everything here is best-effort: no git, not a repo, dubious ownership -> empty
# branch -> no segment at all, and the rest of the statusline renders unaffected.
branch=""
head_oid=""
ahead=0
behind=0
dirty=""
untracked=""
if [ -n "${cwd:-}" ] && [ -d "${cwd:-}" ]; then
  git_status=$(git --no-optional-locks -c core.fsmonitor= -C "$cwd" status --porcelain=v2 --branch --untracked-files=normal 2>/dev/null || true)
  while IFS= read -r gline; do
    case "$gline" in
      '# branch.oid '*)  head_oid=${gline#'# branch.oid '} ;;
      '# branch.head '*) branch=${gline#'# branch.head '} ;;
      '# branch.ab '*)
        ab=${gline#'# branch.ab '}
        ahead=${ab%% *}; ahead=${ahead#+}
        behind=${ab##* }; behind=${behind#-}
        ;;
      '#'*) ;;               # any other header line
      '1 '*|'2 '*) dirty=1 ;;  # changed / renamed: tracked work, uncommitted
      'u '*)       dirty=1 ;;  # unmerged: mid-conflict is dirty by any definition
      '? '*)       untracked=1 ;;
      '! '*) ;;              # ignored: =normal never emits these, but be explicit
    esac
  done <<< "$git_status"
  # The counts are fed to bash arithmetic below, which aborts the script under
  # `set -e` on anything that isn't an integer. Nothing but git writes them, but
  # the rest of this script never trusts a value it merely expects either — and
  # since #96 that "rest" includes the stdin JSON, through this same to_int.
  to_int ahead  "$ahead"
  to_int behind "$behind"
  # A detached HEAD has no branch name — porcelain=v2 says so literally, with the
  # placeholder `(detached)`. Printing that would be printing a word the reader
  # cannot act on, so fall back to the short commit id, which they can. (The old
  # `rev-parse --abbrev-ref` printed the equally useless `HEAD` here.)
  if [ "$branch" = "(detached)" ]; then
    branch=""
    case "$head_oid" in
      '('*|'') ;;                       # `(initial)`: an unborn branch has no oid
      *) branch=${head_oid:0:7} ;;
    esac
  fi
fi
dirname=$(basename "${cwd:-$PWD}")

model=$(sanitize_display "$model")
branch=$(sanitize_display "$branch")
dirname=$(sanitize_display "$dirname")
effort=$(sanitize_display "$effort")
session_name=$(sanitize_display "$session_name")
worktree=$(sanitize_display "$worktree")
vim_mode=$(sanitize_display "$vim_mode")
agent_name=$(sanitize_display "$agent_name")

# pct_color <pct_int> -> ANSI color code, by the 60/85 thresholds this script
# uses wherever it shows a percentage (green -> yellow -> red).
pct_color() {
  local pct_int="$1" color=32
  [ "$pct_int" -ge 60 ] && color=33
  [ "$pct_int" -ge 85 ] && color=31
  printf '%s' "$color"
}

# render_bar <pct_int> <width> <color> -> a bar in one fixed color.
# The caller passes the color because the bars don't all mean the same thing: the
# context bar colors the bar itself (the bar *is* the at-a-glance signal), while
# the rate-limit bars stay a flat blue and let only their percentage carry the
# green/yellow/red, so they don't visually compete with the context bar.
#
# The glyphs are block characters, not ASCII #/-: at a glance a block bar reads as
# a level, while `####------` reads as text you have to count. They are safe here on
# two counts — the bar is generated inside this script, so it never crosses the
# external-input path at all, and even the sanitizer that path uses deletes only C0
# controls (0x00-0x1f/0x7f), passing every UTF-8 byte (>=0x80) through untouched.
#
# The bar measures in EIGHTHS of a cell, not whole cells (#92 A-1). Ten cells of one
# bit each is 10 steps, and on a real machine that was visibly too coarse: 3% and 7%
# both drew ten empty cells, and every value from 40% to 49% drew the same picture —
# a bar that cannot distinguish a tenth of its own range is decoration. The partial
# block glyphs ▏▎▍▌▋▊▉ subdivide the leading cell into eight, so the same ten columns
# carry 80 steps (1.25% each).
#
# The groove is painted as a BACKGROUND COLOR, not as a ░ glyph, and that is not a
# cosmetic preference — ░ made the bar look broken. A partial cell like ▎ inks only
# its left quarter and leaves the other three quarters at the terminal's background,
# so `██████▎░░░` ran: solid block, then a gap of nothing, then a field of dots. The
# bar visibly came apart at exactly the cell that carries the precision the eighths
# were added for. Filling the track with a background color instead means the unlit
# part of the partial cell is the same color as the empty cells beside it, and the
# bar is continuous from end to end. The empty cells are therefore spaces (a space
# shows the background and nothing else). Every ░ still in this file is in a comment —
# this paragraph and the trade-off note below — describing the thing that was removed:
# none of them reaches the code, and none is ever printed. (Deliberately not "there are
# N of them": a comment that counts itself is wrong the moment anyone adds a sentence,
# and it went stale exactly that way once already. The scope claim is the true one, and
# the one worth making — `grep -v '^#' | grep ░` is what it says, and it returns zero.)
#
# The background is 100 (bright black), an SGR *palette* color — index 8 of the
# terminal's own 16 colors — and not a 256-color or 24-bit literal like 48;5;236.
# A palette color is resolved by the terminal, so it follows whatever theme the user
# is running; a hardcoded grey is a grey chosen against one theme, and this script
# is a distributable that runs on other people's. Both bars share the groove color:
# the track means the same thing on both, and only the fill differs (see above).
#
# What that costs, stated plainly rather than discovered later: the groove is carried
# entirely by SGR. Where those escapes aren't interpreted — a pipe, a log file, a
# terminal without color — the empty cells are what they literally are, spaces, and
# only the filled part survives as █. ░ would have drawn a visible track there. The
# trade is deliberate: this is a statusline, rendered into an interactive terminal,
# and a bar that comes apart in the terminals people actually watch it in is the worse
# failure. (Not verified against a specific no-color terminal — it is what SGR being
# ignored means, and nothing stronger is claimed.)
#
# The escape is written as `${color};100m` — one SGR setting foreground and
# background together — and the bar is closed with a plain `[0m`, which resets both.
# That reset is load-bearing: leak the background and the terminal keeps painting it
# across everything printed after the bar, to the end of the line.
#
# Not braille (⠁⠃⠇⠏⠟⠿), and not because it would be harder — the arithmetic is the
# same. Two reasons, both about what the glyph *means*. Braille's full cell ⠿ is a
# lattice of dots: it carries less visual weight than a solid █, so a full bar reads
# as less full, which is the one thing an at-a-glance level must not do. And the way
# a braille cell fills up (⠁ → ⠃ → ⠇ → ⠏ …) grows *downward* and then jumps to the
# next dot column, so a horizontal bar built from it advances in a direction its own
# glyphs don't move in. The block partials grow strictly left-to-right, which is the
# direction the bar itself grows: the shape and the meaning agree.
#
# The partials are an ARRAY indexed 1..7 (index 0 is the empty string and is never
# reached — a zero remainder draws no partial cell at all). Same reason the spinner
# frames are an array: `${str:i:1}` counts characters only in a UTF-8 locale and
# bytes under LC_ALL=C — and this script sets no locale — so slicing would hand back
# one byte of a 3-byte glyph. Indexing an array is the same operation in every locale.
bar_partials=('' ▏ ▎ ▍ ▌ ▋ ▊ ▉)

render_bar() {
  local pct_int="$1" width="$2" color="$3" eighths full rem out i
  # Round DOWN, and clamp to the ends. The two ends are the load-bearing part: an
  # 81st eighth would leave a "100%" bar one cell short of full, and a partial cell
  # rounded up onto an empty bar would put a mark on 0%. Neither is a value the
  # reader can act on, and both are the same class of confident-wrong-answer this
  # script refuses everywhere else.
  eighths=$(( pct_int * width * 8 / 100 ))
  [ "$eighths" -lt 0 ] && eighths=0
  [ "$eighths" -gt $(( width * 8 )) ] && eighths=$(( width * 8 ))
  full=$(( eighths / 8 ))
  rem=$(( eighths % 8 ))
  # <fg>;100m — the fill color the caller chose, over the shared bright-black groove.
  out="${esc}[${color};100m"
  for (( i = 0; i < width; i++ )); do
    if   [ "$i" -lt "$full" ];                        then out="${out}█"
    elif [ "$i" -eq "$full" ] && [ "$rem" -gt 0 ];    then out="${out}${bar_partials[$rem]}"
    else                                                   out="${out} "   # groove: the background, nothing on top of it
    fi
  done
  # [0m resets background as well as foreground. Without it the groove would run on
  # into the text after the bar and out to the end of the line.
  printf '%s' "${out}${esc}[0m"
}

# fmt_elapsed <seconds> -> 45s / 12m / 2h 3m — the unit follows the magnitude.
# A session that has run for two hours used to print `⏱️ 7384s`, a number nobody
# converts in their head, so the digits were there and the duration wasn't.
#
# The space in `2h 3m` separates the two units so the eye doesn't read `2h3m` as one
# run-on token. It appears only where there are two units to separate: `45s`, `12m`
# and a whole `1h` have nothing to space out. A whole hour stays `1h`, never `1h 0m` —
# a zero that carries no information is still a thing to read.
fmt_elapsed() {
  local s="$1" h m
  if [ "$s" -lt 60 ]; then
    printf '%ss' "$s"
  elif [ "$s" -lt 3600 ]; then
    printf '%sm' "$(( s / 60 ))"
  else
    h=$(( s / 3600 )); m=$(( s % 3600 / 60 ))
    if [ "$m" -eq 0 ]; then printf '%sh' "$h"; else printf '%sh %sm' "$h" "$m"; fi
  fi
}

# --- working/idle indicator (needs hooks/session-state.sh; see header) ---
# Driven by real hook state, not wall-clock: session-state.sh writes
# {"state":"running"|"stopped"} keyed by session id on UserPromptSubmit / Stop.
#
# *Whether* the spinner appears is that hook state; only which frame it is on is
# the clock, and each half says exactly one thing. The hook state says Claude is
# working. The turning says *this display is still being redrawn* — nothing more.
# It is worth the two lines it costs because a still image of a statusline is
# otherwise indistinguishable from a live one (a detached tmux pane, a frozen
# terminal, a statusline no longer being called all leave a convincing `working`
# on screen), and it costs nothing extra to run: refreshInterval: 1 already
# re-renders this every second (see the header), so the frame advances on renders
# that were happening anyway.
#
# What the spinner does NOT do is vouch for the hook. A hook that wedged after
# writing {"state":"running"} leaves that file on disk, this script keeps being
# called every second, and the spinner keeps turning over the stale state — the
# frozen `working` and the live one look identical. Detecting that would take a
# staleness test on the state file's mtime, which this script does not do. Don't
# read the spinner as hook health; it is a liveness signal for the *rendering*,
# and claiming more of it would be exactly the confident wrong answer this script
# refuses to give everywhere else.
#
# True idle needs one more condition. "stopped" from the main turn alone is not
# enough: while any subagent marker (written by subagent-idle-gate.sh) still
# stands for this session, Claude is working in the background, so keep showing
# "working". This is the statusline mirror of the gate's own "defer the idle bell
# while a subagent runs" rule — both read the same dir, so the indicator and the
# bell can never disagree.
#
# **The marker dir is counted exactly once, here, and $sub_running is the only
# count in this script.** It is now consumed by exactly one reader — the
# idle-suppression test immediately below. It used to have a second: a
# `🏃 N subagent(s)` badge on line 2, which re-derived its own count from a second
# `ls` of the same dir, so a subagent finishing between the two reads made the two
# views describe different moments — "working" with no badge, or a badge beside an
# idle tick (#89). #89 fixed that by counting once; #92 then removed the badge
# itself (Claude Code already reports subagents, and the statusline was repeating
# it). Neither change licenses a second `ls`: whatever new reader wants this number
# reads $sub_running, because one read cannot race a read that does not exist, and
# the invariant that matters (#75, designed in #79) is that the gate and this
# indicator resolve the same marker set — the statusline may not disagree with the
# bell about whether the session is idle, nor with itself.
#
# Order is therefore load-bearing: the count must settle before the suppression
# test below consumes it, which is why it lives here.
#
# Missing state file (hooks not wired) or unreadable -> neutral ○ rather than a
# guess. Best-effort throughout: no session id -> no state, no count, and the rest
# of the statusline renders unaffected.
#
# Both cache paths below are keyed by the *sanitized* session id, the same
# `tr -c 'A-Za-z0-9_-' '_'` mapping hooks/session-state.sh and
# hooks/subagent-idle-gate.sh apply on the writing side. Reader and writers must
# agree byte for byte or the indicator silently stops finding its state file, so
# the two sides are only ever changed together. For a real session id (a CLI-
# generated UUID) the mapping is the identity, so it also costs no compatibility.
run_state=""
sub_running=0
if [ -n "$sid" ]; then
  safe_sid=$(printf '%s' "$sid" | tr -c 'A-Za-z0-9_-' '_')
  state_file="${XDG_CACHE_HOME:-$HOME/.cache}/claude-code-state/${safe_sid}.json"
  [ -f "$state_file" ] && run_state=$(jq -r '.state // empty' "$state_file" 2>/dev/null || true)
  sub_dir="${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener/subagents-${safe_sid}"
  if [ -d "$sub_dir" ]; then
    # TOCTOU-safe under set -e + pipefail: if sub_dir is removed (e.g. a
    # concurrent idle-gate reset) between the -d guard and the ls, ls exits
    # non-zero and pipefail would fail the assignment and abort the whole
    # statusline. `|| true` swallows that failing exit status so we just count 0
    # and fall through to plain idle. `wc -l` already emits a lone `0` on empty
    # input, so the pipe's own output is used verbatim (no separate `echo 0`, which
    # used to append a second `0` and yield `0\n0`); `${sub_running:-0}` guards the
    # empty case.
    sub_running=$(ls -1A "$sub_dir" 2>/dev/null | wc -l | tr -d ' ' || true)
    sub_running="${sub_running:-0}"
  fi
fi
if [ "$run_state" = "stopped" ] && [ "${sub_running:-0}" -gt 0 ] 2>/dev/null; then
  run_state="running"   # main turn ended, subagents still run: not idle yet
fi
case "$run_state" in
  running)
    # The frames are an ARRAY, indexed — not a string sliced with ${s:i:1}. Bash's
    # substring expansion counts *characters* only in a UTF-8 locale; under LC_ALL=C
    # (or any POSIX locale, and this script sets none) it counts bytes, so a 3-byte
    # braille glyph would come out as one byte of mojibake. Indexing an array is the
    # same operation in every locale.
    #
    # $EPOCHSECONDS is a bash 5 builtin: the shell already holds the time, so
    # forking `date` just to read it would cost a process every second — ~86,400
    # per session per day — for a number that is already in memory. The fallback
    # is not decoration: macOS still ships bash 3.2 as /bin/bash, which is where
    # `/usr/bin/env bash` lands on a stock Mac, and there $EPOCHSECONDS is unset.
    # Same portability budget as the array above.
    #
    # It is validated as an integer for the same reason ahead/behind are, and it is
    # the *validation* that does the work here — not the shape of the expansion.
    # Bash arithmetic evaluates the value it is handed, and that evaluation expands
    # array subscripts: a value of `y[$(cmd)]` runs cmd. (A `1+$(cmd)` payload does
    # not — it is a syntax error — so the subscript is the vector, and a bare `now`
    # is just as exposed to it as `${EPOCHSECONDS:-...}` would be. Substituting the
    # name buys nothing; the numeric test is the whole guard.)
    #
    # On bash 5 this is unreachable anyway: EPOCHSECONDS is a dynamic variable, so
    # an exported one cannot set it. But the shell the fallback exists for is macOS's
    # bash 3.2, where it is an ordinary variable the environment CAN carry a payload
    # into — i.e. the one platform without the built-in guard is the one platform
    # that takes this branch. `set -u` does not help: a payload naming a variable
    # that really exists is fully expanded before any abort. The fork budget is
    # unchanged either way (bash 5: 0, bash 3.2: the one `date` it already paid).
    #
    # This is the one numeric guard that is NOT to_int, and deliberately so: a
    # non-integer here has a real fallback (ask `date`), where every other guarded
    # value has only 0 to fall back to. Same test, different consequence.
    spin_frames=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
    now=${EPOCHSECONDS:-}
    case "$now" in ''|*[!0-9]*) now=$(date +%s) ;; esac
    spin_idx=$(( now % 10 ))
    indicator="${esc}[33m${spin_frames[$spin_idx]} working${esc}[0m"
    ;;
  stopped) indicator="${esc}[32m✅ idle${esc}[0m" ;;
  *)       indicator="${esc}[2m○${esc}[0m" ;;
esac

# --- line 1: indicator / model (+ reasoning effort) / dir / branch ---
line1="${indicator}  🤖 ${esc}[1m${model}${esc}[0m"
if [ -n "$effort" ]; then
  case "$effort" in
    low)    ec=32 ;;
    medium) ec=36 ;;
    high)   ec=33 ;;
    xhigh)  ec=35 ;;
    max)    ec=31 ;;
    *)      ec=37 ;;
  esac
  line1="${line1} ${esc}[${ec}m🎚️${effort}${esc}[0m"
fi
line1="${line1}  📁 ${esc}[36m${dirname}${esc}[0m"

# The branch segment is assembled in its OWN variables, and $branch is never touched.
# $branch is not just displayed here: the bridge write at the end of this script
# emits it as `branch` into status-<session>.json — a file this repo documents in
# its README as an on-disk format, written where anything on the machine can read
# it. No consumer in this tree parses that key today (the extension's
# src/status-bridge.ts reads only cost_usd and context_used_percentage), and that
# is precisely the trap: grep the tree, find nothing, conclude the separation is
# obsolete, fold `↑2 ✚` into $branch — and a published format silently starts
# carrying display decoration. The value we publish is a branch name, so it stays a
# branch name. Display is assembled beside it, never into it.
#
# $abseg (not `ab`) because `ab` is the raw `+N -M` payload parsed out of the
# porcelain up in the git block, and both are plain top-level variables in the same
# shell: reusing the name would silently clobber the counts. The rendered string and
# the parsed value are different things and get different names.
if [ -n "$branch" ]; then
  branchseg="🌿 ${esc}[35m${branch}${esc}[0m"
  abseg=""
  [ "$ahead" -gt 0 ]  && abseg="${abseg}↑${ahead}"
  [ "$behind" -gt 0 ] && abseg="${abseg}↓${behind}"
  [ -n "$abseg" ] && branchseg="${branchseg} ${esc}[36m${abseg}${esc}[0m"
  # ✚ before …, and ✚ is the bright one: uncommitted work in tracked files is
  # something to act on, untracked files usually are not. Both glyphs are generated
  # here, inside the script — like the bar glyphs, they never cross the external-
  # input path, so they don't ride the sanitizer (which passes every byte >= 0x80
  # anyway). Absent state prints nothing at all: no untracked file, no ….
  [ -n "$dirty" ]     && branchseg="${branchseg} ${esc}[33m✚${esc}[0m"
  [ -n "$untracked" ] && branchseg="${branchseg} ${esc}[2m…${esc}[0m"
  line1="${line1}  ${branchseg}"
fi

# --- line 2: context bar / cost / elapsed ---
# ctx / ctx_tokens / ctx_size / dur_ms arrive from the stdin JSON and may be floats
# (e.g. 82.5); bash arithmetic and [ -ge ] accept only integers, and under `set -e`
# a float would abort the whole script before it printed. to_int truncates for the
# maths AND guards the result (see its comment) — the bar still shows the raw ${ctx},
# so the guard changes no digit the reader sees.
bar=""
if [ -n "$ctx" ]; then
  to_int ctx_int "$ctx"
  bar="$(render_bar "$ctx_int" 10 "$(pct_color "$ctx_int")") ${ctx}%"
  # Token count when the schema reports it: the percentage alone doesn't say how
  # much room is left in absolute terms, and the window size varies by model.
  # The denominator is printed only when context_window_size is reported too. It
  # is never defaulted: assuming 200000 would print (450k/200k) on a 1M-context
  # model, and a plausible-looking wrong denominator is indistinguishable from a
  # real one. Without it the token count still stands on its own.
  if [ -n "$ctx_tokens" ]; then
    to_int tok_int "$ctx_tokens"
    tok_k=$(( (tok_int + 500) / 1000 ))
    if [ -n "$ctx_size" ]; then
      to_int size_int "$ctx_size"
      size_k=$(( (size_int + 500) / 1000 ))
      bar="${bar} ${esc}[2m(${tok_k}k/${size_k}k)${esc}[0m"
    else
      bar="${bar} ${esc}[2m(${tok_k}k)${esc}[0m"
    fi
  fi
fi
to_int dur_int "$dur_ms"
elapsed=$(fmt_elapsed "$(( dur_int / 1000 ))")

ctxseg=""
[ -n "$bar" ] && ctxseg="🧠 ${bar}  "
line2="${ctxseg}💰 \$$(printf '%.2f' "$cost")  ⏱️ ${elapsed}"

# --- line 3: rate-limit usage (subscription plans only; absent otherwise) ---
line3=""
if [ -n "$five_h" ]; then
  to_int fh_int "$five_h"
  line3="⏳ ${esc}[2m5h${esc}[0m $(render_bar "$fh_int" 10 34) ${esc}[$(pct_color "$fh_int")m$(printf '%.0f' "$five_h")%${esc}[0m"
fi
if [ -n "$week" ]; then
  to_int wk_int "$week"
  [ -n "$line3" ] && line3="${line3}  "
  line3="${line3}📅 ${esc}[2m7d${esc}[0m $(render_bar "$wk_int" 10 34) ${esc}[$(pct_color "$wk_int")m$(printf '%.0f' "$week")%${esc}[0m"
fi

# --- line 4: thinking / worktree / vim / agent / name ---
# Each value is its own label (a worktree name, a vim mode), so no category words.
# thinking renders ON *or* OFF — bright when on, dim when off — but only when the
# field is actually reported. It used to read `.thinking.enabled // false`, which
# cannot tell "reported as off" from "not reported at all": every Claude Code
# version that doesn't send the field got a permanent 💭OFF, and therefore a
# permanent line 4, breaking this script's own promise (see the header) that
# lines 3-4 cost no blank lines when the fields behind them are absent. The three
# states are now distinct — the `case` below simply has no arm for "" — which is
# why $thinking is extracted with an explicit null test rather than `// empty`
# (jq's `//` would swallow a reported `false` along with the null).
extras=()
case "$thinking" in
  true)  extras+=("💭${esc}[1;36mON${esc}[0m") ;;
  false) extras+=("${esc}[2m💭OFF${esc}[0m") ;;
esac
[ -n "$worktree" ] && extras+=("🌳 ${worktree}")
[ -n "$vim_mode" ] && extras+=("⌨️ ${vim_mode}")
[ -n "$agent_name" ] && extras+=("🧑‍💻 ${agent_name}")
[ -n "$session_name" ] && extras+=("🏷️ “${session_name}”")

line4=""
for part in "${extras[@]+"${extras[@]}"}"; do
  [ -n "$line4" ] && line4="${line4}  "
  line4="${line4}${part}"
done

# Three segments are deliberately gone (#92), all for one reason, and none is
# worth reviving. `⚠ >200k` restated in a warning what the context bar right above
# it already shows as a level. The open PR for the branch is something every other
# surface the reader has open — the terminal, the editor, GitHub — already tells
# them. And the `🏃 N subagent(s)` badge on line 2 duplicated what Claude Code
# itself already prints; it had, in fact, never once run on a real machine before
# the installer (#76) put it there, and it was cut on sight. A statusline earns its
# width by saying what nothing else says; a duplicate is just less room for what
# does. What survives from the badge is the *count* — $sub_running, up at the
# indicator — because the idle suppression cannot work without it (#75/#79).

out="${line1}${esc}[K${nl}${line2}${esc}[K"
[ -n "$line3" ] && out="${out}${nl}${line3}${esc}[K"
[ -n "$line4" ] && out="${out}${nl}${line4}${esc}[K"
printf '%s' "$out"

# --- bridge write (only inside a tmux session; best-effort) ---
if [ -n "${TMUX:-}" ]; then
  session=$(tmux display-message -p '#S' 2>/dev/null || true)
  if [ -n "$session" ]; then
    safe=$(printf '%s' "$session" | tr -c 'A-Za-z0-9_-' '_')
    dir="${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener"
    tmp="$dir/.status-${safe}.$$.tmp"
    mkdir -p "$dir" || true
    if jq -n \
      --arg     s      "$session" \
      --argjson ctx    "${ctx:-null}" \
      --argjson cost   "$cost" \
      --arg     repo   "$dirname" \
      --arg     branch "$branch" \
      '{session:$s, context_used_percentage:$ctx, cost_usd:$cost, repo:$repo, branch:$branch}' \
      > "$tmp" 2>/dev/null; then
      mv -f "$tmp" "$dir/status-${safe}.json" || true
    else
      rm -f "$tmp" || true
    fi
  fi
fi

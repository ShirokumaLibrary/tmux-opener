#!/usr/bin/env bash
# Records whether Claude Code is currently generating a response, keyed by
# session_id. Driven by two hooks:
#   UserPromptSubmit -> session-state.sh running
#   Stop             -> session-state.sh stopped
# statusline.sh reads the resulting file to show a real running/stopped
# indicator (unlike a wall-clock spinner, which just shows the statusline
# subsystem is alive, not that Claude itself is actively working).
#
# NOTE: this script used to also emit a BEL to the pane tty on "stopped"
# (every turn end). That is now owned by subagent-idle-gate.sh, which defers
# the bell until true idle (main stopped AND all subagents finished) and
# delegates the emission to tmux-opener-bell.sh. Ringing here too would bypass
# that gate and notify prematurely while subagents still run, so this script
# is now state-file-only.
#
# Best-effort throughout: silently does nothing when jq is missing or the
# write fails for any reason.
set -euo pipefail

state="${1:-}"
[ -z "$state" ] && exit 0

input=$(cat)
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)
[ -z "$session_id" ] && exit 0

# The session id becomes a file name, so it is reduced to a safe character set
# first — the same `tr -c 'A-Za-z0-9_-' '_'` mapping subagent-idle-gate.sh uses
# for its marker dir and statusline.sh uses to read this file back. `.` maps to
# `_` as well, so no value can walk out of $dir with `..`. The three must agree
# byte for byte (the reader would otherwise look for a name nobody writes), so
# they are only ever changed together. For a real session id (a CLI-generated
# UUID) the mapping is the identity, so it changes no existing file name.
safe_sid=$(printf '%s' "$session_id" | tr -c 'A-Za-z0-9_-' '_')

dir="${XDG_CACHE_HOME:-$HOME/.cache}/claude-code-state"
mkdir -p "$dir" 2>/dev/null || exit 0

tmp="$dir/.${safe_sid}.$$.tmp"
if jq -n --arg state "$state" --arg t "$(date +%s)" \
  '{state:$state, updated_at:($t|tonumber)}' > "$tmp" 2>/dev/null; then
  mv -f "$tmp" "$dir/${safe_sid}.json" 2>/dev/null || rm -f "$tmp"
else
  rm -f "$tmp" 2>/dev/null || true
fi

exit 0

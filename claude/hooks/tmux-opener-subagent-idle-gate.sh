#!/usr/bin/env bash
# tmux-opener subagent-aware idle gate for Claude Code CLI hooks.
#
# Purpose: fire the idle notification only on *true* idle — when the main turn
# has stopped AND every subagent has finished — rather than on the main Stop
# event alone. It tracks the set of running subagents as marker files and, when
# the session is genuinely idle, delegates the actual bell to tmux-opener-bell.sh
# (session/tty resolution, reason-file write, BEL); it does not re-implement any
# of that here.
#
# The bell script must sit in the same directory as this one — the delegation
# resolves it as `$(dirname "$0")/tmux-opener-bell.sh` (below), with no path
# configured anywhere. Both live in claude/hooks/ in the repository and land in
# ~/.claude/hooks/ on install, so the adjacency holds by construction.
#
# Usage: register in ~/.claude/settings.json, passing the event kind as $1:
#   PreToolUse (matcher "Agent") -> tmux-opener-subagent-idle-gate.sh pending (an Agent-tool
#                                    call is about to launch a subagent)
#   SubagentStart    -> tmux-opener-subagent-idle-gate.sh start     (a subagent began)
#   SubagentStop     -> tmux-opener-subagent-idle-gate.sh stop      (a subagent finished)
#   Stop             -> tmux-opener-subagent-idle-gate.sh main-stop (the main turn stopped)
#   UserPromptSubmit -> tmux-opener-subagent-idle-gate.sh reset     (a new turn started)
#
# ============================================================================
# The activation model (why liveness is OBSERVED, not inferred from age)
# ============================================================================
# A marker registers *one activation* of a subagent, NOT the subagent's whole
# lifetime. This is the fact everything below rests on, and it was established by
# live observation (design #79 O1-O7), not assumed:
#   - SubagentStart re-fires on every resume (it rewrites the marker and the
#     subagent's .meta.json). A worker resumed by SendMessage — the standard
#     shape in this repo — gets a *fresh* marker at resume time.
#   - SubagentStop fires on *park* too (leaving to wait for SendMessage), not
#     only on final completion. While parked, the subagent has NO marker.
# Therefore a marker's mtime is "the start of the current activation" and its
# age is "how long the current activation has run". Nothing re-touches it while
# the subagent works, so age CANNOT distinguish "still working" from "died and
# leaked" — a single activation that runs long (a 674s worker was observed)
# would be swept as stale while genuinely alive. Age-based staleness was the
# root of the false-idle bug (#75): it is a bound on *elapsed activation time*,
# which scales with the amount of work, so any threshold breaks the moment a
# long enough activation arrives.
#
# So liveness is OBSERVED, not inferred. Claude Code keeps, per running
# subagent, ${transcript_path%.jsonl}/subagents/agent-<agent_id>.jsonl and
# appends to it continuously while the subagent runs. The marker name IS that
# agent_id (1:1), so the gate reads that transcript's mtime: recent writes mean
# the activation is genuinely alive. The marker (a registration slip) and the
# transcript freshness (proof of life) are BOTH required — a just-parked agent
# can have a seconds-fresh transcript yet hold no marker (it is not running), so
# freshness alone must never resurrect a park. transcript_path is a common stdin
# field on every hook event (official schema, O7), so it is available in the
# reset/main-stop sweeps even though those events carry no per-agent id.
#
# When the transcript cannot be observed — an anon-* marker, an older Claude
# Code without this layout, or jq absent so transcript_path reads empty — the
# gate DEGRADES to the old age gate (FALLBACK_STALE_SEC). The old elapsed-time
# flaw survives only in that one fallback, and only where liveness is genuinely
# unobservable; it never regresses below today's behavior.
#
# Sweeping QUARANTINES, it does not delete. In-run silence has no principled
# upper bound (a single tool call can wait on a human approval or an API 529
# retry; the measured in-run max is 822s), so no SILENCE_SEC can be provably
# right. A quarantined marker whose subagent writes even one more line is
# restored to the live set on the next hook event, so a mis-sweep costs one
# stray bell that self-heals — not "rings every turn for the rest of the
# activation" as deletion did. Correctness does not ride on the threshold being
# exactly right.
#
# Why "pending": SubagentStart does not fire synchronously before the Stop of
# the turn that launched it — the Agent tool is async, so a real run showed
# Stop firing (and idle notifying) ~25s before the corresponding SubagentStart
# even created its marker. PreToolUse on the Agent tool call fires in the
# launching turn itself, before that turn's own Stop, so registering a
# provisional marker there closes the race: main-stop no longer sees an empty
# set for a subagent that is about to exist but hasn't announced itself yet.
# A pending marker is the ONE kind that cannot carry a liveness signal (its
# subagent does not exist yet, so no transcript), so it alone stays bounded by a
# time threshold (PENDING_STALE_SEC) — but that threshold bounds only the
# platform's launch latency (~25s measured), which is not work, so it is a
# legitimate thing to time-box.
#
# Why the fire point is main-stop alone, not the last SubagentStop: a
# background subagent's completion always wakes the main loop to process it
# (a fresh turn), so firing on the last SubagentStop rings one turn too early
# — before the main loop's own reaction to that completion has finished. Real
# testing against this exact scenario confirmed users expect the notification
# only when the *whole* conversation (subagents + the main loop's follow-up)
# is done, which is exactly what main-stop-with-an-empty-set means.
#
# Why marker identity uses agent_id (not a plain +1/-1 counter): real sessions
# were observed to receive stray SubagentStop events for agents this gate
# never saw a SubagentStart for (e.g. a delayed stop from an earlier,
# unrelated worker). Removing a marker by agent_id degrades harmlessly when no
# such marker exists (`rm -f` on a missing path is a no-op), so a stray stop
# has zero effect on the tracked count. A naive counter would instead
# decrement on every stray stop, undercounting genuinely running subagents and
# reintroducing the false-idle bug this gate exists to fix. Do not "simplify"
# this to a counter. Consistent with that warning, the id-less ("anonymous")
# SubagentStop fallback retires only an anon-* victim — never an
# agent_id-identified live marker (that would BE the naive-counter failure this
# block forbids). It is not a no-op, though: in jq-absent sessions every marker
# is anon-* (no session_id/agent_id to name them), so something must remove them
# to keep the count balanced, or idle would only ever fire every
# FALLBACK_STALE_SEC there.
#
# Hook stdin is JSON (official Claude Code hook schema). Fields read here,
# quoted verbatim from that schema:
#   .session_id        - the stable id of this Claude Code session (one marker
#                        set dir per session).
#   .agent_id          - the id of the subagent for SubagentStart/SubagentStop
#                        (one marker file per running subagent).
#   .transcript_path   - path to this session's transcript. Common to every hook
#                        event (O7). A running subagent's own transcript lives at
#                        ${transcript_path%.jsonl}/subagents/agent-<agent_id>.jsonl
#                        and is the liveness signal the sweep reads.
#   .stop_hook_active  - true when the Stop hook is re-entered from a stop-hook
#                        continuation. Not needed for gating; named here for
#                        schema parity so a future refinement can read it.
#
# Requires: jq. Degrades harmlessly when jq/tmux are absent or outside tmux —
# every external call is best-effort (|| true) and the script always exits 0.
# Without jq, transcript_path reads empty and the sweep falls to the degraded
# age gate (FALLBACK_STALE_SEC) — never below today's behavior.
set -euo pipefail

event="${1:-}"

# Cooldown between idle fires, in seconds. Same intent as the extension's
# BELL_COFIRE_MS (3000ms, src/status-bridge.ts): a pair of fires closer than
# this collapses to a single idle event so idle never double-notifies.
# Trade-off accepted by design #52 / plan #54: two *distinct* but legitimate
# idles less than COOLDOWN_SEC apart also collapse to one (e.g. a very fast
# turn finishing within 3s of the previous idle). This is intentional
# best-effort de-dup, not a bug.
COOLDOWN_SEC=3

# Read the hook JSON once. Missing jq / non-JSON stdin degrade to empty fields.
input="$(cat 2>/dev/null || true)"
read_field() {
  [ -n "$input" ] || { printf ''; return 0; }
  printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null || true
}

session_id="$(read_field '.session_id')"
agent_id="$(read_field '.agent_id')"
# Present on every hook event (O7). Empty when jq is absent -> degraded mode.
transcript_path="$(read_field '.transcript_path')"

# Sanitize before using either value as a filename segment. Same mapping as
# safeSessionName() in src/status-bridge.ts (tr -c 'A-Za-z0-9_-' '_') so the
# statusline reader and this writer land on the same marker dir.
sanitize() { printf '%s' "$1" | tr -c 'A-Za-z0-9_-' '_'; }
safe_session="$(sanitize "$session_id")"
safe_agent="$(sanitize "$agent_id")"

cache="${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener"
dir="$cache/subagents-$safe_session"            # marker set: one file per running subagent
# Quarantine is a SIBLING dir, deliberately not a child of "$dir": tmux-opener-statusline.sh
# counts entries in the exact path subagents-<sid>/ (not a glob), so a sibling
# stays outside its count and the badge/bell invariant follows with no change to
# tmux-opener-statusline.sh (design #79 D7). Swept markers move here instead of being
# deleted, so a mis-sweep self-heals (see the activation-model header).
qdir="$cache/subagents-$safe_session-quarantine"
emit_marker="$cache/idle-emitted-$safe_session"  # mtime of the last idle fire (cooldown)
# (Legacy: an earlier revision kept a main-stopped flag so the last
# SubagentStop could fire a deferred idle. That rang one turn too early —
# before the main loop processed the completion — so the only fire point now
# is main-stop with an empty set. The flag file is still removed on reset to
# clean up leftovers from the old revision.)
main_flag="$cache/main-stopped-$safe_session"

# Count the marker files in the (live) set dir (0 when the dir is absent/empty).
# UNCHANGED fire predicate: the sweep runs first, so "live dir empty" means
# "every registered activation has finished or been quarantined".
count_markers() {
  local n
  n="$( { [ -d "$dir" ] && ls -1A "$dir" 2>/dev/null || true; } | wc -l | tr -d ' ' )"
  printf '%s' "${n:-0}"
}

# Portable mtime (epoch seconds): GNU stat, then BSD/macOS stat, else 0.
file_mtime() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || printf '0'
}

# --- Liveness thresholds (design #79 case E) ---------------------------------
# SILENCE_SEC bounds IN-RUN silence: the gap between transcript writes WHILE the
# marker is held. It is NOT a bound on how long the activation runs (that is what
# the old, broken STALE_SEC measured). Do NOT conflate the two silences:
#   - in-run silence (marker HELD)   -> measured max 822s (n=82,738). THIS is
#     what SILENCE_SEC bounds. Long gaps are a single Bash call waiting on a
#     human approval, or 529 retries — the agent is alive but not writing.
#   - park silence  (marker ABSENT)  -> measured max 1573s. OUT OF SCOPE of the
#     sweep: a parked subagent holds no marker (O3), so the sweep never sees it.
# Provisional value 1800 (~2.19x the observed in-run max 822s). FINAL value is a
# human approval decision (plan #86 unresolved item 1); implemented at 1800 so
# review can confirm or retune. Because sweeping quarantines (self-heals) rather
# than deletes, an off threshold costs one stray bell, not a broken gate.
SILENCE_SEC=1800
# Degraded-mode age gate (judgments 3/4: transcript unobservable). The old
# elapsed-time flaw survives ONLY here — 6x looser than the old 600s, and only
# where liveness genuinely cannot be observed.
FALLBACK_STALE_SEC=3600
# pending-* can carry no liveness signal (no subagent, no transcript yet); this
# bounds only the platform launch latency (~25s measured), 10x+ headroom.
PENDING_STALE_SEC=300

# A running subagent appends to ${transcript_path%.jsonl}/subagents/agent-<id>.jsonl
# (O1/O7). The marker name is sanitize(agent_id); the sweep derives the transcript
# as agent-<marker>.jsonl, which lines up with the real file only while agent_id is
# sanitize-invariant (the current UUID form: [A-Za-z0-9-] maps to itself). A future
# agent_id carrying other characters would not match its transcript and fall through
# to the degraded age gate (Judgment 3/4) rather than misfire. transcript_path is
# present on reset/main-stop too, and the sweep reads the derived file's mtime.
# Empty transcript_path (jq absent) -> subagents_dir empty -> degraded mode.
subagents_dir=""
[ -n "$transcript_path" ] && subagents_dir="${transcript_path%.jsonl}/subagents"

# Quarantine (never delete) markers no longer alive, and restore any whose
# subagent has resumed writing. Called at the head of reset and main-stop so a
# leaked marker is reclaimed even while the user waits silently for a bell (the
# reset-only sweep of the old revision never ran in that case -> permanent
# silence; design #79 D5). The fire predicate (count_markers) is unchanged.
#
# Freshness is read via file_mtime (stat) only — NEVER jq (plan #86 M3): jq is
# used solely to parse stdin fields, and a jq-absent host must still observe
# transcript mtime.
sweep_dead() {
  local now
  now="$(date +%s 2>/dev/null || true)"
  # Clock unreadable: keep every marker (touch nothing) rather than guess at
  # staleness. Keeping markers defers the idle verdict, so this degrades toward
  # silence — the side that avoids the false-idle bell #75 exists to prevent.
  [ -n "$now" ] || return 0

  # 1) Restore: a quarantined marker whose transcript is fresh again returns to
  #    live. This is the self-heal that turns a mis-sweep into a single stray
  #    bell instead of per-turn noise (design #79 D3).
  if [ -d "$qdir" ] && [ -n "$subagents_dir" ]; then
    for f in "$qdir"/*; do
      [ -e "$f" ] || continue
      local base tp
      base="$(basename "$f")"
      case "$base" in pending-*) continue ;; esac   # pending has no transcript
      tp="$subagents_dir/agent-$base.jsonl"
      [ -e "$tp" ] || continue
      if [ "$(( now - $(file_mtime "$tp") ))" -lt "$SILENCE_SEC" ]; then
        mkdir -p "$dir" 2>/dev/null || true
        mv -f "$f" "$dir/$base" 2>/dev/null || true
      fi
    done
  fi

  # 2) Sweep: quarantine markers judged no longer alive (4-value decision).
  [ -d "$dir" ] || return 0
  for f in "$dir"/*; do
    [ -e "$f" ] || continue
    local base age tp dead=0
    base="$(basename "$f")"
    case "$base" in
      pending-*)
        # No liveness signal by construction: bound the launch latency only.
        age=$(( now - $(file_mtime "$f") ))
        if [ "$age" -ge "$PENDING_STALE_SEC" ]; then dead=1; fi
        ;;
      *)
        tp="$subagents_dir/agent-$base.jsonl"
        if [ -n "$subagents_dir" ] && [ -e "$tp" ]; then
          # Judgment 1/2: observe liveness via transcript silence.
          if [ "$(( now - $(file_mtime "$tp") ))" -ge "$SILENCE_SEC" ]; then
            dead=1
          fi
        else
          # Judgment 3/4: cannot observe (anon-* / old layout / jq absent) ->
          # degraded age gate.
          age=$(( now - $(file_mtime "$f") ))
          if [ "$age" -ge "$FALLBACK_STALE_SEC" ]; then dead=1; fi
        fi
        ;;
    esac
    if [ "$dead" -eq 1 ]; then
      mkdir -p "$qdir" 2>/dev/null || true
      mv -f "$f" "$qdir/$base" 2>/dev/null || true
    fi
  done
}

# True when an idle fire happened within COOLDOWN_SEC (suppress the duplicate).
# emit_marker is a directory (created atomically by fire_idle), so test -e/-d,
# not -f. When time is unreadable we fail OPEN here (return "not recent" -> let
# the idle fire) rather than suppress every notification: this cooldown gate
# degrades toward notifying. Note sweep_dead's clock-unreadable path degrades the
# OTHER way, toward silence — the two fail-opens guard opposite mistakes (a lost
# bell here, a false-idle bell there), so neither is "the script's stance" (F4).
recently_emitted() {
  [ -e "$emit_marker" ] || return 1
  local now mtime
  now="$(date +%s 2>/dev/null || true)"
  [ -n "$now" ] || return 1                 # no clock -> fail open (fire)
  mtime="$(file_mtime "$emit_marker")"
  [ "$(( now - mtime ))" -lt "$COOLDOWN_SEC" ]
}

# Fire the idle notification exactly once, when main-stop observes an empty
# set. Stamps the emit marker for the cooldown and delegates the real bell to
# tmux-opener-bell.sh in this same directory. A fire inside the cooldown window
# is suppressed.
#
# Atomicity here is partial, and that's an accepted trade-off (like F3/F5):
# only the session's *first* idle fire is atomically protected. On that first
# fire emit_marker does not yet exist, so `mkdir` succeeds for exactly one racer
# and fails for every loser — the winner claims the fire, and each loser then
# sees a freshly-created marker (mtime == now) so recently_emitted is true and it
# suppresses. mkdir's own mtime serves as the cooldown timestamp. From the second
# fire onward emit_marker already exists, so control falls into the non-atomic
# else path: recently_emitted (cooldown check) followed by touch (timestamp
# update), a check-then-update with a tiny (μs-scale) race window. Concurrent
# main-stops in that window could both notify, but the extension's
# BELL_COFIRE_MS backstop (3000ms, src/status-bridge.ts) collapses
# near-simultaneous fires, so this never reaches the user as a visible
# double-notification — a best-effort design, not full atomicity.
fire_idle() {
  mkdir -p "$cache" 2>/dev/null || true
  if mkdir "$emit_marker" 2>/dev/null; then
    : # won the atomic claim; the fresh dir's mtime stamps the cooldown
  else
    # marker already present: a concurrent/recent fire owns it. Fire only if the
    # cooldown has elapsed (or the clock is unreadable -> fail open), re-stamping
    # the marker's mtime so this fire restarts the cooldown window.
    if recently_emitted; then
      return 0
    fi
    touch "$emit_marker" 2>/dev/null || true   # re-stamp the cooldown (dir mtime)
  fi
  local bell
  bell="$(dirname "$0")/tmux-opener-bell.sh"
  if [ -x "$bell" ]; then
    "$bell" stop </dev/null >/dev/null 2>&1 || true
  elif [ -f "$bell" ]; then
    bash "$bell" stop </dev/null >/dev/null 2>&1 || true
  fi
}

case "$event" in
  pending)
    # PreToolUse(Agent): a subagent is about to be launched but has not yet
    # sent SubagentStart. Add a provisional marker now so main-stop (which may
    # fire before SubagentStart, since Agent-tool launch is async) sees a
    # non-empty set and defers instead of false-idling.
    mkdir -p "$dir" 2>/dev/null || true
    touch "$dir/pending-$$-$(date +%s 2>/dev/null || printf '0')-${RANDOM}${RANDOM}" 2>/dev/null || true
    ;;
  start)
    mkdir -p "$dir" 2>/dev/null || true
    # Always create a marker so the running set is never under-counted (F1). If
    # .agent_id is empty/unavailable (missing field, unreadable stdin, or jq
    # absent), synthesize a unique per-start name from PID + epoch + $RANDOM so
    # concurrent anonymous starts don't collide. Under-counting here is the one
    # failure that makes main-stop fire a false idle while a subagent still runs,
    # so we bias toward always tracking.
    marker="$safe_agent"
    if [ -z "$marker" ]; then
      marker="anon-$$-$(date +%s 2>/dev/null || printf '0')-${RANDOM}${RANDOM}"
    fi
    touch "$dir/$marker" 2>/dev/null || true
    # This real start now accounts for one earlier "pending" anticipation (if
    # any); retire one so a launched-and-registered subagent isn't double
    # counted as both pending and started. Missing pending marker (e.g. no
    # PreToolUse fired) is harmless: nothing to retire, count is still correct.
    pending_victim="$( { { [ -d "$dir" ] && ls -1A "$dir" 2>/dev/null || true; } | grep '^pending-' | head -n1; } || true )"
    [ -n "$pending_victim" ] && rm -f "$dir/$pending_victim" 2>/dev/null || true
    ;;
  stop)
    if [ -n "$safe_agent" ]; then
      # Identified stop: remove this agent's marker from BOTH live and
      # quarantine (a quarantined-then-stopped agent must not linger).
      rm -f "$dir/$safe_agent" "$qdir/$safe_agent" 2>/dev/null || true
    else
      # No agent_id: we can't identify which marker this stop pairs with, so
      # retire an ANONYMOUS one (anon-* only) to keep the set count balanced.
      # Restricting the victim to anon-* closes P-1 — a stray, id-less stop can
      # never evict an agent_id-identified live marker (which is exactly the
      # naive-counter failure the header forbids). It is NOT a no-op: in
      # jq-absent sessions every marker is anon-*, so this is the only remover,
      # and dropping it would make idle fire only every FALLBACK_STALE_SEC there
      # (design #79 D4). Live first, then quarantine.
      victim="$( { { [ -d "$dir" ] && ls -1A "$dir" 2>/dev/null || true; } | grep '^anon-' | head -n1; } || true )"
      if [ -n "$victim" ]; then
        rm -f "$dir/$victim" 2>/dev/null || true
      else
        victim="$( { { [ -d "$qdir" ] && ls -1A "$qdir" 2>/dev/null || true; } | grep '^anon-' | head -n1; } || true )"
        [ -n "$victim" ] && rm -f "$qdir/$victim" 2>/dev/null || true
      fi
    fi
    # Deliberately NO fire here. See the module header ("Why the fire point is
    # main-stop alone"): the main loop always wakes to process a subagent's
    # completion, and firing here would ring one turn too early.
    ;;
  main-stop)
    sweep_dead                               # reclaim/quarantine before judging idle
    if [ "$(count_markers)" -eq 0 ]; then
      fire_idle                              # nothing in flight: truly idle now
    fi
    # Set non-empty: a subagent still runs; its completion will wake the main
    # loop and that turn's main-stop will fire. Nothing to record here.
    ;;
  reset)
    # New turn. A background subagent routinely outlives a single user turn in
    # normal use (the user keeps chatting while it runs), so reset must NOT
    # wipe the whole marker set on every UserPromptSubmit — an earlier revision
    # did, and it cleared genuinely-running markers mid-flight, causing the next
    # main-stop to fire on a falsely-empty set. Instead, sweep_dead observes
    # transcript silence and QUARANTINES only markers that are actually no
    # longer alive (restoring any that resumed), so a still-writing subagent
    # survives reset regardless of how long its activation has run.
    sweep_dead
    mkdir -p "$dir" 2>/dev/null || true
    rm -f "$main_flag" 2>/dev/null || true      # legacy flag: always safe to drop
    ;;
  *)
    : # unknown event kind: no-op (degrade harmlessly)
    ;;
esac

exit 0

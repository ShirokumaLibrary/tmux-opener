#!/usr/bin/env bash
# tmux-opener bell-reason bridge for Claude Code CLI hooks.
#   使い方: settings.json の Stop / Notification hooks から reason 引数付きで呼ぶ。
#   効果: tmux セッション内なら reason(ask/stop) を理由別ファイルへ書き、BEL を送る。
#   Notification は完了時にも発火するが、Stop と別ファイルに書くので互いを上書きしない。
#   読み手(notifyBell)が「両ファイル新鮮かつ mtime 近接なら stop 優先」で完了を stop に倒す。
# 依存: jq
set -euo pipefail
reason="${1:-stop}"          # "ask" | "stop"
case "$reason" in ask|stop) ;; *) reason=stop ;; esac
cat >/dev/null 2>&1 || true  # hook stdin(JSON)は使わないので捨てる
if [ -n "${TMUX:-}" ]; then
  session=$(tmux display-message -p '#S' 2>/dev/null || true)
  if [ -n "$session" ]; then
    safe=$(printf '%s' "$session" | tr -c 'A-Za-z0-9_-' '_')
    dir="${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener"
    mkdir -p "$dir"
    tmp="$dir/.bell-${safe}.${reason}.$$.tmp"
    jq -n --arg s "$session" --arg r "$reason" '{session:$s, reason:$r}' > "$tmp"
    mv -f "$tmp" "$dir/bell-${safe}.${reason}.json"   # 書き（自ファイルへアトミック置換）
  fi
fi
pane_tty=""
if [ -n "${TMUX:-}" ]; then
  pane_tty=$(tmux display-message -p '#{pane_tty}' 2>/dev/null || true)
fi
if [ -n "$pane_tty" ]; then
  printf '\a' > "$pane_tty" 2>/dev/null || printf '\a' > /dev/tty 2>/dev/null || printf '\a'
else
  printf '\a' > /dev/tty 2>/dev/null || printf '\a'
fi

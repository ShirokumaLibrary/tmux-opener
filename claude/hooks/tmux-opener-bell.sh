#!/usr/bin/env bash
# tmux-opener bell-reason bridge for Claude Code CLI hooks.
#   使い方: settings.json の Stop / Notification hooks から reason 引数付きで呼ぶ。
#   効果: tmux セッション内なら reason(ask/stop) を理由別ファイルへ書き、BEL を送る。
#   matcher 付きの配線(#108)では Notification は完了型では発火しない——鳴るのは
#   「人を待っている」3 型だけ。それでも読み手(notifyBell)の tie-break は残す:
#   「両ファイル新鮮かつ mtime 近接なら stop 優先」。#108 以前の matcher なし配線
#   (完了時にも Notification が飛ぶ)のまま運用しているユーザーが居るので、消さないこと。
#   reason 別に別ファイルへ書くので、どちらの配線でも互いを上書きしない。
# 依存: jq
set -euo pipefail
reason="${1:-stop}"          # "ask" | "stop"
case "$reason" in ask|stop) ;; *) reason=stop ;; esac
# ask のときだけ Notification hook の stdin JSON から notification_type を拾う(#116)。
# matcher 付き配線(#108)なら値は「人を待っている」3 型のいずれか——読み手(resolveBellReason)
# はこれを見て、完了直後 3 秒以内の本物の承認待ちを完了に寄せずに済む。stop には
# notification_type は無いので従来どおり stdin を捨てる。
notification_type=""
if [ "$reason" = ask ]; then
  stdin_json=$(cat 2>/dev/null || true)
  notification_type=$(printf '%s' "$stdin_json" | jq -r '.notification_type // empty' 2>/dev/null || true)
else
  cat >/dev/null 2>&1 || true  # stop: hook stdin(JSON)は使わないので捨てる
fi
if [ -n "${TMUX:-}" ]; then
  session=$(tmux display-message -p '#S' 2>/dev/null || true)
  if [ -n "$session" ]; then
    safe=$(printf '%s' "$session" | tr -c 'A-Za-z0-9_-' '_')
    dir="${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener"
    mkdir -p "$dir"
    tmp="$dir/.bell-${safe}.${reason}.$$.tmp"
    # 型が空/無ければフィールド自体を省く——空文字列を「型あり」と誤読させない(#116)。
    if [ -n "$notification_type" ]; then
      jq -n --arg s "$session" --arg r "$reason" --arg t "$notification_type" \
        '{session:$s, reason:$r, notification_type:$t}' > "$tmp"
    else
      jq -n --arg s "$session" --arg r "$reason" '{session:$s, reason:$r}' > "$tmp"
    fi
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

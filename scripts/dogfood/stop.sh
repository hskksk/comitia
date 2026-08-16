#!/usr/bin/env bash
set -euo pipefail

TMUX_ARGS=()
if [[ -f /exec-daemon/tmux.portal.conf ]]; then
  TMUX_ARGS=(-f /exec-daemon/tmux.portal.conf)
fi

SESSION_BOARD="${COMITIA_DOGFOOD_TMUX_BOARD:-comitia-board}"
SESSION_SMEE="${COMITIA_DOGFOOD_TMUX_SMEE:-comitia-smee}"

for session in "$SESSION_BOARD" "$SESSION_SMEE"; do
  if tmux "${TMUX_ARGS[@]}" has-session -t "=$session" 2>/dev/null; then
    tmux "${TMUX_ARGS[@]}" send-keys -t "$session:0.0" C-c || true
    sleep 1
    tmux "${TMUX_ARGS[@]}" kill-session -t "$session" || true
    echo "Stopped tmux session: $session"
  fi
done

echo "Dogfood stack stopped."

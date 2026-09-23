#!/usr/bin/env bash
# Keep keeper paper mode (read-only mainnet, no key) running in a detached tmux session, restarting on crash.
#   scripts/paper-run.sh          start (no-op if already running)
#   scripts/paper-run.sh status   show session + last log lines
#   scripts/paper-run.sh stop     stop it
#   tmux attach -t offmint-paper  watch it live (detach: Ctrl-b d)
# Output: web/public/paper/<date>-<ticker>.json, logs: keeper/logs/paper-live.log
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
S=offmint-paper
LOG="$ROOT/keeper/logs/paper-live.log"
mkdir -p "$ROOT/keeper/logs"
case "${1:-start}" in
  start)
    if tmux has-session -t "$S" 2>/dev/null; then
      echo "already running (tmux session $S)"
      exit 0
    fi
    tmux new-session -d -s "$S" "cd '$ROOT/keeper' && while true; do npx tsx src/paper.ts >>'$LOG' 2>&1; echo \"{\\\"event\\\":\\\"paper-exited\\\",\\\"code\\\":\$?,\\\"ts\\\":\\\"\$(date -u +%FT%TZ)\\\"}\" >>'$LOG'; sleep 30; done"
    echo "started tmux session $S; log: $LOG"
    ;;
  status)
    tmux has-session -t "$S" 2>/dev/null && echo "running (tmux session $S)" || echo "NOT running"
    tail -n 5 "$LOG" 2>/dev/null | cut -c1-200 || true
    ;;
  stop)
    tmux kill-session -t "$S" 2>/dev/null && echo "stopped" || echo "not running"
    ;;
  *)
    echo "usage: $0 [start|status|stop]"
    exit 1
    ;;
esac

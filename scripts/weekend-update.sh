#!/usr/bin/env bash
# Weekend report auto-update (docs/FINISH.md C2). After each Monday settle, re-run the scans so the just-finished
# mint-off window is appended (harm.ts and weekends.ts pick up every completed window automatically) and paper mode's
# live result for it is attached (backtest/src/paperMerge.ts).
#   scripts/weekend-update.sh          run once now
#   scripts/weekend-update.sh --loop   stay up; run once per Monday after 02:00 UTC (paper mode settles at Mon 01:00)
# Read-only mainnet. Writes web/public/data/{harm,weekends,frequency}.json; commit + redeploy publish them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/keeper/logs/weekend-update.log"
mkdir -p "$(dirname "$LOG")"

run_once() {
  echo "[$(date -u +%FT%TZ)] weekend update: harm -> weekends -> frequency" | tee -a "$LOG"
  cd "$ROOT/backtest"
  set -a; [ -f "$ROOT/.env" ] && . "$ROOT/.env"; set +a
  npx tsx src/harm.ts >>"$LOG" 2>&1
  npx tsx src/weekends.ts >>"$LOG" 2>&1
  npx tsx src/frequency.ts >>"$LOG" 2>&1
  python3 - "$ROOT" <<'EOF' | tee -a "$LOG"
import json, sys
w = json.load(open(sys.argv[1] + "/web/public/data/weekends.json"))["windows"][0]
p = w.get("paper") or {}
print(f"latest window {w['window']}: {w['tokensAbove10']} tokens above 10%, ${w['paidAboveReferenceUsd']:,.0f} paid above the reference on ${w['buysValueUsd']:,.0f} of buys; paper: {p.get('settled', 0)}/{p.get('tokens', 0)} settled")
EOF
}

if [ "${1:-}" != "--loop" ]; then run_once; exit 0; fi
last=""
while true; do
  day=$(date -u +%u); hour=$(date -u +%H); today=$(date -u +%F)
  if [ "$day" = "1" ] && [ "$hour" -ge 2 ] && [ "$last" != "$today" ]; then
    run_once && last="$today" || echo "[$(date -u +%FT%TZ)] update failed; retrying next hour" | tee -a "$LOG"
  fi
  sleep 3600
done

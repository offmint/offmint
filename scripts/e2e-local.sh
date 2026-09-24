#!/usr/bin/env bash
# End-to-end demo weekend on a fresh local anvil chain:
#   Deploy.s.sol -> DemoBuyer steps (market) + keeper bot --once (arm, lock, settle) -> assert more STOCK per share.
# Uses anvil's public, well-known test keys only. Usage: scripts/e2e-local.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8546}"
RPC="http://127.0.0.1:$PORT"
LOG="$(mktemp)"

anvil --silent --port "$PORT" &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true; rm -f "$LOG"' EXIT
for _ in $(seq 1 50); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done

# anvil accounts 0 (deployer/owner), 1 (keeper), 2 (fee recipient)
export DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export KEEPER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
export FEE_RECIPIENT=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
KEEPER_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d

cd "$ROOT/contracts"
step() { echo "--- $*"; }
demo() { forge script script/DemoBuyer.s.sol --sig "$@" --rpc-url "$RPC" --broadcast >/dev/null; }
warp() {
  cast rpc evm_increaseTime "$1" --rpc-url "$RPC" >/dev/null
  cast rpc evm_mine --rpc-url "$RPC" >/dev/null
}
bot() {
  (cd "$ROOT/keeper" && RPC_URL="$RPC" KEEPER_PRIVATE_KEY="$KEEPER_PK" npx tsx src/bot.ts \
    --deployment "$ROOT/contracts/deployments/31337.json" --once) >"$LOG" 2>&1 || {
    cat "$LOG"
    exit 1
  }
}
expect_action() {
  bot
  if ! grep -q "\"event\":\"tx\".*\"action\":\"$1\".*\"status\":\"success\"" "$LOG"; then
    echo "FAIL: expected keeper to $1"
    cat "$LOG"
    exit 1
  fi
  echo "keeper: $1 ✓"
}
call() { cast call "$VAULT" "$@" --rpc-url "$RPC" | awk '{print $1}'; }

step "deploy"
forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --slow >/dev/null
VAULT=$(python3 -c "import json;print(json.load(open('deployments/31337.json'))['vault'])")
ASSETS0=$(call "totalAssets()(uint256)")
echo "vault $VAULT, totalAssets $ASSETS0"

step "Friday close print; 6 min later minting closes (weekend opens)"
demo "fridayClose()"
warp 360
demo "openWeekend(uint256)" 2400 # 40-min demo weekend; windowEnd is fixed at arm time
warp 90
expect_action arm

step "weekend squeeze to \$49.03 (+70%): every rung cleared"
demo "pump(uint256)" 4903000000
expect_action lock
# must be the rung-sold trigger (proves the bot reads the right pool/tick), not the pre-reopen timer
grep -q '"action":"lock".*fully sold' "$LOG" || {
  echo "FAIL: lock was not triggered by a sold rung"
  cat "$LOG"
  exit 1
}

step "Monday: window ends, mint arbitrage pulls the pool to \$29.13, oracle prints fresh"
warp 2400
demo "pump(uint256)" 2913000000
demo "mondayPrint(uint256)" 2913000000
warp 1860
expect_action settle

STATE=$(call "state()(uint8)")
ASSETS1=$(call "totalAssets()(uint256)")
echo "state $STATE, totalAssets $ASSETS0 -> $ASSETS1"
[ "$STATE" = "0" ] || {
  echo "FAIL: vault not OPEN"
  exit 1
}
python3 -c "import sys; sys.exit(0 if int('$ASSETS1') > int('$ASSETS0') else 1)" || {
  echo "FAIL: no STOCK gained"
  exit 1
}
echo "E2E OK: +$(python3 -c "print(round((int('$ASSETS1')-int('$ASSETS0'))/1e18,4))") STOCK per 100 deposited (after perf fee)"

#!/usr/bin/env bash
# MetaVault weekly cycle end-to-end on a fresh local anvil chain (SPEC §6.5.2), driven by the unmodified keeper bot:
#   deploy -> schedule weekend -> BUY-IN -> Friday commit -> arm MetaVault's instance -> squeeze -> lock
#   -> Monday settle -> UNWIND to USDG -> assert IDLE and USDG NAV up.
# Uses anvil's public, well-known test keys only. Usage: scripts/e2e-meta.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8548}"
RPC="http://127.0.0.1:$PORT"
LOG="$(mktemp)"

anvil --silent --port "$PORT" &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true; rm -f "$LOG"' EXIT
for _ in $(seq 1 50); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done

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
j() { python3 -c "import json;print(json.load(open('deployments/31337.json'))['$1'])"; }
bot() {
  (cd "$ROOT/keeper" && RPC_URL="$RPC" KEEPER_PRIVATE_KEY="$KEEPER_PK" META_PICKS="$STOCK" META_BUYIN_OPEN=1 \
    LOG_DIR="$(mktemp -d)" npx tsx src/bot.ts --deployment "$ROOT/contracts/deployments/31337.json" --once) >"$LOG" 2>&1 || {
    cat "$LOG"
    exit 1
  }
}
# expect_tx <instance> <action>: run the bot once, then check its log; seen <instance> <action>: check the same log
expect_tx() {
  bot
  seen "$1" "$2"
}
seen() {
  if ! grep -q "\"event\":\"tx\",\"instance\":\"$1\",\"action\":\"$2\".*\"status\":\"success\"" "$LOG"; then
    echo "FAIL: expected $1 to $2"
    cat "$LOG"
    exit 1
  fi
  echo "keeper ($1): $2 ✓"
}
mcall() { cast call "$META" "$@" --rpc-url "$RPC" | awk '{print $1}'; }

step "deploy (factory, MetaVault, community + MetaVault instances)"
forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --slow >/dev/null
META=$(j metaVault)
STOCK=$(j stock)
NAV0=$(mcall "totalAssets()(uint256)")
echo "MetaVault $META, NAV $NAV0 USDG raw"

step "schedule the weekend: opens in 8h for 40 min (the demo clock needs it before BUY-IN)"
demo "scheduleWeekend(uint256,uint256)" 28800 2400
expect_tx metaVault buyIn
[ "$(mcall "openPositionCount()(uint256)")" = "1" ] || { echo "FAIL: not CYCLE_ACTIVE"; exit 1; }

step "Friday: 6h before the window, commit into MetaVault's instance; close print"
warp 7300
expect_tx metaVault commit
demo "fridayClose()"

step "weekend opens; keeper arms MetaVault's instance"
warp 21660
expect_tx meta-instance arm

step "weekend squeeze to +70%: rungs sold, lock"
demo "pump(uint256)" 4903000000
expect_tx meta-instance lock

step "Monday: back to \$29.13, fresh print, settle, then UNWIND to USDG"
warp 2400
demo "pump(uint256)" 2913000000
demo "mondayPrint(uint256)" 2913000000
warp 1860
expect_tx meta-instance settle
seen metaVault unwind # same bot pass: MetaVault ticks right after its instance settles

OPEN=$(mcall "openPositionCount()(uint256)")
NAV1=$(mcall "totalAssets()(uint256)")
echo "openPositionCount $OPEN, NAV $NAV0 -> $NAV1"
[ "$OPEN" = "0" ] || { echo "FAIL: MetaVault not IDLE"; exit 1; }
python3 -c "import sys; sys.exit(0 if int('$NAV1') > int('$NAV0') else 1)" || { echo "FAIL: NAV did not rise"; exit 1; }
echo "E2E META OK: NAV $(python3 -c "print(round((int('$NAV1')-int('$NAV0'))/int('$NAV0')*100,3))")% in USDG after a squeeze weekend (fees included)"

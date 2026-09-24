#!/usr/bin/env bash
# Live MetaVault weekly cycle on Robinhood Chain testnet (SPEC §11 M5): deposit USDG -> cycle runs -> NAV moves ->
# withdraw. Real time, ~1.5 h. The keeper bot must be running with META_PICKS=<stock>, META_BUYIN_OPEN=1 and
# META_COMMIT_LEAD=600. This script only plays "the market" and the demo clock (DemoBuyer), and at the end redeems the
# deployer's MetaVault shares. Keys come from .env (sourced, never printed). Usage: scripts/demo-meta-testnet.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"
set -a && source ../.env && set +a
RPC="${RH_TESTNET_RPC:-https://rpc.testnet.chain.robinhood.com}"
J=deployments/46630.json
g() { python3 -c "import json;print(json.load(open('$J'))['$1'])"; }
META=$(g metaVault)
INST=$(g metaInstance)
USDG=$(g usdg)
ME=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
START_IN="${START_IN:-1200}"
DURATION="${DURATION:-2400}"

ts() { date -u +%H:%M:%S; }
say() { echo "[$(ts)] $*"; }
retry() { for _ in 1 2 3 4 5 6; do out=$("$@" 2>/dev/null) && { echo "$out"; return 0; }; sleep 3; done; return 1; }
c() { retry cast call "$@" --rpc-url "$RPC" | awk '{print $1}'; }
now() { retry cast block latest -f timestamp --rpc-url "$RPC"; }
demo() { retry forge script script/DemoBuyer.s.sol --sig "$@" --rpc-url "$RPC" --broadcast --slow >/dev/null; }
wait_for() { # wait_for <description> <command...>: poll every 20 s
  local what="$1"; shift
  say "waiting: $what"
  until "$@"; do sleep 20; done
  say "done: $what"
}
positions() { c "$META" "openPositionCount()(uint256)"; }
phase() { retry cast call "$META" "position(address)((address,uint8,uint8,uint64,uint64,uint256,uint256,uint256,uint256,uint256))" "$(g stock)" --rpc-url "$RPC" | tr -d '()' | cut -d, -f2 | tr -d ' '; }
state() { c "$INST" "state()(uint8)"; }

NAV0=$(c "$META" "totalAssets()(uint256)")
SHARES=$(c "$META" "balanceOf(address)(uint256)" "$ME")
say "MetaVault $META NAV $NAV0 (USDG raw); deployer shares $SHARES (from the 10,000 USDG deploy deposit)"

say "1. schedule the demo weekend: opens in ${START_IN}s for ${DURATION}s"
demo "scheduleWeekend(uint256,uint256)" "$START_IN" "$DURATION"
START=$(( $(now) + START_IN ))
END=$(( START + DURATION ))

wait_for "keeper BUY-IN (MetaVault CYCLE_ACTIVE)" test "$(positions)" = "1"
wait_for "keeper Friday commit into MetaVault's instance" test "$(phase)" = "2"
say "2. Friday close print"
demo "fridayClose()"

wait_for "window open + keeper arms MetaVault's instance" test "$(state)" = "1"
say "3. weekend squeeze: pool to \$49.03 (+70%)"
demo "pump(uint256)" 4903000000

wait_for "window end ($(date -u -d @$END +%H:%M:%S))" test "$(now)" -ge "$END"
say "4. Monday: pool back to \$29.13, fresh oracle print"
demo "pump(uint256)" 2913000000
demo "mondayPrint(uint256)" 2913000000

wait_for "keeper settle + UNWIND (MetaVault IDLE)" test "$(positions)" = "0"
NAV1=$(c "$META" "totalAssets()(uint256)")
say "NAV $NAV0 -> $NAV1"

say "5. deployer redeems all MetaVault shares"
B0=$(c "$USDG" "balanceOf(address)(uint256)" "$ME")
retry cast send "$META" "redeem(uint256,address,address)" "$SHARES" "$ME" "$ME" --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$RPC" >/dev/null
B1=$(c "$USDG" "balanceOf(address)(uint256)" "$ME")
OUT=$(( B1 - B0 ))
say "deposited 10000.000000 USDG, withdrew $(python3 -c "print(f'{$OUT/1e6:.6f}')") USDG (0.5% entry + 0.5% exit fee included)"
python3 -c "import json;json.dump({'nav0':'$NAV0','nav1':'$NAV1','deposited':'10000000000','withdrawn':'$OUT','metaVault':'$META'},open('deployments/demo-meta-46630.json','w'),indent=2)"

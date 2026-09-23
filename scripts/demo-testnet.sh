#!/usr/bin/env bash
# Live demo weekend on Robinhood Chain testnet (~75 min of real time).
#   The keeper bot runs in the background; this script plays the market (DemoBuyer) and waits on on-chain state:
#   Friday close -> weekend opens -> bot ARMS -> squeeze +70% -> bot LOCKS (band cleared) -> window ends ->
#   Monday: pool back near the old price, oracle prints fresh -> bot SETTLES -> more STOCK per share.
# Needs ~/offmint/.env with DEPLOYER_PRIVATE_KEY, KEEPER_PRIVATE_KEY (keys are only loaded into this process).
# Usage: scripts/demo-testnet.sh   (log: keeper/logs/demo-testnet-<ts>.log)
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a
RPC="${RH_TESTNET_RPC:-https://rpc.testnet.chain.robinhood.com}"
DEP="$ROOT/contracts/deployments/46630.json"
jget() { python3 -c "import json;print(json.load(open('$DEP'))['$1'])"; }
VAULT=$(jget vault)
CLOCK=$(jget clock)
TS=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$ROOT/keeper/logs"
BOTLOG="$ROOT/keeper/logs/demo-bot-$TS.jsonl"

say() { echo "[$(date -u +%H:%M:%S)] $*"; }
retry() {
  local i
  for i in 1 2 3 4 5 6; do
    if out=$("$@" 2>&1); then
      echo "$out"
      return 0
    fi
    sleep $((i * 3))
  done
  echo "$out" >&2
  return 1
}
vcall() { retry cast call "$VAULT" "$@" --rpc-url "$RPC" | awk '{print $1}'; }
now() { retry cast block latest -f timestamp --rpc-url "$RPC"; }
demo() {
  say "DemoBuyer $*"
  (cd "$ROOT/contracts" && retry forge script script/DemoBuyer.s.sol --sig "$@" --rpc-url "$RPC" --broadcast --slow) |
    grep -E "pool price now|feed close|weekend open|Error" || true
}
# wait_for <description> <timeout-seconds> <command...>: polls every 20s until the command succeeds
wait_for() {
  local what=$1 limit=$2 t0
  shift 2
  t0=$(date +%s)
  say "waiting: $what"
  until "$@"; do
    if (($(date +%s) - t0 > limit)); then
      say "TIMEOUT waiting for: $what"
      tail -5 "$BOTLOG" || true
      exit 1
    fi
    sleep 20
  done
  say "done: $what"
}
state_is() { [ "$(vcall 'state()(uint8)')" = "$1" ]; }
EPOCH_SIG='currentEpoch()((uint64,uint64,uint64,uint64,uint256,int24,int24,uint128,bytes32,bool,uint256,uint256,uint256,uint256,uint256,uint256,int256,uint256))'
# epoch field by index (0 id, 1 armedAt, 2 windowEnd, 9 locked); parses the whole tuple, not just the first token
efield() { retry cast call "$VAULT" "$EPOCH_SIG" --rpc-url "$RPC" | python3 -c "import sys,re; t=sys.stdin.read().strip()[1:-1]; print(re.sub(r' \[.*?\]','',[x.strip() for x in t.split(',')][$1]))"; }
locked() { [ "$(efield 9)" = "true" ]; }
window_over() { [ "$(now)" -ge "$(efield 2)" ]; }

ASSETS0=$(vcall 'totalAssets()(uint256)')
SUPPLY=$(vcall 'totalSupply()(uint256)')
START_STATE=$(vcall 'state()(uint8)')
say "vault $VAULT  totalAssets $ASSETS0  epochs $(vcall 'epochCount()(uint256)')  state $START_STATE"

say "starting keeper bot (20s interval) -> $BOTLOG"
(cd "$ROOT/keeper" && RPC_URL="$RPC" npx tsx src/bot.ts --deployment "$DEP" --interval 20 >>"$BOTLOG" 2>&1) &
BOT=$!
trap 'kill $BOT 2>/dev/null || true' EXIT

# resumable: every step checks on-chain state first, so a re-run continues where the last one stopped
if [ "$START_STATE" = "0" ]; then
  demo "fridayClose()"
  demo "openWeekend(uint256)" 2400
  wait_for "keeper arms (oracle frozen >= 5 min)" 900 state_is 1
fi
if state_is 1 && ! locked; then
  demo "pump(uint256)" 4903000000
  wait_for "keeper locks (band cleared)" 600 locked
fi
if state_is 1; then
  WE=$(efield 2)
  say "position locked; demo weekend ends at $(date -u -d @"$WE" +%H:%M:%S) UTC"
  wait_for "demo weekend window ends (minting reopens)" 3000 window_over
  FEED_AT=$(retry cast call "$(jget feed)" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url "$RPC" | sed -n 4p | awk '{print $1}')
  if [ "$FEED_AT" -lt "$WE" ]; then
    demo "pump(uint256)" 2913000000
    demo "mondayPrint(uint256)" 2913000000
  fi
  wait_for "keeper settles (windowEnd + 30 min, oracle fresh)" 3600 state_is 0
fi
ASSETS0=$(python3 -c "print(100*10**18)") # demo deposit baseline (resumable runs start mid-epoch)
ASSETS1=$(vcall 'totalAssets()(uint256)')
EPOCH=$(retry cast call "$VAULT" "$EPOCH_SIG" --rpc-url "$RPC")
say "SETTLED: totalAssets $ASSETS0 -> $ASSETS1"
python3 - "$ROOT" "$VAULT" "$ASSETS0" "$ASSETS1" "$SUPPLY" "$EPOCH" <<'EOF'
import glob, json, re, sys
root, vault, a0, a1, supply, epoch = sys.argv[1:]
# keeper txs from every demo run (a resumed run continues an epoch armed by an earlier run)
txs = [json.loads(l) for f in sorted(glob.glob(f"{root}/keeper/logs/demo-bot-*.jsonl")) for l in open(f) if '"event":"tx"' in l]
names = ["id","armedAt","windowEnd","settledAt","p0","tickLower","tickUpper","liquidity","salt","locked",
         "stockBefore","stockDeployed","stockBack","usdgReceived","stockBought","usdgLeft","pnlStock","feeStock"]
vals = [re.sub(r" \[.*?\]", "", x.strip()) for x in epoch.strip()[1:-1].split(",")]
ep = dict(zip(names, vals))
rec = {
    "chainId": 46630, "vault": vault,
    "totalAssetsBefore": a0, "totalAssetsAfter": a1, "shareSupply": supply,
    "stockGained": (int(a1) - int(a0)) / 1e18,
    "keeperTxs": [{k: t[k] for k in ("action", "reason", "hash", "status", "stateAfter")} for t in txs],
    "epoch": ep,
    "explorer": "https://explorer.testnet.chain.robinhood.com/tx/",
}
out = f"{root}/contracts/deployments/demo-46630.json"
json.dump(rec, open(out, "w"), indent=2)
print(json.dumps({k: rec[k] for k in ("stockGained", "keeperTxs")}, indent=2))
print("wrote", out)
EOF

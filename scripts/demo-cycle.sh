#!/usr/bin/env bash
# Reproduce an Offmint weekend in one command.
#   scripts/demo-cycle.sh local     fresh anvil chain: deploy everything, run BOTH paths with the unmodified keeper bot,
#                                   print before/after balances (~3-4 min, no keys, no network)
#   scripts/demo-cycle.sh testnet   run the sandbox steps on Robinhood Chain testnet (46630) with SANDBOX_PRIVATE_KEY
#                                   from .env (needs the sandbox deployment: contracts/deployments/sandbox-46630.json)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-local}"

case "$MODE" in
local)
  echo "=== 1/2 Community vault: deposit mHIMS -> weekend ladder -> +70% squeeze -> lock -> Monday settle ==="
  C=$("$ROOT/scripts/e2e-local.sh" 2>&1 | grep -vE "foundry-pp|Detected artifacts" | tee /dev/stderr | tail -2)
  echo
  echo "=== 2/2 MetaVault: deposit USDG -> buy-in -> commit -> ladder -> squeeze -> settle -> unwind to USDG ==="
  M=$("$ROOT/scripts/e2e-meta.sh" 2>&1 | grep -vE "foundry-pp|Detected artifacts" | tee /dev/stderr | tail -2)
  echo
  echo "=== Summary (local anvil, demo pool, +70% squeeze; not a performance claim) ==="
  echo "Community vault : $(echo "$C" | grep -E 'totalAssets' | sed 's/state 0, //')"
  echo "                  $(echo "$C" | grep -E 'E2E OK')"
  echo "MetaVault       : $(echo "$M" | grep -E 'openPositionCount' | sed 's/openPositionCount 0, //')"
  echo "                  $(echo "$M" | grep -E 'E2E META OK')"
  ;;
testnet)
  DEP="$ROOT/contracts/deployments/sandbox-46630.json"
  if [ ! -f "$DEP" ]; then
    echo "No sandbox deployment yet ($DEP). Deploy it first (NEXT.md Task 3):"
    echo "  cd contracts && forge script script/Sandbox.s.sol --rpc-url \$ALCHEMY_RH_TESTNET_URL --broadcast --slow"
    exit 1
  fi
  cd "$ROOT"
  set -a && source .env && set +a
  for step in reset deposit buyIn startWeekend simulateSqueeze reopenMarket settle unwind withdraw; do
    npx tsx web/src/lib/sandbox/cli.ts "$step"
  done
  ;;
*)
  echo "usage: scripts/demo-cycle.sh [local|testnet]" >&2
  exit 2
  ;;
esac

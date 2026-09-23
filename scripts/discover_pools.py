#!/usr/bin/env python3
"""M0 fact check: join Robinhood Stock Token API x Chainlink feed directory x Uniswap v4 Initialize events.
Writes contracts/config/mainnet.json. Read-only; public RPC by default (override with RH_MAINNET_RPC).
Usage: python3 scripts/discover_pools.py [TICKER ...]"""
import json, os, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

RPC = os.environ.get("RH_MAINNET_RPC", "https://rpc.mainnet.chain.robinhood.com")
PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
INIT_TOPIC = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"
POOLS_SLOT = 6
OUT = Path(__file__).resolve().parent.parent / "contracts/config/mainnet.json"

def http_json(url, body=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None,
                                 headers={"content-type": "application/json", "user-agent": "offbell/0.1"})
    for attempt in range(8):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 7:
                raise
            time.sleep(2 ** attempt)
        except urllib.error.URLError:
            if attempt == 7:
                raise
            time.sleep(2 ** attempt)

def rpc(method, params):
    r = http_json(RPC, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    if "error" in r:
        raise RuntimeError(r["error"])
    return r["result"]

def keccak(b: bytes) -> bytes:
    # stdlib sha3_256 is NOT keccak; use Foundry's cast (installed with the toolchain).
    return bytes.fromhex(subprocess.check_output(["cast", "keccak", "0x" + b.hex()], text=True).strip()[2:])

def topic(addr): return "0x" + addr.lower()[2:].rjust(64, "0")

def signed(v, bits):
    return v - (1 << bits) if v >= 1 << (bits - 1) else v

def pools_for(stock):
    c0, c1 = sorted([stock, USDG], key=lambda a: int(a, 16))
    logs = rpc("eth_getLogs", [{"address": PM, "fromBlock": "0x0", "toBlock": "latest",
                                "topics": [INIT_TOPIC, None, topic(c0), topic(c1)]}])
    out = []
    for lg in logs:
        data = bytes.fromhex(lg["data"][2:])
        w = [int.from_bytes(data[i:i + 32], "big") for i in range(0, len(data), 32)]
        pid = lg["topics"][1]
        slot = int.from_bytes(keccak(bytes.fromhex(pid[2:]) + POOLS_SLOT.to_bytes(32, "big")), "big")
        s0 = int(rpc("eth_call", [{"to": PM, "data": "0x1e2eaeaf" + slot.to_bytes(32, "big").hex()}, "latest"]), 16)
        liq = int(rpc("eth_call", [{"to": PM, "data": "0x1e2eaeaf" + (slot + 3).to_bytes(32, "big").hex()}, "latest"]), 16)
        out.append({
            "poolId": pid,
            "poolKey": {"currency0": c0, "currency1": c1, "fee": w[0], "tickSpacing": signed(w[1], 256),
                        "hooks": "0x" + w[2].to_bytes(32, "big")[-20:].hex()},
            "initBlock": int(lg["blockNumber"], 16),
            "sqrtPriceX96": str(s0 & ((1 << 160) - 1)),
            "tick": signed((s0 >> 160) & 0xFFFFFF, 24),
            "liquidity": str(liq),
        })
    return out, c0.lower() == stock.lower()

def main():
    want = set(a.upper() for a in sys.argv[1:])
    assets = http_json("https://api.robinhood.com/rhj/assets")["assets"]
    feeds = http_json("https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json")
    feed_by = {}
    for f in feeds:
        n = f["name"]
        if n.startswith("Robinhood "):
            feed_by[n.split()[1].split("-")[0].split("/")[0].strip()] = f
    res = {"chainId": 4663, "poolManager": PM, "usdg": USDG, "usdgDecimals": 6,
           "sequencerUptimeFeed": "UNVERIFIED - not listed in Chainlink directory for robinhood-mainnet (checked 2026-09-23)",
           "sources": ["https://api.robinhood.com/rhj/assets",
                       "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json",
                       "PoolManager Initialize logs"],
           "stocks": {}}
    for a in assets:
        sym = a["tokenSymbol"]
        if want and sym not in want:
            continue
        dep = [x for x in a["deployments"] if x["chainId"] == 4663]
        if not dep:
            continue
        stock = dep[0]["contractAddress"]
        f = feed_by.get(sym)
        if not f and not want:
            continue
        pools, s_is0 = pools_for(stock)
        pools.sort(key=lambda p: int(p["liquidity"]), reverse=True)
        best = next((p for p in pools if int(p["poolKey"]["hooks"], 16) == 0 and int(p["liquidity"]) > 0), None)
        res["stocks"][sym] = {
            "token": stock, "decimals": a.get("tokenDecimals", 18), "name": a["tokenName"],
            "currentMultiplier": a["currentMultiplier"], "pendingMultiplier": a["pendingMultiplier"],
            "feed": f["proxyAddress"] if f else None,
            "feedDecimals": f["decimals"] if f else None,
            "feedHeartbeat": f["heartbeat"] if f else None,
            "stockIsCurrency0": s_is0,
            "bestNoHookPool": best,
            "pools": pools[:10],
            "poolCount": len(pools),
        }
        print(f"{sym:6} feed={'yes' if f else 'NO '} pools={len(pools):3} s0={s_is0} best={'none' if not best else best['poolId'][:10]+' L='+best['liquidity']}", flush=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(res, indent=2) + "\n")
    print("wrote", OUT)

if __name__ == "__main__":
    main()

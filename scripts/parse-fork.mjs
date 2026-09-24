// Parses a pinned mainnet-fork run (forge test -vv, contracts/test/Fork.t.sol) into web/public/data/sim/fork.json.
//   node scripts/parse-fork.mjs contracts/deployments/fork/fork-<block>.log <block>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const [log, block] = process.argv.slice(2);
const text = readFileSync(log, "utf8");
const out = { source: "contracts/test/Fork.t.sol test_fork_fullCycle_squeezeLockBuyback: simulated +70% weekend spike, Monday reopen at +1%, on the real pool", forkBlock: Number(block), chainId: 4663, tickers: {} };
for (const part of text.split(/Ran 1 test for test\/Fork\.t\.sol:Fork/).slice(1)) {
  const t = part.match(/^([A-Z]+)/)[1];
  const n = (re) => { const m = part.match(re); return m ? Number(m[1]) : null; };
  const rungs = [...part.matchAll(/rung: (\d+)\s+STOCK placed: ([\d.]+)\s+STOCK left unsold: ([\d.]+)\s+USDG received: ([\d.]+)/g)]
    .map((m) => ({ placed: +(+m[2]).toFixed(4), unsold: +(+m[3]).toFixed(4), usdg: +(+m[4]).toFixed(2) }));
  out.tickers[t] = {
    held: 100,
    p0: n(/P0 \(USD\): ([\d.]+)/),
    rungs,
    usdgReceived: +n(/  USDG received: ([\d.]+)\n  STOCK bought/).toFixed(2),
    stockBought: +n(/STOCK bought back: ([\d.]+)/).toFixed(4),
    pnlStock: +n(/PnL \(STOCK\): ([\d.]+)/).toFixed(4),
    feeStock: +n(/perf fee \(STOCK\): ([\d.]+)/).toFixed(4),
    holderAfter: +n(/holder redeems 100 -> STOCK: ([\d.]+)/).toFixed(2),
  };
}
mkdirSync("web/public/data/sim", { recursive: true });
writeFileSync("web/public/data/sim/fork.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(Object.fromEntries(Object.entries(out.tickers).map(([t, v]) => [t, { p0: v.p0, collected: v.usdgReceived, after: v.holderAfter, rungs: v.rungs.length }]))));

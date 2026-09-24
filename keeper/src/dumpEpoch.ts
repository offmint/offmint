// Print the latest epoch of a deployment's community vault (per-rung fills, buyback, fee) as JSON.
//   RPC_URL=http://127.0.0.1:8546 npx tsx keeper/src/dumpEpoch.ts contracts/deployments/31337.json
import { readFileSync } from "node:fs";
import { createPublicClient, http, type Address } from "viem";
import { offmintVaultAbi } from "./abi/OffmintVault.js";

const dep = JSON.parse(readFileSync(process.argv[2], "utf8"));
const pub = createPublicClient({ transport: http(process.env.RPC_URL) });
const v = { address: dep.vault as Address, abi: offmintVaultAbi } as const;
const e = await pub.readContract({ ...v, functionName: "currentEpoch" });
const rungs = await pub.readContract({ ...v, functionName: "epochRungs", args: [e.id] });
const n = (x: bigint, d: number) => Number(x) / 10 ** d;
console.log(
  JSON.stringify({
    p0: n(e.p0, e.priceDecimals),
    stockBefore: n(e.stockBefore, 18),
    stockDeployed: n(e.stockDeployed, 18),
    rungs: rungs.map((r) => ({ placed: n(r.stockDeployed, 18), unsold: n(r.stockBack, 18), usdg: n(r.usdgReceived, 6) })),
    usdgReceived: n(e.usdgReceived, 6),
    stockBought: n(e.stockBought, 18),
    pnlStock: n(e.pnlStock, 18),
    feeStock: n(e.feeStock, 18),
  }),
);

// Owner/keeper steps for the onchain sandbox (docs/FINISH.md C3-C5): the parts a user cannot do from the browser.
// Testnet 46630 only, sandbox deployment only (contracts/deployments/sandbox-46630.json, owner = keeper = the dedicated
// test wallet in SANDBOX_PRIVATE_KEY). Every transaction hash is printed and appended to keeper/logs/sandbox-ops.jsonl.
//   npx tsx src/sandboxOps.ts status
//   npx tsx src/sandboxOps.ts fund <stock> <usdg> [to]     mint mock mHIMS / test USDG
//   npx tsx src/sandboxOps.ts feed <usd> [ageSeconds]      post the reference price (MockFeed), optionally backdated
//   npx tsx src/sandboxOps.ts squeeze <usd>                buy from the pool until it trades at <usd> (the weekend buyer)
//   npx tsx src/sandboxOps.ts weekend [seconds]             open the manual clock window (started 2 min ago; default 1 h)
//   npx tsx src/sandboxOps.ts arm | lock | reopen | settle  vault steps (reopen = close the window now)
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, erc20Abi, formatUnits, http, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { slot0, poolIdOf } from "./chain.js";
import { offmintVaultAbi } from "./abi/OffmintVault.js";
import { sqrtPriceX96ToUsd, usdToSqrtPriceX96 } from "./rangeMath.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dep = JSON.parse(readFileSync(join(ROOT, "contracts/deployments/sandbox-46630.json"), "utf8"));
const RPC = process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
const robinhoodTestnet = defineChain({ id: 46630, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pk = process.env.SANDBOX_PRIVATE_KEY as Hex | undefined;
if (!pk) throw new Error("SANDBOX_PRIVATE_KEY not set (dedicated testnet wallet only)");
const account = privateKeyToAccount(pk);
const pub = createPublicClient({ chain: robinhoodTestnet, transport: http(RPC) });
const wallet = createWalletClient({ chain: robinhoodTestnet, transport: http(RPC), account });
if ((await pub.getChainId()) !== 46630) throw new Error("not Robinhood Chain testnet");
if (account.address.toLowerCase() !== String(dep.owner).toLowerCase()) throw new Error("SANDBOX_PRIVATE_KEY is not the sandbox owner");

const D = { feed: 8, stock: 18, usd: 6 };
const s0: boolean = dep.stockIsCurrency0;
const key = { currency0: (s0 ? dep.stock : dep.usdg) as Address, currency1: (s0 ? dep.usdg : dep.stock) as Address, fee: dep.poolFee as number, tickSpacing: dep.tickSpacing as number, hooks: "0x0000000000000000000000000000000000000000" as Address };
const poolId = poolIdOf(key);
const mintAbi = parseAbi(["function mint(address,uint256)"]);
const feedAbi = parseAbi(["function setAnswerAt(int256,uint256)", "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"]);
const clockAbi = parseAbi(["function setWindow(uint256,uint256)", "function closeWindow()", "function start() view returns (uint256)", "function end() view returns (uint256)"]);
const swapAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }",
  "struct TestSettings { bool takeClaims; bool settleUsingBurn; }",
  "function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256)",
]);
const LOG = join(ROOT, "keeper/logs/sandbox-ops.jsonl");
mkdirSync(dirname(LOG), { recursive: true });

async function send(step: string, address: Address, abi: any, functionName: string, args: unknown[]) {
  const hash = await wallet.writeContract({ address, abi, functionName, args, chain: robinhoodTestnet });
  const r = await pub.waitForTransactionReceipt({ hash });
  const row = { ts: new Date().toISOString(), step, fn: functionName, hash, status: r.status, block: r.blockNumber.toString(), explorer: `https://explorer.testnet.chain.robinhood.com/tx/${hash}` };
  appendFileSync(LOG, JSON.stringify(row) + "\n");
  console.log(`${step}: ${functionName} ${r.status} ${row.explorer}`);
  if (r.status !== "success") throw new Error(`${functionName} reverted`);
  return r;
}
const now = async () => Number((await pub.getBlock()).timestamp);
const poolUsd = async () => Number(sqrtPriceX96ToUsd((await slot0(pub as any, poolId, dep.poolManager)).sqrtPriceX96, D, s0)) / 1e8;

const [cmd, ...a] = process.argv.slice(2);
switch (cmd) {
  case "status": {
    const bal = (t: Address) => pub.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
    const [, answer, , updatedAt] = await pub.readContract({ address: dep.feed, abi: feedAbi, functionName: "latestRoundData" });
    const V = { address: dep.vault as Address, abi: offmintVaultAbi } as const;
    console.log(JSON.stringify({
      wallet: account.address,
      eth: formatUnits(await pub.getBalance({ address: account.address }), 18),
      stock: formatUnits(await bal(dep.stock), 18), usdg: formatUnits(await bal(dep.usdg), 6),
      poolUsd: await poolUsd(), referenceUsd: Number(answer) / 1e8, referenceAgeSec: (await now()) - Number(updatedAt),
      clock: { start: Number(await pub.readContract({ address: dep.clock, abi: clockAbi, functionName: "start" })), end: Number(await pub.readContract({ address: dep.clock, abi: clockAbi, functionName: "end" })), now: await now() },
      vault: { state: Number(await pub.readContract({ ...V, functionName: "state" })), totalAssets: formatUnits(await pub.readContract({ ...V, functionName: "totalAssets" }) as bigint, 18) },
    }, null, 1));
    break;
  }
  case "fund": {
    const to = (a[2] ?? account.address) as Address;
    if (Number(a[0]) > 0) await send("fund", dep.stock, mintAbi, "mint", [to, parseUnits(a[0], 18)]);
    if (Number(a[1]) > 0) await send("fund", dep.usdg, mintAbi, "mint", [to, parseUnits(a[1], 6)]);
    break;
  }
  case "feed": {
    const t = (await now()) - Number(a[1] ?? 0);
    await send("feed", dep.feed, feedAbi, "setAnswerAt", [BigInt(Math.round(Number(a[0]) * 1e8)), BigInt(t)]);
    break;
  }
  case "squeeze": {
    // move the pool to <usd>: buyers pay USDG to push it up (the weekend spike), sellers pay tokens to bring it down
    const target = usdToSqrtPriceX96(BigInt(Math.round(Number(a[0]) * 1e8)), D, s0);
    const up = Number(a[0]) > (await poolUsd());
    const payToken = up ? dep.usdg : dep.stock;
    await send("squeeze", payToken, erc20Abi, "approve", [dep.swapRouter, 2n ** 255n]);
    // zeroForOne = pay token0. USDG is token0 when the stock is token1, so buying (up) pays token0 iff !s0.
    const zeroForOne = up ? !s0 : s0;
    await send("squeeze", dep.swapRouter, swapAbi, "swap", [key, { zeroForOne, amountSpecified: -(10n ** 27n), sqrtPriceLimitX96: target }, { takeClaims: false, settleUsingBurn: false }, "0x"]);
    console.log(`pool now $${(await poolUsd()).toFixed(4)}`);
    break;
  }
  case "weekend": {
    const t = await now();
    // the vault stores this window's end at arm and settles >= settleDelay (30 min) after it: keep it short for a demo
    await send("weekend", dep.clock, clockAbi, "setWindow", [BigInt(t - 120), BigInt(t + Number(a[0] ?? 3600))]);
    break;
  }
  case "arm": {
    const ladder = await pub.readContract({ address: dep.vault, abi: offmintVaultAbi, functionName: "defaultLadder" });
    await send("arm", dep.vault, offmintVaultAbi, "arm", [ladder, 3000]);
    break;
  }
  case "lock": await send("lock", dep.vault, offmintVaultAbi, "lock", []); break;
  case "reopen": await send("reopen", dep.clock, clockAbi, "closeWindow", []); break;
  case "settle": await send("settle", dep.vault, offmintVaultAbi, "settle", [0n]); break;
  default: throw new Error("usage: status | fund <stock> <usdg> [to] | feed <usd> [age] | squeeze <usd> | weekend | arm | lock | reopen | settle");
}

// docs/FEATURES.md Feature 3, Step 0 gate: does Uniswap's own PositionManager + Permit2 on Robinhood Chain testnet (46630)
// work with our sandbox pool? Runs the whole personal-sell-order flow against a LOCAL ANVIL FORK of testnet (nothing is
// broadcast): Permit2 approval -> one-sided range above the VERIFIED REFERENCE price (the sandbox's MockFeed, which is
// what our price reference reads on testnet), never above the pool price -> a buyer swap fills it -> collect (decrease +
// burn + take). Case B pushes the pool above the reference first: the +10% order is refused, and a +20% order is still
// anchored to the reference, not to the inflated pool. No new contracts: only Uniswap's deployed ones.
//   anvil --fork-url https://rpc.testnet.chain.robinhood.com --port 8547 --chain-id 46630
//   npx tsx src/sellOrderGate.ts [--rpc http://127.0.0.1:8547]
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, encodeAbiParameters, encodePacked, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { slot0, poolIdOf } from "./chain.js";
import { sqrtPriceX96ToUsd, usdToSqrtPriceX96, liquidityForStock } from "./rangeMath.js";
import { sellOrderRange, SellOrderError } from "./sellOrder.js";
import { getSqrtPriceAtTick } from "./tickMath.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const TESTNET_UNISWAP = {
  positionManager: "0x58daec3116aae6D93017bAAea7749052E8a04fA7" as Address, // poolManager() = our PoolManager, permit2() = canonical
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
};
const ACT = { DECREASE_LIQUIDITY: 0x01, MINT_POSITION: 0x02, BURN_POSITION: 0x03, SETTLE_PAIR: 0x0d, TAKE_PAIR: 0x11 };
const D = { feed: 8, stock: 18, usd: 6 };

const rpc = process.argv.includes("--rpc") ? process.argv[process.argv.indexOf("--rpc") + 1] : "http://127.0.0.1:8547";
const chain = { ...foundry, id: 46630 };
const pub = createPublicClient({ chain, transport: http(rpc) });
const dep = JSON.parse(readFileSync(join(ROOT, "contracts/deployments/46630.json"), "utf8"));
if ((await pub.getChainId()) !== 46630) throw new Error("not a testnet fork");
if (!(await pub.request({ method: "anvil_nodeInfo" as any }).catch(() => null))) throw new Error("refusing: --rpc must be a local anvil fork");

const feedAbi = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)", "function decimals() view returns (uint8)"]);
const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function mint(address,uint256)"]);
const permit2Abi = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const pmAbi = parseAbi([
  "function modifyLiquidities(bytes unlockData, uint256 deadline) payable",
  "function nextTokenId() view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function getPositionLiquidity(uint256) view returns (uint128)",
  "function poolManager() view returns (address)",
  "function permit2() view returns (address)",
]);
const swapAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }",
  "struct TestSettings { bool takeClaims; bool settleUsingBurn; }",
  "function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256)",
]);

const s0: boolean = dep.stockIsCurrency0;
const [c0, c1] = s0 ? [dep.stock, dep.usdg] : [dep.usdg, dep.stock];
const key = { currency0: c0 as Address, currency1: c1 as Address, fee: dep.poolFee as number, tickSpacing: dep.tickSpacing as number, hooks: "0x0000000000000000000000000000000000000000" as Address };
const poolId = poolIdOf(key);
const keyTuple = [{ type: "tuple", components: [{ type: "address", name: "currency0" }, { type: "address", name: "currency1" }, { type: "uint24", name: "fee" }, { type: "int24", name: "tickSpacing" }, { type: "address", name: "hooks" }] }] as const;

// test accounts (fork only): anvil's public default dev keys #0 and #1 (published by Foundry, never funded anywhere
// real); a seller and a weekend buyer. Mock tokens are minted by impersonating their owner.
const seller = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9c86dae88c7a8412f4603b6b78690d");
const w = (a: typeof seller) => createWalletClient({ chain, transport: http(rpc), account: a });
await pub.request({ method: "anvil_impersonateAccount" as any, params: [dep.owner] as any });
await pub.request({ method: "anvil_setBalance" as any, params: [dep.owner, "0x56BC75E2D63100000"] as any });
const owner = createWalletClient({ chain, transport: http(rpc), account: dep.owner as Address });
const send = async (wc: any, address: Address, abi: any, functionName: string, args: unknown[]) => {
  const hash = await wc.writeContract({ address, abi, functionName, args, chain });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted`);
  return r;
};
const bal = (t: Address, who: Address) => pub.readContract({ address: t, abi: erc20, functionName: "balanceOf", args: [who] });
const usd = async () => Number(sqrtPriceX96ToUsd((await slot0(pub, poolId, dep.poolManager)).sqrtPriceX96, D, s0)) / 1e8;

const out: Record<string, unknown> = {};
const pm = TESTNET_UNISWAP.positionManager;
out.positionManager = pm;
out.boundPoolManager = await pub.readContract({ address: pm, abi: pmAbi, functionName: "poolManager" });
out.boundPermit2 = await pub.readContract({ address: pm, abi: pmAbi, functionName: "permit2" });
if (String(out.boundPoolManager).toLowerCase() !== String(dep.poolManager).toLowerCase()) throw new Error("PositionManager is bound to a different PoolManager");

// 1. fund the seller with sandbox HIMS and the buyer with USDG
const amount = 100n * 10n ** 18n;
for (const a of [seller, buyer]) await pub.request({ method: "anvil_setBalance" as any, params: [a.address, "0x56BC75E2D63100000"] as any });
await send(owner, dep.stock, erc20, "mint", [seller.address, amount]);
await send(owner, dep.usdg, erc20, "mint", [buyer.address, 10n ** 12n]);

// 2. Permit2 approval flow: token -> Permit2 (ERC-20 approve), Permit2 -> PositionManager (allowance with expiry)
await send(w(seller), dep.stock, erc20, "approve", [TESTNET_UNISWAP.permit2, 2n ** 256n - 1n]);
await send(w(seller), TESTNET_UNISWAP.permit2, permit2Abi, "approve", [dep.stock, pm, 2n ** 160n - 1n, 2 ** 47]);

// verified reference price: the sandbox feed (the pool price is NOT the reference)
const [, refAnswer] = await pub.readContract({ address: dep.feed, abi: feedAbi, functionName: "latestRoundData" });
const refUsd = Number(refAnswer) / 1e8;
out.referenceUsd = refUsd;
out.poolUsdAtStart = await usd();

const settle = encodeAbiParameters([{ type: "address" }, { type: "address" }], [c0, c1]);
const unlock = (acts: number[], params: Hex[]) => encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [encodePacked(acts.map(() => "uint8"), acts), params]);
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600) + 10n ** 9n; // fork clock may lag; generous
await send(w(buyer), dep.usdg, erc20, "approve", [dep.swapRouter, 2n ** 255n]);
const moveTo = async (priceUsd: number) => {
  const target = usdToSqrtPriceX96(BigInt(Math.round(priceUsd * 1e8)), D, s0);
  const cur = (await slot0(pub, poolId, dep.poolManager)).sqrtPriceX96;
  if (target === cur) return;
  // buyer pays USDG when the target is a higher USD price
  const up = priceUsd > (await usd());
  if (!up) throw new Error("gate only pushes the price up");
  await send(w(buyer), dep.swapRouter, swapAbi, "swap", [key, { zeroForOne: !s0, amountSpecified: -(10n ** 12n), sqrtPriceLimitX96: target }, { takeClaims: false, settleUsingBurn: false }, "0x"]);
};

/** Place a +premium..+premium+width order anchored to the reference, squeeze through it, collect. */
async function cycle(label: string, premiumBps: number, widthBps: number) {
  const { tick } = await slot0(pub, poolId, dep.poolManager);
  const r = sellOrderRange(refAnswer, premiumBps, widthBps, tick, dep.tickSpacing, D, s0);
  const [sa, sb] = [getSqrtPriceAtTick(r.tickLower), getSqrtPriceAtTick(r.tickUpper)];
  const L = liquidityForStock(amount / 2n, sa, sb, s0);
  const [max0, max1] = s0 ? [amount, 0n] : [0n, amount];
  const tokenId = await pub.readContract({ address: pm, abi: pmAbi, functionName: "nextTokenId" });
  const mintParams = encodeAbiParameters(
    [...keyTuple, { type: "int24" }, { type: "int24" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "address" }, { type: "bytes" }],
    [key, r.tickLower, r.tickUpper, L, max0, max1, seller.address, "0x"],
  );
  const before = await bal(dep.stock, seller.address);
  const poolBefore = await usd();
  const rMint = await send(w(seller), pm, pmAbi, "modifyLiquidities", [unlock([ACT.MINT_POSITION, ACT.SETTLE_PAIR], [mintParams, settle]), deadline]);
  const placed = before - (await bal(dep.stock, seller.address));
  const bandUsd = [Number(sqrtPriceX96ToUsd(sa, D, s0)) / 1e8, Number(sqrtPriceX96ToUsd(sb, D, s0)) / 1e8].sort((a, b) => a - b);
  await moveTo(bandUsd[1] * 1.02);
  const liq = await pub.readContract({ address: pm, abi: pmAbi, functionName: "getPositionLiquidity", args: [tokenId] });
  const dec = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }], [tokenId, liq, 0n, 0n, "0x"]);
  const burn = encodeAbiParameters([{ type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }], [tokenId, 0n, 0n, "0x"]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [c0, c1, seller.address]);
  const [st0, us0] = [await bal(dep.stock, seller.address), await bal(dep.usdg, seller.address)];
  const rCollect = await send(w(seller), pm, pmAbi, "modifyLiquidities", [unlock([ACT.DECREASE_LIQUIDITY, ACT.BURN_POSITION, ACT.TAKE_PAIR], [dec, burn, take]), deadline]);
  const stockBack = (await bal(dep.stock, seller.address)) - st0;
  const usdgBack = (await bal(dep.usdg, seller.address)) - us0;
  const res = {
    label, premiumPct: premiumBps / 100, referenceUsd: refUsd, poolUsdAtPlace: poolBefore, bandUsd, bandVsReferencePct: bandUsd.map((b) => Math.round((b / refUsd - 1) * 1e4) / 100),
    tokenId: tokenId.toString(), stockPlaced: Number(placed) / 1e18, stockBack: Number(stockBack) / 1e18, usdgReceived: Number(usdgBack) / 1e6,
    avgSellUsd: Number(usdgBack) / 1e6 / (Number(placed - stockBack) / 1e18), gasMint: rMint.gasUsed.toString(), gasCollect: rCollect.gasUsed.toString(),
    ok: placed > 0n && usdgBack > 0n && stockBack < placed && bandUsd[0] >= refUsd * (1 + premiumBps / 10_000) * 0.999,
  };
  return res;
}

// Case A: pool at the reference; +10..+20% order, anchored to the reference
out.caseA = await cycle("A: pool at the reference", 1000, 1000);
// Case B: the pool is now well above the reference (after case A's squeeze, and pushed to +15% if lower)
if ((await usd()) < refUsd * 1.15) await moveTo(refUsd * 1.15);
const poolB = await usd();
let refused: string | null = null;
try {
  sellOrderRange(refAnswer, 1000, 1000, (await slot0(pub, poolId, dep.poolManager)).tick, dep.tickSpacing, D, s0);
} catch (e) {
  refused = e instanceof SellOrderError ? e.code : String(e);
}
out.caseB = { poolUsd: poolB, poolVsReferencePct: Math.round((poolB / refUsd - 1) * 1e4) / 100, plus10Refused: refused };
const premB = Math.ceil(((poolB / refUsd - 1) * 10_000 + 500) / 100) * 100; // next whole % at least 5 points above the pool
out.caseB2 = await cycle(`B2: pool above the reference; +${premB / 100}% order still anchored to the reference`, premB, 1000);
const pass = (out.caseA as any).ok && refused === "PoolAboveLevel" && (out.caseB2 as any).ok;
out.result = pass
  ? "PASS: PositionManager + Permit2 place, fill and collect sell orders anchored to the verified reference; a level the pool already trades above is refused"
  : "FAIL";
console.log(JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
if (!pass) process.exit(1);

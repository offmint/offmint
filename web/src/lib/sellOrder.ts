// Personal sell order (docs/FEATURES.md Feature 3), testnet only: Uniswap's own PositionManager + Permit2, no Offmint
// contract involved. Addresses and action codes verified in docs/verification/sellorder-gate.md (Step 0 gate).
import { encodeAbiParameters, encodePacked, keccak256, parseAbi, type Address, type Hex } from "viem";
import { addrs } from "@/lib/config";

export const POSITION_MANAGER: Address = "0x58daec3116aae6D93017bAAea7749052E8a04fA7"; // poolManager() = ours
export const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const ACT = { DECREASE_LIQUIDITY: 0x01, MINT_POSITION: 0x02, BURN_POSITION: 0x03, SETTLE_PAIR: 0x0d, TAKE_PAIR: 0x11 };
const ZERO: Address = "0x0000000000000000000000000000000000000000";

export const pmAbi = parseAbi([
  "function modifyLiquidities(bytes unlockData, uint256 deadline) payable",
  "function getPositionLiquidity(uint256) view returns (uint128)",
  "function positionInfo(uint256) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed id)",
]);
export const permit2Abi = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);
export const priceRefAbi = parseAbi(["function read() view returns (uint256 price, uint8 decimals, uint256 updatedAt)"]);
export const pmStateAbi = parseAbi(["function extsload(bytes32) view returns (bytes32)"]);
export const swapAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }",
  "struct TestSettings { bool takeClaims; bool settleUsingBurn; }",
  "function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256)",
]);

const dep = addrs as typeof addrs & { stockIsCurrency0: boolean; poolFee: number; tickSpacing: number; swapRouter: Address };
export const STOCK_IS_0 = dep.stockIsCurrency0;
export const TICK_SPACING = dep.tickSpacing;
export const SWAP_ROUTER = dep.swapRouter;
export const POOL_KEY = {
  currency0: (STOCK_IS_0 ? dep.stock : dep.usdg) as Address,
  currency1: (STOCK_IS_0 ? dep.usdg : dep.stock) as Address,
  fee: dep.poolFee,
  tickSpacing: dep.tickSpacing,
  hooks: ZERO,
};
const keyTuple = { type: "tuple", components: [{ type: "address", name: "currency0" }, { type: "address", name: "currency1" }, { type: "uint24", name: "fee" }, { type: "int24", name: "tickSpacing" }, { type: "address", name: "hooks" }] } as const;
export const POOL_ID = keccak256(encodeAbiParameters([keyTuple], [POOL_KEY]));
/** PoolManager storage slot of the pool's slot0 (pools mapping at slot 6). */
export const SLOT0 = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [POOL_ID, 6n]));
export function decodeSlot0(word: Hex): { sqrtPriceX96: bigint; tick: number } {
  const w = BigInt(word);
  let tick = Number((w >> 160n) & 0xffffffn);
  if (tick >= 1 << 23) tick -= 1 << 24;
  return { sqrtPriceX96: w & ((1n << 160n) - 1n), tick };
}
/** v4-periphery PositionInfo: | 200 bits poolId | 24 tickUpper | 24 tickLower | 8 hasSubscriber | */
export function decodePositionInfo(info: bigint): { tickLower: number; tickUpper: number } {
  const s24 = (x: bigint) => { const n = Number(x & 0xffffffn); return n >= 1 << 23 ? n - (1 << 24) : n; };
  return { tickLower: s24(info >> 8n), tickUpper: s24(info >> 32n) };
}

const unlock = (acts: number[], params: Hex[]) => encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [encodePacked(acts.map(() => "uint8"), acts), params]);
const pair = encodeAbiParameters([{ type: "address" }, { type: "address" }], [POOL_KEY.currency0, POOL_KEY.currency1]);

/** MINT_POSITION + SETTLE_PAIR: a one-sided position holding only the stock. */
export function mintCalldata(tickLower: number, tickUpper: number, liquidity: bigint, stockAmount: bigint, owner: Address): Hex {
  const [max0, max1] = STOCK_IS_0 ? [stockAmount, 0n] : [0n, stockAmount];
  const p = encodeAbiParameters(
    [keyTuple, { type: "int24" }, { type: "int24" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "address" }, { type: "bytes" }],
    [POOL_KEY, tickLower, tickUpper, liquidity, max0, max1, owner, "0x"],
  );
  return unlock([ACT.MINT_POSITION, ACT.SETTLE_PAIR], [p, pair]);
}
/** DECREASE_LIQUIDITY (all) + BURN_POSITION + TAKE_PAIR: USDG received + unsold stock back to `to`. */
export function collectCalldata(tokenId: bigint, liquidity: bigint, to: Address): Hex {
  const dec = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }], [tokenId, liquidity, 0n, 0n, "0x"]);
  const burn = encodeAbiParameters([{ type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }], [tokenId, 0n, 0n, "0x"]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [POOL_KEY.currency0, POOL_KEY.currency1, to]);
  return unlock([ACT.DECREASE_LIQUIDITY, ACT.BURN_POSITION, ACT.TAKE_PAIR], [dec, burn, take]);
}
export const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

/** Order ids placed from this browser (PositionManager is not enumerable). Storage may be unavailable. */
const KEY = "offmint.sellOrders";
export function savedOrders(owner: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(`${KEY}.${owner.toLowerCase()}`) ?? "[]");
  } catch {
    return [];
  }
}
export function saveOrders(owner: string, ids: string[]) {
  try {
    localStorage.setItem(`${KEY}.${owner.toLowerCase()}`, JSON.stringify([...new Set(ids)]));
  } catch {
    /* private window / blocked storage: the order still exists onchain; the user can paste its id */
  }
}

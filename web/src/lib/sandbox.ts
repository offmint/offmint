// In-browser sandbox (docs/DECISIONS.md, sandbox decision 26 Sep): an illustrative weekend run through the SAME engine
// that produced our published replay numbers (keeper/src/poolSim.ts + supplyReplay.ts, generated copies in lib/range).
// Only the market is made up: a synthetic pool and a synthetic weekend of buyers and sellers. The vault's rules are the
// real ones: the contract's default ladder, lock when a step sells out, pull 15 min before reopen, one buyback capped
// at the fresh price + 1%, 10% fee on profit.
import { PoolSim, sqrtAtTick } from "@/lib/range/poolSim";
import { replayWeekend, type PoolEvent, type ModeResult } from "@/lib/range/supplyReplay";
import { usdToSqrtPriceX96, tickToUsd, type Decimals } from "@/lib/range/rangeMath";
import params from "../../public/data/params.json";

const D: Decimals = { feed: 8, stock: 18, usd: 6 };
const S0 = true; // stock is currency0 in the simulated pool (the engine handles both orientations; tested)
const SPACING = 60;
const FEE = 3000; // 0.3% pool fee
const HOUR = 3600;
export const SAT = Date.UTC(2026, 9, 3) / 1000; // an example weekend: Sat 3 Oct 2026 00:00 UTC
export const MON = SAT + 48 * HOUR;

export const DEPTHS = {
  thin: { usdTo10: 5_000, label: "Thin", note: "about $5,000 of buying moves the price 10%: typical for a new listing" },
  medium: { usdTo10: 25_000, label: "Medium", note: "about $25,000 moves it 10%" },
  deep: { usdTo10: 150_000, label: "Deep", note: "about $150,000 moves it 10%: a well-traded token" },
} as const;
export type Depth = keyof typeof DEPTHS;

export interface Scenario { tokens: number; refUsd: number; peakPct: number; reopenPct: number; depth: Depth }
export const PRESETS: Record<string, { label: string; blurb: string; s: Omit<Scenario, "tokens" | "refUsd"> }> = {
  normal: { label: "Normal weekend", blurb: "Buyers and sellers balance out; the price barely moves. This is what happens most weekends.", s: { peakPct: 3, reopenPct: 0.5, depth: "medium" } },
  spike: { label: "Big spike", blurb: "Buyers rush in while nobody can mint new tokens, like HIMS on 29 Aug; Monday opens near the real price.", s: { peakPct: 150, reopenPct: 2, depth: "medium" } },
  bad: { label: "Spike, then Monday opens higher", blurb: "The price jumps and the real stock also rose, so on Monday the vault can't buy back everything within its 1% cap.", s: { peakPct: 40, reopenPct: 30, depth: "thin" } },
};

const Q96 = 2 ** 96;
const sOf = (usd: number) => Number(usdToSqrtPriceX96(BigInt(Math.round(usd * 1e8)), D, S0)) / Q96;
const usdOf = (s: number) => s * s * 1e12;

export interface SandboxRun {
  scenario: Scenario;
  refUsd: number;
  freshUsd: number;
  capUsd: number;
  rungs: { premiumPct: number; fromUsd: number; toUsd: number; tokens: number; soldPct: number; lockedAt: number | null }[];
  deployTokens: number;
  result: ModeResult;
  raw: ModeResult;
  series: { t: number; without: number; withVault: number }[];
  peakWithout: number;
  peakWith: number;
  events: { t: number; text: string }[];
}

/** Build the synthetic weekend and run the real engine on it. Deterministic. */
export function runSandbox(sc: Scenario): SandboxRun {
  const ref = sc.refUsd;
  const Sref = sOf(ref);
  // base liquidity for the chosen depth: USDG needed to move +10% = L * (S(1.1 ref) - S(ref))
  const L = (DEPTHS[sc.depth].usdTo10 * 1e6) / (sOf(ref * 1.1) - Sref);
  const [lo, hi] = [Math.floor(Math.log(sOf(ref / 20) ** 2) / Math.log(1.0001) / SPACING) * SPACING, Math.ceil(Math.log(sOf(ref * 20) ** 2) / Math.log(1.0001) / SPACING) * SPACING];
  const base = [{ tickLower: lo, tickUpper: hi, liquidityDelta: BigInt(Math.round(L)) }];
  // "what happened without Offmint": a generator pool with base liquidity only
  const gen = new PoolSim(Sref);
  gen.modify(lo, hi, L);
  gen.setPrice(Sref);
  const events: PoolEvent[] = [];
  let block = 0n;
  const push = (ts: number, zeroForOne: boolean, amt: number) => {
    if (amt <= 0) return;
    gen.swap(zeroForOne, amt, FEE);
    const a = -BigInt(Math.round(amt));
    events.push({ kind: "swap", block: ++block, logIndex: 0, ts, amount0: zeroForOne ? a : 1n, amount1: zeroForOne ? 1n : a, sqrtPriceX96: BigInt(Math.round(gen.S * Q96)), liquidity: BigInt(Math.round(gen.L)), fee: FEE });
  };
  /** Move the price from where it is to `usd` in `n` equal trades between t0 and t1 (buyers if up, sellers if down). */
  const moveTo = (usd: number, t0: number, t1: number, n: number) => {
    const target = sOf(usd);
    for (let i = 1; i <= n; i++) {
      const s = gen.S + ((target - gen.S) * 1) / (n - i + 1);
      const ts = Math.round(t0 + ((t1 - t0) * i) / n);
      if (s > gen.S) push(ts, false, (gen.L * (s - gen.S)) / (1 - FEE / 1e6)); // buyers pay USDG (token1)
      else if (s < gen.S) push(ts, true, (gen.L * (1 / s - 1 / gen.S)) / (1 - FEE / 1e6)); // sellers pay tokens (token0)
    }
  };
  const peakUsd = ref * (1 + sc.peakPct / 100);
  const freshUsd = ref * (1 + sc.reopenPct / 100);
  moveTo(peakUsd, SAT + 1 * HOUR, SAT + 20 * HOUR, 40); // Saturday: buyers arrive
  moveTo(peakUsd * 0.97, SAT + 20 * HOUR, SAT + 30 * HOUR, 10); // Sunday morning: it hovers
  moveTo(freshUsd, SAT + 30 * HOUR, MON - 1 * HOUR, 30); // Sunday: arbitrage expectations pull it back
  moveTo(freshUsd, MON, MON + HOUR, 4); // Monday: minting is back on, the pool sits at the real price
  const series: SandboxRun["series"] = [{ t: SAT, without: ref, withVault: ref }];
  const run = replayWeekend(
    {
      stockIs0: S0, tickSpacing: SPACING, p0Usd: ref, freshUsd, holdingUsd: sc.tokens * ref, windowStart: SAT, windowEnd: MON,
      armTime: SAT + 300, settleTime: MON + HOUR, armSqrtPriceX96: BigInt(Math.round(Sref * Q96)), baseBefore: base, events,
      settleSqrtPriceX96: BigInt(Math.round(sOf(freshUsd) * Q96)), gasUsd: 0,
      trace: (t, w, v) => series.push({ t, without: w, withVault: v }),
    },
    { rungs: params.ladder, deployBps: params.vault.defaultDeployBps, buybackSlippageBps: params.vault.buybackSlippageBps, perfFeeBps: params.vault.perfFeeBps, lockLead: 15 * 60 },
  );
  const result = run.supply!;
  const raw = run.raw!;
  const rungs = result.rungs.map((r) => {
    const [a, b] = [Number(tickToUsd(r.tickLower, D, S0)), Number(tickToUsd(r.tickUpper, D, S0))].map((x) => x / 1e8).sort((x, y) => x - y);
    return { premiumPct: r.premiumBps / 100, fromUsd: a, toUsd: b, tokens: r.stockPlaced, soldPct: r.soldPct, lockedAt: r.lockedAt };
  });
  const ev: SandboxRun["events"] = [];
  for (const r of rungs) if (r.lockedAt !== null && r.lockedAt < MON - 15 * 60 && r.soldPct >= 99.9) ev.push({ t: r.lockedAt, text: `Step +${r.premiumPct}% sold out and was pulled` });
  ev.push({ t: MON - 15 * 60, text: "15 min before reopen: every step still in the pool is pulled" });
  return {
    scenario: sc, refUsd: ref, freshUsd, capUsd: freshUsd * (1 + params.vault.buybackSlippageBps / 10_000), rungs,
    deployTokens: result.stockDeployed, result, raw, series,
    peakWithout: Math.max(...series.map((p) => p.without)), peakWith: Math.max(...series.map((p) => p.withVault)),
    events: ev.sort((a, b) => a.t - b.t),
  };
}
export { sqrtAtTick, usdOf };

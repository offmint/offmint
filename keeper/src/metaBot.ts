// MetaVault keeper (SPEC §6.5.2): snapshot -> metaDecide() -> simulate -> send -> log, one action per tick.
// Picks come from the latest SELECT output (select.ts) mapped to stocks that have a MetaVault instance in the factory;
// META_PICKS=0xstock,... overrides them (testnet demo: the mock stock has no mainnet SELECT score).
// META_BUYIN_OPEN=1 opens BUY-IN regardless of weekday (testnet demo clock); otherwise Wed/Thu UTC only.
// META_COMMIT_LEAD=<seconds> shortens the Friday commit lead for a real-time demo weekend (default 6h).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { metaVaultAbi } from "./abi/MetaVault.js";
import { vaultFactoryAbi } from "./abi/VaultFactory.js";
import { offmintVaultAbi } from "./abi/OffmintVault.js";
import { sessionClockAbi } from "./abi/ISessionClock.js";
import { slot0, poolIdOf } from "./chain.js";
import { sqrtPriceX96ToUsd } from "./rangeMath.js";
import { STATE } from "./decide.js";
import { metaDecide, realBuyInOpen, META_POLICY, PHASE, type MetaSnapshot, type StockView } from "./metaDecide.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const refAbi = parseAbi(["function read() view returns (uint256 price, uint8 decimals, uint256 updatedAt)"]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"]);

/** Latest SELECT picks as stock addresses (lowercased), best first. */
export function latestPicks(logDir = process.env.LOG_DIR ?? join(ROOT, "keeper/logs")): string[] {
  if (process.env.META_PICKS) return process.env.META_PICKS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!existsSync(logDir)) return [];
  const f = readdirSync(logDir).filter((n) => /^select-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().at(-1);
  if (!f) return [];
  const doc = JSON.parse(readFileSync(join(logDir, f), "utf8"));
  const byTicker = new Map((doc.scored ?? []).map((s: any) => [s.ticker, s.token.toLowerCase()]));
  return (doc.picks ?? []).map((t: string) => byTicker.get(t)).filter(Boolean) as string[];
}

export async function createMetaBot(o: { rpc: string; pk: Hex; deploymentPath: string; log: (x: Record<string, unknown>) => void }) {
  const dep = JSON.parse(readFileSync(o.deploymentPath, "utf8"));
  const metaAddr = dep.metaVault as Address;
  const probe = createPublicClient({ transport: http(o.rpc) });
  const chain = defineChain({
    id: await probe.getChainId(),
    name: "offmint-target",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [o.rpc] } },
  });
  const transport = () => http(o.rpc, { retryCount: 8, retryDelay: 1_500, timeout: 45_000 });
  const pub = createPublicClient({ chain, transport: transport() });
  const account = privateKeyToAccount(o.pk);
  const wallet = createWalletClient({ chain, transport: transport(), account });
  const m = { address: metaAddr, abi: metaVaultAbi } as const;
  const [clock, registry, usdg] = await Promise.all([
    pub.readContract({ ...m, functionName: "clock" }),
    pub.readContract({ ...m, functionName: "registry" }),
    pub.readContract({ ...m, functionName: "asset" }),
  ]);
  const usdDec = Number(await pub.readContract({ address: usdg, abi: erc20, functionName: "decimals" }));
  const lastUnwindTry: Record<string, number> = {};
  o.log({ event: "meta-bot-start", metaVault: metaAddr, keeper: account.address });

  async function stockView(stock: Address): Promise<StockView | null> {
    const inst = await pub.readContract({ address: registry, abi: vaultFactoryAbi, functionName: "vaultFor", args: [stock, metaAddr] });
    if (/^0x0{40}$/i.test(inst)) return null;
    const v = { address: inst, abi: offmintVaultAbi } as const;
    const [st, key, s0, ref, pm, bl, sDec] = await Promise.all([
      pub.readContract({ ...v, functionName: "state" }),
      pub.readContract({ ...v, functionName: "poolKey" }),
      pub.readContract({ ...v, functionName: "stockIsCurrency0" }),
      pub.readContract({ ...v, functionName: "priceRef" }),
      pub.readContract({ ...v, functionName: "poolManager" }),
      pub.readContract({ ...m, functionName: "isBlacklisted", args: [stock] }),
      pub.readContract({ address: stock, abi: erc20, functionName: "decimals" }),
    ]);
    let r: StockView["ref"] = null;
    let pd = 8;
    try {
      const [price, d, updatedAt] = await pub.readContract({ address: ref, abi: refAbi, functionName: "read" });
      r = { price, updatedAt: Number(updatedAt) };
      pd = d;
    } catch {
      // reverting reference = paused / halted / sequencer down
    }
    const { sqrtPriceX96 } = await slot0(pub, poolIdOf(key), pm);
    return {
      stock,
      ref: r,
      poolUsd: sqrtPriceX96ToUsd(sqrtPriceX96, { feed: pd, stock: Number(sDec), usd: usdDec }, s0),
      subState: STATE[st],
      blacklisted: bl,
    };
  }

  async function snapshot(): Promise<MetaSnapshot> {
    const now = Number((await pub.getBlock()).timestamp);
    const ahead = BigInt(now + 7 * 86400);
    const c = { address: clock, abi: sessionClockAbi } as const;
    const [params, count, base, cwe, open, bal, inWindow, us, ue] = await Promise.all([
      pub.readContract({ ...m, functionName: "getParams" }),
      pub.readContract({ ...m, functionName: "openPositionCount" }),
      pub.readContract({ ...m, functionName: "cycleBase" }),
      pub.readContract({ ...m, functionName: "cycleWeekendEnd" }),
      pub.readContract({ ...m, functionName: "openPositions" }),
      pub.readContract({ address: usdg, abi: erc20, functionName: "balanceOf", args: [metaAddr] }),
      pub.readContract({ ...c, functionName: "inWeekendWindow", args: [BigInt(now)] }),
      pub.readContract({ ...c, functionName: "windowStart", args: [ahead] }),
      pub.readContract({ ...c, functionName: "windowEnd", args: [ahead] }),
    ]);
    const positions = await Promise.all(
      open.map(async (s) => {
        const p = await pub.readContract({ ...m, functionName: "position", args: [s] });
        return { stock: s.toLowerCase(), phase: PHASE[p.phase], weekendEnd: Number(p.weekendEnd), buyInPrice: p.buyInPrice };
      }),
    );
    const picks = latestPicks();
    const stocks: Record<string, StockView> = {};
    for (const s of new Set([...positions.map((p) => p.stock), ...picks])) {
      const view = await stockView(s as Address);
      if (view) stocks[s] = view;
    }
    return {
      now,
      inWindow,
      upcoming: { start: Number(us), end: Number(ue) },
      params: {
        maxConcurrent: params.maxConcurrent,
        allocBps: params.allocBps,
        buyInSlippageBps: params.buyInSlippageBps,
        earlyUnwindThresholdBps: params.earlyUnwindThresholdBps,
        maxRefAge: Number(params.maxRefAge),
      },
      usdgBalance: bal,
      openPositionCount: Number(count),
      cycleBase: base,
      cycleWeekendEnd: Number(cwe),
      positions,
      stocks,
      picks: picks.filter((p) => stocks[p]),
      lastUnwindTry,
    };
  }

  async function tick() {
    const s = await snapshot();
    const d = metaDecide(s, {
      buyInOpen: process.env.META_BUYIN_OPEN === "1" || realBuyInOpen(s.now),
      commitLead: Number(process.env.META_COMMIT_LEAD ?? META_POLICY.commitLead),
    });
    o.log({ event: "tick", instance: "metaVault", open: s.openPositionCount, usdg: s.usdgBalance, picks: s.picks.length, action: d.action, reason: d.reason, now: s.now });
    if (d.action === "none") return { decision: d };
    const args = d.action === "buyIn" ? [d.stock, d.amount] : [d.stock];
    try {
      const { request } = await pub.simulateContract({ ...m, account, functionName: d.action, args: args as any });
      const hash = await wallet.writeContract(request as any);
      const rcpt = await pub.waitForTransactionReceipt({ hash });
      if (d.action === "unwind") lastUnwindTry[d.stock.toLowerCase()] = s.now;
      o.log({ event: "tx", instance: "metaVault", action: d.action, args, reason: d.reason, hash, status: rcpt.status, gasUsed: rcpt.gasUsed });
      return { decision: d, tx: { hash, status: rcpt.status } };
    } catch (e: any) {
      if (d.action === "unwind") lastUnwindTry[d.stock.toLowerCase()] = s.now;
      const msg = String(e?.shortMessage ?? e).slice(0, 400);
      o.log({ level: "error", instance: "metaVault", action: d.action, msg });
      return { decision: d, error: msg };
    }
  }
  return { tick, snapshot };
}

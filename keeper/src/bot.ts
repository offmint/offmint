// Offmint keeper bot (SPEC §8): arm / lock / settle / retryBuyback / emergencyUnwind / expireBuyback.
//   RPC_URL=... KEEPER_PRIVATE_KEY=0x... npm run bot -- --deployment ../contracts/deployments/46630.json [--once]
// Every tick: snapshot -> decide() -> simulate -> send -> wait -> log (JSON lines, keeper/logs/bot-<date>.jsonl).
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { offmintVaultAbi } from "./abi/OffmintVault.js";
import { sessionClockAbi } from "./abi/ISessionClock.js";
import { slot0, poolIdOf } from "./chain.js";
import { decide, STATE, type Decision, type KeeperPolicy, type Snapshot } from "./decide.js";
import { iso, isoDate } from "./clock.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const refAbi = parseAbi(["function read() view returns (uint256 price, uint8 decimals, uint256 updatedAt)"]);
const stockAbi = parseAbi([
  "function oraclePaused() view returns (bool)",
  "function uiMultiplier() view returns (uint256)",
  "function newUIMultiplier() view returns (uint256)",
  "function effectiveAt() view returns (uint256)",
  "function symbol() view returns (string)",
]);

function logLine(o: Record<string, unknown>) {
  const line = JSON.stringify({ ts: iso(Math.floor(Date.now() / 1000)), ...o }, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  console.log(line);
  try {
    mkdirSync(join(ROOT, "keeper/logs"), { recursive: true });
    appendFileSync(join(ROOT, `keeper/logs/bot-${isoDate(Math.floor(Date.now() / 1000))}.jsonl`), line + "\n");
  } catch {}
}

async function notify(text: string) {
  const url = process.env.TELEGRAM_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  } catch {}
}

export interface BotOptions {
  rpc: string;
  pk: Hex;
  deploymentPath: string;
  policy?: KeeperPolicy;
  /** Sink for log records (default: stdout + keeper/logs). */
  log?: (o: Record<string, unknown>) => void;
  quiet?: boolean;
}

/** Builds a keeper bound to one vault deployment. `tick()` runs one snapshot -> decide -> execute cycle. */
export async function createBot(o: BotOptions) {
  const log = o.log ?? logLine;
  const { rpc, pk } = o;
  const dep = JSON.parse(readFileSync(o.deploymentPath, "utf8"));
  const vault = dep.vault as Address;
  const policy: KeeperPolicy = o.policy ?? JSON.parse(readFileSync(join(ROOT, "keeper/policy.json"), "utf8"));

  const probe = createPublicClient({ transport: http(rpc) });
  const chain = defineChain({
    id: await probe.getChainId(),
    name: "offmint-target",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  // public RPCs drop connections (e.g. TLS BadRecordMac on Robinhood testnet): retry generously
  const transport = () => http(rpc, { retryCount: 8, retryDelay: 1_500, timeout: 45_000 });
  const pub = createPublicClient({ chain, transport: transport() });
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ chain, transport: transport(), account });

  const v = { address: vault, abi: offmintVaultAbi } as const;
  const [stock, clock, priceRef, pm, key, s0, onchainKeeper] = await Promise.all([
    pub.readContract({ ...v, functionName: "asset" }),
    pub.readContract({ ...v, functionName: "clock" }),
    pub.readContract({ ...v, functionName: "priceRef" }),
    pub.readContract({ ...v, functionName: "poolManager" }),
    pub.readContract({ ...v, functionName: "poolKey" }),
    pub.readContract({ ...v, functionName: "stockIsCurrency0" }),
    pub.readContract({ ...v, functionName: "keeper" }),
  ]);
  const ticker = dep.ticker ?? (await pub.readContract({ address: stock, abi: stockAbi, functionName: "symbol" }));
  const poolId = poolIdOf(key);
  if (onchainKeeper.toLowerCase() !== account.address.toLowerCase()) {
    log({ level: "warn", msg: "this key is not the vault keeper: only permissionless calls (after grace) will succeed", keeper: onchainKeeper, me: account.address });
  }
  if (!o.quiet) log({ event: "bot-start", chainId: chain.id, vault, ticker, keeper: account.address });

  let lastRetryAt = 0;

  async function snapshot(): Promise<Snapshot> {
    const now = Number((await pub.getBlock()).timestamp);
    const nowB = BigInt(now);
    const c = { address: clock as Address, abi: sessionClockAbi } as const;
    const [st, params, ladder, inWindow, ws, we, pool, epoch] = await Promise.all([
      pub.readContract({ ...v, functionName: "state" }),
      pub.readContract({ ...v, functionName: "getParams" }),
      pub.readContract({ ...v, functionName: "defaultLadder" }),
      pub.readContract({ ...c, functionName: "inWeekendWindow", args: [nowB] }),
      pub.readContract({ ...c, functionName: "windowStart", args: [nowB] }),
      pub.readContract({ ...c, functionName: "windowEnd", args: [nowB] }),
      slot0(pub, poolId, pm),
      pub.readContract({ ...v, functionName: "currentEpoch" }),
    ]);
    const rungs = epoch.id > 0n ? await pub.readContract({ ...v, functionName: "epochRungs", args: [epoch.id] }) : [];
    // the vault's price reference reverts when unhealthy (issuer pause, halt flag, sequencer): treat as paused
    let price = { answer: 0n, updatedAt: 0 };
    let paused = false;
    try {
      const [answer, , updatedAt] = await pub.readContract({ address: priceRef as Address, abi: refAbi, functionName: "read" });
      price = { answer, updatedAt: Number(updatedAt) };
    } catch {
      paused = true;
    }
    let corporateActionAt: number | null = null;
    try {
      const [cur, next, at] = await Promise.all([
        pub.readContract({ address: stock, abi: stockAbi, functionName: "uiMultiplier" }),
        pub.readContract({ address: stock, abi: stockAbi, functionName: "newUIMultiplier" }),
        pub.readContract({ address: stock, abi: stockAbi, functionName: "effectiveAt" }),
      ]);
      if (at > 0n && next !== cur) corporateActionAt = Number(at);
    } catch {
      // mock stock tokens don't implement the ERC-8056 multiplier schedule
    }
    return {
      now,
      ticker,
      state: STATE[st],
      params: {
        defaultLadder: ladder.map((r) => ({ premiumBps: r.premiumBps, widthBps: r.widthBps, shareBps: r.shareBps })),
        defaultDeployBps: params.defaultDeployBps,
        armDelay: params.armDelay,
        minFrozen: params.minFrozen,
        maxPreCloseAge: params.maxPreCloseAge,
        settleDelay: params.settleDelay,
        maxFreshAge: params.maxFreshAge,
      },
      clock: { inWindow, windowStart: Number(ws), windowEnd: Number(we) },
      feed: price,
      oraclePaused: paused,
      stockIsCurrency0: s0,
      poolTick: pool.tick,
      epoch: {
        id: Number(epoch.id),
        armedAt: Number(epoch.armedAt),
        windowEnd: Number(epoch.windowEnd),
        settledAt: Number(epoch.settledAt),
        rungs: rungs.map((r) => ({ tickLower: r.tickLower, tickUpper: r.tickUpper, removed: r.removed })),
      },
      corporateActionAt,
      lastRetryAt,
    };
  }

  async function execute(d: Exclude<Decision, { action: "none" }>): Promise<{ hash: Hex; gasUsed: bigint; status: string }> {
    let args: readonly unknown[] = [];
    if (d.action === "arm") args = d.args;
    if (d.action === "settle" || d.action === "retryBuyback") {
      // quote the buyback by simulating with no floor, then protect the real call with 99.5% of the quote
      const sim = await pub.simulateContract({ ...v, account, functionName: d.action, args: [0n] });
      args = [(sim.result * 995n) / 1000n];
    }
    const { request } = await pub.simulateContract({ ...v, account, functionName: d.action as any, args: args as any });
    const hash = await wallet.writeContract(request as any);
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (d.action === "retryBuyback") lastRetryAt = Number((await pub.getBlock()).timestamp);
    const after = STATE[await pub.readContract({ ...v, functionName: "state" })];
    log({ event: "tx", action: d.action, args, reason: d.reason, hash, status: rcpt.status, gasUsed: rcpt.gasUsed, stateAfter: after });
    await notify(`Offmint ${ticker}: ${d.action} (${d.reason}) -> ${after} ${hash}`);
    return { hash, gasUsed: rcpt.gasUsed, status: rcpt.status };
  }

  async function tick(): Promise<{ decision: Decision; tx?: { hash: Hex; gasUsed: bigint; status: string }; error?: string }> {
    const s = await snapshot();
    const d = decide(s, policy);
    if (!o.quiet) log({ event: "tick", state: s.state, action: d.action, reason: d.reason, poolTick: s.poolTick, feedUpdatedAt: s.feed.updatedAt, now: s.now });
    if (d.action === "none") return { decision: d };
    try {
      return { decision: d, tx: await execute(d) };
    } catch (e: any) {
      const msg = String(e?.shortMessage ?? e).slice(0, 400);
      log({ level: "error", action: d.action, msg });
      if (d.action === "retryBuyback") lastRetryAt = s.now;
      return { decision: d, error: msg };
    }
  }

  return { tick, snapshot, account, vault, pub };
}

export async function main(argv = process.argv.slice(2)) {
  const opt = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const rpc = process.env.RPC_URL ?? process.env.RH_TESTNET_RPC;
  const pk = process.env.KEEPER_PRIVATE_KEY as Hex | undefined;
  if (!rpc || !pk) throw new Error("set RPC_URL and KEEPER_PRIVATE_KEY");
  const bot = await createBot({
    rpc,
    pk,
    deploymentPath: resolve(opt("--deployment") ?? join(ROOT, "contracts/deployments/46630.json")),
  });
  if (argv.includes("--once")) return bot.tick();
  const interval = Number(opt("--interval") ?? 60) * 1000;
  for (;;) {
    try {
      await bot.tick();
    } catch (e) {
      logLine({ level: "error", msg: String(e).slice(0, 400) });
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

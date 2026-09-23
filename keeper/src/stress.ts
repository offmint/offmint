// Stress test: many full weekends back-to-back on a fresh local anvil chain, with time warps instead of waiting.
// Same contracts, same Deploy.s.sol, same keeper bot as testnet. Random scenarios + many depositors; safety
// invariants are asserted after every step. Writes a JSON report.
//   npm run stress -w keeper -- --epochs 40 --users 12 --seed 7
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { offmintVaultAbi } from "./abi/OffmintVault.js";
import { createBot } from "./bot.js";
import { poolIdOf, slot0 } from "./chain.js";
import { usdToSqrtPriceX96, sqrtPriceX96ToUsd } from "./rangeMath.js";
import { STATE } from "./decide.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FOUNDRY = join(process.env.HOME ?? "", ".foundry/bin");
const DEPLOYER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex; // anvil #0
const KEEPER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex; // anvil #1
const FEE_TO = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address; // anvil #2
const D = { feed: 8, stock: 18, usd: 6 };

const args = process.argv.slice(2);
const opt = (k: string, d: number) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
const EPOCHS = opt("--epochs", 40);
const USERS = opt("--users", 12);
const PORT = opt("--port", 8548);
let seed = opt("--seed", 7);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31); // deterministic LCG
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function mint(address,uint256)",
]);
const feedAbi = parseAbi(["function setAnswer(int256)", "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"]);
const clockAbi = parseAbi(["function openWindow(uint256)", "function end() view returns (uint256)"]);
const swapAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }",
  "struct TestSettings { bool takeClaims; bool settleUsingBurn; }",
  "function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256)",
]);

type Scenario = "squeeze" | "partial" | "quiet" | "gapUp" | "staleOracle";
const SCENARIOS: Scenario[] = ["squeeze", "squeeze", "partial", "quiet", "gapUp", "staleOracle"];

async function main() {
  const rpc = `http://127.0.0.1:${PORT}`;
  const anvil: ChildProcess = spawn(join(FOUNDRY, "anvil"), ["--silent", "--port", String(PORT), "--accounts", "3"], { stdio: "ignore" });
  const t0 = Date.now();
  try {
    const pub = createPublicClient({ chain: foundry, transport: http(rpc) });
    for (let i = 0; i < 50; i++) {
      try {
        await pub.getChainId();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    // ------------------------------------------------------------------ deploy with the real script
    const depPath = join(ROOT, "contracts/deployments/31337.json");
    execFileSync(join(FOUNDRY, "forge"), ["script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast"], {
      cwd: join(ROOT, "contracts"),
      env: { ...process.env, DEPLOYER_PRIVATE_KEY: DEPLOYER_PK, KEEPER_ADDRESS: privateKeyToAccount(KEEPER_PK).address, FEE_RECIPIENT: FEE_TO },
      stdio: "ignore",
    });
    const dep = JSON.parse(readFileSync(depPath, "utf8"));
    const vault = dep.vault as Address;
    const deployer = createWalletClient({ chain: foundry, transport: http(rpc), account: privateKeyToAccount(DEPLOYER_PK) });
    const s0: boolean = dep.stockIsCurrency0;
    const key = {
      currency0: (s0 ? dep.stock : dep.usdg) as Address,
      currency1: (s0 ? dep.usdg : dep.stock) as Address,
      fee: Number(dep.poolFee),
      tickSpacing: Number(dep.tickSpacing),
      hooks: "0x0000000000000000000000000000000000000000" as Address,
    };
    const poolId = poolIdOf(key);
    const bot = await createBot({ rpc, pk: KEEPER_PK, deploymentPath: depPath, quiet: true, log: () => {} });

    const send = async (address: Address, abi: any, functionName: string, a: unknown[], wallet = deployer) => {
      const hash = await wallet.writeContract({ address, abi, functionName, args: a } as any);
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error(`${functionName} reverted`);
    };
    const warp = async (sec: number) => {
      await pub.request({ method: "evm_increaseTime" as any, params: [sec] as any });
      await pub.request({ method: "evm_mine" as any, params: [] as any });
    };
    // independent market maker / weekend buyer, so the owner's balances stay a clean invariant
    const mmPk = keccak256(toHex("offmint-stress-market"));
    const market = createWalletClient({ chain: foundry, transport: http(rpc), account: privateKeyToAccount(mmPk) });
    await pub.request({ method: "anvil_setBalance" as any, params: [market.account.address, "0x56BC75E2D63100000"] as any });
    const poolUsd = async () => Number(sqrtPriceX96ToUsd((await slot0(pub, poolId, dep.poolManager)).sqrtPriceX96, D, s0)) / 1e8;
    let marketReady = false;
    const moveTo = async (usd: number) => {
      if (!marketReady) {
        await send(dep.stock, erc20, "mint", [market.account.address, 10n ** 27n]);
        await send(dep.usdg, erc20, "mint", [market.account.address, 10n ** 16n]);
        await send(dep.stock, erc20, "approve", [dep.swapRouter, 2n ** 255n], market);
        await send(dep.usdg, erc20, "approve", [dep.swapRouter, 2n ** 255n], market);
        marketReady = true;
      }
      const target = usdToSqrtPriceX96(BigInt(Math.round(usd * 1e8)), D, s0);
      const cur = (await slot0(pub, poolId, dep.poolManager)).sqrtPriceX96;
      if (target === cur) return;
      await send(dep.swapRouter, swapAbi, "swap", [
        key,
        { zeroForOne: target < cur, amountSpecified: -(10n ** 30n), sqrtPriceLimitX96: target },
        { takeClaims: false, settleUsingBurn: false },
        "0x",
      ], market);
    };
    const v = (fn: string, a: unknown[] = []) => pub.readContract({ address: vault, abi: offmintVaultAbi, functionName: fn as any, args: a as any }) as Promise<any>;
    const state = async () => STATE[Number(await v("state"))];
    const bal = (token: Address, who: Address) => pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [who] });


    // ------------------------------------------------------------------ depositors
    const users = Array.from({ length: USERS }, (_, i) => {
      const pk = keccak256(toHex(`offmint-stress-user-${i}`));
      return { account: privateKeyToAccount(pk), wallet: createWalletClient({ chain: foundry, transport: http(rpc), account: privateKeyToAccount(pk) }) };
    });
    for (const u of users) {
      await pub.request({ method: "anvil_setBalance" as any, params: [u.account.address, "0x56BC75E2D63100000"] as any });
      await send(dep.stock, erc20, "mint", [u.account.address, 10_000n * 10n ** 18n]);
      await send(dep.stock, erc20, "approve", [vault, 2n ** 255n], u.wallet);
    }

    // ------------------------------------------------------------------ invariants
    const ownerAddr = deployer.account.address;
    const keeperAddr = bot.account.address;
    const watch0 = {
      ownerStock: await bal(dep.stock, ownerAddr),
      ownerUsdg: await bal(dep.usdg, ownerAddr),
      keeperStock: await bal(dep.stock, keeperAddr),
      keeperUsdg: await bal(dep.usdg, keeperAddr),
    };
    const violations: string[] = [];
    const check = async (where: string, supplyAtArm?: bigint) => {
      const st = await state();
      if ((await bal(dep.stock, keeperAddr)) !== watch0.keeperStock || (await bal(dep.usdg, keeperAddr)) !== watch0.keeperUsdg) violations.push(`${where}: keeper balance changed`);
      if ((await bal(dep.stock, ownerAddr)) !== watch0.ownerStock || (await bal(dep.usdg, ownerAddr)) !== watch0.ownerUsdg) violations.push(`${where}: owner balance changed`);
      if (st === "OPEN" && (await bal(dep.usdg, vault)) > 100n) violations.push(`${where}: USDG left in OPEN`);
      if (st !== "OPEN" && ((await v("maxDeposit", [ownerAddr])) > 0n || (await v("maxRedeem", [users[0].account.address])) > 0n)) violations.push(`${where}: gating broken in ${st}`);
      if (supplyAtArm !== undefined && (st === "ARMED" || st === "PENDING_BUYBACK") && (await v("totalSupply")) !== supplyAtArm) violations.push(`${where}: supply moved while ${st}`);
    };

    // ------------------------------------------------------------------ epochs
    const epochs: any[] = [];
    const gas: Record<string, bigint[]> = {};
    const botStep = async (expect?: string) => {
      const r = await bot.tick();
      if (r.tx) (gas[r.decision.action] ??= []).push(r.tx.gasUsed);
      if (r.error) violations.push(`bot ${r.decision.action} failed: ${r.error}`);
      if (expect && r.decision.action !== expect) throw new Error(`expected bot to ${expect}, got ${r.decision.action} (${r.decision.reason})`);
      return r.decision.action;
    };
    const BASE = 28.84;
    let price = BASE;
    let deposits = 0;
    let redeems = 0;

    for (let e = 1; e <= EPOCHS; e++) {
      // weekday: random deposits / partial exits (only possible while OPEN)
      for (const u of (await state()) === "OPEN" ? users : []) {
        const r = rand();
        if (r < 0.35) {
          await send(vault, offmintVaultAbi, "deposit", [BigInt(Math.floor(1 + rand() * 300)) * 10n ** 18n, u.account.address], u.wallet);
          deposits++;
        } else if (r < 0.5) {
          const sh: bigint = await v("balanceOf", [u.account.address]);
          if (sh > 0n) {
            await send(vault, offmintVaultAbi, "redeem", [(sh * BigInt(Math.floor(10 + rand() * 90))) / 100n, u.account.address, u.account.address], u.wallet);
            redeems++;
          }
        }
      }
      await check(`e${e} weekday`);
      const scenario = pick(SCENARIOS);
      const pps0: bigint = await v("convertToAssets", [10n ** 21n]);
      const assets0: bigint = await v("totalAssets");

      await send(dep.feed, feedAbi, "setAnswer", [BigInt(Math.round((await poolUsd()) * 1e8))]);
      await warp(360);
      await send(dep.clock, clockAbi, "openWindow", [2400n]);
      await warp(90);
      await botStep("arm");
      const supplyAtArm: bigint = await v("totalSupply");
      await check(`e${e} armed`, supplyAtArm);

      let peak = price;
      if (scenario === "squeeze" || scenario === "gapUp") peak = price * (1.65 + rand() * 0.6);
      else if (scenario === "partial") peak = price * (1.12 + rand() * 0.3);
      if (peak !== price) {
        await moveTo(peak);
        await botStep(); // locks if the band was cleared
      }
      // weekend chop (can reverse fills if not locked)
      if (scenario === "partial") await moveTo(price * (1.02 + rand() * 0.05));
      await check(`e${e} weekend`, supplyAtArm);

      await warp(2400);
      // weekly level is noise around $28.84 (+/-15%) so the walk stays inside the seeded liquidity ($9.6-$86.5)
      let fresh = BASE * (0.85 + rand() * 0.3);
      if (scenario === "gapUp") fresh = price * 1.3; // stock really gapped up; pool stays far above the cap
      else await moveTo(fresh);
      if (scenario !== "staleOracle") await send(dep.feed, feedAbi, "setAnswer", [BigInt(Math.round(fresh * 1e8))]);
      await warp(1860);
      await botStep();
      await check(`e${e} settle`, supplyAtArm);

      const path: string[] = [await state()];
      if (scenario === "staleOracle") {
        await warp(96 * 3600);
        await botStep("emergencyUnwind");
        path.push(await state());
        if ((await state()) === "PENDING_BUYBACK") {
          await warp(48 * 3600 + 60);
          await botStep("expireBuyback");
          path.push(await state());
          // one depositor exits pro-rata in STOCK + USDG
          const u = users[Math.floor(rand() * users.length)];
          const sh: bigint = await v("balanceOf", [u.account.address]);
          if (sh > 0n) await send(vault, offmintVaultAbi, "redeemMixed", [sh / 2n, u.account.address], u.wallet);
          await moveTo(fresh);
          await send(dep.feed, feedAbi, "setAnswer", [BigInt(Math.round(fresh * 1e8))]);
          await warp(60);
          await botStep("retryBuyback");
          path.push(await state());
        }
      }
      // sellers keep arriving: each round arbitrage refills the pool back to the fresh price, the oracle prints
      // again and the bot retries. Large buybacks need several rounds because each stops at feed * 1.01.
      let rounds = 0;
      while ((await state()) === "PENDING_BUYBACK" && rounds < 40) {
        await moveTo(fresh);
        await warp(16 * 60);
        await send(dep.feed, feedAbi, "setAnswer", [BigInt(Math.round(fresh * 1e8))]);
        await botStep("retryBuyback");
        rounds++;
      }
      if (rounds) path.push(`${await state()}(${rounds} retries)`);
      if ((await state()) === "PENDING_BUYBACK") {
        // designed escape hatch: expire -> OPEN_MIXED (pro-rata exits) -> a later fresh retry restores OPEN
        await warp(48 * 3600 + 60);
        await botStep("expireBuyback");
        path.push(await state());
        await moveTo(fresh);
        await send(dep.feed, feedAbi, "setAnswer", [BigInt(Math.round(fresh * 1e8))]);
        await botStep("retryBuyback");
        path.push(await state());
      }
      await check(`e${e} end`);
      const ep = await v("currentEpoch");
      const pps1: bigint = await v("convertToAssets", [10n ** 21n]);
      epochs.push({
        epoch: e,
        scenario,
        p0: Number(ep.p0) / 1e8,
        peakUsd: Math.round(peak * 100) / 100,
        mondayUsd: Math.round(fresh * 100) / 100,
        locked: ep.locked,
        path,
        stockDeployed: Number(ep.stockDeployed) / 1e18,
        usdgReceived: Number(ep.usdgReceived) / 1e6,
        stockBought: Number(ep.stockBought) / 1e18,
        pnlStock: Number(ep.pnlStock) / 1e18,
        feeStock: Number(ep.feeStock) / 1e18,
        ppsChangePct: Math.round((Number(pps1 - pps0) / Number(pps0)) * 1e6) / 1e4,
        totalAssets: Number(assets0) / 1e18,
      });
      price = scenario === "gapUp" ? BASE : fresh; // gap-ups mean-revert the following week
      process.stdout.write(`e${e} ${scenario.padEnd(11)} ${path.join(">").padEnd(40)} pps ${epochs.at(-1).ppsChangePct}%\n`);
    }

    // ------------------------------------------------------------------ report
    const by = (s: Scenario) => epochs.filter((x) => x.scenario === s);
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1e4) / 1e4 : null);
    const gasSummary = Object.fromEntries(
      Object.entries(gas).map(([k, g]) => [k, { calls: g.length, avg: Math.round(g.reduce((a, b) => a + Number(b), 0) / g.length), max: Math.max(...g.map(Number)) }]),
    );
    const report = {
      generatedAt: new Date().toISOString(),
      config: { epochs: EPOCHS, users: USERS, seed: opt("--seed", 7) },
      wallClockSec: Math.round((Date.now() - t0) / 1000),
      simulatedDays: Math.round((Number((await pub.getBlock()).timestamp) - Number(epochs.length ? 0 : 0)) / 86400),
      violations,
      totals: {
        deposits,
        redeems,
        compoundedPpsPct: Math.round((epochs.reduce((a, x) => a * (1 + x.ppsChangePct / 100), 1) - 1) * 1e6) / 1e4,
        feesPaidStock: Math.round(epochs.reduce((a, x) => a + x.feeStock, 0) * 1e4) / 1e4,
        endedOpen: (await state()) === "OPEN",
      },
      byScenario: Object.fromEntries(
        (["squeeze", "partial", "quiet", "gapUp", "staleOracle"] as Scenario[]).map((s) => [s, { n: by(s).length, avgPpsChangePct: avg(by(s).map((x) => x.ppsChangePct)) }]),
      ),
      gas: gasSummary,
      epochs,
    };
    delete (report as any).simulatedDays;
    const out = join(ROOT, "docs/stress/stress-report.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 1));
    console.log(JSON.stringify({ violations: report.violations, totals: report.totals, byScenario: report.byScenario, gas: report.gas, wallClockSec: report.wallClockSec }, null, 2));
    console.log(`wrote ${out}`);
    if (violations.length) process.exitCode = 1;
  } finally {
    anvil.kill();
  }
}

await main();

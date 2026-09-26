// Real testnet runs through the real UI (docs/FINISH.md C3, C4): Playwright drives the pages, and an injected
// EIP-1193 wallet answers the dapp's requests in Node, signing with the dedicated test wallet (SANDBOX_PRIVATE_KEY).
// The key never reaches the page or the logs. Owner-only steps (squeeze, clock, feed, arm/lock/settle) run through
// keeper/src/sandboxOps.ts. Run against the sandbox build:
//   NEXT_DIST_DIR=.next-sandbox NEXT_PUBLIC_TESTNET_DEPLOYMENT=sandbox npx next start -p 3002
//   node scripts/wallet-e2e.mjs sell|sell-buyback|vault-deposit|vault-withdraw
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = process.env.E2E_URL || "http://localhost:3002";
const SHOTS = join(ROOT, "docs/screenshots");
const LOG = join(ROOT, "keeper/logs/wallet-e2e.jsonl");
const RPC = process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
const chain = defineChain({ id: 46630, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
if (!process.env.SANDBOX_PRIVATE_KEY) throw new Error("SANDBOX_PRIVATE_KEY not set");
const account = privateKeyToAccount(process.env.SANDBOX_PRIVATE_KEY);
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ chain, transport: http(RPC), account });
mkdirSync(SHOTS, { recursive: true });
const txs = [];

const hex = (v) => (v === undefined || v === null ? undefined : BigInt(v));
async function handle(method, params = []) {
  switch (method) {
    case "eth_requestAccounts": case "eth_accounts": return [account.address];
    case "eth_chainId": return "0xb626";
    case "net_version": return "46630";
    case "wallet_switchEthereumChain": case "wallet_addEthereumChain": case "wallet_requestPermissions": return null;
    case "wallet_getPermissions": return [{ parentCapability: "eth_accounts" }];
    case "eth_sendTransaction": {
      const t = params[0];
      const hash = await wallet.sendTransaction({ to: t.to, data: t.data, value: hex(t.value), gas: hex(t.gas) });
      const r = await pub.waitForTransactionReceipt({ hash });
      const row = { ts: new Date().toISOString(), step: current, to: t.to, selector: String(t.data ?? "").slice(0, 10), hash, status: r.status, explorer: `https://explorer.testnet.chain.robinhood.com/tx/${hash}` };
      txs.push(row);
      appendFileSync(LOG, JSON.stringify(row) + "\n");
      console.log(`  tx ${r.status}: ${row.explorer}`);
      return hash;
    }
    case "personal_sign": return account.signMessage({ message: { raw: params[0] } });
    case "eth_signTypedData_v4": return account.signTypedData(JSON.parse(params[1]));
    default: return pub.request({ method, params });
  }
}

let current = "setup";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.exposeBinding("__walletRequest", async (_src, method, params) => {
  try { return { ok: await handle(method, params) }; } catch (e) { return { err: e.shortMessage ?? e.message }; }
});
await ctx.addInitScript(() => {
  const listeners = {};
  const eth = {
    isMetaMask: false,
    request: async ({ method, params }) => {
      const r = await window.__walletRequest(method, params ?? []);
      if (r.err) throw Object.assign(new Error(r.err), { code: 4001 });
      if (method === "eth_requestAccounts") (listeners.connect ?? []).forEach((f) => f({ chainId: "0xb626" }));
      return r.ok;
    },
    on: (e, f) => { (listeners[e] ??= []).push(f); return eth; },
    removeListener: (e, f) => { listeners[e] = (listeners[e] ?? []).filter((x) => x !== f); return eth; },
  };
  window.ethereum = eth;
});
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("  page error:", e.message));
const shot = (name) => p.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
const ops = (...args) => execFileSync("npx", ["tsx", "src/sandboxOps.ts", ...args], { cwd: join(ROOT, "keeper"), env: process.env, encoding: "utf8" }).split("\n").filter((l) => l && !l.startsWith('{"event"')).join("\n");
async function connect() {
  const btn = p.getByRole("button", { name: /Connect Wallet/i }).first();
  if (!(await btn.isVisible().catch(() => false))) return;
  await btn.click();
  await p.getByText(/Browser Wallet|Injected/i).first().click();
  await p.waitForTimeout(2500);
}
async function clickAndConfirm(name, step, timeout = 180_000) {
  current = step;
  const n = txs.length;
  await p.getByRole("button", { name }).first().click();
  const t0 = Date.now();
  while (txs.length === n && Date.now() - t0 < timeout) await p.waitForTimeout(1000);
  if (txs.length === n) throw new Error(`no transaction after clicking ${name}`);
  await p.waitForTimeout(4000); // let the page refetch
}

const flow = process.argv[2];
try {
  if (flow === "sell") {
    await p.goto(`${BASE}/sell`, { waitUntil: "networkidle" });
    await connect();
    await p.getByPlaceholder(/Amount of/).fill("20");
    await p.waitForTimeout(3000);
    await shot("C3-1-sell-ready");
    // approvals then place: the button's label walks through the three steps
    for (const [label, step] of [[/Approve .* for Permit2/, "approve token -> Permit2"], [/Allow the Uniswap position manager/, "Permit2 -> PositionManager"], [/Place sell order/, "place sell order (+10%)"]]) {
      if (await p.getByRole("button", { name: label }).first().isVisible().catch(() => false)) await clickAndConfirm(label, step);
    }
    await shot("C3-2-order-placed");
    console.log(ops("squeeze", String(Number(process.env.SQUEEZE_USD ?? 36.5))));
    await p.reload({ waitUntil: "networkidle" }); await connect(); await p.waitForTimeout(5000);
    await shot("C3-3-order-filled");
    // the pool is now above the reference: a +10% order must be refused, a higher one still anchored to the reference
    await p.getByPlaceholder(/Amount of/).fill("5");
    await p.getByRole("button", { name: /^\+10%/ }).click();
    await p.waitForTimeout(1500);
    await shot("C3-4-pool-above-reference-refused");
    await p.getByPlaceholder("custom %").fill("35");
    await p.waitForTimeout(1500);
    await shot("C3-5-pool-above-reference-custom-35");
    await clickAndConfirm(/^Collect$/, "collect (decrease + burn + take)");
    await shot("C3-6-collected");
  } else if (flow === "sell-buyback") {
    await p.goto(`${BASE}/sell`, { waitUntil: "networkidle" });
    await connect(); await p.waitForTimeout(5000);
    await p.getByPlaceholder("USDG to spend").first().fill(process.env.BUYBACK_USDG ?? "100");
    for (const [label, step] of [[/Approve USDG for the buy back/, "approve USDG -> router"], [/Buy back, capped at/, "buy back (capped at fresh + 1%)"]]) {
      if (await p.getByRole("button", { name: label }).first().isVisible().catch(() => false)) await clickAndConfirm(label, step);
    }
    await shot("C3-7-bought-back");
  } else if (flow === "vault-deposit") {
    await p.goto(`${BASE}/vault/HIMS`, { waitUntil: "networkidle" });
    await connect(); await p.waitForTimeout(3000);
    await p.getByPlaceholder(/0\.0 m/).fill(process.env.DEPOSIT ?? "50");
    await p.waitForTimeout(1500);
    if (await p.getByRole("button", { name: /^Approve$/ }).isVisible().catch(() => false)) await clickAndConfirm(/^Approve$/, "approve vault");
    await clickAndConfirm(/^Deposit$/, "deposit");
    await shot("C4-1-deposited");
  } else if (flow === "vault-withdraw") {
    await p.goto(`${BASE}/vault/HIMS`, { waitUntil: "networkidle" });
    await connect(); await p.waitForTimeout(5000);
    await shot("C4-3-before-withdraw");
    await clickAndConfirm(/Withdraw everything/, "withdraw everything (redeem)");
    await shot("C4-4-withdrawn");
  } else throw new Error("usage: sell | sell-buyback | vault-deposit | vault-withdraw");
} finally {
  console.log(JSON.stringify(txs, null, 1));
  await b.close();
}

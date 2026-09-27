// Post-deploy check (docs/FINISH.md D1): every page on desktop (1440) and phone (390), live data on /monitor and
// /weekends, wallet connect through an injected EIP-1193 wallet, and the /api/rpc request rate of one connected visitor
// (it must stay well under the per-IP limit in src/lib/rateLimit.ts). The wallet is read-only: a fixed address and no
// key, so nothing can be signed. Usage: E2E_URL=https://… node scripts/deploy-check.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = (process.env.E2E_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const SHOTS = join(ROOT, "docs/screenshots/D1");
const ADDRESS = "0x000000000000000000000000000000000000dEaD"; // read-only: never signs
const TESTNET_RPC = "https://rpc.testnet.chain.robinhood.com";
const ROUTES = ["/", "/monitor", "/weekends", "/weekends/2026-08-29", "/sell", "/app", "/sandbox", "/vault/HIMS", "/backtest", "/paper"];
const WIDTHS = [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844, isMobile: true, hasTouch: true }];
mkdirSync(SHOTS, { recursive: true });

const results = { base: BASE, at: new Date().toISOString(), pages: [], live: {}, wallet: [], rpcPerMinute: null };
const fail = [];
const browser = await chromium.launch();

async function newContext(w) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, isMobile: !!w.isMobile, hasTouch: !!w.hasTouch });
  let approved = false; // like a real wallet: no accounts until the user approves the connection
  await ctx.exposeBinding("__walletRequest", async (_src, method, params) => {
    if (method === "eth_requestAccounts") { approved = true; return { ok: [ADDRESS] }; }
    if (method === "eth_accounts") return { ok: approved ? [ADDRESS] : [] };
    if (method === "eth_chainId") return { ok: "0xb626" };
    if (method === "net_version") return { ok: "46630" };
    if (method.startsWith("wallet_")) return { ok: method === "wallet_getPermissions" ? [{ parentCapability: "eth_accounts" }] : null };
    if (/^eth_(send|sign)|^personal_sign/.test(method)) return { err: "read-only check wallet" };
    const r = await fetch(TESTNET_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const j = await r.json();
    return j.error ? { err: j.error.message } : { ok: j.result };
  });
  await ctx.addInitScript(() => {
    const listeners = {};
    const eth = {
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
  return ctx;
}

for (const w of WIDTHS) {
  const ctx = await newContext(w);
  for (const route of ROUTES) {
    const p = await ctx.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
    const res = await p.goto(BASE + route, { waitUntil: "networkidle", timeout: 90_000 }).catch((e) => ({ status: () => `nav error: ${e.message.slice(0, 80)}` }));
    await p.waitForTimeout(1500);
    const overflowPx = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => null);
    const slug = route === "/" ? "home" : route.slice(1).replace(/\//g, "_");
    await p.screenshot({ path: join(SHOTS, `${slug}-${w.width}.png`), fullPage: false });
    const row = { route, width: w.width, status: res.status(), errors, overflowPx };
    results.pages.push(row);
    if (row.status !== 200 || errors.length || overflowPx > 0) fail.push(`${route} @${w.width}: ${JSON.stringify(row)}`);
    await p.close();
  }
  await ctx.close();
}

// live data: /api/live feeds /monitor; /weekends reads the published report
{
  const ctx = await newContext(WIDTHS[0]);
  const p = await ctx.newPage();
  const liveResp = p.waitForResponse((r) => r.url().includes("/api/live"), { timeout: 120_000 });
  await p.goto(BASE + "/monitor", { waitUntil: "domcontentloaded" });
  const live = await (await liveResp).json();
  const first = live.rows?.[0]?.ticker;
  // the table fills once the basket (paper service) and /api/live have both answered: wait for priced rows
  let tableRows = 0;
  for (let i = 0; i < 30 && tableRows < Math.min(5, live.rows?.length ?? 0); i++) {
    await p.waitForTimeout(2000);
    tableRows = await p.locator("tbody tr").filter({ hasText: "$" }).count().catch(() => 0);
  }
  const shown = tableRows > 0;
  results.live.monitor = { ok: live.ok, rpc: live.rpc, basketLive: live.basket?.live, rows: live.rows?.length ?? 0, verified: live.verifiedCount, errors: live.errors, pricedRowsOnPage: tableRows };
  if (!live.rows?.length || !shown) fail.push(`/monitor live data: ${JSON.stringify(results.live.monitor)}`);
  await p.screenshot({ path: join(SHOTS, "monitor-live-1440.png"), fullPage: false });
  await p.goto(BASE + "/weekends", { waitUntil: "networkidle" });
  const txt = await p.locator("body").innerText();
  results.live.weekends = { paidAbove: /\$3,615,154/.test(txt), valueOfBuys: /\$17,594,088/.test(txt), liveObservation: /live observation|paper mode/i.test(txt) };
  if (!results.live.weekends.paidAbove || !results.live.weekends.valueOfBuys) fail.push(`/weekends data: ${JSON.stringify(results.live.weekends)}`);
  await ctx.close();
}

// wallet connect on desktop and phone; then one connected visitor's /api/rpc rate over 60 s on /vault/HIMS
for (const w of WIDTHS) {
  const ctx = await newContext(w);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  let rpc = 0;
  p.on("request", (r) => { if (r.url().includes("/api/rpc/")) rpc++; });
  await p.goto(BASE + "/vault/HIMS", { waitUntil: "networkidle" });
  await p.getByRole("button", { name: /Connect Wallet/i }).first().click();
  await p.getByRole("button", { name: /^(Browser Wallet|Injected)$/ }).first().click();
  await p.waitForTimeout(4000);
  const short = `${ADDRESS.slice(0, 4)}`;
  const connected = await p.getByRole("button", { name: new RegExp(`${short}.*${ADDRESS.slice(-4)}`, "i") }).first().isVisible().catch(() => false);
  await p.screenshot({ path: join(SHOTS, `wallet-connected-${w.width}.png`), fullPage: false });
  results.wallet.push({ width: w.width, connected, errors });
  if (!connected || errors.length) fail.push(`wallet @${w.width}: connected=${connected} errors=${errors.join("; ")}`);
  if (w.width === 1440) {
    rpc = 0;
    await p.waitForTimeout(60_000);
    results.rpcPerMinute = rpc;
    if (rpc > 60) fail.push(`one visitor made ${rpc} /api/rpc requests in 60 s: too close to the limit`);
  }
  await ctx.close();
}

await browser.close();
results.fail = fail;
writeFileSync(join(SHOTS, "deploy-check.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ base: BASE, pages: results.pages.length, live: results.live, wallet: results.wallet, rpcPerMinute: results.rpcPerMinute }, null, 1));
console.log(fail.length ? `FAIL (${fail.length}):\n- ${fail.join("\n- ")}` : "ALL CHECKS PASS");
process.exit(fail.length ? 1 : 0);

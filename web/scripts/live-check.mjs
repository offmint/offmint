// Live-data check in a real browser (Chromium), desktop 1440 and phone 390: countdown ticks, detector basket count,
// verified premiums and the live tables fill from /api/live, and the hero card shows its final frame without JS and
// with reduced motion. Read-only. Usage: E2E_URL=https://… node scripts/live-check.mjs [shotDir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.E2E_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const SHOTS = process.argv[2] || "live-check-shots";
mkdirSync(SHOTS, { recursive: true });
const VIEW = [{ name: "desktop", viewport: { width: 1440, height: 900 } }, { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }];
const CLOCK = /(\d+)d (\d\d)h (\d\d)m (\d\d)s/;
const out = [], fail = [];
const browser = await chromium.launch();

async function until(fn, ms = 60_000) { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 1000)); } return v; }

for (const v of VIEW) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: !!v.isMobile, hasTouch: !!v.hasTouch, deviceScaleFactor: v.deviceScaleFactor ?? 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));

  // landing: live badge (basket count), stat band (basket count + largest verified premium), live table
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const stat = await until(async () => { const t = await p.locator("body").innerText(); return /\(updating\)|Live monitor (loading|updating)/.test(t) ? null : t; });
  const body = stat ?? (await p.locator("body").innerText());
  const basket = body.match(/(\d+)\s*\n?\s*new listings in the vulnerable window now/)?.[1] ?? null;
  const verified = body.match(/(\d+) of (\d+) basket tokens pass right now/);
  const liveRows = await p.locator("section:has-text('Verified live premiums') tbody tr").filter({ hasText: "%" }).count().catch(() => 0);
  await p.locator("text=Verified live premiums").first().scrollIntoViewIfNeeded().catch(() => {});
  await p.waitForTimeout(800);
  await p.screenshot({ path: join(SHOTS, `landing-live-${v.name}.png`) });
  const landing = { basket, verified: verified ? `${verified[1]} of ${verified[2]}` : null, liveTableRows: liveRows, stillUpdating: !stat };
  if (!basket || !verified || stat === null) fail.push(`${v.name} landing: ${JSON.stringify(landing)}`);

  // countdown on /monitor and /app: present and ticking
  const clocks = {};
  for (const route of ["/monitor", "/app"]) {
    await p.goto(BASE + route, { waitUntil: "domcontentloaded" });
    const a = await until(async () => (await p.locator("body").innerText()).match(CLOCK)?.[0], 20_000);
    await p.waitForTimeout(2200);
    const b = (await p.locator("body").innerText()).match(CLOCK)?.[0];
    clocks[route] = { first: a ?? null, later: b ?? null, ticking: !!a && !!b && a !== b };
    if (!clocks[route].ticking) fail.push(`${v.name} ${route} countdown: ${JSON.stringify(clocks[route])}`);
  }
  // /monitor live table: priced rows
  await p.goto(BASE + "/monitor", { waitUntil: "domcontentloaded" });
  const monitorRows = await until(async () => { const n = await p.locator("tbody tr").filter({ hasText: "$" }).count(); return n >= 5 ? n : null; }, 90_000) ?? 0;
  await p.screenshot({ path: join(SHOTS, `monitor-live-${v.name}.png`) });
  if (monitorRows < 5) fail.push(`${v.name} /monitor rows: ${monitorRows}`);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  out.push({ view: v.name, landing, clocks, monitorRows, overflow, errors });
  if (errors.length) fail.push(`${v.name} page errors: ${errors.join("; ")}`);
  await ctx.close();

  // hero card: no JS, and reduced motion, must show the final frame
  for (const mode of [{ tag: "nojs", javaScriptEnabled: false }, { tag: "reduced", reducedMotion: "reduce" }]) {
    const c = await browser.newContext({ viewport: v.viewport, isMobile: !!v.isMobile, javaScriptEnabled: mode.javaScriptEnabled ?? true, reducedMotion: mode.reducedMotion ?? "no-preference" });
    const q = await c.newPage();
    await q.goto(BASE + "/", { waitUntil: mode.tag === "nojs" ? "load" : "networkidle" });
    await q.waitForTimeout(mode.tag === "nojs" ? 0 : 2000);
    const t = await q.locator("text=sell steps reached").first().innerText().catch(() => "");
    const hero = await q.locator("text=Peak over Friday").first().locator("xpath=..").innerText().catch(() => "");
    await q.locator("text=Peak over Friday").first().scrollIntoViewIfNeeded().catch(() => {});
    await q.screenshot({ path: join(SHOTS, `hero-${mode.tag}-${v.name}.png`) });
    const r = { steps: t.match(/(\d)\/4/)?.[0] ?? null, peak: hero.match(/\+[\d.]+%/)?.[0] ?? null };
    out.push({ view: v.name, hero: mode.tag, ...r });
    if (r.steps !== "4/4" || r.peak !== "+317.6%") fail.push(`${v.name} hero ${mode.tag}: ${JSON.stringify(r)}`);
    await c.close();
  }
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
console.log(fail.length ? `FAIL\n- ${fail.join("\n- ")}` : "PASS");
process.exit(fail.length ? 1 : 0);

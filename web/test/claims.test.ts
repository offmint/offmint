// docs/AIRTIGHT.md ground rule 1: every displayed number comes from a data file, and the build fails if a rendered
// number differs from its data file. Three layers: no typed-in figures in landing components; data files agree with
// each other and with the contract source; rendered HTML shows exactly the data values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BARS, EVENTS, WORKED, DEMO, TESTS, PARAMS, FORK, LARGEST, COMMUNITY } from "../src/lib/claims";
import { WEEKENDS } from "../src/lib/weekends";
import { Evidence } from "../src/components/landing/Evidence";
import { HowItWorks } from "../src/components/landing/HowItWorks";
import { Verify } from "../src/components/landing/Verify";
import { Explainer } from "../src/components/landing/Explainer";

const ROOT = join(__dirname, "../..");
const LANDING = join(__dirname, "../src/components/landing");

test("no typed-in figures in landing components (decimal % or $ amounts)", () => {
  for (const f of readdirSync(LANDING).filter((f) => f.endsWith(".tsx"))) {
    const src = readFileSync(join(LANDING, f), "utf8").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
    for (const [i, line] of src.entries()) {
      const text = line.replace(/className="[^"]*"/g, "").replace(/`[^`]*\$\{[^`]*`/g, "");
      assert.doesNotMatch(text, /[+-]?\d+\.\d+\s*%/, `${f}:${i + 1} hardcodes a percentage: ${line.trim()}`);
      assert.doesNotMatch(text, /(^|[^{])\$\d[\d,]*(\.\d+)?k?\b/, `${f}:${i + 1} hardcodes a dollar amount: ${line.trim()}`);
    }
  }
});

test("replayed events: peak / reference reproduces the screen's premium exactly", () => {
  for (const e of EVENTS) {
    const recomputed = (e.peakUsd / e.p0 - 1) * 100;
    assert.ok(Math.abs(recomputed - e.screen.maxPremiumPct!) < 0.01, `${e.ticker}: ${recomputed.toFixed(3)} vs ${e.screen.maxPremiumPct}`);
    assert.equal(e.screen.p0Source, "pool-fri-close", `${e.ticker} reference must be the stated one`);
  }
  assert.equal(LARGEST, Math.max(...BARS.map((b) => b.pct)));
});

test("worked example is internally consistent (pinned fork)", () => {
  const sumUsdg = WORKED.usdg.reduce((a: number, b: number) => a + b, 0);
  assert.ok(Math.abs(sumUsdg - WORKED.usdgReceived) < 0.05, "per-step USDG adds up to the total");
  assert.ok(Math.abs(WORKED.placed.reduce((a: number, b: number) => a + b, 0) - 30) < 0.01, "30 placed");
  assert.ok(Math.abs(WORKED.holderAfter - (WORKED.held + WORKED.pnlStock - WORKED.feeStock)) < 0.02, "holder = held + pnl - fee");
  assert.ok(FORK.forkBlock > 0, "fork block is pinned");
});

test("params.json matches the contract source", () => {
  const meta = readFileSync(join(ROOT, "contracts/src/MetaVault.sol"), "utf8");
  for (const [k, v] of Object.entries(PARAMS.metaVault)) assert.match(meta, new RegExp(`${k}:\\s*${v}\\b`), `MetaVault.${k}`);
  const rm = readFileSync(join(ROOT, "contracts/src/libraries/RangeMath.sol"), "utf8");
  for (const [i, r] of PARAMS.ladder.entries()) assert.match(rm, new RegExp(`r\\[${i}\\] = Rung\\(${r.premiumBps}, ${r.widthBps}, ${r.shareBps}\\)`));
});

test("rendered numbers equal their data values", () => {
  const ev = renderToStaticMarkup(createElement(Evidence));
  for (const b of BARS) assert.ok(ev.includes(`+${b.pct < 1 ? b.pct.toFixed(2) : b.pct.toFixed(1)}%`), `bar ${b.label}`);
  for (const e of EVENTS) assert.ok(ev.includes(`$${e.p0.toFixed(2)}`) && ev.includes(`$${e.peakUsd.toFixed(2)}`), `${e.ticker} p0/peak`);
  const how = renderToStaticMarkup(createElement(HowItWorks));
  assert.ok(how.includes(`${WORKED.holderAfter.toFixed(2)} GLXY`) && how.includes(`$${WORKED.usdgReceived.toFixed(2)}`), "worked example");
  assert.ok(how.includes(String(WORKED.block)), "fork block shown");
  const ver = renderToStaticMarkup(createElement(Verify));
  assert.ok(ver.includes(`>${TESTS.contracts}<`) && ver.includes(`>${TESTS.fork}<`), "test counts");
  assert.ok(ver.includes((Number(DEMO.withdrawn) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2 })), "testnet cycle result");
});

test("weekend report agrees with harm.json, window by window (same pools, references and buy rules)", () => {
  const harm = JSON.parse(readFileSync(join(ROOT, "web/public/data/harm.json"), "utf8"));
  const th = WEEKENDS.headlineThresholdPct;
  assert.equal(th, harm.headlineThresholdPct, "same headline threshold");
  assert.equal(WEEKENDS.windows.length, harm.windows.length, "every window since 1 Jul listed");
  for (const w of WEEKENDS.windows) {
    const h = harm.windows.find((x: any) => x.window === w.window);
    assert.ok(h, `harm has ${w.window}`);
    const want = h[`above${th}pct`];
    assert.ok(Math.abs(w.paidAboveReferenceUsd - want.usdAboveReference) < 1, `${w.window}: $${w.paidAboveReferenceUsd} vs harm $${want.usdAboveReference}`);
    assert.equal(w.buysAbove, want.swaps, `${w.window}: buys`);
    assert.equal(w.wallets, want.uniqueSenders, `${w.window}: wallets`);
    const sumTokens = w.tokens.reduce((a, t) => a + t.paidAboveReferenceUsd, 0);
    assert.ok(Math.abs(sumTokens - w.paidAboveReferenceUsd) < 1, `${w.window}: per-token rows add up`);
  }
});

test("landing explainer shows exactly the replay's numbers", () => {
  const html = renderToStaticMarkup(createElement(Explainer));
  const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;
  const { low, high } = COMMUNITY.spike;
  assert.ok(low && high, "at least one big spike weekend replayed");
  assert.ok(html.includes(signed(low.r.excessPctExLpFees)) && html.includes(signed(high.r.excessPctExLpFees)), "spike range");
  assert.ok(COMMUNITY.worst && html.includes(signed(COMMUNITY.worst.r.excessPctExLpFees)), "worst weekend");
  assert.ok(html.includes(`${COMMUNITY.feePct}% of profit`), "fee");
  assert.ok(COMMUNITY.capacityUsd && html.includes(`$${Math.round(COMMUNITY.capacityUsd).toLocaleString("en-US")}`), "capacity");
  assert.match(html, /did not pick HIMS before the 29 Aug spike/, "MetaVault line carries the picker result");
  assert.doesNotMatch(html, /overpa|risk-free|guaranteed|\bsafe\b/i, "banned wording");
});

test("README plain-English numbers match the replay data", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const top = readme.slice(readme.indexOf("## In plain English"), readme.indexOf("## The problem"));
  const c = COMMUNITY;
  const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`;
  assert.ok(top.includes(`${pct(c.spike.low!.r.excessPctExLpFees)} (${c.spike.low!.e.ticker}`), "spike low");
  assert.ok(top.includes(`${pct(c.spike.high!.r.excessPctExLpFees)} (${c.spike.high!.e.ticker}`), "spike high");
  assert.ok(top.includes(`${pct(c.worst!.r.excessPctExLpFees)}** (${c.worst!.e.ticker}`), "worst");
  assert.ok(top.includes(`${c.normal.count} of ${c.screened} ticker-weekends`), "normal count");
  assert.ok(top.includes(`$${Math.round(c.capacityUsd!).toLocaleString("en-US")} per pool`), "capacity");
  assert.ok(top.includes(`range $${Math.round(c.capacityMin!).toLocaleString("en-US")} to $${Math.round(c.capacityMax!).toLocaleString("en-US")}`), "capacity range");
  assert.ok(top.includes(`${c.spikesPending} of these ${c.spikeCount}`), "pending count");
  assert.ok(top.includes(`${c.feePct}% of profit`), "fee");
  assert.match(top, /did not pick HIMS before the 29 Aug spike/);
  assert.doesNotMatch(readme, /overpa|risk-free|guaranteed|market-neutral\b(?! for)/i, "banned wording");
});

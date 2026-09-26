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
import { HeroChart } from "../src/components/landing/HeroChart";

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
    assert.ok(Math.abs(w.buysValueUsd - want.usdPaid) < 1, `${w.window}: value of buys $${w.buysValueUsd} vs harm $${want.usdPaid}`);
    assert.ok(w.paidAboveReferenceUsd < w.buysValueUsd || w.buysValueUsd === 0, `${w.window}: the excess is part of the value, never more`);
    assert.equal(w.wallets, want.uniqueSenders, `${w.window}: wallets`);
    const sumValue = w.tokens.reduce((a, t) => a + t.buysValueUsd, 0);
    assert.ok(Math.abs(sumValue - w.buysValueUsd) < 1, `${w.window}: per-token values add up`);
    const sumTokens = w.tokens.reduce((a, t) => a + t.paidAboveReferenceUsd, 0);
    assert.ok(Math.abs(sumTokens - w.paidAboveReferenceUsd) < 1, `${w.window}: per-token rows add up`);
  }
});

test("weekend report period totals equal harm.json totals: both quantities, same definition", () => {
  const harm = JSON.parse(readFileSync(join(ROOT, "web/public/data/harm.json"), "utf8"));
  const h = harm.totals[`above${WEEKENDS.headlineThresholdPct}pct`];
  const T = WEEKENDS.totals;
  assert.ok(Math.abs(T.buysValueUsd - h.usdPaid) < 1, `value of buys ${T.buysValueUsd} vs ${h.usdPaid}`);
  assert.ok(Math.abs(T.paidAboveReferenceUsd - h.usdAboveReference) < 1, `paid above ${T.paidAboveReferenceUsd} vs ${h.usdAboveReference}`);
  assert.equal(T.buysAbove, h.swaps);
  assert.equal(T.wallets, h.uniqueSenders);
  assert.equal(T.windows, harm.windows.length);
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

test("hero Friday price (P0) is read from data and its caption names the reference (AIRTIGHT 5, FINISH B4)", () => {
  const html = renderToStaticMarkup(createElement(HeroChart));
  const ev = EVENTS[0];
  assert.equal(ev.ticker, "HIMS");
  assert.ok(html.includes(`Reference $${ev.p0.toFixed(2)} is the pool price at Fri 20:00 UTC`), "caption states which reference, from data");
  assert.equal(ev.p0, ev.screen.p0, "P0 is the screen's reference, not derived from the premium");
  if (ev.nyseClose !== null) assert.ok(html.includes(`NYSE close $${ev.nyseClose.toFixed(2)}`), "NYSE close shown next to it");
});

test("every fork-derived number shows its pinned block (AIRTIGHT 13, FINISH B5)", () => {
  const block = FORK.forkBlock as number;
  assert.ok(block > 0);
  assert.ok(renderToStaticMarkup(createElement(Verify)).includes(`mainnet-fork tests @ block ${block}`), "Verify");
  assert.ok(renderToStaticMarkup(createElement(HowItWorks)).includes(`block ${block}`), "HowItWorks worked example");
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const row = readme.split("\n").find((l) => l.startsWith("| Mainnet-fork simulations"));
  assert.ok(row && row.includes(`block ${block.toLocaleString("en-US")}`), "README proof row names the block");
  assert.match(readme, new RegExp(`npm run test:fork\\s+# ${TESTS.fork} mainnet-fork tests`), "README fork test count = tests.json");
});

test("CLAIMS.md ledger rows match their data files (FINISH B6)", () => {
  const ledger = readFileSync(join(ROOT, "docs/CLAIMS.md"), "utf8");
  const J = (f: string) => JSON.parse(readFileSync(join(ROOT, "web/public/data", f), "utf8"));
  const harm = J("harm.json"), fr = J("frequency.json"), mo = J("mintoff.json"), tests = J("tests.json");
  const m = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
  const has = (s: string, what: string) => assert.ok(ledger.includes(s), `CLAIMS.md is missing ${what}: ${s}`);
  const h5 = harm.totals.above5pct, h2 = harm.totals.above2pct;
  has(`${m(h5.usdPaid)} (${h5.swaps.toLocaleString("en-US")} buys)`, "value of buys >5%");
  has(`| ${m(h5.usdAboveReference)} |`, "paid above the reference >5%");
  has(`${h5.uniqueSenders.toLocaleString("en-US")} (bots`, "wallets >5%");
  has(`${m(h2.usdPaid)} of buys, ${m(h2.usdAboveReference)} above the reference, ${h2.uniqueSenders.toLocaleString("en-US")} wallets`, "2% detail");
  const c = COMMUNITY;
  const pc = (x: number) => `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(1)}%`;
  has(`${pc(c.spike.low!.r.excessPctExLpFees)} (${c.spike.low!.e.ticker}`, "spike low");
  has(`${pc(c.spike.high!.r.excessPctExLpFees)} (${c.spike.high!.e.ticker}`, "spike high");
  has(`${pc(c.worst!.r.excessPctExLpFees)} (${c.worst!.e.ticker}`, "worst");
  has(`median ${m(c.capacityUsd!)} (range ${m(c.capacityMin!)} to ${m(c.capacityMax!)}, ${c.capacityEvents} capped weekends)`, "capacity");
  has(`nothing sells on ${c.normal.count} of ${c.screened} ticker-weekends`, "normal weekend");
  const e10 = fr.eligible.byThreshold.find((r: any) => r.thresholdPct === 10);
  has(`${e10.windowsWithAnySustained} of ${fr.eligible.windows} windows`, "frequency 1 in 3");
  has(`= ${mo.shareOfCalendarPct}%`, "mint-off share");
  has(`${tests.contracts} contract, ${tests.fork} fork, ${tests.keeperAndBacktest} keeper+backtest`, "test counts");
});

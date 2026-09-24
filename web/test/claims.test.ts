// docs/AIRTIGHT.md ground rule 1: every displayed number comes from a data file, and the build fails if a rendered
// number differs from its data file. Three layers: no typed-in figures in landing components; data files agree with
// each other and with the contract source; rendered HTML shows exactly the data values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BARS, EVENTS, WORKED, DEMO, TESTS, PARAMS, FORK, LARGEST } from "../src/lib/claims";
import { Evidence } from "../src/components/landing/Evidence";
import { HowItWorks } from "../src/components/landing/HowItWorks";
import { Verify } from "../src/components/landing/Verify";

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

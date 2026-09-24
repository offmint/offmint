import { test } from "node:test";
import assert from "node:assert/strict";
import { metaDecide, realBuyInOpen, type MetaSnapshot, type MetaPolicy, type StockView } from "../src/metaDecide.js";

const SAT = 1790380800; // Sat 26 Sep 2026 00:00 UTC
const MON = SAT + 2 * 86400;
const THU = SAT - 36 * 3600;
const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const open: MetaPolicy = { buyInOpen: true, commitLead: 6 * 3600 };

const view = (o: Partial<StockView> = {}): StockView => ({
  stock: A, ref: { price: 30_00000000n, updatedAt: THU - 600 }, poolUsd: 30_00000000n, subState: "OPEN", blacklisted: false, ...o,
});
function snap(o: Partial<MetaSnapshot> = {}): MetaSnapshot {
  return {
    now: THU,
    inWindow: false,
    upcoming: { start: SAT, end: MON },
    params: { maxConcurrent: 2, allocBps: 3000, buyInSlippageBps: 100, earlyUnwindThresholdBps: 800, maxRefAge: 86400 },
    usdgBalance: 100_000_000000n,
    openPositionCount: 0,
    cycleBase: 0n,
    cycleWeekendEnd: 0,
    positions: [],
    stocks: { [A]: view(), [B]: view({ stock: B }) },
    picks: [A, B],
    lastUnwindTry: {},
    ...o,
  };
}
const bought = (o: Partial<MetaSnapshot> = {}, phase: any = "BOUGHT") =>
  snap({ openPositionCount: 1, cycleBase: 100_000_000000n, cycleWeekendEnd: MON, positions: [{ stock: A, phase, weekendEnd: MON, buyInPrice: 30_00000000n }], ...o });

test("buy-in: best pick, allocBps of the balance; zero picks is a normal no-op", () => {
  const d = metaDecide(snap(), open);
  assert.equal(d.action, "buyIn");
  assert.equal((d as any).stock, A);
  assert.equal((d as any).amount, 30_000_000000n);
  assert.match(metaDecide(snap({ picks: [] }), open).reason, /zero picks/);
  assert.equal(metaDecide(snap(), { ...open, buyInOpen: false }).action, "none", "only on buy-in days");
});

test("buy-in skips: blacklisted, stale/paused reference, pool already above the cap, held, sub-vault busy", () => {
  assert.equal((metaDecide(snap({ stocks: { [A]: view({ blacklisted: true }), [B]: view({ stock: B }) } }), open) as any).stock, B);
  assert.equal((metaDecide(snap({ stocks: { [A]: view({ ref: null }), [B]: view({ stock: B }) } }), open) as any).stock, B);
  assert.equal((metaDecide(snap({ stocks: { [A]: view({ ref: { price: 30_00000000n, updatedAt: THU - 2 * 86400 } }), [B]: view({ stock: B }) } }), open) as any).stock, B);
  assert.equal((metaDecide(snap({ stocks: { [A]: view({ poolUsd: 30_40000000n }), [B]: view({ stock: B }) } }), open) as any).stock, B, "+1.33% > 1% cap");
  assert.equal((metaDecide(snap({ stocks: { [A]: view({ subState: "ARMED" }), [B]: view({ stock: B }) } }), open) as any).stock, B);
  // second pick uses the cycle's base, not the reduced balance
  const d = metaDecide(bought({ usdgBalance: 70_000_000000n }), open);
  assert.equal((d as any).stock, B);
  assert.equal((d as any).amount, 30_000_000000n);
});

test("buy-in stops: maxConcurrent, cutoff before the window, no upcoming window, in the window", () => {
  const two = bought({ openPositionCount: 2, positions: [{ stock: A, phase: "BOUGHT", weekendEnd: MON, buyInPrice: 30_00000000n }, { stock: B, phase: "BOUGHT", weekendEnd: MON, buyInPrice: 30_00000000n }] });
  assert.match(metaDecide(two, open).reason, /maxConcurrent/);
  assert.match(metaDecide(snap({ now: SAT - 5 * 3600 }), open).reason, /cutoff/);
  assert.match(metaDecide(snap({ upcoming: { start: THU - 5 * 86400, end: THU - 3 * 86400 } }), open).reason, /no upcoming/);
  assert.equal(metaDecide(snap({ inWindow: true, now: SAT + 60 }), open).action, "none");
});

test("stop-loss: fires at -8% on a fresh, unpaused reference; never while paused", () => {
  const drop = (price: bigint, ref: StockView["ref"] = { price, updatedAt: THU + 3000 }) =>
    bought({ now: THU + 3600, stocks: { [A]: view({ ref }), [B]: view({ stock: B }) } });
  assert.notEqual(metaDecide(drop(28_00000000n), open).action, "triggerEarlyUnwind", "-6.7%");
  assert.equal(metaDecide(drop(27_60000000n), open).action, "triggerEarlyUnwind", "-8%");
  assert.notEqual(metaDecide(drop(0n, null), open).action, "triggerEarlyUnwind", "paused/halted reference");
});

test("commit: from commitLead before the window, while the sub-vault is OPEN", () => {
  assert.notEqual(metaDecide(bought({ now: SAT - 7 * 3600 }), open).action, "commit");
  assert.equal(metaDecide(bought({ now: SAT - 6 * 3600 }), open).action, "commit");
  assert.equal(metaDecide(bought({ now: SAT + 60, inWindow: true }), open).action, "commit", "window open, not armed yet");
  const armed = bought({ now: SAT + 600, inWindow: true, stocks: { [A]: view({ subState: "ARMED" }) } });
  assert.equal(metaDecide(armed, open).action, "none", "too late: stays BOUGHT, unwound after the weekend");
});

test("unwind: after the weekend on a post-reopen print, once the sub-vault settled; UNWINDING retries every 15 min", () => {
  const monday = (o: Partial<MetaSnapshot>, phase: any, sv: Partial<StockView>) =>
    bought({ now: MON + 3600, stocks: { [A]: view({ ref: { price: 30_00000000n, updatedAt: MON + 600 }, ...sv }) }, ...o }, phase);
  assert.equal(metaDecide(monday({}, "COMMITTED", { subState: "ARMED" }), open).action, "none", "sub-vault not settled");
  assert.equal(metaDecide(monday({}, "COMMITTED", {}), open).action, "unwind");
  assert.equal(metaDecide(monday({}, "COMMITTED", { subState: "OPEN_MIXED" }), open).action, "unwind");
  assert.equal(metaDecide(monday({}, "COMMITTED", { ref: { price: 30_00000000n, updatedAt: MON - 60 } }), open).action, "none", "pre-reopen print");
  assert.equal(metaDecide(monday({}, "BOUGHT", {}), open).action, "unwind", "never committed");
  assert.equal(metaDecide(monday({ lastUnwindTry: { [A]: MON + 3000 } }, "UNWINDING", {}), open).action, "none");
  assert.equal(metaDecide(monday({ lastUnwindTry: { [A]: MON + 2000 } }, "UNWINDING", {}), open).action, "unwind");
});

test("real clock: buy-in days are Wednesday and Thursday UTC", () => {
  assert.equal(realBuyInOpen(THU), true);
  assert.equal(realBuyInOpen(THU - 86400), true);
  assert.equal(realBuyInOpen(SAT - 3600), false, "Friday");
  assert.equal(realBuyInOpen(MON), false);
});

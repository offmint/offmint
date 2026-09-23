import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, type Snapshot, type KeeperPolicy } from "../src/decide.js";

const SAT = 1790380800;
const MON = SAT + 2 * 86400;
const policy: KeeperPolicy = { premiumTable: {}, skip: [] };

function snap(o: Partial<Snapshot> = {}): Snapshot {
  return {
    now: SAT + 20 * 60,
    ticker: "TSLA",
    state: "OPEN",
    params: {
      defaultPremiumBps: 1000, defaultWidthBps: 5000, defaultDeployBps: 3000,
      armDelay: 300, minFrozen: 900, maxPreCloseAge: 6 * 3600, settleDelay: 3600, maxFreshAge: 3600,
    },
    clock: { inWindow: true, windowStart: SAT, windowEnd: MON },
    feed: { answer: 30_00000000n, updatedAt: SAT - 4 * 3600 },
    oraclePaused: false,
    stockIsCurrency0: true,
    poolTick: -242_000,
    epoch: { id: 0, armedAt: 0, windowEnd: 0, settledAt: 0, locked: false, tickLower: 0, tickUpper: 0 },
    corporateActionAt: null,
    lastRetryAt: 0,
    ...o,
  };
}
const armed = (o: Partial<Snapshot> = {}) =>
  snap({ state: "ARMED", epoch: { id: 1, armedAt: SAT + 1200, windowEnd: MON, settledAt: 0, locked: false, tickLower: -241_000, tickUpper: -237_000 }, ...o });

// ------------------------------------------------------------------ arm

test("arms with defaults inside the window", () => {
  assert.deepEqual(decide(snap(), policy), { action: "arm", args: [1000, 5000, 3000], reason: "weekend window, oracle frozen" });
});

test("premium table can only make the keeper more conservative", () => {
  assert.deepEqual((decide(snap(), { premiumTable: { TSLA: 2000 }, skip: [] }) as any).args, [2000, 5000, 3000]);
  assert.deepEqual((decide(snap(), { premiumTable: { TSLA: 200 }, skip: [] }) as any).args, [1000, 5000, 3000]);
});

test("does not arm: weekday / too early / paused / not frozen / stale close / skip / corporate action / already armed", () => {
  const none = (s: Snapshot, pol = policy) => decide(s, pol).action === "none";
  assert.ok(none(snap({ clock: { inWindow: false, windowStart: SAT, windowEnd: MON } })));
  assert.ok(none(snap({ now: SAT + 200 })));
  assert.ok(none(snap({ oraclePaused: true })));
  assert.ok(none(snap({ feed: { answer: 30_00000000n, updatedAt: SAT + 10 * 60 } })));
  assert.ok(none(snap({ feed: { answer: 30_00000000n, updatedAt: SAT - 7 * 3600 } })));
  assert.ok(none(snap({ feed: { answer: 0n, updatedAt: SAT - 3600 } })));
  assert.ok(none(snap(), { premiumTable: {}, skip: ["TSLA"] }));
  assert.ok(none(snap({ corporateActionAt: SAT + 86400 })));
  assert.ok(!none(snap({ corporateActionAt: MON + 86400 })), "action after the window is fine");
  assert.ok(none(snap({ epoch: { id: 3, armedAt: SAT + 60, windowEnd: MON, settledAt: SAT + 90, locked: true, tickLower: 0, tickUpper: 0 } })));
});

// ------------------------------------------------------------------ lock / settle

test("locks when the band is cleared (both orientations)", () => {
  assert.equal(decide(armed({ poolTick: -236_000 }), policy).action, "lock"); // S0: tick >= tickUpper
  assert.equal(decide(armed({ poolTick: -239_000 }), policy).action, "none"); // in band
  const s1 = armed({ stockIsCurrency0: false, epoch: { id: 1, armedAt: SAT, windowEnd: MON, settledAt: 0, locked: false, tickLower: 237_000, tickUpper: 241_000 } });
  assert.equal(decide({ ...s1, poolTick: 236_000 }, policy).action, "lock"); // S1: tick < tickLower
  assert.equal(decide({ ...s1, poolTick: 239_000 }, policy).action, "none");
});

test("locks 15 minutes before reopen, not earlier; never twice", () => {
  assert.equal(decide(armed({ now: MON - 16 * 60 }), policy).action, "none");
  assert.equal(decide(armed({ now: MON - 15 * 60 }), policy).action, "lock");
  const locked = armed({ now: MON - 60 });
  locked.epoch.locked = true;
  assert.equal(decide(locked, policy).action, "none");
});

test("settles only after settleDelay with a fresh post-reopen print", () => {
  const fresh = { answer: 30_60000000n, updatedAt: MON + 600 };
  assert.equal(decide(armed({ now: MON + 3599, feed: fresh }), policy).action, "lock", "too early to settle, still unlocked");
  assert.equal(decide(armed({ now: MON + 3600, feed: fresh }), policy).action, "settle");
  assert.equal(decide(armed({ now: MON + 3600, feed: { answer: 1n, updatedAt: MON - 1 } }), policy).action, "lock", "pre-reopen print");
  assert.equal(decide(armed({ now: MON + 3 * 3600, feed: fresh }), policy).action, "lock", "print too old");
  assert.equal(decide(armed({ now: MON + 3600, feed: fresh, oraclePaused: true }), policy).action, "lock");
});

test("emergency unwind after 96h without a fresh oracle", () => {
  assert.equal(decide(armed({ now: MON + 96 * 3600 }), policy).action, "emergencyUnwind");
});

// ------------------------------------------------------------------ pending / mixed

test("pending: retry every 15 min while fresh, expire after 48h", () => {
  const pend = (o: Partial<Snapshot>) =>
    snap({ state: "PENDING_BUYBACK", epoch: { id: 1, armedAt: SAT, windowEnd: MON, settledAt: MON + 3600, locked: true, tickLower: 0, tickUpper: 0 }, feed: { answer: 1n, updatedAt: MON + 7000 }, ...o });
  assert.equal(decide(pend({ now: MON + 7200, lastRetryAt: 0 }), policy).action, "retryBuyback");
  assert.equal(decide(pend({ now: MON + 7200, lastRetryAt: MON + 7000 }), policy).action, "none");
  assert.equal(decide(pend({ now: MON + 3600 + 48 * 3600 + 1 }), policy).action, "expireBuyback");
  assert.equal(decide({ ...pend({ now: MON + 7200 }), state: "OPEN_MIXED" }, policy).action, "retryBuyback");
});

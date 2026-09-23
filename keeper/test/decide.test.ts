import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, conservativeLadder, type Snapshot, type KeeperPolicy, type Rung } from "../src/decide.js";

const SAT = 1790380800;
const MON = SAT + 2 * 86400;
const policy: KeeperPolicy = { premiumTable: {}, skip: [] };
const LADDER: Rung[] = [
  { premiumBps: 800, widthBps: 400, shareBps: 2500 },
  { premiumBps: 1500, widthBps: 700, shareBps: 3000 },
  { premiumBps: 2500, widthBps: 1000, shareBps: 2500 },
  { premiumBps: 4000, widthBps: 1500, shareBps: 2000 },
];

function snap(o: Partial<Snapshot> = {}): Snapshot {
  return {
    now: SAT + 20 * 60,
    ticker: "GLXY",
    state: "OPEN",
    params: { defaultLadder: LADDER, defaultDeployBps: 3000, armDelay: 300, minFrozen: 900, maxPreCloseAge: 6 * 3600, settleDelay: 3600, maxFreshAge: 3600 },
    clock: { inWindow: true, windowStart: SAT, windowEnd: MON },
    feed: { answer: 30_00000000n, updatedAt: SAT - 4 * 3600 },
    oraclePaused: false,
    stockIsCurrency0: true,
    poolTick: -242_000,
    epoch: { id: 0, armedAt: 0, windowEnd: 0, settledAt: 0, rungs: [] },
    corporateActionAt: null,
    lastRetryAt: 0,
    ...o,
  };
}
// S0 rungs (USD rises with tick): each rung sits above the previous one
const RUNGS_S0 = [
  { tickLower: -241_200, tickUpper: -240_840, removed: false },
  { tickLower: -240_600, tickUpper: -240_000, removed: false },
  { tickLower: -239_700, tickUpper: -238_860, removed: false },
  { tickLower: -238_500, tickUpper: -237_300, removed: false },
];
const armed = (o: Partial<Snapshot> = {}, rungs = RUNGS_S0) =>
  snap({ state: "ARMED", epoch: { id: 1, armedAt: SAT + 1200, windowEnd: MON, settledAt: 0, rungs: rungs.map((r) => ({ ...r })) }, ...o });

// ------------------------------------------------------------------ arm

test("arms with the vault's default ladder and deploy", () => {
  const d = decide(snap(), policy);
  assert.equal(d.action, "arm");
  assert.deepEqual((d as any).args, [LADDER, 3000]);
});

test("premium table only makes the keeper MORE conservative: every rung shifts up equally", () => {
  const up = conservativeLadder(LADDER, 1200);
  assert.deepEqual(up.map((r) => r.premiumBps), [1200, 1900, 2900, 4400]);
  assert.deepEqual(up.map((r) => r.widthBps), LADDER.map((r) => r.widthBps), "widths unchanged -> still non-overlapping");
  assert.deepEqual(conservativeLadder(LADDER, 500), LADDER, "a lower floor never loosens the ladder");
  assert.deepEqual(conservativeLadder(LADDER), LADDER);
  assert.deepEqual(((decide(snap(), { premiumTable: { GLXY: 1200 }, skip: [] }) as any).args[0] as Rung[])[0].premiumBps, 1200);
});

test("does not arm: weekday / too early / paused / not frozen / stale close / skip / corporate action / already armed", () => {
  const none = (s: Snapshot, pol = policy) => decide(s, pol).action === "none";
  assert.ok(none(snap({ clock: { inWindow: false, windowStart: SAT, windowEnd: MON } })));
  assert.ok(none(snap({ now: SAT + 200 })));
  assert.ok(none(snap({ oraclePaused: true })), "a reverting price reference (halt, pause, sequencer) blocks arm");
  assert.ok(none(snap({ feed: { answer: 30_00000000n, updatedAt: SAT + 10 * 60 } })));
  assert.ok(none(snap({ feed: { answer: 30_00000000n, updatedAt: SAT - 7 * 3600 } })));
  assert.ok(none(snap({ feed: { answer: 0n, updatedAt: SAT - 3600 } })));
  assert.ok(none(snap(), { premiumTable: {}, skip: ["GLXY"] }));
  assert.ok(none(snap({ corporateActionAt: SAT + 86400 })));
  assert.ok(!none(snap({ corporateActionAt: MON + 86400 })), "action after the window is fine");
  assert.ok(none(snap({ epoch: { id: 3, armedAt: SAT + 60, windowEnd: MON, settledAt: SAT + 90, rungs: [] } })));
});

// ------------------------------------------------------------------ lock (per rung) / settle

test("locks as soon as ANY live rung is fully sold (S0)", () => {
  assert.equal(decide(armed({ poolTick: -241_500 }), policy).action, "none", "below the ladder");
  assert.equal(decide(armed({ poolTick: -241_000 }), policy).action, "none", "inside rung 0, not through it");
  const d = decide(armed({ poolTick: -240_700 }), policy); // through rung 0 only
  assert.equal(d.action, "lock");
  assert.match(d.reason, /1 rung/);
  assert.match(decide(armed({ poolTick: -237_000 }), policy).reason, /4 rung/, "above the whole ladder");
});

test("S1 mirror: a rung is sold once the tick falls below its tickLower", () => {
  const s1 = [
    { tickLower: 240_840, tickUpper: 241_200, removed: false },
    { tickLower: 240_000, tickUpper: 240_600, removed: false },
  ];
  assert.equal(decide(armed({ stockIsCurrency0: false, poolTick: 241_000 }, s1), policy).action, "none");
  assert.equal(decide(armed({ stockIsCurrency0: false, poolTick: 240_700 }, s1), policy).action, "lock");
});

test("already-removed rungs never re-trigger a lock", () => {
  const r = RUNGS_S0.map((x, i) => ({ ...x, removed: i === 0 }));
  assert.equal(decide(armed({ poolTick: -240_700 }, r), policy).action, "none", "rung 0 already pulled, rung 1 not through");
});

test("locks everything left 15 minutes before reopen, never earlier; nothing left -> nothing to do", () => {
  assert.equal(decide(armed({ now: MON - 16 * 60 }), policy).action, "none");
  assert.equal(decide(armed({ now: MON - 15 * 60 }), policy).action, "lock");
  const allGone = RUNGS_S0.map((x) => ({ ...x, removed: true }));
  assert.equal(decide(armed({ now: MON - 60 }, allGone), policy).action, "none");
});

test("settles only after settleDelay with a fresh post-reopen print", () => {
  const fresh = { answer: 30_60000000n, updatedAt: MON + 600 };
  const allGone = RUNGS_S0.map((x) => ({ ...x, removed: true }));
  assert.equal(decide(armed({ now: MON + 3599, feed: fresh }, allGone), policy).action, "none", "too early");
  assert.equal(decide(armed({ now: MON + 3600, feed: fresh }, allGone), policy).action, "settle");
  assert.equal(decide(armed({ now: MON + 3600, feed: { answer: 1n, updatedAt: MON - 1 } }, allGone), policy).action, "none", "pre-reopen print");
  assert.equal(decide(armed({ now: MON + 3 * 3600, feed: fresh }, allGone), policy).action, "none", "print too old");
  assert.equal(decide(armed({ now: MON + 3600, feed: fresh, oraclePaused: true }, allGone), policy).action, "none", "paused");
});

test("emergency unwind after 96h without a fresh oracle", () => {
  assert.equal(decide(armed({ now: MON + 96 * 3600 }), policy).action, "emergencyUnwind");
});

// ------------------------------------------------------------------ pending / mixed

test("pending: retry every 15 min while fresh, expire after 48h", () => {
  const pend = (o: Partial<Snapshot>) =>
    snap({ state: "PENDING_BUYBACK", epoch: { id: 1, armedAt: SAT, windowEnd: MON, settledAt: MON + 3600, rungs: [] }, feed: { answer: 1n, updatedAt: MON + 7000 }, ...o });
  assert.equal(decide(pend({ now: MON + 7200, lastRetryAt: 0 }), policy).action, "retryBuyback");
  assert.equal(decide(pend({ now: MON + 7200, lastRetryAt: MON + 7000 }), policy).action, "none");
  assert.equal(decide(pend({ now: MON + 3600 + 48 * 3600 + 1 }), policy).action, "expireBuyback");
  assert.equal(decide({ ...pend({ now: MON + 7200 }), state: "OPEN_MIXED" }, policy).action, "retryBuyback");
});

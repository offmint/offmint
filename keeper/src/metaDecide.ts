// Pure MetaVault keeper decision (SPEC §6.5.2): given a snapshot of MetaVault, its sub-vault instances and their price
// references, which call (if any) is due now? Mirrors MetaVault's preconditions so the bot never sends a transaction
// the contract would reject. Deterministic threshold checks only; the picks themselves come from SELECT (select.ts).

export const PHASE = ["NONE", "BOUGHT", "COMMITTED", "UNWINDING"] as const;
export type Phase = (typeof PHASE)[number];
const BPS = 10_000n;
export const UNWIND_RETRY_EVERY = 15 * 60;

export interface MetaParams {
  maxConcurrent: number;
  allocBps: number;
  buyInSlippageBps: number;
  earlyUnwindThresholdBps: number;
  maxRefAge: number;
}

/** Everything the keeper knows about one stock this tick. */
export interface StockView {
  stock: string;
  ref: { price: bigint; updatedAt: number } | null; // null = reference reverted (paused / halted / sequencer)
  poolUsd: bigint; // pool price, same decimals as the reference
  subState: "OPEN" | "ARMED" | "PENDING_BUYBACK" | "OPEN_MIXED";
  blacklisted: boolean;
}

export interface Position {
  stock: string;
  phase: Phase;
  weekendEnd: number;
  buyInPrice: bigint;
}

export interface MetaSnapshot {
  now: number;
  inWindow: boolean;
  upcoming: { start: number; end: number }; // clock.windowStart / windowEnd(now + 7d): the weekend MetaVault would buy for
  params: MetaParams;
  usdgBalance: bigint;
  openPositionCount: number;
  cycleBase: bigint;
  cycleWeekendEnd: number;
  positions: Position[];
  stocks: Record<string, StockView>; // by lowercased address, for every position and every pick
  picks: string[]; // SELECT output, best first (lowercased addresses); empty most weeks
  lastUnwindTry: Record<string, number>;
}

export interface MetaPolicy {
  buyInOpen: boolean; // Wed/Thu UTC on the real clock; the demo can open it explicitly
  commitLead: number; // commit this long before the window opens (SPEC: Friday, a few hours before Saturday's arm)
}
export const META_POLICY: MetaPolicy = { buyInOpen: false, commitLead: 6 * 3600 };

export type MetaDecision =
  | { action: "buyIn"; stock: string; amount: bigint; reason: string }
  | { action: "triggerEarlyUnwind" | "commit" | "unwind"; stock: string; reason: string }
  | { action: "none"; reason: string };

const fresh = (v: StockView | undefined, now: number, maxAge: number, notBefore = 0) =>
  !!v?.ref && v.ref.price > 0n && v.ref.updatedAt >= notBefore && now - v.ref.updatedAt <= maxAge;

/** Is SELECT/BUY-IN open on the real weekly clock? Wednesday or Thursday, UTC. */
export const realBuyInOpen = (now: number) => [3, 4].includes(new Date(now * 1000).getUTCDay());

export function metaDecide(s: MetaSnapshot, policy: MetaPolicy): MetaDecision {
  const p = s.params;
  const key = (a: string) => a.toLowerCase();

  // 1. stop-loss first: it only exists between BUY-IN and commit
  for (const pos of s.positions.filter((x) => x.phase === "BOUGHT")) {
    const v = s.stocks[key(pos.stock)];
    if (!fresh(v, s.now, p.maxRefAge)) continue; // paused/halted/stale: the contract refuses too
    if (v!.ref!.price * BPS <= pos.buyInPrice * (BPS - BigInt(p.earlyUnwindThresholdBps))) {
      return { action: "triggerEarlyUnwind", stock: pos.stock, reason: `reference fell >= ${p.earlyUnwindThresholdBps / 100}% below buy-in` };
    }
  }

  // 2. unwind: after the weekend, only on a post-reopen print; UNWINDING retries every 15 min
  for (const pos of s.positions) {
    const v = s.stocks[key(pos.stock)];
    const over = s.now >= pos.weekendEnd;
    if (!over && pos.phase !== "UNWINDING") continue;
    if (!fresh(v, s.now, p.maxRefAge, over ? pos.weekendEnd : 0)) continue;
    if (pos.phase === "COMMITTED" && v!.subState !== "OPEN" && v!.subState !== "OPEN_MIXED") continue;
    if (pos.phase === "UNWINDING" && s.now - (s.lastUnwindTry[key(pos.stock)] ?? 0) < UNWIND_RETRY_EVERY) continue;
    return { action: "unwind", stock: pos.stock, reason: pos.phase === "UNWINDING" ? "sell the remainder" : "weekend over, reference fresh" };
  }

  // 3. commit: Friday, commitLead before the window opens (or once it has opened, while the sub-vault is not armed yet)
  for (const pos of s.positions.filter((x) => x.phase === "BOUGHT")) {
    const v = s.stocks[key(pos.stock)];
    if (s.now >= pos.weekendEnd || v?.subState !== "OPEN") continue;
    if (s.now >= s.upcoming.start - policy.commitLead) {
      return { action: "commit", stock: pos.stock, reason: "deposit into MetaVault's instance before the weekend arm" };
    }
  }

  // 4. BUY-IN: SELECT picks, only on buy-in days, before the commit point, one per tick
  if (!policy.buyInOpen) return { action: "none", reason: s.openPositionCount ? "cycle active" : "IDLE: not a buy-in day" };
  if (s.inWindow || s.upcoming.end <= s.now) return { action: "none", reason: "no upcoming window to buy for" };
  if (s.now >= s.upcoming.start - policy.commitLead) return { action: "none", reason: "past the buy-in cutoff" };
  if (s.openPositionCount > 0 && s.cycleWeekendEnd !== s.upcoming.end) return { action: "none", reason: "last week's cycle still unwinding" };
  if (s.positions.some((x) => x.phase !== "BOUGHT")) return { action: "none", reason: "cycle already past buy-in" };
  if (s.openPositionCount >= p.maxConcurrent) return { action: "none", reason: "maxConcurrent reached" };
  const held = new Set(s.positions.map((x) => key(x.stock)));
  const base = s.openPositionCount === 0 ? s.usdgBalance : s.cycleBase;
  const amount = (base * BigInt(p.allocBps)) / BPS;
  if (amount === 0n) return { action: "none", reason: "no USDG to allocate" };
  for (const pick of s.picks.map(key)) {
    if (held.has(pick)) continue;
    const v = s.stocks[pick];
    if (!v || v.blacklisted || v.subState !== "OPEN") continue;
    if (!fresh(v, s.now, p.maxRefAge)) continue;
    if (v.poolUsd * BPS >= v.ref!.price * (BPS + BigInt(p.buyInSlippageBps))) continue; // squeeze already running: don't chase
    return { action: "buyIn", stock: pick, amount, reason: "SELECT pick, pool within buy-in cap" };
  }
  return { action: "none", reason: s.picks.length ? "no eligible pick this tick" : "SELECT: zero picks (normal)" };
}

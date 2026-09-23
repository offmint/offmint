// Pure keeper decision (SPEC §8): given a snapshot of the vault + oracle + pool, which call (if any) is due now?
// Mirrors OffmintVault's preconditions so the bot never sends a transaction the contract would reject.

export const STATE = ["OPEN", "ARMED", "PENDING_BUYBACK", "OPEN_MIXED"] as const;
export type State = (typeof STATE)[number];

export const LOCK_LEAD = 15 * 60;
export const RETRY_WINDOW = 48 * 3600;
export const EMERGENCY_DELAY = 96 * 3600;
export const RETRY_EVERY = 15 * 60;

export interface Rung {
  premiumBps: number;
  widthBps: number;
  shareBps: number;
}

export interface VaultParams {
  defaultLadder: Rung[]; // the vault's own default ladder (SPEC §5.0)
  defaultDeployBps: number;
  armDelay: number;
  minFrozen: number;
  maxPreCloseAge: number;
  settleDelay: number;
  maxFreshAge: number;
}

export interface Snapshot {
  now: number;
  ticker: string;
  state: State;
  params: VaultParams;
  clock: { inWindow: boolean; windowStart: number; windowEnd: number };
  feed: { answer: bigint; updatedAt: number };
  oraclePaused: boolean;
  stockIsCurrency0: boolean;
  poolTick: number;
  epoch: {
    id: number;
    armedAt: number;
    windowEnd: number;
    settledAt: number;
    rungs: { tickLower: number; tickUpper: number; removed: boolean }[];
  };
  /** Corporate action (multiplier change) effective inside this window -> skip (SPEC §8.2). */
  corporateActionAt: number | null;
  lastRetryAt: number;
}

export interface KeeperPolicy {
  premiumTable: Record<string, number>;
  skip: string[];
}

export type Decision =
  | { action: "arm"; args: [Rung[], number]; reason: string }
  | { action: "lock" | "settle" | "retryBuyback" | "emergencyUnwind" | "expireBuyback"; reason: string }
  | { action: "none"; reason: string };

/**
 * The keeper may only be MORE conservative than the vault default: a per-ticker premium floor shifts every rung up by
 * the same amount (widths and ordering unchanged, so the ladder stays valid and non-overlapping).
 */
export function conservativeLadder(ladder: Rung[], minFirstPremiumBps?: number): Rung[] {
  const shift = Math.max(0, (minFirstPremiumBps ?? 0) - (ladder[0]?.premiumBps ?? 0));
  return ladder.map((r) => ({ ...r, premiumBps: r.premiumBps + shift }));
}

const fresh = (s: Snapshot, windowEnd: number) =>
  !s.oraclePaused && s.feed.answer > 0n && s.feed.updatedAt >= windowEnd && s.now - s.feed.updatedAt <= s.params.maxFreshAge;

export function decide(s: Snapshot, policy: KeeperPolicy): Decision {
  const p = s.params;
  switch (s.state) {
    case "OPEN": {
      const ws = s.clock.windowStart;
      if (!s.clock.inWindow) return { action: "none", reason: "weekday: minting open" };
      if (s.epoch.id > 0 && s.epoch.armedAt >= ws) return { action: "none", reason: "already armed this window" };
      if (policy.skip.includes(s.ticker)) return { action: "none", reason: "ticker in skip list" };
      if (s.corporateActionAt !== null && s.corporateActionAt >= ws && s.corporateActionAt < s.clock.windowEnd) {
        return { action: "none", reason: "corporate action inside the window" };
      }
      if (s.now < ws + p.armDelay) return { action: "none", reason: "waiting for armDelay" };
      if (s.oraclePaused) return { action: "none", reason: "oracle paused" };
      if (s.feed.answer <= 0n) return { action: "none", reason: "feed answer <= 0" };
      if (s.now - s.feed.updatedAt < p.minFrozen) return { action: "none", reason: "feed not frozen yet" };
      if (s.feed.updatedAt + p.maxPreCloseAge < ws) return { action: "none", reason: "no recent close print: skip weekend" };
      return { action: "arm", args: [conservativeLadder(p.defaultLadder, policy.premiumTable[s.ticker]), p.defaultDeployBps], reason: "weekend window, oracle frozen" };
    }
    case "ARMED": {
      const we = s.epoch.windowEnd;
      if (s.now >= we + EMERGENCY_DELAY) return { action: "emergencyUnwind", reason: "oracle never came back fresh" };
      if (s.now >= we + p.settleDelay && fresh(s, we)) return { action: "settle", reason: "reopened, oracle fresh" };
      const live = s.epoch.rungs.filter((r) => !r.removed);
      // same rule as OffmintVault.lock(): any fully-sold rung, or everything left just before reopen
      const sold = live.filter((r) => (s.stockIsCurrency0 ? s.poolTick >= r.tickUpper : s.poolTick < r.tickLower));
      if (sold.length) return { action: "lock", reason: `${sold.length} rung(s) fully sold: position is 100% USDG there` };
      if (live.length && s.now + LOCK_LEAD >= we) return { action: "lock", reason: "reopen imminent" };
      return { action: "none", reason: s.now < we ? "weekend: position live" : "waiting for fresh oracle" };
    }
    case "PENDING_BUYBACK": {
      if (s.now > s.epoch.settledAt + RETRY_WINDOW) return { action: "expireBuyback", reason: "retry window over" };
      if (fresh(s, s.epoch.windowEnd) && s.now - s.lastRetryAt >= RETRY_EVERY) {
        return { action: "retryBuyback", reason: "pending USDG, oracle fresh" };
      }
      return { action: "none", reason: "pending: waiting for fresh oracle / retry interval" };
    }
    case "OPEN_MIXED": {
      if (fresh(s, s.epoch.windowEnd) && s.now - s.lastRetryAt >= RETRY_EVERY) {
        return { action: "retryBuyback", reason: "restore OPEN" };
      }
      return { action: "none", reason: "mixed: waiting for fresh oracle" };
    }
  }
}

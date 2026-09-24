// Every number shown on the landing page, with the run it came from. Nothing here is illustrative.

/** Local end-to-end run (scripts/e2e-local.sh, DUMP_EPOCH): HIMS-priced mock, Friday close $28.84, +70% squeeze,
 *  Monday reopen $29.13, default ladder, 30 of 100 shares deployed. */
export const HERO_RUN = {
  source: "Local simulation (scripts/e2e-local.sh), ladder settings v1",
  ticker: "HIMS",
  p0: 28.84,
  peak: 49.03,
  monday: 29.13,
  rungs: [
    { premiumPct: 8, sold: 7.5, usdg: 238.21 },
    { premiumPct: 15, sold: 9.0, usdg: 309.04 },
    { premiumPct: 25, sold: 7.5, usdg: 281.78 },
    { premiumPct: 40, sold: 6.0, usdg: 255.69 },
  ],
  boughtBack: 37.12,
  boughtBackUsdg: 1084.72,
  sharesBefore: 100,
  sharesAfter: 106.41, // after the 10% performance fee on the 7.12 gained
};

/** Mainnet-fork run (contracts/test/Fork.t.sol, ForkGLXY.test_fork_fullCycle_squeezeLockBuyback): the real
 *  GLXY/USDG pool at 24 Sep 2026 state, Friday close $25.87, simulated +70% spike, Monday +1%. */
export const WORKED_GLXY = {
  source: "Mainnet-fork simulation on the real GLXY/USDG pool (contracts/test/Fork.t.sol), 24 Sep 2026 state",
  held: 100,
  p0: 25.87,
  placed: [7.5, 9.0, 7.5, 6.0],
  usdg: [214.52, 277.13, 253.32, 229.64],
  collected: 974.6,
  boughtBack: 37.07,
  fee: 0.71,
  after: 106.36,
};

/** Registry-wide weekend screen + backtest replays (backtest/, Uniswap v4 swap logs, 1 Aug – 19 Sep 2026). */
export const EVIDENCE = {
  hims: { peakPct: 317.6, date: "29 Aug 2026", p0: 28.84 },
  glxy: { peakPct: 186.1, date: "12 Sep 2026" },
  source: "Our weekend screen of every Robinhood stock token, Uniswap v4 swap logs, 1 Aug – 19 Sep 2026",
};

export const TESTNET_CYCLE: [string, string][] = [
  ["buy-in", "0x300799da34a0539bd9e91e0fd6c59e3f5b3e63de7df0a3a40bbf45ae45c6db44"],
  ["commit", "0x5ace8e0ffcff552d5b00630ba3d88f2fb95a890030cbf122a8d539cd9d268773"],
  ["arm", "0xbee65c69857ad7bd3d23234faea4ef5afbf72f9ce665bbbda67d2de7877ebd45"],
  ["lock", "0xbb44130566bb67489c66247b9388622a29d1a018d6ea58c421a83dba4488a36c"],
  ["settle", "0x0b385a948e9ce253e080cdf62f6a26147f216a8a9944ce305cd2b3ce7840e8de"],
  ["unwind", "0xe64969cc5b07ecba05140341c9fb23113dbecbdfc6873edced65ef33764daa9e"],
];

export const TESTS = { contracts: 160, fork: 12, keeper: 76 };
export const REPO = "https://github.com/offmint/offmint";
export const EXPLORER = "https://explorer.testnet.chain.robinhood.com";

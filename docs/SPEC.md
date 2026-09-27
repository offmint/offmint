# Offmint — Build Specification (v1.0, 23 Sep 2026)

> "They price the weekend. We supply it."
> Source of truth for the build. CLAUDE.md holds the working rules; this file holds what to build and how.

---

## 1. Problem (why this exists)

- Robinhood Stock Tokens trade 24/7 on Robinhood Chain, but **minting/burning only happens Mon 02:00 – Sat 02:00 CET/CEST**
  (docs.robinhood.com/chain/stock-tokens). Over the weekend, onchain supply is fixed.
- Chainlink stock feeds are **24/5**; when the underlying market is closed the feed **holds the last price with no heartbeat**
  (docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood).
- Result: weekend **scarcity premiums**. Case study: 28–31 Aug 2026, tokenized HIMS printed ~$61 vs a $28.84 NYSE close
  (~112% premium) after a memecoin pool absorbed the free float; it collapsed within hours of minting reopening.
- Robinhood's crypto GM (Sep 2026): scarcity premiums converge when minting resumes; **the fix is market-maker depth**,
  including Uniswap pools where users provide stock tokens.
- Existing work prices the gap (GapGuard, MarketHoursFeeHook, BandHook) or LPs all week (EARN). **Nobody supplies
  weekend float from holders.** That is Offmint.

**Ported from:** Ribbon Finance weekly covered-call vaults (sell upside above a strike, earn premium) + Hyperliquid HLP
(community-owned market-making vault), rebuilt around the tokenized-stock minting clock.

### 1.1 IMPORTANT — what the data actually shows (read before picking tickers)
Onchain data for the weekend of 29–30 Aug 2026 shows **two different regimes, not one**:
- **Liquid/major names barely move.** NVDA: $223.84 → $218.79 → $219.21 (−2.3%, mostly recovered). SPY: $771.48 →
  $772.45 → $776.42 (+0.6%). At `premiumBps = 1000` (10%) the vault **would not have armed on either** — correct
  behaviour, but it means near-zero yield on the names most people assume are "the market."
- **Thin, meme-pool-adjacent names blow out.** HIMS printed ~$61 vs a $28.84 close (**+112%**) after a memecoin pool
  (BONER) became its dominant liquidity venue over the free float and absorbed it. Same chain, wildly different outcome.
- **Total weekend volume was huge either way** ($492.6M across Sat/Sun, zero new supply minted) — the *demand* is real,
  the *dislocation* is concentrated in thin names, not broad ones.
- **Robinhood is actively patching this.** In a Bankless interview ([reported by BigGo Finance](https://finance.biggo.com/news/4691062f7e0b2bb5),
  21 Sep 2026), Robinhood's Johann Kerbrat said they onboarded market makers ahead of a later 3-day weekend to prevent
  the earlier dislocation, and that Uniswap pools where users lend stock tokens are part of the liquidity. Secondary
  source: paraphrase with attribution, never in quotation marks. Treat it as a **shrinking-window risk**, not a
  permanent moat.
- **A Chainlink feed does not make a token immune** (updated 27 Sep 2026, docs/verification/feed-claim.md). Weekend
  report, 12 mint-off windows (3 Jul–19 Sep), every hook-free USDG pool, premium held ≥ 15 min vs the official close: a
  token held > 10% above its reference for ≥ 1 h **19 times — 16 on tokens without a feed** (e.g. LMT +53.5% on 5 Sep,
  13.2 h; LMT has no feed) **and 3 on tokens with one** (MSTR 25 Jul and 29 Aug, RKLB 12 Sep). The largest names
  (NVDA, TSLA, AAPL, SPY) never went above 2.6%. So "majors don't squeeze" holds for the largest names, not for
  "has a feed". The earlier line "every feed-backed ticker stayed ≤ 3.7%" came from a 10-ticker hand-picked scan
  (8 majors) and is withdrawn.

**Consequence for the build:** this vault must NOT default to "works on any stock." The live Detector (§3.7) decides
which tokens are in the basket; §3.5's fixed curation list is superseded. The Detector's "has a feed → graduated" rule
excludes MSTR and RKLB, which did spike (flagged in docs/verification/mstr.md §5; not changed yet).

---

## 2. Glossary

| Term | Meaning |
|---|---|
| STOCK | A Robinhood stock token (ERC-20, 18 decimals, implements ERC-8056 `uiMultiplier()`, `oraclePaused()`) |
| USDG | Paxos Global Dollar, 6 decimals. Treated as $1 for pricing |
| Feed | Chainlink AggregatorV3 for the STOCK (USD per 1 token, already multiplier-adjusted) |
| P0 | Feed price read at `arm()` = last price before the weekend freeze |
| Window | Weekend frozen window: Sat 00:00 UTC → Mon 00:00 UTC (+ `sessionOffset`) |
| Band | USD price range `[P0·(1+premium), P0·(1+premium+width)]` where the vault sells |
| Epoch | One weekend cycle: OPEN → ARMED → (PENDING_BUYBACK) → OPEN |
| Basket | The live set of no-feed, recently-listed tickers a vault could be deployed for (§3.7 Detector output) |
| MetaVault | The user-facing platform vault (`asset = USDG`); rotates capital into `OffmintVault` sub-vaults weekly (§6.5) |
| PushPriceReference | Keeper-adjacent, separately-keyed oracle sourced from Robinhood's own `/rhj/prices` API, used when no Chainlink feed exists yet (§3.6) |

---

## 3. Time model — `SessionClock`

### 3.1 Facts it encodes
- Tokenization closes **Sat 02:00 CEST = Sat 00:00 UTC** and reopens **Mon 02:00 CEST = Mon 00:00 UTC** while the EU is on
  summer time (until 25 Oct 2026). Chainlink's 24/5 overnight session ends Fri 20:00 ET = Sat 00:00 UTC (EDT) → aligned.
- After 25 Oct 2026 (EU winter time) tokenization moves to Sat/Mon **01:00 UTC**; after 1 Nov (US winter time) the feed
  session also moves to 01:00 UTC. Handle with `sessionOffset` (seconds), owner-settable within **[-3h, +3h]**. Current value: **0**.

### 3.2 Interface
```solidity
interface ISessionClock {
    function inWeekendWindow(uint256 ts) external view returns (bool);
    function windowStart(uint256 ts) external view returns (uint256); // Sat 00:00 UTC + offset of the window containing/preceding ts
    function windowEnd(uint256 ts) external view returns (uint256);   // following Mon 00:00 UTC + offset
}
```
- Implementation `SessionClock`: pure timestamp math.
  - `dow(t) = ((t / 1 days) + 4) % 7` → 0=Sun … 6=Sat (1970-01-01 was a Thursday).
  - `t' = ts - offset`; in window iff `dow(t') == 6 || dow(t') == 0`.
- Implementation `ManualSessionClock` (**testnet demo only**, clearly named): owner toggles `weekend` on/off and sets
  `start/end`, so a full cycle can be demoed live on testnet without waiting for Saturday.
- The vault stores `ISessionClock clock` (immutable). Mainnet/fork → `SessionClock`. Testnet demo → `ManualSessionClock`.

### 3.3 Holidays
No calendar onchain. Feed freshness handles it: if Friday is a holiday, the feed froze early → `maxPreCloseAge`
check fails → epoch skipped (safe). If Monday is a holiday, the feed stays frozen → settle waits.

### 3.5 Ticker curation — SUPERSEDED, kept for history (see §3.7 for the live process)
The original plan here was a static, hand-picked list of 3–5 tickers. **Real backtest data killed that plan on
24 Sep 2026.** Across the observed no-feed listings (GLXY, HIMS, NU, BULL, AMC, BB, FIG, IBM, RIVN, RCAT), two genuine
squeezes occurred in four weekends — HIMS (+317.6%, 29 Aug) and GLXY (+186.1%, 12 Sep) — on **two different tickers**,
with every other name in that set staying calm (≤11.7%) over those four weekends. (That bound is only for those 10
names: the full weekend report, 187 tickers over 12 windows, has 19 spikes > 10% held ≥ 1 h — 16 without a feed,
3 with one; see §1.1 and docs/verification/feed-claim.md.) Per-ticker, a squeeze is close to a one-off; a
fixed list built from last month's evidence would have caught at most one of the two real events, by luck. Pool-wide,
across the whole no-feed basket, a squeeze recurred roughly every other weekend. **The unit of the product is the
basket, not the ticker.** See §3.7 (Detector) and §6.5 (MetaVault) for what replaced this.

### 3.6 Push price reference — `PushPriceReference` (built, do not re-derive from scratch)
No-feed tickers (the ones that actually matter per §3.5) have no Chainlink price. Robinhood's own REST API
(`GET api.robinhood.com/rhj/prices` + `/rhj/assets` for `currentMultiplier`) is the reference: it's Robinhood's own
source of truth, independent of whether Chainlink has stood up a feed yet, and is very likely the same upstream data
Chainlink will eventually consume — so cutover to a real feed later is a config swap, not a discontinuity.
Implemented design (keep this, it's already built and tested):
- A **poster role**, separate from the keeper — a different key, different responsibility, so a compromised keeper
  can't also fake prices.
- **Forward-only timestamps** — a post can never move `updatedAt` backwards, closing a replay vector.
- **20% per-post cap**, except after a detected ≥12h market gap (e.g. the API itself was down or the market was
  shut longer than usual) — bounds how much a single malicious or buggy post can move the reference.
- **Halt flag** — poster or owner can freeze updates; vault reads must treat a halted reference the same as
  `oraclePaused()` on the Chainlink path. **Built as an owner freeze specifically: it blocks both posts and reads,
  and the poster cannot undo it** — the owner is the only party who can lift a halt, closing the obvious gap where
  a compromised poster halts, then un-halts, to slip a bad price through.
- **Maximum reference age (default 1 day, bound 1h–3d)** — beyond this, treat the reference as stale for every
  purpose that reads it (fair-price guard, stop-loss check, buyback cap), same discipline as `maxFreshAge` on the
  Chainlink path (§4). This wasn't given a value when §3.6 was first written; confirmed here as the default.
- Same `(price, updatedAt)` interface as the Chainlink adapter — the vault code does not know or care which source
  it's reading. Guard against double-counting the multiplier (§CLAUDE.md gotcha) — `/rhj/prices` is raw underlying
  price, `currentMultiplier` from `/rhj/assets` must be applied once, the same way `uiMultiplier()` is applied once
  on the Chainlink path.

### 3.7 Detector — the live process that replaced §3.5's fixed list
Runs continuously, not once:
1. **Discover** — watch `PoolManager.Initialize` events for new STOCK/USDG pools, and/or poll `/rhj/assets` for
   tokens not seen before.
2. **Verify** — check the token's address against Robinhood's canonical `/rhj/assets` registry before doing
   anything else with it. Never trust a ticker symbol alone — copycat tokens mimicking real ticker symbols are a
   documented scam pattern on this chain. **This check happens off-chain, against Robinhood's REST API — there is
   no onchain registry to check against.** So `VaultFactory.deployVault` (§6.5.4) is owner-gated, not
   permissionless: the factory owner performs this off-chain verification and lists each stock (with its feed and
   pool) before deploying. This is more conservative than the original permissionless design, and correctly so —
   permissionless deployment with no reliable onchain check to gate it would have been the less safe choice, not
   a more decentralized one.
3. **Classify** — no live Chainlink feed **and** pool age under `vulnerableWindowDays` (default 30, tune from
   ongoing data) → basket member, priced via `PushPriceReference` (§3.6). Live feed → not a basket member (majors
   don't squeeze; §1.1). A basket member that later gets a Chainlink feed graduates out — **only at the start of
   its next MetaVault cycle, never while a `BasketPosition` for it is open** (switching a ticker's oracle source
   mid-flight, from `PushPriceReference`'s last posted price to a freshly-live Chainlink feed, can create a price
   discontinuity that breaks the buyback cap's reference, §5.3/§6.7, which assumes one continuous price source
   for the epoch it's armed under).
4. **Liquidity floor** — below `$10,000` average pool TVL (tunable from ongoing data; this is a starting default,
   not a derived constant), exclude; not enough real liquidity to safely arm a ladder against yet.
5. Output: `basket.json`, refreshed continuously, consumed by the keeper's weekly candidate selection (§8) and the
   MetaVault's allocator (§6.5).

---

## 4. Oracle rules (every read)

`_readFeed()` returns `(price, updatedAt)` and reverts unless:
1. `answer > 0`
2. `IStockToken(stock).oraclePaused() == false`
3. Sequencer uptime feed: `status == 0` and `block.timestamp - startedAt > SEQ_GRACE (3600)`
   - If no sequencer feed is configured (testnet), skip this check (constructor flag).

Per action:

| Action | Extra condition |
|---|---|
| `arm` | `clock.inWeekendWindow(now)`; `now >= windowStart + armDelay`; **frozen:** `now - updatedAt >= minFrozen` ; **recent close:** `updatedAt >= windowStart - maxPreCloseAge` |
| `settle` | `now >= windowEnd + settleDelay`; **fresh:** `updatedAt >= windowEnd` and `now - updatedAt <= maxFreshAge` |
| `retryBuyback` | same freshness as settle |
| `emergencyUnwind` | `now >= windowEnd + emergencyDelay` (no oracle requirement) |

Defaults: `armDelay 5 min`, `minFrozen 15 min`, `maxPreCloseAge 6 h`, `settleDelay 1 h`, `maxFreshAge 1 h`, `emergencyDelay 96 h`.

---

## 5. Range math — `RangeMath` library

### 5.0 Ladder, not a single band
A single band (old design: one range from +10% to +60%) either fills a lot at a bad average price or barely fills at
all — there's no granularity, and it's a single predictable wall an MEV searcher can see the moment `arm()` lands.
**v1 uses a ladder of up to 4 range orders (rungs)** instead, each a separate `modifyLiquidity` position with its own
tick range and its own slice of the deployable capital:

```solidity
struct Rung { uint16 premiumBps; uint16 widthBps; uint16 shareBps; } // shareBps of maxDeploy allocated to this rung; sum(shareBps) == 10000
// Default ladder: [ {800,400,2500}, {1500,700,3000}, {2500,1000,2500}, {4000,1500,2000} ]
//   → 25% of deploy at +8–12%, 30% at +15–22%, 25% at +25–35%, 20% at +40–55%
```
Each rung is computed and deployed independently with §5.2's math (same single-sided rule, applied per rung — rungs
must not overlap; enforce `rung[i].upperTick <= rung[i+1].lowerTick` at construction). `arm()` loops rungs and issues
one `modifyLiquidity` per rung inside the same `unlock` callback. `settle()` removes all rungs, sums the returns, then
does one buyback swap against the combined USDG received. Epoch struct (§6.4) stores an array of rung results, not one.
This is strictly better fill-capture than one band for roughly the same gas (4 `modifyLiquidity` calls vs 1) and reads
as real market-making rather than a tripwire.

### 5.1 USD price → pool sqrtPriceX96
Inputs: feed answer `A` (decimals `fd`), STOCK decimals `ds=18`, USDG decimals `du=6`.

**Case S0 — STOCK is currency0** (pool price = USDG_raw per STOCK_raw, rises with USD price):
```
X        = FullMath.mulDiv(A * 10**du, 2**192, 10**(fd + ds))
sqrtP    = FixedPointMathLib.sqrt(X)            // uint160 cast after bound check
```
**Case S1 — STOCK is currency1** (pool price = STOCK_raw per USDG_raw, falls as USD price rises):
```
X        = FullMath.mulDiv(10**(fd + ds), 2**192, A * 10**du)
sqrtP    = sqrt(X)
```
Then `tick = TickMath.getTickAtSqrtPrice(sqrtP)`. Ticks are **negative** in S0 (≈ -240k for ~$30) — use a correct
**floor division** for negatives when snapping to `tickSpacing` (Solidity `/` truncates toward zero).

### 5.2 One-sided sell range
Let `Lusd = P0·(1+premiumBps)`, `Uusd = P0·(1+premiumBps+widthBps)`; `cur = current pool tick` (StateLibrary.getSlot0).

**S0 (STOCK = currency0):** position holds only currency0 iff range is **above** current tick.
```
tickLower = ceilToSpacing(tick(Lusd));  tickUpper = floorToSpacing(tick(Uusd))
if (tickLower <= cur) tickLower = ceilToSpacing(cur + 1)      // pool already at/above threshold: sell only above current price
require(tickUpper > tickLower)
L = LiquidityAmounts.getLiquidityForAmount0(sqrt(tickLower), sqrt(tickUpper), amountStock)
```
**S1 (STOCK = currency1):** position holds only currency1 iff range is **below** current tick. Higher USD ⇒ lower tick.
```
tickUpper = floorToSpacing(tick(Lusd));  tickLower = ceilToSpacing(tick(Uusd))
if (tickUpper > cur) tickUpper = floorToSpacing(cur)          // keep strictly single-sided (tickUpper <= cur)
require(tickUpper > tickLower)
L = LiquidityAmounts.getLiquidityForAmount1(sqrt(tickLower), sqrt(tickUpper), amountStock)
```
Rounding rule: **always move range edges away from the current price** so the position is never two-sided.

### 5.3 Buyback price limit
`capUsd = freshPrice · (1 + buybackSlippageBps)` → `sqrtCap` via §5.1.
- S0: buying currency0 with currency1 → `zeroForOne = false`, price rises, `sqrtPriceLimitX96 = sqrtCap` (above current).
- S1: buying currency1 with currency0 → `zeroForOne = true`, price falls, `sqrtPriceLimitX96 = sqrtCap` (below current).
The swap **stops at the limit** (partial fill) instead of reverting → leftover USDG → `PENDING_BUYBACK`.

Fuzz test: USD→tick→USD round-trips within 1 tick for $0.01–$10,000 in both orientations.

---

## 6. Vault — `OffmintVault` (one per STOCK)

### 6.1 Base
- `ERC4626` (OpenZeppelin) with `asset = STOCK`, `_decimalsOffset() = 3` (inflation-attack mitigation).
- Share token: name `Offmint {TICKER}`, symbol `ob{TICKER}` — **except** a MetaVault-exclusive instance (§6.5.3),
  which uses symbol `mb{TICKER}` so the two are never visually or programmatically confused.
- `Ownable2Step` owner (params within bounds, keeper, pause deposits). `keeper` address (arm/settle before grace).
- `IUnlockCallback` for PoolManager.
- **`address immutable restrictedDepositor`** (default `address(0)` = open to anyone, the community instance).
  When set to a non-zero address, `deposit`/`mint` revert unless `msg.sender == restrictedDepositor`. This is the
  entire mechanism behind §6.5's fix: MetaVault gets its own instance with this set to `address(metaVault)`, so
  its actively-bought-in capital is never pooled with a community depositor's market-neutral holdings — two
  separate instances, same tested code, one new immutable and one `require`.

### 6.2 States
```
OPEN  --arm()-->  ARMED  --settle() full buyback-->  OPEN
                  ARMED  --settle() partial-------->  PENDING_BUYBACK --retryBuyback() full--> OPEN
                  ARMED  --emergencyUnwind()------->  PENDING_BUYBACK
PENDING_BUYBACK --expireBuyback() after retryWindow--> OPEN_MIXED (withdraw-only, pro-rata STOCK+USDG)
```
- OPEN: `deposit/mint/withdraw/redeem` enabled. `totalAssets() = STOCK.balanceOf(this)` (USDG balance must be 0).
- ARMED, PENDING_BUYBACK: `maxDeposit/maxMint/maxWithdraw/maxRedeem = 0`.
- OPEN_MIXED: deposits disabled; `redeemMixed(shares)` pays pro-rata STOCK and USDG. Returns to OPEN when USDG balance hits 0
  (e.g. anyone calls `retryBuyback` later and it completes).
- (Stretch, after Oct 4) `requestWithdraw(shares)` queue during ARMED, paid at settle.

### 6.3 External API
```solidity
// ---- lifecycle ----
function arm(Rung[] calldata rungs, uint16 deployBps) external;   // keeper; anyone after armGrace (rungs then = defaultLadder)
function settle(uint256 minStockOut) external;                                  // keeper; anyone after settleGrace (minStockOut ignored → uses cap only)
function retryBuyback(uint256 minStockOut) external;                            // anyone, within retryWindow
function emergencyUnwind() external;                                            // anyone, after emergencyDelay
function expireBuyback() external;                                              // anyone, after retryWindow → OPEN_MIXED
function redeemMixed(uint256 shares, address to) external returns (uint256 stockOut, uint256 usdgOut);

// ---- views ----
function state() external view returns (State);
function currentEpoch() external view returns (Epoch memory);
function epochs(uint256 id) external view returns (Epoch memory);
function poolKey() external view returns (PoolKey memory);
function stockIsCurrency0() external view returns (bool);

// ---- admin (bounded) ----
function setParams(Params calldata p) external onlyOwner;   // reverts outside bounds (§6.6)
function setKeeper(address k) external onlyOwner;
function setDepositsPaused(bool) external onlyOwner;
```
**No function may transfer vault assets to owner/keeper** except the performance fee to `feeRecipient` inside `settle`.

### 6.4 Epoch record
```solidity
struct Epoch {
  uint64 id; uint64 armedAt; uint64 windowEnd;
  uint256 p0;               // feed answer at arm
  RungResult[] rungs;        // per-rung: tickLower, tickUpper, liquidity, salt, stockDeployed, stockBack, usdgReceived
  uint256 stockBefore;      // vault STOCK before arm (incl. undeployed)
  uint256 stockDeployed;
  uint256 stockBack;        // STOCK returned from position
  uint256 usdgReceived;     // USDG from fills (+ fees)
  uint256 stockBought;      // from buyback
  uint256 usdgLeft;
  int256  pnlStock;         // stockAfter - stockBefore (before fee)
  uint256 feeStock;
}
```

### 6.6 Parameters & hard bounds
| Param | Default | Bound |
|---|---|---|
| Ladder rungs | §5.0's default: `[{800,400,2500},{1500,700,3000},{2500,1000,2500},{4000,1500,2000}]` | see §5.0 per-rung bounds |
| `deployBps` — **community instance** (`restrictedDepositor = 0`) | 3000 | ≤ 5000 |
| `deployBps` — **MetaVault instance** (`restrictedDepositor = metaVault`) | **decision pending** — see note below | ≤ 5000 (same hard ceiling either way) |
| `buybackSlippageBps` | 100 | ≤ 300 |
| `perfFeeBps` | 1000 | ≤ 2000 |
| `armDelay / minFrozen / maxPreCloseAge` | 5m / 15m / 6h | fixed ranges in code |
| `settleDelay / maxFreshAge` | 1h / 1h | ≥ 30m / ≤ 2h |
| `armGrace / settleGrace` | 2h / 6h | ≤ 12h |
| `retryWindow / emergencyDelay` | 48h / 96h | fixed |
| `sessionOffset` (in SessionClock) | 0 | −3h … +3h |
Keeper-supplied arm params must satisfy every rung being **at least as conservative** as the default ladder
(premium ≥ default for that rung, width ≤ bound, deploy ≤ default) — same principle as the old single-range rule,
now applied per rung.

**`deployBps` for MetaVault's own instances is an open decision, not yet made.** Since community and MetaVault
capital are on separate instances (§6.1, §6.5.3), `deployBps` no longer has to protect a passive depositor who
never opted into this — it only bounds MetaVault's own exposure. Raising it (toward the 5000 ceiling) increases
both the upside on a squeeze (M3.5's backtest showed only +0.44% NAV on a +30% squeeze, mostly because of this
same param compounding with `allocBps`) and the downside on a gap-up (a worse version of M3's observed −0.49%
weekend). This is a real trade-off, not a free improvement — implement the split so it's settable independently,
default it to the same 3000 as community for now, and revisit the number once more paper-mode weekends of real
data are in.

### 6.7 Unlock-callback flows (PoolManager direct)
Encode an `Action` enum in `unlock(data)`; `unlockCallback` must `require(msg.sender == address(poolManager))`.

**ARM** (loop over each of the ≤4 rungs in one callback)
1. For each rung: `poolManager.modifyLiquidity(key, {tickLower, tickUpper, liquidityDelta: +L_i, salt: bytes32(i)}, "")`.
2. Sum owed STOCK across all rungs. Pay once: `poolManager.sync(stock)`; `stock.transfer(poolManager, totalOwed)`; `poolManager.settle()`.
3. Assert total USDG delta == 0 across all rungs (every rung single-sided). Store epoch with per-rung results.

**SETTLE**
1. For each rung: `modifyLiquidity(key, {tickLower, tickUpper, liquidityDelta: -L_i, salt: bytes32(i)}, "")` → accumulate
   callerDelta (positive STOCK and/or USDG) per rung into totals.
2. If total USDG credit > 0: **one combined swap** — `poolManager.swap(key, {zeroForOne: S1, amountSpecified:
   -int256(totalUsdgCredit), sqrtPriceLimitX96: sqrtCap}, "")`.
3. Net deltas: take all positive STOCK (`poolManager.take(stock, this, amt)`); take any remaining USDG credit.
4. Outside callback: compute `pnlStock`; if > 0 send `feeStock = pnl·perfFeeBps` to `feeRecipient`; check `minStockOut`
   when called by keeper; state = OPEN if `usdgLeft == 0` else PENDING_BUYBACK.

**RETRY_BUYBACK**: swap only (step 2–3 of SETTLE) with fresh cap.
**EMERGENCY_UNWIND**: step 1 (all rungs) + take, no swap → PENDING_BUYBACK.

### 6.8 Events & errors
Events: `Armed(id,p0,tickLower,tickUpper,stockDeployed,liquidity)`, `Settled(id,stockBack,usdgReceived,stockBought,usdgLeft,pnlStock,feeStock)`,
`BuybackRetried(id,stockBought,usdgLeft)`, `EmergencyUnwound(id)`, `ParamsUpdated(Params)`, `KeeperUpdated(address)`.
Custom errors: `WrongState, NotWindow, TooEarly, OracleStale, OracleNotFrozen, OraclePaused, SequencerDown,
ParamOutOfBounds, NotKeeper, RangeInvalid, NotSingleSided, SlippageMinOut, OnlyPoolManager`.

---

## 6.5 MetaVault — the platform layer (what the user actually deposits into)

### 6.5.0 Why this exists
§3.5's data killed the "deposit your GLXY, wait" product: per-ticker, a squeeze is close to a one-off. What recurs
is the *basket*-level rate (~1 squeeze every 2 weekends across all no-feed listings). A single vault that rotates
capital across whichever basket member looks primed each week is the product that actually matches the evidence.
`OffmintVault` (§6) doesn't go away — it becomes the engine MetaVault drives, unchanged.

### 6.5.1 What the user does
Deposit and withdraw **USDG**. One share token (`omMETA`), one NAV, no per-ticker decision for the depositor to make.
This is also the answer to "buy/sell flow": there isn't a user-facing swap. The buying happens inside the vault, on
the depositor's behalf, as part of the weekly cycle below.

### 6.5.1a State machine (precise — §6.2's table, not a description, is the model here)
```
IDLE  --keeper SELECT + BUY-IN (≥1 candidate funded)-->  CYCLE_ACTIVE
CYCLE_ACTIVE --every BasketPosition cleared (UNWIND or EarlyUnwind, none left open)-->  IDLE
```
- **`IDLE`**: `basketPositions.length == 0`. `deposit()`/`withdraw()` enabled (standard ERC4626).
- **`CYCLE_ACTIVE`**: at least one `BasketPosition` is open, in ANY of {bought-in, armed, settling, unwinding}.
  `maxDeposit`/`maxWithdraw` = 0 — same reasoning as §6.2, NAV must not move under a depositor mid-cycle. This is
  a single coarse gate, not one flag per position: **the vault is IDLE only when every position from that week's
  cycle has fully cleared**, including a slow partial-fill unwind that drags past Monday into Tuesday or
  Wednesday. There is no calendar-day rule for when deposits reopen — only "all positions cleared."
- If `maxConcurrent > 1` and positions clear at different times (one squeezes and settles Monday, another never
  squeezed and unwinds cleanly Monday too, but a third partial-fills into Wednesday) — the vault stays
  `CYCLE_ACTIVE` until the *last* one clears. Track this with `openPositionCount`, decremented on each clear;
  `IDLE` iff `openPositionCount == 0`.

### 6.5.1b `totalAssets()` — the actual NAV computation
MetaVault's assets are never purely its own USDG balance once a cycle is active. Three components, summed:
```
totalAssets = USDG.balanceOf(this)                                              // idle capital
            + Σ over open BasketPositions:
                if not yet armed:  position.stockAmount × currentPriceUSDG(stock)   // held directly, pre-arm
                if armed:          OffmintVault(stock).convertToAssets(obShares) × currentPriceUSDG(stock)
                                    // MetaVault's obTICKER share balance in that sub-vault, in STOCK terms,
                                    // converted to USDG terms via that ticker's own oracle (§3.6/§4)
```
`currentPriceUSDG(stock)` reads through the same oracle the ticker's `OffmintVault` uses (`PushPriceReference` or
Chainlink) — never a second, independent price source for the same ticker; that would let the two disagree and
create an arbitrageable NAV. This is a `view` function called on every `deposit`/`withdraw`/`previewX` — but those
are only reachable in `IDLE` (§6.5.1a), where by definition the sum above reduces to just `USDG.balanceOf(this)`.
The multi-term version matters for off-chain display (`/app`'s live NAV chart, §9) during `CYCLE_ACTIVE`, not for
any onchain deposit/withdraw path — nobody can deposit or withdraw while it would actually need to be computed
for a state-changing call, which removes an entire class of manipulation-during-computation risk by construction.

### 6.5.2 The weekly cycle (this is the full "resolve" flow, start to finish)
```
Mon–Wed  IDLE        MetaVault holds USDG. Deposits/withdrawals open (ERC4626 as usual).
Wed/Thu  SELECT       Keeper reads basket.json (§3.7). Score each candidate:
                       `score = w1×(7d pool-volume growth %) + w2×(top non-USDG pool's volume share %)` — the
                       exact BONER/HIMS signal, made concrete (defaults w1=w2=1, tunable, logged every week for
                       the pitch). **For pools younger than 14 days (exactly the GLXY/HIMS case)**, "7-day
                       growth" is undefined on a literal 7-day window — compare the two halves of whatever
                       history actually exists instead, and use 0 for pools under 2 days old (too little history
                       to mean anything, safe default is "no signal yet," not a fabricated number).
                       Pick up to `maxConcurrent` (default 2) candidates scoring above `minScoreBps` (default
                       10000); **below that bar, pick fewer — zero candidates most weeks is the expected, normal
                       outcome, not an edge case.** Never picks a ticker already flagged skip/earnings (§8) or
                       currently blacklisted (§6.5.3).
Wed/Thu  BUY-IN        For each candidate: swap up to `allocBps` (default 3000, ≤5000 hard bound) of MetaVault's
                       USDG for that STOCK. **This is the exact same swap primitive as Monday's buyback (§6.7
                       SETTLE step 2) — spend USDG, buy STOCK, capped against a price limit — just called earlier
                       and funded from MetaVault's own balance instead of settle proceeds. No new swap logic.**
                       Direct `PoolManager.swap()` inside `unlock()`, same `PoolKey` used for that ticker's
                       arm/settle. Not 1inch/0x for v1 — that's a stretch optimization (§ below), not the MVP path;
                       reusing tested code beats a new external dependency this close to Oct 4.
                       **Two separate checks, don't conflate them:** (1) a *pre-check* — refuse to even attempt if
                       current pool price > `PushPriceReference × (1 + buyInSlippageBps)`, so MetaVault doesn't
                       chase a squeeze that's already started; (2) the swap's own `sqrtPriceLimitX96`, set to that
                       same cap, so the trade **itself** cannot be sandwiched within the same transaction — a
                       pre-check alone doesn't stop a same-block sandwich, the execution-time limit does. Both are
                       required; this mirrors the buyback's cap (§6.7), which already gets this right for
                       UNWIND — BUY-IN needs the identical treatment, not just a lighter version of it.
                       Partial-fill-safe: thin liquidity → less STOCK bought than planned, never a worse price
                       than the cap.
                       Records `buyInPrice` and `buyInAt` for the position (needed by the stop-loss below).
Thu–Fri  STOP-LOSS      Between BUY-IN and Friday, a few hours before Saturday's arm — **not** "until Saturday":
                       `arm()` is only callable by the ticker's own configured keeper, not by MetaVault directly,
                       so MetaVault deposits its bought-in STOCK on Friday and the same keeper that already
                       arms/settles every `OffmintVault` instance arms this one Saturday as usual — MetaVault
                       itself never calls `arm()`. The stop-loss window closes at that Friday deposit, not at
                       Saturday's freeze. Anyone can call `triggerEarlyUnwind(stock)` before that point; it
                       reverts unless current price ≤ `buyInPrice × (1 − earlyUnwindThresholdBps)` **AND the
                       price source is not paused/halted** (same `oraclePaused()`/halt-flag discipline as every
                       other price read in this system, §4/§3.6 — a legitimate dividend/split multiplier jump
                       must never look like a crash to this check). If it fires: exits via the same UNWIND
                       primitive (below) immediately, before that candidate ever reaches the weekend ladder. No
                       replacement candidate is picked for the freed slot that week — proceed into the weekend
                       with fewer positions rather than rushing a second pick under time pressure. Emits
                       `EarlyUnwind(stock, buyInPrice, exitPrice, lossUSDG, lossBps)` — **loss is denominated in
                       USDG, not STOCK: MetaVault's own accounting is USDG-native, and a stop-out is fundamentally
                       a dollar loss, not a share count.**
                       **The realized loss counts toward `weeklyLossCapBps` exactly like a full-cycle loss** —
                       an early-unwind exit is still a loss-realization event; a ticker that keeps getting stopped
                       out must still reach the blacklist, not quietly bypass it by exiting early every time.
                       **Scope, stated precisely: this window closes at the Friday deposit, a few hours before
                       Saturday's `arm()`, not at arm itself.** Once deposited into the ladder, this guard no
                       longer applies — see §6.5.5.
Sat 00:00 ARM          For each funded candidate still open (i.e. not stopped out): deposit the STOCK into that
                       ticker's `OffmintVault` and call `arm()` — §6's unchanged ladder logic takes over completely
                       from here.
Mon+      SETTLE       §6's unchanged settle logic runs per sub-vault.
Mon+      UNWIND        MetaVault withdraws its position (principal + any pnlStock) from each sub-vault and sells
                       the STOCK back to USDG — **the mirror of BUY-IN, same primitive, reverse direction, same
                       partial-fill-safe cap** (`unwindSlippageBps`, refuse to sell below fair price minus that
                       bound). Thin liquidity → sells what fills, holds the remainder for a later retry rather
                       than accepting a bad price; NAV floats with the held STOCK's live value until it clears.
                       Profit or loss for the week is realized in USDG terms in MetaVault's NAV once fully unwound.
```
Deposits/withdrawals are open in IDLE; disabled while any BUY-IN/ARM/SETTLE is in flight for the same reason §6.2
disables them mid-epoch — NAV must not move under a depositor mid-cycle.

### 6.5.3 Contracts
- `MetaVault` — `ERC4626` (`asset = USDG`), owns a mapping `ticker → OffmintVault` (its own exclusive instance,
  deployed via `VaultFactory` in §6.5.4).
- **MetaVault never deposits into the same `OffmintVault` instance a community depositor can reach, and a
  community depositor's stock is never in the same instance MetaVault buys into.** Each basket ticker gets up to
  two `OffmintVault` deployments: the open, community one (`restrictedDepositor = address(0)`) for anyone who
  already holds that stock and wants genuinely market-neutral yield on idle weekend holdings, and MetaVault's own
  (`restrictedDepositor = address(metaVault)`) for its actively-bought-in capital. Both run the exact same
  unchanged ladder mechanics, and both can post range orders into the same underlying Uniswap pool — only the
  accounting is separated, not the market-supply effect. This is the fix for the earlier pooled-deposit design:
  a market-neutral depositor's risk and timing must never be shaped by MetaVault's speculative decisions, or vice
  versa. See §6.1 for the mechanism (`restrictedDepositor`).
```solidity
struct BasketPosition {
  address stock; uint256 stockAmount; uint256 buyInPrice; uint64 buyInAt; bool armed;
}  // one live entry per currently-funded candidate; cleared on UNWIND or EarlyUnwind
```
- New bounded params (same pattern as §6.6): `maxConcurrent` (≤3), `allocBps` (≤5000), `buyInSlippageBps` (≤100),
  `unwindSlippageBps` (≤100), `earlyUnwindThresholdBps` (default 800 = 8%, bound 500–1500 — below 5% trips on
  ordinary noise, above 15% stops protecting against much), `weeklyLossCapBps` (**default 1000 = 10%**, ≤2000 —
  hard stop: if buy-in-to-unwind loss on any single ticker exceeds this, that ticker is auto-blacklisted from the
  basket for `blacklistDays` (**default 28, bound 7–90**), no keeper override; **the blacklist is ticker-level,
  checked against either instance's realized losses** — a bad outcome in the community pool is still a signal
  MetaVault shouldn't pick that ticker next, and vice versa), `minScoreBps` (**default 10000**, the SELECT bar
  from §6.5.2 — tunable, logged every week).
- **Revenue: `txFeeBps`** (default 50 = 0.5%, hard bound ≤200 = 2%) — charged on both `deposit()` and `withdraw()`
  of MetaVault, sent to `feeRecipient` (same recipient as `perfFeeBps`). This is flat, on every transaction,
  independent of whether that week was profitable — the second of two revenue lines, alongside the existing
  `perfFeeBps` (10% of realized profit, §6.5.3/§6.7). Implement as the standard ERC4626 fee-vault pattern — skim
  in `_deposit`/`_withdraw` (or override `previewDeposit`/`previewWithdraw` consistently with them), never skim in
  a way that lets repeated deposit/withdraw arb the vault or drift share price outside a transaction. Not charged
  on the community `OffmintVault` instance's deposit path — that stays free, scope the fee to MetaVault only,
  where the actual revenue driver is.

### 6.5.4 `VaultFactory`
```solidity
function deployVault(address stock, address restrictedDepositor) external returns (address vault);
    // owner-only (§3.7 step 2 — no onchain registry exists to gate this permissionlessly).
    // restrictedDepositor = address(0) for the community instance,
    // address(metaVault) for MetaVault's exclusive instance. A ticker typically gets both deployed once it
    // qualifies (§3.7) — not lazily, keep this simple.
function vaultFor(address stock, address restrictedDepositor) external view returns (address);
    // look up either instance by the same key used to deploy it
function allVaults() external view returns (address[] memory);
```
Deploys a new `OffmintVault` wired to `PushPriceReference` (no-feed basket member) or `ChainlinkOracle` (has a feed),
decided by an onchain check mirroring §3.7 step 3. Reverts if a vault for that `(stock, restrictedDepositor)` pair
already exists, or if the token address isn't in Robinhood's canonical registry (§3.7 step 2 — the anti-scam guard
belongs in the factory,
not just offchain tooling, since this function is meant to be callable by anyone).

### 6.5.5 The honest risk disclosure (state this plainly in the UI, not buried)
This is **not market-neutral**. MetaVault actively buys into thinly-traded, often meme-adjacent, newly-listed stocks
ahead of a hoped-for weekend squeeze. If the squeeze doesn't happen, MetaVault just holds a normal position in a
volatile small-float stock for a few days and unwinds at whatever Monday's price is — a real, ordinary market risk,
not a mechanism failure.

Three things bound the damage, and it's worth being precise about what each one actually covers, because none of
them make this risk-free:
- **`earlyUnwindThresholdBps` (the stop-loss)** cuts a bad pick loose *before* the weekend — but only in the window
  between BUY-IN and ARM. The moment a position is armed into the weekend ladder, this guard no longer applies;
  a Saturday-to-Monday move on an armed position is not covered by it.
- **`allocBps`** caps how much of the vault goes into any one pick.
- **`weeklyLossCapBps`** blacklists a ticker after a bad result, so the same mistake can't repeat immediately.

Together these reduce the downside. They do not eliminate the risk of picking wrong, and no combination of onchain
guards can — holding a volatile asset for several days is a real market exposure by definition. Never describe this
product as "risk-free," "safe," or "market-neutral" in the UI, docs, or pitch. State the mechanism and its actual
scope, not a stronger claim than the mechanism supports.

---

## 7. Pools

- **Testnet:** deploy (or `MockUSDG`, 6 dec, if no testnet USDG) and create our own STOCK/USDG pool:
  fee 3000, tickSpacing 60, `hooks = address(0)`, initialised at the MockFeed price. Seed two-sided liquidity from the deployer.
  `script/DemoBuyer.s.sol` buys STOCK with USDG to push a premium during the demo.
- **Mainnet (paper/fork):** for each ticker find the deepest STOCK/USDG v4 pool from PoolManager `Initialize` events;
  record `PoolKey` in `contracts/config/mainnet.json`. Reject pools whose hook reverts on `beforeAddLiquidity`.
- Reading slot0 offchain: use StateView if its Robinhood address is confirmed; otherwise `poolManager.extsload` with the
  v4 StateLibrary layout (`POOLS_SLOT = 6`, slot = keccak256(poolId, POOLS_SLOT)).

---

## 8. Keeper (`keeper/`, TypeScript + viem)

- Config: `keeper/config.<chain>.json` → vaults `{ address, stock, feed, poolKey, ticker }`, RPC, key (env).
- Loop every 60 s per vault:
  1. Read `state`, clock, feed, `oraclePaused`, `newUIMultiplier()/effectiveAt()`.
  2. **Arm** when §4 conditions hold. Params: `premiumBps = max(default, ticker table)`; skip if a corporate action
     `effectiveAt` falls inside the window, or ticker is in `skip.json` (earnings/news, manual).
  3. **Settle** when §4 conditions hold. `minStockOut` from Quoter simulation minus 0.5%.
  4. **Retry** buyback every 15 min while PENDING_BUYBACK.
- **Paper mode (`npm run paper`)** — read-only on mainnet, no key:
  at window start record P0 + hypothetical band per ticker; stream PoolManager `Swap` logs for target pools; compute
  hypothetical fills (same math as backtest §10); at window end + delay record hypothetical buyback.
  Write `web/public/paper/<date>-<ticker>.json`. **Must be running before Sat 26 Sep 00:00 UTC.**
- Logs: JSON lines to `keeper/logs/`. Optional Telegram webhook (env) for arm/settle notifications.

---

## 9. Web (`web/`, Next.js 15 + wagmi v2 + viem + Tailwind + RainbowKit)

| Route | Content |
|---|---|
| `/` | Hero: "They price the weekend. We supply it." One line stating what MetaVault actually does (deposit USDG, we rotate into the week's most vulnerable newly-listed stocks, you get more USDG back). The GLXY + HIMS chart as proof, not just HIMS. The risk disclosure (§6.5.5) belongs on this page, not hidden in a footer. CTA to `/app` and `/monitor`. |
| `/app` | The product. Connect wallet, deposit/withdraw USDG into `MetaVault`, live NAV chart, current cycle state (IDLE/SELECT/BUY-IN/ARMED/SETTLE), **this week's picks with the reason the detector/keeper picked them**, countdown to next Sat 00:00 UTC, history of past weekly cycles (win/loss/no-fill per ticker, from events). This replaces the old `/vault` per-ticker picker — a depositor never chooses a ticker. |
| `/monitor` | Live table (mainnet, no wallet): every basket member from `basket.json`, Chainlink-vs-none status, `PushPriceReference` price, pool price, premium %, session state, countdown. This is also where the detector's work is visible — new listings appear here the moment they're discovered, before any cycle touches them. |
| `/vault/[ticker]` | Advanced/transparency view — shows **both instances side by side when both exist**: the community pool (open, market-neutral, `restrictedDepositor = address(0)`) and MetaVault's own (`mbTICKER`, this week's pick if any). Each with its own epoch history and current rungs if armed. Making the separation visible here is itself part of the honesty requirement (§6.5.5) — a visitor should never have to wonder which pool they'd be joining. Not the primary user path; linked from `/app`'s "this week's picks." |
| `/backtest` | HIMS (28–31 Aug) **and** GLXY (12 Sep) replays, side by side — two real events, not one. Price path, band, fills, summary, and the honest caveat (a live vault dampens the spike; real fills differ). |
| `/paper` | Live paper-mode results, now explicitly labeled per ticker (HIMS/NVDA/SPY/GLXY/NU), running through the Sep 26–28 and Oct 3–4 weekends. |

Addresses from `web/src/config/addresses.<chainId>.json` (written by deploy script). Charts: recharts.
Follow the frontend-design guidance: calm, trustworthy, finance-grade; no neon. The `/` and `/app` copy must not
read as "safe passive yield" — §6.5.5's disclosure is a design requirement, not a legal afterthought.

### 9.1 Onboarding & wallet
**Decided: standard wallet-connect only.** RainbowKit, already in the stack. User brings their own wallet and their
own ETH for gas — same as any normal dApp, zero new integration, zero sponsored-gas abuse surface to manage.
~~Sponsored transactions via Privy + Alchemy paymaster~~ — considered, dropped for simplicity. Do not build this.

**Jurisdiction notice, not a gate.** Stock Tokens aren't available to US persons and are restricted in a few other
jurisdictions (Robinhood's own terms). Show this plainly at signup as a disclosure. Do not build wallet-geofencing,
IP checks, or KYC — same reasoning as §6.5.5: state the fact, don't build enforcement machinery around it.

---

## 10. Backtest (`backtest/`)

- Event: `hims-2026-08-28`. P0 = feed price at Fri close (read feed history via `getRoundData`, or use $28.84 if unavailable).
- Data: `eth_getLogs` on PoolManager `Swap` events filtered by `poolId` (topic1) for HIMS pools, Fri 20:00 UTC → Mon 06:00 UTC,
  chunked; fall back to Blockscout API. Convert `sqrtPriceX96` → USD per HIMS (orientation-aware).
- Simulation: band `[P0·1.10, P0·1.60]`, deployed Q ∈ {10, 50, 100} HIMS. Walk the price path; when price enters the band,
  compute STOCK sold between successive prices with concentrated-liquidity amounts for liquidity L; buyback at first
  post-reopen pool price after `settleDelay`, capped at feed·1.01.
- Output `web/public/backtest/hims-2026-08-28.json`: timeline, fills, avg sell, usdgReceived, stockBought, net ΔSTOCK, % vs HODL.
- **Friction costs, not just isolated ladder P&L:** subtract two swap-fee legs (buy-in + unwind, pool fee tier
  each), realistic slippage on both, and `txFeeBps` from the headline number. A marginal squeeze can flip from
  profitable to negative once real round-trip costs are counted — show both the gross and net figures on
  `/backtest` so this isn't hidden.
- **State the caveat in UI:** a live vault would have dampened the spike; real fills would differ.
- Stretch: every ticker × every weekend since 3 Jul 2026 → summary table.

---

## 10.5 AI Advisor (v2, stretch — does NOT block Oct 4 submission)

**Honesty rule for this section:** the keeper (§8) is deterministic automation, not AI, and the pitch must say so
plainly. The place real model judgment earns its keep is **target selection**, not trade execution — a threshold
check doesn't need a model; "should we trust this ticker's price this weekend" does.

### What it is
A separate, read-only service (`advisor/`) that runs once per ticker per week, before Saturday arm time. It:
1. Pulls the ticker's upcoming earnings date / known corporate actions, recent news headlines, and the current pool
   composition (has a new non-USDG pool appeared? has volume share shifted to it? — the exact BONER/HIMS pattern).
2. Reasons over that (LLM call, e.g. Claude via the Messages API) and outputs one of: `NORMAL`, `WIDEN` (increase
   every rung's premiumBps by a bounded multiplier, e.g. ×1.5), `SKIP` (do not arm this ticker this weekend), each
   with a one-paragraph rationale logged for the demo.
3. Writes the recommendation to `advisor/out/<ticker>-<epoch>.json`. **It writes nothing onchain and calls no
   contract function, ever.**

### How it plugs into the keeper (the only integration point)
The keeper (§8) reads the advisor's output file, if present, before calling `arm()`. It may use `SKIP` to not call
arm, or `WIDEN` to pass a wider (never narrower) ladder than the default — both already legal keeper actions per
§6.5's rule that keeper-supplied params must be **≥ as conservative** as defaults. If the advisor's output is
missing, stale (>24h old), or malformed, the keeper **ignores it and uses defaults** — the advisor is additive
safety, never a dependency. No contract change is required to add this; `Params` bounds already make every advisor
output a strict subset of what the keeper could already do.

### Why this design, not "the AI trades"
- It's a true story under questioning: execution stays boring and auditable on purpose (that's what makes it
  trustworthy with money); judgment goes where judgment is actually needed and a formula can't reach.
- It cannot introduce a new failure mode — worst case, a bad recommendation makes the vault *more* conservative
  (skip or widen), never less. This mirrors the keeper's own bound and is the same argument, one layer up.
- It's demoable without being load-bearing: show the advisor flagging a real upcoming earnings date and explain what
  it would have done, without needing that exact scenario to occur during the hackathon window.

### Acceptance criteria (M8, post–Oct 4 only)
- Runs against the curated ticker list (§3.5) weekly.
- Every recommendation is logged with its rationale and shown on `/monitor`.
- A test proves the keeper ignores missing/stale/malformed advisor output and falls back to defaults.
- README states explicitly: "the advisor never has onchain permissions; it can only make the keeper more conservative."

---

## 11. Milestones & acceptance criteria (today = Wed 23 Sep 2026)

| # | Dates | Deliverable | Acceptance |
|---|---|---|---|
| M0 | 23 Sep | Scaffold monorepo; on-chain fact checks (§13) recorded in `contracts/config/*.json` | `forge build` ok; facts file filled or marked UNVERIFIED |
| **M0.5** | **23–24 Sep** | ~~Fixed ticker curation~~ **Superseded by real data (§3.5) — replaced by §3.7 Detector + §6.5 MetaVault** | Evidence: 2 squeezes / 4 weekends, on 2 different tickers → basket model, not a fixed list |
| M1 | 24–25 Sep | **Keeper paper mode** (read-only mainnet, full no-feed basket incl. GLXY/NU) + `/monitor` minimal | ✅ Running against mainnet. Railway deploy still outstanding — **do tonight**, before Sat 26 Sep 00:00 UTC |
| M2 | 24–27 Sep | `SessionClock`, `ManualSessionClock`, `RangeMath` (ladder, §5.0–5.2) + unit/fuzz tests | **Unblocked — proceed.** Unchanged by the MetaVault pivot; this is the engine. |
| M3 | 26–29 Sep | `OffmintVault` + laddered unlock flows; integration tests vs locally deployed PoolManager | **Unblocked — proceed.** Same acceptance as before (§12). |
| **M3.5** | **28 Sep–1 Oct** | **`MetaVault` + `VaultFactory`** (§6.5) — weekly cycle, bounded buy-in/unwind, `weeklyLossCapBps` | Full cycle test: IDLE→SELECT→BUY-IN→ARM→SETTLE→UNWIND→IDLE, NAV up on a simulated squeeze, capped loss on a no-squeeze. **Plus:** `restrictedDepositor` isolation — a community depositor's `deposit()` call reverts against MetaVault's instance and vice versa, confirmed on two separately-deployed instances for the same ticker; stop-loss fires and its loss reaches the blacklist; stop-loss refuses while oracle paused/halted; buy-in sandwich attempt reverts/partial-fills at the cap, doesn't just get pre-checked; `txFeeBps` charged correctly on deposit/withdraw; `totalAssets()` correct with one position armed and one still pre-arm simultaneously (§6.5.1b) |
| M4 | 29–30 Sep | Mainnet fork test (real STOCK + feed/`PushPriceReference`, `vm.warp`) + backtest JSON for **both** HIMS and GLXY | Fork test green; both events reproduced |
| M5 | 1–2 Oct | Web `/app` `/monitor` `/vault/[ticker]` `/backtest` `/paper`; testnet deploy + DemoBuyer script | Live testnet demo: deposit USDG → cycle runs → NAV moves → withdraw more USDG than deposited |
| M6 | 3 Oct | README, architecture diagram, 3-min demo video, 5-slide deck; paper mode running for Oct 3–4 weekend | Checklist §14 complete; deck states the basket-not-list finding and §6.5.5's risk disclosure honestly |
| **SUBMIT** | **4 Oct before 07:59 UTC** | HackQuest Singapore submission | — |
| M7 | 5–11 Oct | Hardening, `requestWithdraw` queue, optional mainnet micro-deploy (user approval), Colosseum write-up | — |
| **M8** | **5–11 Oct (stretch, optional)** | **AI Advisor (§10.5)** — now advises the MetaVault's weekly SELECT step, not just per-ticker arm | Keeper falls back to the plain heuristic when advisor output missing/stale/malformed |
| **SUBMIT** | **12 Oct** | Colosseum World's Fair, Robinhood track (disclose all prior work) | — |

---

## 12. Test plan (Foundry)

Unit
- SessionClock: every weekday boundary, offset ±1h, Sat 00:00:00 inclusive, Mon 00:00:00 exclusive.
- RangeMath: both orientations; negative ticks; spacing snap direction; round-trip fuzz; single-sided assertion.
- Vault: each `arm`/`settle` revert condition individually (state, window, frozen, recent close, paused, sequencer, bounds, keeper-only before grace).
- ERC4626: deposit/withdraw only OPEN; inflation attack (first depositor donate) fails to steal.
Integration (local PoolManager)
- Profit: deposit 100 → arm → swaps push price into band → reopen at P0·1.02 → settle → STOCK > 100·(1 − fee on profit).
- Gap-up: reopen at P0·1.5 → buyback hits cap → PENDING_BUYBACK → price falls → `retryBuyback` completes → OPEN.
- No-fill weekend: settle returns exactly deployed STOCK (+0 fees) → OPEN.
- Emergency: no fresh feed → `emergencyUnwind` after 96h → PENDING_BUYBACK → `expireBuyback` → `redeemMixed`.
- Sandwich at settle: attacker pushes price up before settle → swap stops at cap; no loss beyond slippage bound.
Invariant (handler-based)
- Sum of assets never decreases except via fills/buyback/fee; owner/keeper balances never increase from vault.
Fork
- Mainnet: real STOCK/feed/PoolManager; `deal` STOCK; warp to Saturday; arm; simulate buys; warp to Monday; mockCall feed fresh; settle.

---

## 13. Facts to verify on day 1 (fill `contracts/config/*.json`)

```bash
cast code 0x8366a39cc670b4001a1121b8f6a443a643e40951 --rpc-url https://rpc.testnet.chain.robinhood.com   # v4 on testnet?
cast call <TESTNET_TSLA> "uiMultiplier()(uint256)"  --rpc-url https://rpc.testnet.chain.robinhood.com
cast call <TESTNET_TSLA> "oraclePaused()(bool)"     --rpc-url https://rpc.testnet.chain.robinhood.com
cast call <MAINNET_HIMS_FEED> "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url https://rpc.mainnet.chain.robinhood.com
```
- Testnet STOCK + USDG addresses: claim from faucet.testnet.chain.robinhood.com, read from the tx on the testnet explorer.
- Mainnet STOCK addresses: docs.robinhood.com/chain/contracts (live registry). Feeds + L2 sequencer uptime feed:
  docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood.
- StateView / Quoter addresses on Robinhood mainnet (else use extsload / local quoting).
- Deepest hook-compatible STOCK/USDG pool per ticker.
- Testnet settlement layer: Sepolia is reported to retire around end of Sep 2026 — watch docs.robinhood.com/chain/notices-and-upgrades.
  **Fallback demo = mainnet fork + recorded video.**
- Stock Token jurisdiction list before any mainnet deposit.

---

## 14. Submission checklist

- [ ] Public GitHub repo, clean history, MIT licence
- [ ] README: problem (HIMS chart), how it works (diagram), deployed addresses + explorer links, how to run, test command, risks
- [ ] Contracts deployed + verified on Robinhood Chain testnet (and/or Arbitrum Sepolia if HackQuest requires)
- [ ] Demo video ≤ 3 min: problem → /monitor live → testnet cycle → backtest → safety
- [ ] 5-slide deck: Problem · Why (minting window + frozen oracle) · Mechanism · Proof (backtest + paper) · Safety & roadmap
- [ ] Risk disclosure in UI and README (Monday gap-up = covered-call trade-off; buyback cap; unaudited)
- [ ] Colosseum: disclose all development done before/for Singapore
- [ ] Judge Q&A prepared: "isn't this just LP?", "Monday gap?", "oracle manipulation?", "why holders deposit?"

## 15. Out of scope for v1
Multi-asset baskets, cross-chain (xStocks on Solana), auto-compounding into other venues, governance token, audits.
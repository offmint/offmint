# Price reference adapter (draft)

**Status:** draft abstraction. `IPriceReference` and `ChainlinkPriceReference` exist and are tested. **Nothing is wired into
`OffmintVault`.** A switch would be a contract change touching a security invariant, so it needs sign-off. This doc exists
so either branch of the M0.5 decision can move quickly.

## Why this exists
M0.5 found that every ticker with a Chainlink feed stayed calm (weekend max <= +3.7%), and the one real squeeze (HIMS,
+317.6%) happened on a ticker Chainlink does not cover. Chainlink covers liquid names, and liquid names are too deep for a
meme pool to capture their float. The vault's safety design and the market's danger zone point at different tickers.
Option (b) of M0.5 measures whether that holds across the other no-feed names.

## The interface
```solidity
interface IPriceReference {
    function read() external view returns (uint256 price, uint8 decimals, uint256 updatedAt); // reverts if unhealthy
    function description() external view returns (string memory);
}
```
The vault's timing rules (SPEC §4) only need `(price, updatedAt)`:
- **arm:** frozen (`now - updatedAt >= minFrozen`) and a recent close (`updatedAt >= windowStart - maxPreCloseAge`).
- **settle / retry:** fresh (`updatedAt >= windowEnd`, `now - updatedAt <= maxFreshAge`), and the buyback cap = `price x (1 + slippage)`.

Health checks (answer > 0, issuer `oraclePaused`, sequencer) live in the adapter. Freshness is judged by the vault.
`ChainlinkPriceReference` reproduces today's `_readFeed` exactly (6 tests).

## Candidate sources for tickers without a Chainlink feed

### 1. Pool TWAP. Not available as-is on v4, and self-referential
- **Uniswap v4 core keeps no price history.** v3 pools had `observe()`; v4 needs an oracle **hook**, and the vault
  deliberately targets hook-free pools (CLAUDE.md gotcha 8). An on-chain TWAP therefore means either a separate
  hook-based oracle pool, which is itself thin and manipulable, or a TWAP computed offchain and posted, which is option 2.
- **Manipulation vector (applies to any pool-derived P0):** push the pool **down** just before the freeze, so P0 is set
  low, the band sits low and the vault sells real stock cheaply. Then pump it just before settle, so the buyback cap is
  high and the vault buys back expensively. Both legs extract value from depositors.
- **Mitigations, if used:** a long window (hours of Friday trading, not minutes); a sanity band against the last Chainlink
  print of a correlated name, or against the issuer's reference price; bounds on the P0 move since the last epoch; and a
  minimum-liquidity requirement. None of these fully removes the risk on a thin pool, and thin pools are exactly the
  target tickers.

### 2. Signed push oracle: the more robust path, with a trust assumption
- **Data:** the issuer's own reference price. Robinhood documents `GET https://api.robinhood.com/rhj/prices/{symbol}` for
  stock tokens, which makes it the most credible offchain source for these assets. (Endpoint behaviour, rate limits and
  terms need checking before use.)
- **On chain:** `PushPriceReference` stores `(price, updatedAt)` posted by an authorised signer, with bounds enforced at
  post time: timestamps only move forward, max deviation per update, and a sanity band vs the pool price (reject if the
  pool is not within X% of the posted price on a weekday).
- **Invariant risk:** the signer must **not** be the keeper. A keeper that can set the price can move the band and the cap,
  which is an indirect way to extract depositor funds, and CLAUDE.md forbids any path that lets the keeper take funds.
  Use a separate signer key (ideally 2-of-3), keep the keeper deterministic, and state the trust assumption in the README
  and UI.
- **Scope:** about 1-2 days. A `PushPriceReference` contract plus tests, a small signer service that reuses the keeper
  infrastructure, and a vault refactor from `AggregatorV3Interface feed` to `IPriceReference ref`. The ladder, arm/settle
  and buyback cap stay as they are.

### 3. Other on-chain oracles (to verify)
Check whether Pyth, RedStone or Chainlink Data Streams publish equity prices on Robinhood Chain for the no-feed tickers.
If one does, a thin adapter gives coverage without a new trust assumption. Not yet verified.

## Recommendation (pending option b)
- **If squeezes recur across no-feed tickers:** verify option 3 first (cheapest, no new trust). Otherwise build option 2
  with a non-keeper signer. Do not use a pool-derived P0 on thin pools.
- **If squeezes are rare everywhere:** keep Chainlink-only vaults, and pitch the event-driven framing (detect pool
  capture, the BONER/HIMS pattern). The advisor (SPEC §10.5) then becomes the detection layer. It stays read-only and can
  only make the keeper more conservative.

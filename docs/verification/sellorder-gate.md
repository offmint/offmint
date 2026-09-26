# Personal sell order — Step 0 gate (docs/FEATURES.md Feature 3)

**Result: PASS (25 Sep 2026).** Uniswap's own PositionManager and Permit2 on Robinhood Chain testnet (46630) place,
fill and collect a one-sided sell order on our sandbox pool. No new contracts needed.

| | Address | Check |
|---|---|---|
| PositionManager | `0x58daec3116aae6D93017bAAea7749052E8a04fA7` | `poolManager()` = `0x8366a39C…43e40951` (ours, = mainnet bytecode), `permit2()` = canonical, "Uniswap v4 Positions NFT", 7,533 positions minted |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | canonical address, 9,152 bytes of code |

13 other verified contracts named PositionManager exist on testnet: bound to other PoolManagers, non-canonical Permit2,
or reverting getters. Do not use them.

## Anchoring: the level is a premium over the verified reference, never over the pool
`keeper/src/sellOrder.ts` (`sellOrderRange`): level = reference x (1 + premium), rounded away from the price to the
pool's tickSpacing; **refused** (`PoolAboveLevel`) if the pool already trades at or above the level (the vault's
`sellRange` would shift the band up instead; a personal order must not); minimum +5% (`PremiumTooLow`).
Tests: `keeper/test/sellOrder.test.ts`, both orientations, incl. pool at +5% (level still from the reference) and pool at
+10% / +15% vs a +10% order (refused).

## Run (local anvil fork of testnet; nothing broadcast), 25 Sep 2026
`anvil --fork-url https://rpc.testnet.chain.robinhood.com --port 8547 --chain-id 46630` then
`cd keeper && npx tsx src/sellOrderGate.ts`. The script refuses to run against anything but a local anvil fork.
Reference = the sandbox's MockFeed (what the sandbox price reference reads): **$29.13**; pool at start $29.12.

| Case | Pool at placement | Order | Band (vs reference) | Result |
|---|---|---|---|---|
| A | $29.12 (at the reference) | +10%, width 10% | $32.14–34.75 (+10.35% to +19.30%) | 50 HIMS placed (NFT #7534, gas 292,856), squeezed through, collected 0 HIMS + 1,676.15 USDG, avg $33.52 (gas 148,705) |
| B | $35.45 (+21.68% over the reference) | +10% | — | **refused: PoolAboveLevel** |
| B2 | $35.45 | +27%, width 10% | $37.12–39.89 (+27.44% to +36.95% over the **reference**, not the pool) | filled, 1,929.95 USDG, avg $38.60 (NFT #7535, gas 247,498 / 134,974) |

Approval flow used: HIMS `approve(Permit2, max)`, then `Permit2.approve(HIMS, PositionManager, amount, expiration)`.
Actions: MINT_POSITION (0x02) + SETTLE_PAIR (0x0d); collect = DECREASE_LIQUIDITY (0x01) + BURN_POSITION (0x03) +
TAKE_PAIR (0x11).

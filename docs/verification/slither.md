# Slither (AIRTIGHT item 11)

Slither 0.11.6 on `contracts/` (src only; lib, test, script, mocks excluded): 67 contracts analysed, 102 detectors, **73 results**. None required a code change; each class is triaged below. `OffmintVault` is unchanged.

| Impact | Detector | Count | Verdict | Why |
|---|---|---|---|---|
| High | `uninitialized-state` | 1 | False positive | `_rungResults` is a mapping filled through a storage reference (`RungResult[] storage rs = _rungResults[id]; rs.push(...)`, OffmintVault.sol:268); Slither does not follow the storage alias. Ladder tests read it back after every arm. |
| Medium | `divide-before-multiply` | 2 | Intended | `floorToSpacing`/`ceilToSpacing` snap a tick to the pool's spacing, `(t / s) * s` with explicit handling of negative ticks. Fuzz-tested in both orientations (RangeMath.t.sol). |
| Medium | `incorrect-equality` | 2 | Intended | Checks our own sentinel zeros (a skipped rung's `liquidity == 0`, `amount == 0` early return), never a token balance an attacker can move. |
| Medium | `reentrancy-no-eth` | 12 | Mitigated | Every flagged entry point (`arm`, `lock`, `settle`, `retryBuyback`, `emergencyUnwind`, `buyIn`, `triggerEarlyUnwind`, `commit`, `unwind`) is `nonReentrant`; the external calls go to the Uniswap v4 PoolManager (via unlock/callback, which checks `msg.sender == poolManager`), our own OffmintVault instance, or the stock/USDG tokens. State written after the call records results of that call. |
| Medium | `unused-return` | 11 | Intended | Tuple destructuring that keeps only what is used: `getSlot0` (price or tick), `modifyLiquidity` (`callerDelta` already includes fees, so `feesAccrued` is not needed), `pm.settle()` (the amount paid is computed by us), Chainlink `latestRoundData` (answer and updatedAt are checked; round ids are not used), `MetaVault.totalAssets` (display-only fallback to the buy-in price when the reference reverts). |
| Low | `calls-loop` | 16 | Bounded | Loops are bounded: at most 4 rungs, at most 3 MetaVault positions, factory code chunks set once by the owner. |
| Low | `reentrancy-benign` | 3 | Benign | Event emission after external calls; no state inconsistency. |
| Low | `timestamp` | 18 | By design | All time logic uses `block.timestamp` (never `block.number`, which is the L1 height on this Arbitrum Orbit chain). Windows are hours long; miner skew of seconds does not change outcomes. |
| Informational | `assembly` | 3 | Reviewed | `create`/`create2`/`extcodecopy` in VaultFactory (SSTORE2-style code storage, hash-pinned before any deploy). |
| Informational | `cyclomatic-complexity` | 1 | Accepted | Informational. |
| Informational | `unindexed-event-address` | 2 | Accepted | Informational. |
| Optimization | `cache-array-length` | 2 | Accepted | Gas optimization only. |

Reproduce: `python3 -m venv .venv && .venv/bin/pip install slither-analyzer && slither contracts --filter-paths "lib/|test/|script/|mocks/"`

Not an audit: static analysis catches a class of bugs, not economic or design flaws. The code is unaudited.

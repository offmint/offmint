# Personal sell order: live testnet run through the real UI (docs/FINISH.md C3)

**Status: done except the buy back, which the product only allows after Monday's reopen (Mon 28 Sep 00:00 UTC).**

Run 26 Sep 2026, Robinhood Chain testnet (46630), sandbox deployment (`contracts/deployments/sandbox-46630.json`),
dedicated test wallet `0xDd02F5d73cee23AB05a2690f8994c25095A58CEc` (testnet ETH only). The `/sell` page was driven by
Playwright with an injected wallet that signs in Node (`web/scripts/wallet-e2e.mjs sell`); the pool squeeze (the
weekend buyer) was an owner step (`keeper/src/sandboxOps.ts squeeze`). Uniswap's own PositionManager
`0x58daec3116aae6D93017bAAea7749052E8a04fA7` and Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`; no Offmint contract.

Reference (sandbox price reference) **$28.84**; pool at start **$28.84**. Stock is currency1 in this pool (the other
orientation from the fork gate), so both orientations are now covered.

| # | Step | Where | Tx | Result |
|---|---|---|---|---|
| 1 | Approve mHIMS → Permit2 | UI | [0x136fa608…a23f](https://explorer.testnet.chain.robinhood.com/tx/0x136fa6085ebfb632000aaae75e3dd2ac4dd5c254b249ed98b1c44b81d257a23f) | success |
| 2 | Permit2 → PositionManager allowance | UI | [0x2bcbca94…5ddc](https://explorer.testnet.chain.robinhood.com/tx/0x2bcbca941a2febb1a7838cf30f69419a43b54b3ea4d4b564f1aa69d43a8b5ddc) | success |
| 3 | Place sell order: 20 mHIMS, +10% over the reference (band $31.72–$34.61) | UI | [0xc14a1b2d…b0a8](https://explorer.testnet.chain.robinhood.com/tx/0xc14a1b2d400ea276aa3f26ff9f78cbee2684a4e781b8cfcb7de2d2875d1ab0a8) | success, order #10309 ([screenshot](../screenshots/C3-2-order-placed.png)) |
| 4 | Weekend buyer: approve + swap, pool to $36.50 | owner script | [0x6851eb99…1f53](https://explorer.testnet.chain.robinhood.com/tx/0x6851eb99aaf614c87470c415365b6773c0efdae1fa5023f07ca8bba7d2e61f53), [0x31905e60…279e](https://explorer.testnet.chain.robinhood.com/tx/0x31905e605c24b881152452f69c4dab93360d182b4837da0331705eb7abfb279e) | success |
| 5 | Order view after the squeeze | UI | – | **100% filled, 662.46 USDG received** (avg $33.12) ([screenshot](../screenshots/C3-3-order-filled.png)) |
| 6 | Pool above the reference (+26.6%): try +10% | UI | – | **refused**: "the pool already trades at or above this level; pick a higher premium", button disabled ([screenshot](../screenshots/C3-4-pool-above-reference-refused.png)) |
| 7 | Same, custom +35% | UI | – | **anchored to the reference, not the pool**: "Sells between $38.95 and $41.60 (reference x 1.35 to x 1.45)" ([screenshot](../screenshots/C3-5-pool-above-reference-custom-35.png)) |
| 8 | Collect (decrease + burn + take) | UI | [0x804e0a41…2edf](https://explorer.testnet.chain.robinhood.com/tx/0x804e0a410846ec2c083b050bb137e223b1356d7a1edd2df738e75d3fdabb2edf) | success: order shows "collected", "Buy back opens after Monday's reopen" ([screenshot](../screenshots/C3-6-collected.png)) |
| 9 | Buy back, capped at fresh reference x 1.01 | UI | pending | runs after Mon 28 Sep 00:00 UTC: `node web/scripts/wallet-e2e.mjs sell-buyback` |

Raw logs: `keeper/logs/wallet-e2e.jsonl` (UI transactions) and `keeper/logs/sandbox-ops.jsonl` (owner steps), both
local; the hashes above are the record.

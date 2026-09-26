# Community vault: live testnet cycle through the real UI (docs/FINISH.md C4)

**Status: done.** Deposit and withdraw through the `/vault/HIMS` page from a wallet; the weekend in between run on the
sandbox's manual clock. Robinhood Chain testnet (46630), sandbox deployment (`contracts/deployments/sandbox-46630.json`,
community vault [`0x8335696D25C09A21dC6273f9E43762cc1f70Bb8d`](https://explorer.testnet.chain.robinhood.com/address/0x8335696D25C09A21dC6273f9E43762cc1f70Bb8d)),
dedicated test wallet `0xDd02F5d73cee23AB05a2690f8994c25095A58CEc` (testnet ETH only), 26 Sep 2026.

UI steps: Playwright + an injected wallet that signs in Node (`web/scripts/wallet-e2e.mjs vault-deposit`,
`vault-withdraw`). Owner/keeper steps: `keeper/src/sandboxOps.ts` (the sandbox's owner and keeper is the same test
wallet). The vault contract is the unmodified `OffmintVault`.

| # | Time (UTC) | Step | Where | Tx |
|---|---|---|---|---|
| 1 | 07:58 | Pool back to the reference ($28.84) | owner | [0x0894201c…fee6](https://explorer.testnet.chain.robinhood.com/tx/0x0894201c541720457d0c7167cf129d7e20cc020dd32aff4ee5b9bdd8d401fee6), [0x62acdf06…2a34](https://explorer.testnet.chain.robinhood.com/tx/0x62acdf069449861ac6656667d779fbc23d09d80c81c7eb1f2ceb694d98da2a34) |
| 2 | ~08:00 | **Approve + deposit 50 mHIMS** (50,000 shares) | **UI** | [0x75e77afa…bdf](https://explorer.testnet.chain.robinhood.com/tx/0x75e77afaac1393ef65946be624d2a9b8067b612371ca82f5a888453f8892ebdf), [0x8ee24c7d…ab8d](https://explorer.testnet.chain.robinhood.com/tx/0x8ee24c7d81aed27c4fa0bee1f5c6b4218a3cf6c25e49b5ffb709ea11e3bbab8d) ([screenshot](../screenshots/C4-1-deposited.png)) |
| 3 | 08:01 | Friday reference $28.84 posted 10 min in the past (the vault needs the price frozen >= 5 min) | owner | [0xfd3c4cbb…82a6](https://explorer.testnet.chain.robinhood.com/tx/0xfd3c4cbba82ac3c281498045331be70bf02dc740150d779eacc18dc0992182a6) |
| 4 | 08:01 | Weekend window opened (manual clock, ends 08:05) | owner | [0xbaeb551e…7c19](https://explorer.testnet.chain.robinhood.com/tx/0xbaeb551e911f8f7ab5d48ed00243b9bb23ae70ed06eb1ba9ca08bb340f937c19) |
| 5 | 08:01 | **Arm**: 45 mHIMS (30% of 150) on the default ladder, 4 steps | keeper | [0xbfa45c9e…9b15](https://explorer.testnet.chain.robinhood.com/tx/0xbfa45c9efdf62c4ced364c96c03e4b1681b348bfb5b44a4d9a6e162b6f659b15) |
| 6 | 08:01 | Weekend buyer pushes the pool to $46.14 (+60%) | owner | [0x0c8632bd…a0a](https://explorer.testnet.chain.robinhood.com/tx/0x0c8632bd1704122d844634bd192962dd93bbcfac9fdb17d4e75c5782dba21a0a), [0x7162891a…43b3](https://explorer.testnet.chain.robinhood.com/tx/0x7162891a71a5d9f07754adcd39751ae599033d91aabd5b9b4aced8021a2943b3) |
| 7 | 08:01 | **Lock**: every step pulled (all sold) | keeper | [0x55569b44…48ec](https://explorer.testnet.chain.robinhood.com/tx/0x55569b44eb356df475780575c33b6e5d66b41835a93bc30b84403f542b5e48ec) |
| 8 | 08:02 | Monday: minting back on, pool back to $29.13 (+1%) | owner | [0xaa31d1fa…409d](https://explorer.testnet.chain.robinhood.com/tx/0xaa31d1faad071cf970f2d3af3cf29ca69222cb10f2eed9fb861e74f6af76409d), [0x82461266…47f2](https://explorer.testnet.chain.robinhood.com/tx/0x82461266696334d084e9e4b727be3eca6c313299ddc935df59b699df096c47f2) |
| 9 | 08:35 | Fresh reference $29.13 (after the 30-min settle delay, a hard bound) | owner | [0xeee8ab74…fb41](https://explorer.testnet.chain.robinhood.com/tx/0xeee8ab74bffdd5ad5a86bf634e24db24742ae1b6bf75b4d9eab1f1ef4a59fb41) |
| 10 | 08:36 | **Settle**: buyback capped at fresh x 1.01 | keeper | [0xc989e341…8626](https://explorer.testnet.chain.robinhood.com/tx/0xc989e34186a9713f83259f4e5ac894a1983a0a82e69fbe24b6dddc4affb28626) |
| 11 | ~08:37 | **Withdraw everything** (redeem 150,000 shares) | **UI** | [0xef027de9…360c](https://explorer.testnet.chain.robinhood.com/tx/0xef027de9e9b73446e856e345e2ed13201656e62f2feab4504cd0047e6576360c) ([before](../screenshots/C4-3-before-withdraw.png), [after](../screenshots/C4-4-withdrawn.png)) |

## Result (from the vault's own epoch record and the Withdraw event)
- Epoch #1: 45 mHIMS placed; all four steps sold for **1,627.07 USDG**; Monday buyback **55.67 mHIMS**; PnL **+10.67
  mHIMS** before the 10% fee.
- Vault total assets **150 -> 159.60 mHIMS**. Withdraw event: **159.604 mHIMS for 150,000 shares** (+9.60 tokens,
  **+6.40%**, after the fee).
- Caveat: the test wallet is also the sandbox deployer, so it held the 100 mHIMS seeded at deployment as well as the 50
  deposited through the UI; "yours" on the page is the whole vault. The squeeze is simulated (an owner swap), so this
  proves the mechanism and the UI end to end, not a return.

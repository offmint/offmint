# Offmint — 3-minute demo script + shot list

Order (FINISH F2): problem (HIMS) → mint-off window → weekend report → sell order → vault → honest limits.
Record at 1440 px, browser zoom 100%, testnet wallet already funded from the faucet (never a wallet with real funds).
Numbers are read off the screen; all are in docs/CLAIMS.md.

| # | Time | Shot (what's on screen) | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:20 | Landing hero. Let the HIMS card play the weekend: price line spikes, four sell steps fill. | "This is HIMS on Robinhood Chain, the weekend of 29 August. The token traded 317% above its Friday price. Why? New stock tokens can only be created while the real market is open." |
| 2 | 0:20–0:40 | Scroll to "Minting is off 31.2% of the time" and the week strip with the *now* marker. | "Weekends and US holidays: minting is off for 31% of the year. The token keeps trading, but nothing brings it back to the real price until Monday." |
| 3 | 0:40–1:05 | `/weekends`: the totals, then click Sat 29 Aug → the per-token table. | "We scanned every onchain swap since July. Buyers paid 3.6 million dollars above the real price, from 23 thousand wallets. It happens on a different token each time, so we watch the whole basket, not a fixed list." |
| 4 | 1:05–1:20 | `/monitor`: rows marked verified / unverified with reasons. | "The monitor shows it live, and only calls a premium real if it passes five checks: depth, fresh trades, a tight quote, and an independent price." |
| 5 | 1:20–1:55 | `/sell`: pick +10%, show "reached it k of n windows", place. Blockscout tx. Then the sandbox squeeze fills it; Collect. | "If you hold the token, you can act yourself: a sell order from your own wallet, priced above the real price, never the pool. Offmint never holds your tokens. The squeeze fills it; you collect dollars." |
| 6 | 1:55–2:30 | `/vault/HIMS`: deposit, then docs/verification/vault-live.md tx list (arm, settle), withdraw showing more mHIMS than deposited. | "Or let the vault do it. It posts four steps above Friday's price when minting closes, and on Monday buys back, never above the fresh price plus 1%. On testnet, with a simulated squeeze: 150 in, 159.6 back." |
| 7 | 2:30–2:50 | Landing FAQ: "Can I lose money?" open; then the Explainer table (normal weekend ~0%, worst −0.1%, capacity ~$1,647). | "Honest limits: on a normal weekend nothing sells. If Monday opens higher, you can end with fewer tokens. Capacity today is about 1,600 dollars per pool, so it doesn't calm the spike yet. Unaudited, testnet." |
| 8 | 2:50–3:00 | Verify section: contract cards + test counts. | "Everything's verified on Blockscout, with 160 contract tests and a mainnet fork. They price the weekend. We supply it." |

## Shot list checklist
- [ ] Hero animation captured once from page load (don't use reduced motion).
- [ ] `/weekends` totals + 29 Aug detail.
- [ ] `/monitor` with at least one unverified row showing its reason.
- [ ] `/sell`: level buttons with "k of n", placement tx on Blockscout, fill, collect.
- [ ] `/vault/HIMS`: deposit + withdraw; the tx list from vault-live.md.
- [ ] FAQ "Can I lose money?" open.
- [ ] Verify cards.

Don't say: "safe", "risk-free", "market-neutral" (except: holders add no *new* exposure), "AI", any APY.

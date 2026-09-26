# Offmint landing page — visual brief

## The problem with the current page
It explains Offmint with paragraphs. Every section must instead **show** its point with a visual built from
product UI and real data — the way agentstaq.xyz does it (the user's own earlier site: a live transaction-trace card
in the hero, a worked-example panel with numbers flowing, a "your side / our side" split diagram, can/cannot lists,
and "verify it yourself" contract cards). Match that level of craft. Do not copy its layout or copy; build Offmint's
own visuals from Offmint's own mechanism.

**Rule: no section ships as text only.** Each section = one visual + at most ~40 words.

## Chosen direction (decided by the user)
**Reference: Ethena's site (ethena.fi) — data-forward, big live numbers, mechanism diagrams.**
**Mood: light first, Matte for key sections.**

Ethena is a dark site; we take its *approach*, not its palette:
- **Numbers are the headline.** Large, tabular, live where possible, each with a short label and a source.
  They are the visual, not decoration around text.
- **Diagrams explain the mechanism** in clean line-work (Graphite strokes, cyan only for what matters).
- **Dense but calm**: generous spacing around a few big numbers, not many small ones.
- Do not copy Ethena's layout, copy, or graphics. The user will paste Ethena screenshots as the quality bar.

**Backgrounds (overrides the "Layout & style rules" section below):**
- Default page background: Mist `#EEF4F3`; text Matte.
- **Matte `#161819` only for the key sections:** the hero product card (the card itself is Matte on the light
  hero), §3 Evidence (the weekend spike — "minting off" is the dark moment), and §8 Verify it yourself.
- Everything else light. Cyan on light backgrounds uses Tide `#0E9F9A` for text/lines (contrast); Glow `#3BE3EE`
  only on Matte surfaces.

**New component — live stat band (Ethena-style), directly under the hero, full width, light:**
| Big number | Label | Source |
|---|---|---|
| `2d 14h 06m` | until minting turns off (or "Minting off · reopens in …") | computed from the session clock |
| `+317.6%` | largest weekend premium observed (HIMS, 29 Aug) | our backtest |
| `N` | new listings in the vulnerable window now | detector `basket.json` |
| `X%` | highest live premium right now | `/monitor` data |
Rules: no TVL/APY/yield numbers (testnet; would mislead). Every number has its source on hover/footnote.
Live numbers refresh server-side; if a live source fails, show "—" with "updating", never a stale number as live.

Brand: `web/public/brand/BRAND.md` (Tide #0E9F9A, Glow #3BE3EE, Matte #161819, Graphite #2B2F31, Mist #EEF4F3,
Paper #F4F7F7; Schibsted Grotesk). Data/asset sources: `docs/ASSETS.md`.

---

## Section by section

### 1. Hero — "The weekend market" card (the memorable element)
Left: headline "They price the weekend. We supply it." + one line + buttons "Try the sandbox", "See live prices".
Right: **one product-UI card** that plays a single weekend, once, on page load (~6 s), then rests on the final frame:
- Top bar: ticker badge `HIMS` · status pill **Minting on → Minting off** (flips at Friday).
- Small price chart: flat line (reference / Friday close $28.84, dashed), then the token line spikes.
- The 4 sell rungs drawn as a staircase of horizontal steps above the reference (+8%, +15%, +25%, +40%).
- As the price line crosses each rung, that rung fills cyan and a row appears: `Rung 2 filled · sold 3.0 @ $33.20`.
- Monday: status flips back to **Minting on**, line drops, row `Bought back 9.0 @ $29.10`.
- Final line: `Shares: 100.00 → 106.41` with caption "Local simulation, ladder settings v1".
Respect `prefers-reduced-motion`: show the final frame statically. This is the only autoplay animation on the page.

### 2. The week, as a strip
A single horizontal Mon→Sun timeline, full width. Minting window shaded Mist; **Sat 00:00 → Mon 00:00 UTC**
shaded Matte with label "Minting off". A live marker shows *now* (visitor's local time + UTC).
Caption: "Stock tokens trade 24/7. New ones can only be created while the real market is open."

### 3. The evidence — two real spikes
Two charts side by side from our own backtest JSON (`web/public/backtest/`):
- HIMS, 29 Aug: token vs reference, premium gap shaded cyan, annotations: "Friday close $28.84",
  "peak +317.6%", "minting reopens".
- GLXY, 12 Sep: same treatment, "+186.1%".
Under them, one line of plain fact: "Both were new listings with no Chainlink price feed. Every feed-backed ticker we
scanned stayed under ~4%." Label each chart with source + date range.

### 4. How it works — worked example (like STAQ's "Worked example" panel)
A horizontal row of 4 connected cards with real numbers flowing left → right; connectors are the staircase motif:
`Friday: you hold 100 GLXY` → `Sell ladder: 30 GLXY placed in 4 steps above $P0` →
`Weekend spike fills 3 steps: +$ collected` → `Monday: capped buyback → 106.41 GLXY`.
Toggle above it: **Spike** / **No spike**. "No spike" shows every step unfilled and ends at `100.00 GLXY`
("nothing sold, nothing lost on the ladder").
Numbers must come from our own runs; caption the source.

### 5. Two ways in — two unequal panels
- **Already hold the stock?** Community vault. Visual: your token → vault → ladder → back to you (loop).
  Note: "You already held it. No new exposure."
- **Holding dollars?** MetaVault. Visual: USDG → picks up to 2 new listings mid-week → ladder → back to USDG.
  Risk shown *inside* the panel, same weight as the benefit: "Can lose money. 8% stop-loss before the weekend,
  max 30% of the vault per pick, losing tickers blacklisted 28 days."
Show the two vaults as **separate boxes feeding the same pool** with the label "Separate money. Same market."

### 6. What the bot can and cannot do
Two-column list (STAQ-style can / cannot), about the keeper:
- Can: place the ladder when minting closes · settle when it reopens · run the weekly pick.
- Cannot: withdraw your funds · sell below Friday's price + threshold · buy back above the price cap ·
  pick a blacklisted ticker · change its own limits.
Footer line: "It's a rules-based bot, not AI."

### 7. Live now
Compact table fed by `/monitor` data: ticker badge, token price, reference price, premium %, pool depth, session.
Empty state: "No new listings in the vulnerable window right now." Link: "Open live monitor".

### 8. Verify it yourself
Contract cards (address + one line saying what to read), linking to Blockscout testnet:
MetaVault, community vault, MetaVault-only vault, VaultFactory, PushPriceReference, Faucet.
Plus: test count, link to repo, link to the autonomous testnet cycle's transactions.

### 9. Footer
"Built on Robinhood Chain / Arbitrum" (official assets per ASSETS.md) · not affiliated/endorsed disclaimer ·
not available to US persons · risk disclosure link · GitHub.

---

## Layout & style rules
- Backgrounds: follow "Chosen direction" above (light first; Matte only for the hero card, §3, §8).
- Cyan appears only on: the spike/premium, filled rungs, primary buttons, the "now" marker.
- Product-UI cards: Graphite borders, 12 px radius on cards, 6 px on chips — two radii, not one for everything.
- Numbers in `tabular-nums`. Sentence case. No all-caps eyebrows, no "01 / 02 / 03" labels except in section 4,
  which really is a sequence.
- Max text width ~64ch. Mobile: hero card stacks under the headline; the week strip scrolls horizontally.

---

## Process (required)
1. **References:** the user will paste screenshots of pages they like into Claude Code (including agentstaq.xyz).
   Treat them as the quality bar for craft and density, not as layouts to copy.
2. Build each numbered section as its own component in `web/src/components/landing/`.
3. After each section: run the dev server, take **Playwright screenshots at 1440 px and 390 px**, look at them,
   and fix anything that is text-only, cramped, misaligned, or unreadable before moving on.
4. Check reduced-motion and keyboard focus.
5. When done, post the final screenshots for the user to review.

## Don'ts
No stock photos, no Robinhood app imagery, no company logos (ticker badges only), no gradient blobs, no
"risk-free / safe / market-neutral" (except: the community vault adds no *new* exposure), no numbers without a
source caption, no third-party API as a hard dependency of the hero.

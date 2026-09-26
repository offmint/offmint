import { COMMUNITY } from "@/lib/claims";

// Straight answers, including the uncomfortable ones (docs/FINISH.md F3). Numbers from COMMUNITY (supply/replay.json).
const c = COMMUNITY;
const QA: [string, string][] = [
  [
    "Can I lose money?",
    `Yes. If the price opens higher on Monday, the vault buys back only what it can within its 1% cap and retries, so you can end with fewer tokens than you deposited. The worst weekend we replayed was ${c.worst ? `${c.worst.r.excessPctExLpFees.toFixed(1)}%` : "a small loss"}, mostly gas. Unaudited, testnet only. It is not risk-free.`,
  ],
  [
    "Isn't this just a Uniswap limit order?",
    "Mechanically, yes: a one-sided range above the price is a limit order. What Offmint adds is where to put it (anchored to the verified reference, never to a pool that is already spiking), when (only while minting is off), and a capped buyback after Monday's reopen. The sell order page lets you place one yourself.",
  ],
  [
    "Does it calm the spike?",
    "Not at today's size. Our replays show it can trim a thin pool's peak, but the buyback on Monday is limited by pool depth, so capacity is small. We say so rather than claim we fix the market.",
  ],
  [
    "Why is capacity so small?",
    c.capacityUsd !== null
      ? `On Monday the vault must buy back within 1% of the fresh price. In our replays that absorbed about $${Math.round(c.capacityUsd).toLocaleString("en-US")} per pool (middle of ${c.capacityEvents} capped weekends). Deeper pools or other buyback routes would raise it.`
      : "On Monday the vault must buy back within 1% of the fresh price, and today's pools are shallow.",
  ],
  [
    "Is the bot an AI?",
    "No. The keeper is a rules-based bot: threshold checks against a price reference. It cannot withdraw your funds or change its limits, and if it stops, anyone can arm or settle after a grace period.",
  ],
  [
    "What about MetaVault?",
    "Experimental, coming later. Replayed with only the data it would have had, its weekly picker did not pick HIMS before the 29 Aug spike.",
  ],
];

/** FAQ card: native <details>, so it works without JavaScript and with the keyboard. The first answer starts open. */
export function Faq() {
  return (
    <section id="faq" className="gutter py-16 md:py-24">
      <h2 className="h-section text-center text-[40px] md:text-[60px]">
        Straight answers.
        <br />
        <span className="text-[#9AA3A6]">Including the awkward ones.</span>
      </h2>
      <div className="mx-auto mt-12 max-w-3xl rounded-[12px] bg-paper-card px-6 text-matte md:px-10">
        {QA.map(([q, a], i) => (
          <details key={q} open={i === 0} className="group border-b border-paper-line py-6 last:border-b-0">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-tide [&::-webkit-details-marker]:hidden">
              {q}
              <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mist text-xl group-open:bg-matte group-open:text-paper-text">
                <span className="group-open:hidden">+</span>
                <span className="hidden group-open:inline">−</span>
              </span>
            </summary>
            <p className="mt-3 max-w-[64ch] text-sm text-ink-soft">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

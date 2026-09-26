/** SPEC §6.5.5: the risk disclosure is a design requirement, shown next to the yield pitch, never buried. */
export function RiskDisclosure({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rounded-lg border border-caution-line bg-caution-bg p-5 text-sm text-caution">
      <div className="mb-2 font-semibold">This is not market-neutral.</div>
      <p>
        MetaVault buys into thinly traded, often meme-adjacent, newly listed stock tokens ahead of a hoped-for weekend
        squeeze. If no squeeze comes, it holds an ordinary position in a volatile stock for a few days and sells it
        Monday at whatever the price is. That is real market risk, not a mechanism failure.
      </p>
      {!compact && (
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li><b>Stop-loss</b> (8%) only covers the days between buy-in and the Friday deposit. Once the position is in the weekend ladder, a Saturday-to-Monday move is not covered.</li>
          <li><b>allocBps</b> caps how much of the vault goes into any one pick (30%).</li>
          <li><b>weeklyLossCapBps</b> blacklists a ticker for 28 days after a loss over 10%, so the same mistake cannot repeat immediately.</li>
          <li>A Monday gap-up above the sell range is the covered-call trade-off: the buyback is capped at the fresh price + 1%, and anything unfilled waits for a later retry.</li>
        </ul>
      )}
      <p className="mt-3">These bound the downside. They do not remove the risk of picking wrong, and the weekly picker is experimental and unvalidated: a point-in-time replay did not pick HIMS before its 29 Aug spike.</p>
    </div>
  );
}

/** SPEC §9.1: a jurisdiction notice, not a gate. */
export function JurisdictionNotice() {
  return (
    <p className="text-xs text-ink-soft">
      Robinhood stock tokens are not available to US persons and are restricted in some other jurisdictions under
      Robinhood&apos;s terms. Check that they are available to you before using Offmint.
    </p>
  );
}

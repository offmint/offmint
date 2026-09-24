/** §6: what the keeper bot can and cannot do. */
const CAN = ["Place the sell ladder when minting closes", "Settle after the market reopens with a fresh price", "Run the weekly pick for MetaVault"];
const CANNOT = [
  "Withdraw your funds, or send them anywhere",
  "Sell below Friday's price plus the step threshold",
  "Buy back above the price cap",
  "Pick a blacklisted ticker",
  "Change its own limits",
];

export function Bot() {
  return (
    <section id="bot" className="gutter py-16">
      <h2 className="h-section text-[40px] md:text-[64px]">What the bot can and cannot do</h2>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-[12px] border border-paper-line bg-paper-card p-6">
          <div className="text-sm font-medium text-tide">Can</div>
          <ul className="mt-4 space-y-3">
            {CAN.map((c) => (
              <li key={c} className="flex gap-3"><span aria-hidden className="mt-0.5 text-tide">✓</span><span>{c}</span></li>
            ))}
          </ul>
        </div>
        <div className="rounded-[12px] border border-graphite bg-paper-card p-6">
          <div className="text-sm font-medium text-matte">Cannot, enforced by the contracts</div>
          <ul className="mt-4 space-y-3">
            {CANNOT.map((c) => (
              <li key={c} className="flex gap-3"><span aria-hidden className="mt-0.5 text-loss">✕</span><span>{c}</span></li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-5 text-sm text-ink-soft">It&apos;s a rules-based bot, not AI. If it stops, anyone can arm or settle after a grace period.</p>
    </section>
  );
}

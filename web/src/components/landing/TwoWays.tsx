/** §5: two unequal panels, each with a flow diagram; risk inside the MetaVault panel at equal weight. */
function Node({ x, y, w = 96, label, dark = false, icon }: { x: number; y: number; w?: number; label: string; dark?: boolean; icon?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={30} rx={6} fill={dark ? "#161819" : "#fff"} stroke="#2B2F31" />
      {icon && <image href={`/api/logo/${icon}`} x={x + 8} y={y + 6} width={18} height={18} />}
      <text x={icon ? x + 32 : x + w / 2} y={y + 19} textAnchor={icon ? "start" : "middle"} fontSize="12" fill={dark ? "#F4F7F7" : "#161819"}>{label}</text>
    </g>
  );
}
const arrow = "#2B2F31";

export function TwoWays() {
  return (
    <section id="ways" className="border-y border-paper-line bg-paper-card">
      <div className="gutter py-16">
        <h2 className="h-section text-[40px] md:text-[64px]">Two ways in</h2>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.35fr]">
          {/* community */}
          <div className="rounded-[12px] border border-paper-line bg-mist p-6">
            <div className="text-sm text-ink-soft">Already hold the stock?</div>
            <div className="mt-1 text-xl font-semibold">Community vault</div>
            <svg viewBox="0 0 320 150" className="mt-5 w-full" role="img" aria-label="Your token goes into the vault, onto the ladder, and back to you">
              <defs><marker id="a1" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill={arrow} /></marker></defs>
              <Node x={8} y={20} w={104} label="your GLXY" icon="GLXY" />
              <Node x={216} y={20} label="vault" dark />
              <Node x={112} y={100} label="weekend ladder" w={100} />
              <line x1={112} y1={35} x2={210} y2={35} stroke={arrow} markerEnd="url(#a1)" />
              <path d="M264 50 Q264 115 218 115" fill="none" stroke={arrow} markerEnd="url(#a1)" />
              <path d="M112 115 Q56 115 56 56" fill="none" stroke="#0E9F9A" strokeWidth={1.6} markerEnd="url(#a1)" />
              <text x={6} y={140} fontSize="11" fill="#0E9F9A">more GLXY back after a spike</text>
            </svg>
            <p className="mt-4 text-sm text-ink-soft">You already held it. No new exposure. No deposit fee.</p>
          </div>
          {/* metavault */}
          <div className="rounded-[12px] border border-paper-line bg-mist p-6">
            <div className="text-sm text-ink-soft">Holding dollars?</div>
            <div className="mt-1 text-xl font-semibold">MetaVault</div>
            <ol className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-3 text-sm" aria-label="USDG buys up to two new listings mid-week, runs the ladder, returns to USDG">
              {[["your USDG", ""], ["up to 2 new listings", "bought Wed/Thu"], ["weekend ladder", "Sat–Mon"], ["USDG", "sold Monday"]].map(([label, note], i, a) => (
                <li key={label} className="flex items-center gap-2">
                  <span className={`rounded-[6px] border border-graphite px-3 py-1.5 ${i === a.length - 1 ? "bg-matte text-paper-text" : "bg-white"}`}>
                    {label}{note && <span className="ml-1.5 text-xs text-ink-faint">{note}</span>}
                  </span>
                  {i < a.length - 1 && <span aria-hidden className="text-ink-faint">→</span>}
                </li>
              ))}
            </ol>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <p className="text-sm text-ink-soft">Rotates into the week&apos;s most exposed new listings. More USDG back when a spike comes.</p>
              <p className="rounded-[6px] border border-caution-line bg-caution-bg p-3 text-sm text-caution">
                <b>Can lose money.</b> 8% stop-loss before the weekend, max 30% of the vault per pick, losing tickers blacklisted 28 days.
              </p>
            </div>
          </div>
        </div>
        {/* separate money, same market */}
        <div className="mt-6 grid items-center gap-4 rounded-[12px] border border-paper-line p-5 md:grid-cols-[auto_1fr_auto]">
          <div className="space-y-2 text-sm">
            <div className="rounded-[6px] border border-graphite bg-white px-3 py-2">Community vault <span className="text-ink-faint">(ob)</span></div>
            <div className="rounded-[6px] border border-graphite bg-matte px-3 py-2 text-paper-text">MetaVault-only vault <span className="text-[#9AA3A6]">(mb)</span></div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold">Separate money. Same market.</div>
            <div className="mt-1 text-sm text-ink-soft">Two vaults, two sets of books, one pool to sell into.</div>
            <div aria-hidden className="mt-2 hidden h-px bg-graphite md:block" />
          </div>
          <div className="rounded-[6px] border border-graphite bg-white px-3 py-2 text-center text-sm">Same Uniswap v4 pool</div>
        </div>
      </div>
    </section>
  );
}

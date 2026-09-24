import Link from "next/link";
import { PriceChart } from "@/components/PriceChart";
import { TickerBadge } from "@/components/Brand";
import hims from "../../../public/data/backtest/hims-2026-08-28.json";
import glxy from "../../../public/data/backtest/glxy-2026-09-11.json";
import testnet from "@/config/addresses.46630.json";

// Every number on this page comes from our own tests, replays or testnet runs; each one names its source.
const EXPLORER = "https://explorer.testnet.chain.robinhood.com";
const CYCLE_TXS: [string, string][] = [
  ["buy-in", "0x300799da34a0539bd9e91e0fd6c59e3f5b3e63de7df0a3a40bbf45ae45c6db44"],
  ["commit", "0x5ace8e0ffcff552d5b00630ba3d88f2fb95a890030cbf122a8d539cd9d268773"],
  ["arm", "0xbee65c69857ad7bd3d23234faea4ef5afbf72f9ce665bbbda67d2de7877ebd45"],
  ["lock", "0xbb44130566bb67489c66247b9388622a29d1a018d6ea58c421a83dba4488a36c"],
  ["settle", "0x0b385a948e9ce253e080cdf62f6a26147f216a8a9944ce305cd2b3ce7840e8de"],
  ["unwind", "0xe64969cc5b07ecba05140341c9fb23113dbecbdfc6873edced65ef33764daa9e"],
];

export default function Landing() {
  const events = [
    { d: hims as any, peakPct: "+317.6%", date: "Sat 29 Aug 2026" },
    { d: glxy as any, peakPct: "+186.1%", date: "Sat 12 Sep 2026" },
  ];
  return (
    <main>
      {/* ------------------------------------------------------------------ hero */}
      <section className="bg-matte text-paper-text">
        <div className="mx-auto max-w-6xl px-4 pb-20 pt-14">
          <h1 className="max-w-4xl text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl">
            They price the weekend.<br /><span className="text-glow">We supply it.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-[#C9D1D3]">
            On weekends nobody can create new Robinhood stock tokens, so a newly listed token can spike far above its real
            share price, and whoever buys the top gets hit on Monday. Offmint is the weekend seller: it offers supply in
            steps above Friday&apos;s price and buys back once the market reopens.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/app" className="btn-glow px-6 py-3 text-base">Launch app</Link>
            <a href="#proof" className="btn-outline-dark px-6 py-3 text-base">See the proof</a>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {events.map(({ d, peakPct, date }) => (
              <div key={d.id} className="rounded-lg border border-graphite p-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <div className="flex items-center gap-2"><TickerBadge ticker={d.summary.ticker} tone="light" /><span className="text-sm text-[#C9D1D3]">{date}</span></div>
                  <div className="num text-xl font-semibold">{peakPct}<span className="ml-1 text-xs font-normal text-[#9AA3A6]">over Friday close</span></div>
                </div>
                <PriceChart data={d.sim.timeline} p0={d.summary.p0Usd} tone="dark" height={200}
                  caption={`${d.summary.ticker}/USDG, Uniswap v4 swaps on Robinhood Chain mainnet, weekend of ${d.event.windowStart.slice(0, 10)}. Peak premium from our 8-weekend screen.`} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ problem + why structural */}
      <section id="problem" className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2">
        <div>
          <div className="label mb-2">The problem</div>
          <h2 className="text-3xl font-semibold tracking-tight">Weekend spikes nobody can supply into</h2>
          <p className="mt-4 text-ink-soft">
            On weekdays a stock token&apos;s price stays honest: if it trades above the real share, traders create new
            tokens at the real price and sell them. On weekends that loop is switched off. In our screen of every
            Robinhood stock token over 8 weekends, two newly listed tokens without a Chainlink feed spiked:
            <b className="text-ink"> HIMS +317.6%</b> (29 Aug) and <b className="text-ink">GLXY +186.1%</b> (12 Sep).
            The large names (NVDA, TSLA, AAPL, SPY and others) never moved more than about 4% over Friday&apos;s close.
          </p>
          <p className="mt-3 text-sm text-ink-faint">
            Source: our registry-wide weekend screen, Uniswap v4 swap logs, 1 Aug – 19 Sep 2026. A few smaller
            feed-backed names also had single-weekend spikes; the pattern that repeats is new listings.
          </p>
        </div>
        <div>
          <div className="label mb-2">Why it is structural</div>
          <h2 className="text-3xl font-semibold tracking-tight">The gap follows the real market&apos;s hours</h2>
          <p className="mt-4 text-ink-soft">
            New tokens can only be created while the underlying share can be bought: Robinhood&apos;s tokenization
            window runs Monday 02:00 to Saturday 02:00 CET/CEST. Even if those hours grow, weekends, market holidays and
            trading halts remain, and each is a window in which supply cannot respond to demand.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------------ mechanism */}
      <section id="how" className="border-y border-paper-line bg-paper-card">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="label mb-2">How it works</div>
          <h2 className="text-3xl font-semibold tracking-tight">A sell ladder for the weekend, a capped buyback on Monday</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            <Step n="1" title="Friday: post the ladder" body="When token creation closes, the vault posts four sell steps above Friday's price: +8–12%, +15–22%, +25–35% and +40–55%. They are one-sided Uniswap v4 range orders, so nothing sells unless buyers pay more than Friday's price." />
            <Step n="2" title="Weekend: sell only into a spike" body="If buyers push the token into a step, the vault sells into it. A fully sold step is pulled at once, so the dollars it earned cannot be bought back on the way down during the weekend." />
            <Step n="3" title="Monday: buy back, capped" body="After the reopen, with a fresh price, the vault buys the stock back with what it earned, never above that fresh price + 1%. If Monday opens higher, it buys what it can and retries later instead of chasing." />
          </div>
          <p className="mt-6 text-sm text-ink-soft">
            The contracts talk to the Uniswap v4 PoolManager directly. A rules-based keeper bot calls arm and settle, and
            anyone can call them if the keeper stops. It cannot move funds anywhere except through these steps.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------------ two ways in */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="label mb-2">Two ways in</div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="card">
            <div className="text-sm text-ink-faint">If you already hold the stock token</div>
            <h3 className="mt-1 text-xl font-semibold">Community vault</h3>
            <p className="mt-2 text-ink-soft">
              Deposit the token you hold. The vault runs the weekend ladder with part of it: a filled spike usually
              returns more tokens, and a Monday that opens above the sell steps can return slightly fewer. It adds no new
              market exposure, because you already held the stock. No deposit fee.
            </p>
            <Link href="/vault/HIMS" className="mt-4 inline-block text-sm font-medium text-tide underline">See the vaults</Link>
          </div>
          <div className="card">
            <div className="text-sm text-ink-faint">If you hold dollars</div>
            <h3 className="mt-1 text-xl font-semibold">MetaVault</h3>
            <p className="mt-2 text-ink-soft">
              Deposit USDG. Each week the keeper may pick up to two new listings, buy into them with at most 30% of the
              vault each, run the weekend ladder, and sell back to USDG on Monday. This is real market risk: if no spike
              comes, it is an ordinary stock position sold Monday at whatever the price is.
            </p>
            <Link href="/app" className="mt-4 inline-block text-sm font-medium text-tide underline">Open MetaVault</Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ numbers */}
      <section className="bg-matte text-paper-text">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="label mb-2 text-[#9AA3A6]">What a squeeze is worth, two ways</div>
          <h2 className="max-w-3xl text-3xl font-semibold tracking-tight">Big on the capital in the ladder, small on the whole vault, by design</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <Metric value="+8.1%" label="on the capital in the sell ladder" note="in STOCK, before the 10% performance fee" />
            <Metric value="+0.44%" label="on the whole MetaVault" note="NAV in USDG, after fees" />
          </div>
          <p className="mt-6 max-w-3xl text-[#C9D1D3]">
            Both numbers come from the same run: a simulated +30% weekend squeeze against a locally deployed Uniswap v4
            pool (<code className="text-glow">contracts/test/MetaVault.t.sol</code>). The gap is deliberate risk sizing:
            MetaVault buys in with 30% of the vault, and 30% of that goes into the ladder, so about 9% of the vault is at
            work in a given weekend.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------------ proof */}
      <section id="proof" className="mx-auto max-w-6xl px-4 py-16">
        <div className="label mb-2">Proof</div>
        <h2 className="text-3xl font-semibold tracking-tight">Built, tested and running</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <Proof title="Replays of the two real weekends">
            HIMS: +14.7% more stock than holding, from the capital deployed (sell-and-lock, before fees). Replayed on the
            real swap history. <Link className="underline" href="/backtest">Both replays</Link>
          </Proof>
          <Proof title="Mainnet-fork simulations">
            On real Robinhood Chain pools, 30 tokens deployed into a simulated squeeze came back as 36.99 TSLA, 37.09 HIMS
            and 37.07 GLXY. HIMS and GLXY use the no-feed price reference built for new listings.
          </Proof>
          <Proof title="An autonomous cycle on testnet">
            The keeper bot ran a full MetaVault week on its own: 10,000 test USDG in, 10,103.71 out after both fees
            (thin demo pool, +70% squeeze). Transactions:{" "}
            {CYCLE_TXS.map(([k, h], i) => (
              <span key={h}>{i > 0 && " · "}<a className="underline" href={`${EXPLORER}/tx/${h}`} target="_blank">{k}</a></span>
            ))}
          </Proof>
          <Proof title="Paper trading on mainnet, every weekend">
            The unmodified keeper logic runs against every new listing plus NVDA and SPY as controls, with no funds.
            Squeeze or no squeeze, every weekend is published. <Link className="underline" href="/paper">Paper results</Link>
          </Proof>
        </div>
        <p className="mt-6 text-sm text-ink-soft">
          160 contract tests, including fuzzing and invariant tests in both pool orientations; 12 mainnet-fork tests; 76 keeper and backtest
          tests; two local end-to-end cycles run by the unmodified bot in CI. All contracts are verified on the{" "}
          <a className="underline" href={`${EXPLORER}/address/${testnet.metaVault}`} target="_blank">Robinhood Chain testnet explorer</a>.
        </p>
      </section>

      {/* ------------------------------------------------------------------ risks + limits */}
      <section id="risks" className="border-t border-paper-line bg-paper-card">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2">
          <div>
            <div className="label mb-2">The risk, plainly</div>
            <h2 className="text-2xl font-semibold tracking-tight">MetaVault is not market-neutral</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-soft">
              <li>It buys volatile, thinly traded new listings ahead of a hoped-for spike. No spike means an ordinary position sold Monday, up or down.</li>
              <li>An 8% stop-loss covers only the days between buying and Friday&apos;s deposit into the ladder, not the weekend itself.</li>
              <li>Each pick is capped at 30% of the vault; a ticker that loses more than 10% is blacklisted for 28 days.</li>
              <li>A Monday that opens higher than the ladder is the trade-off of selling: the buyback is capped, so part may wait for a later retry.</li>
            </ul>
          </div>
          <div>
            <div className="label mb-2">Honest limits</div>
            <h2 className="text-2xl font-semibold tracking-tight">What we don&apos;t know yet</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-soft">
              <li>The sample is small: two squeezes in the weekends we measured.</li>
              <li>Pools are thin, so the dollar size of each opportunity is small.</li>
              <li>Our own supply shrinks the spike it sells into, so real results would be lower than the replays.</li>
              <li>Unaudited, testnet only. Robinhood Stock Tokens are not available to US persons.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ try it */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="label mb-2">Try it</div>
        <h2 className="text-3xl font-semibold tracking-tight">On Robinhood Chain testnet</h2>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/app" className="btn-primary px-6 py-3">Launch app and get test tokens</Link>
          <Link href="/monitor" className="btn-ghost px-6 py-3">Live basket monitor</Link>
          <a href="https://github.com/offmint/offmint#reproduce-in-one-command" className="btn-ghost px-6 py-3" target="_blank">Reproduce locally in one command</a>
        </div>
      </section>
    </main>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div>
      <div className="num mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-matte text-sm font-semibold text-glow">{n}</div>
      <div className="font-semibold">{title}</div>
      <p className="mt-2 text-sm text-ink-soft">{body}</p>
    </div>
  );
}

function Metric({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="rounded-lg border border-graphite p-6">
      <div className="num text-5xl font-bold tracking-tight">{value}</div>
      <div className="mt-2 text-lg">{label}</div>
      <div className="text-sm text-[#9AA3A6]">{note}</div>
    </div>
  );
}

function Proof({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="font-semibold">{title}</div>
      <p className="mt-2 text-sm text-ink-soft">{children}</p>
    </div>
  );
}

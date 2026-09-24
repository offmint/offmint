import testnet from "@/config/addresses.46630.json";
import { EXPLORER, REPO } from "@/content/landing";
import { DEMO, TESTS, FORK } from "@/lib/claims";

const t = testnet as unknown as Record<string, string>;
const CARDS = [
  { name: "MetaVault", addr: t.metaVault, read: "Read buyIn, commit, unwind and isBlacklisted: every limit is a bounded parameter." },
  { name: "Community vault", addr: t.vault, read: "Read arm, lock and settle: the ladder floor and the buyback cap are checked onchain." },
  { name: "MetaVault-only vault", addr: t.metaInstance, read: "Same code; restrictedDepositor lets only MetaVault deposit." },
  { name: "VaultFactory", addr: t.factory, read: "Deploys both instances per stock from hash-pinned vault code." },
  { name: "Price reference", addr: t.priceRef, read: "Chainlink adapter over the testnet mock feed. The PushPriceReference for no-feed listings is proven in the mainnet-fork tests." },
  { name: "Faucet", addr: t.faucet, read: "1,000 test USDG + 10 mHIMS per wallet per 24 h." },
];

/** §8 (Matte): contract cards, test counts, repo, the autonomous cycle's transactions. */
export function Verify() {
  return (
    <section id="verify" className="bg-matte text-paper-text">
      <div className="gutter py-16">
        <h2 className="h-section text-[40px] md:text-[64px]">Verify it yourself</h2>
        <p className="mt-2 max-w-[64ch] text-[#C9D1D3]">Every contract is source-verified on the Robinhood Chain testnet explorer.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c) => (
            <a key={c.name} href={`${EXPLORER}/address/${c.addr}`} target="_blank" rel="noreferrer"
              className="group rounded-[12px] border border-graphite p-5 transition hover:border-glow focus-visible:outline focus-visible:outline-2 focus-visible:outline-glow">
              <div className="flex items-center justify-between">
                <div className="font-medium">{c.name}</div>
                <span aria-hidden className="text-[#9AA3A6] group-hover:text-glow">↗</span>
              </div>
              <div className="num mt-1 text-xs text-glow" title={c.addr}>{c.addr.slice(0, 10)}…{c.addr.slice(-8)}</div>
              <p className="mt-3 text-sm text-[#C9D1D3]">{c.read}</p>
            </a>
          ))}
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-[1fr_1.4fr]">
          <div className="grid grid-cols-3 gap-4 rounded-[12px] border border-graphite p-5">
            {[[TESTS.contracts, "contract tests"], [TESTS.fork, `mainnet-fork tests @ block ${FORK.forkBlock}`], [TESTS.keeperAndBacktest, "keeper + backtest tests"]].map(([n, l]) => (
              <div key={String(l)}>
                <div className="fig text-[32px] font-semibold leading-none">{n}</div>
                <div className="mt-2 text-xs text-[#9AA3A6]">{l}</div>
              </div>
            ))}
          </div>
          <div className="rounded-[12px] border border-graphite p-5">
            <div className="text-sm font-medium">The keeper bot ran a full MetaVault week on testnet, on its own</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(DEMO.keeperTxs as { action: string; hash: string; instance: string }[]).filter((x) => x.instance !== "community").map(({ action: k, hash: h }) => (
                <a key={h} href={`${EXPLORER}/tx/${h}`} target="_blank" rel="noreferrer"
                  className="rounded-[6px] border border-graphite px-2.5 py-1 text-xs hover:border-glow focus-visible:outline focus-visible:outline-2 focus-visible:outline-glow">{k} ↗</a>
              ))}
            </div>
            <p className="mt-3 text-xs text-[#9AA3A6]">{(Number(DEMO.deposited) / 1e6).toLocaleString("en-US")} test USDG in, {(Number(DEMO.withdrawn) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2 })} out after both fees (thin demo pool, simulated +70% squeeze, testnet). Code: <a className="underline" href={REPO} target="_blank" rel="noreferrer">github.com/offmint/offmint</a></p>
          </div>
        </div>
      </div>
    </section>
  );
}

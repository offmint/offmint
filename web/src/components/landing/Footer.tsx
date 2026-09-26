import Link from "next/link";
import { Logo } from "@/components/Brand";
import { EXPLORER, REPO } from "@/content/landing";

const QUICK = [
  ["What happened last weekend?", "/weekends"],
  ["How does one weekend play out?", "/sandbox"],
  ["Can I place my own sell order?", "/sell"],
  ["Can I lose money?", "/#faq"],
] as const;

/**
 * Footer card with a notched top edge, sitting on the dark band above it. Used by the site and the app.
 * The notch is the band's colour showing through two slanted corners.
 */
export function SiteFooter() {
  return (
    <footer className="bg-matte pt-6">
      <div className="relative mx-2 overflow-hidden rounded-t-[20px] bg-paper-card text-matte sm:mx-3">
        <div aria-hidden className="absolute left-1/2 top-0 h-7 w-[min(78%,1100px)] -translate-x-1/2 bg-matte [clip-path:polygon(0_0,100%_0,97%_100%,3%_100%)] rounded-b-[14px]" />
        <div className="gutter relative pt-20">
          <div className="grid gap-10 md:grid-cols-[1.2fr_1fr]">
            <div>
              <Logo height={30} />
              <p className="mt-6 max-w-[34ch] text-xl text-ink-soft">They price the weekend. We supply it. Weekend supply for new Robinhood Chain stock tokens.</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-6 text-sm">
              <div><dt className="text-ink-faint">Network</dt><dd className="mt-2">Robinhood Chain testnet (46630)</dd></div>
              <div><dt className="text-ink-faint">Status</dt><dd className="mt-2">Unaudited · testnet only</dd></div>
              <div><dt className="text-ink-faint">Source</dt><dd className="mt-2"><a className="underline-offset-2 hover:underline" href={REPO} target="_blank" rel="noreferrer">GitHub</a></dd></div>
              <div><dt className="text-ink-faint">Contracts</dt><dd className="mt-2"><a className="underline-offset-2 hover:underline" href={EXPLORER} target="_blank" rel="noreferrer">Blockscout (testnet)</a></dd></div>
            </dl>
          </div>

          <div className="mt-16 grid gap-10 md:grid-cols-[1.2fr_1fr]">
            <div>
              <h2 className="h-section text-[36px] md:text-[44px]">Ready to try it?</h2>
              <p className="mt-2 text-sm text-ink-soft">Test tokens from the faucet, your own wallet, nothing real at stake.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/vault/HIMS" className="btn-primary rounded-full px-5 py-2.5">Try the vault</Link>
                <Link href="/sandbox" className="btn-ghost rounded-full px-5 py-2.5">Play a weekend</Link>
              </div>
            </div>
            <div>
              <p className="text-ink-soft">Maybe your question is already answered:</p>
              <ul className="mt-4">
                {QUICK.map(([q, href]) => (
                  <li key={href} className="border-b border-paper-line">
                    <Link href={href} className="flex items-center justify-between py-3 text-sm hover:text-tide">
                      {q}<span aria-hidden>→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div aria-hidden className="pointer-events-none mt-10 select-none text-center text-[22vw] font-bold leading-[0.75] tracking-[-0.06em] text-mist">offmint</div>
          <div className="relative -mt-[6vw] flex flex-col gap-4 border-t border-paper-line bg-paper-card/80 py-6 text-xs text-ink-faint md:flex-row md:items-start md:justify-between">
            <div className="max-w-[80ch] space-y-1">
              <p>Built on Robinhood Chain, an Arbitrum Orbit chain. Offmint is an independent project and is not affiliated with or endorsed by Robinhood or the Arbitrum Foundation.</p>
              <p>Robinhood Stock Tokens are not available to US persons. The keeper is a rules-based bot, not an AI.</p>
            </div>
            <div className="flex shrink-0 gap-5">
              <Link className="hover:text-matte" href="/#faq">Risk</Link>
              <a className="hover:text-matte" href={REPO} target="_blank" rel="noreferrer">GitHub</a>
              <Link className="hover:text-matte" href="/monitor">Monitor</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

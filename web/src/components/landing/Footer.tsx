import { Logo } from "@/components/Brand";
import { REPO } from "@/content/landing";

export function SiteFooter() {
  return (
    <footer className="border-t border-paper-line bg-mist">
      <div className="gutter grid gap-8 py-10 text-sm text-ink-soft md:grid-cols-[auto_1fr_auto]">
        <Logo tone="light" height={22} />
        <div className="max-w-[64ch] space-y-1">
          <p>Built on Robinhood Chain, an Arbitrum Orbit chain. Testnet deployment, unaudited.</p>
          <p>Offmint is an independent project and is not affiliated with or endorsed by Robinhood or the Arbitrum Foundation. Robinhood Stock Tokens are not available to US persons.</p>
        </div>
        <div className="flex gap-4 md:flex-col md:gap-1">
          <a className="hover:text-matte" href="#risk">Risk disclosure</a>
          <a className="hover:text-matte" href={REPO} target="_blank" rel="noreferrer">GitHub</a>
          <a className="hover:text-matte" href="/vault/HIMS">Launch app</a>
        </div>
      </div>
    </footer>
  );
}

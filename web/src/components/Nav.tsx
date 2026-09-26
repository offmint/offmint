"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Logo } from "@/components/Brand";

// four-feature order (docs/FEATURES.md): see it -> learn from history -> let the vault do it; MetaVault is not in the nav
const links = [
  ["/monitor", "Monitor"],
  ["/weekends", "Weekends"],
  ["/sell", "Sell order"],
  ["/sandbox", "Sandbox"],
  ["/vault/HIMS", "Vault"],
  ["/backtest", "Backtest"],
  ["/paper", "Paper"],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-paper-line bg-paper-card/90 backdrop-blur">
      <div className="gutter flex items-center justify-between gap-3 py-3">
        <div className="flex min-w-0 items-center gap-8">
          <span className="shrink-0"><Logo height={24} /></span>
          {/* one row that scrolls sideways on phones instead of wrapping or pushing the logo off screen */}
          <nav className="flex min-w-0 gap-5 overflow-x-auto whitespace-nowrap text-sm">
            {links.map(([href, label]) => (
              <Link key={href} href={href} className={path?.startsWith(href.split("/").slice(0, 2).join("/")) ? "font-medium text-tide" : "text-ink-soft hover:text-ink"}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <span className="shrink-0"><ConnectButton chainStatus="icon" showBalance={false} /></span>
      </div>
    </header>
  );
}

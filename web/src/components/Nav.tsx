"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Logo } from "@/components/Brand";

const links = [
  ["/app", "MetaVault"],
  ["/vault/HIMS", "Vaults"],
  ["/monitor", "Monitor"],
  ["/backtest", "Backtest"],
  ["/paper", "Paper"],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <header className="border-b border-paper-line bg-paper-card">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-8">
          <Logo height={24} />
          <nav className="flex gap-5 text-sm">
            {links.map(([href, label]) => (
              <Link key={href} href={href} className={path?.startsWith(href.split("/").slice(0, 2).join("/")) ? "font-medium text-tide" : "text-ink-soft hover:text-ink"}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <ConnectButton chainStatus="icon" showBalance={false} />
      </div>
    </header>
  );
}

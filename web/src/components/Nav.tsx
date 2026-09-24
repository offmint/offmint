"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const links = [
  ["/app", "App"],
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
          <Link href="/" className="font-semibold tracking-tight">Offmint</Link>
          <nav className="flex gap-5 text-sm">
            {links.map(([href, label]) => (
              <Link key={href} href={href} className={path?.startsWith(href) ? "text-accent" : "text-ink-soft hover:text-ink"}>
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

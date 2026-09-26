"use client";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { PillNav } from "@/components/PillNav";

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
  return <PillNav links={links} right={<ConnectButton chainStatus="icon" showBalance={false} />} />;
}

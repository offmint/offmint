"use client";
import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, connectorsForWallets, getDefaultConfig, lightTheme } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { robinhoodTestnet } from "@/lib/chains";
import { useState, type ReactNode } from "react";

// Standard wallet-connect only (SPEC §9.1): the user brings their own wallet and gas. No sponsored transactions.
// Reads go through our server-side proxy (Alchemy key never reaches the browser); wallets sign with their own RPC.
const transports = {
  // batch: reads fired together go out as one JSON-RPC array (the proxy takes up to 50), so a visitor stays far under the
  // per-IP rate limit on /api/rpc (src/lib/rateLimit.ts)
  [robinhoodTestnet.id]: http(typeof window === "undefined" ? undefined : `${window.location.origin}/api/rpc/${robinhoodTestnet.id}`, {
    batch: { batchSize: 50, wait: 20 },
  }),
};
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
// Without a WalletConnect (Reown) project ID, offer browser-extension wallets only rather than a broken WalletConnect option.
const config = WC_PROJECT_ID
  ? getDefaultConfig({ appName: "Offmint", projectId: WC_PROJECT_ID, chains: [robinhoodTestnet], transports, ssr: true })
  : createConfig({
      chains: [robinhoodTestnet],
      transports,
      ssr: true,
      connectors: connectorsForWallets([{ groupName: "Browser wallet", wallets: [injectedWallet] }], {
        appName: "Offmint",
        projectId: "not-used-without-walletconnect",
      }),
    });

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider theme={lightTheme({ accentColor: "#0E9F9A", borderRadius: "small" })}>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

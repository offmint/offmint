"use client";
import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, getDefaultConfig, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, http } from "wagmi";
import { robinhoodTestnet } from "@/lib/chains";
import { useState, type ReactNode } from "react";

// Standard wallet-connect only (SPEC §9.1): the user brings their own wallet and gas. No sponsored transactions.
const config = getDefaultConfig({
  appName: "Offmint",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "offmint-local", // WalletConnect Cloud id for mobile wallets
  chains: [robinhoodTestnet],
  transports: { [robinhoodTestnet.id]: http() },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider theme={lightTheme({ accentColor: "#1f5f8b", borderRadius: "small" })}>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

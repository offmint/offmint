import "./globals.css";
import type { Metadata } from "next";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Offmint",
  description: "They price the weekend. We supply it. Weekend supply for newly listed Robinhood Chain stock tokens.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Nav />
          <main className="mx-auto max-w-6xl px-4 pb-24 pt-8">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-ink-faint">
            Unaudited hackathon software on Robinhood Chain testnet. Not an offer of any security. The keeper is
            deterministic automation (threshold checks against a price reference), not an AI agent.
          </footer>
        </Providers>
      </body>
    </html>
  );
}

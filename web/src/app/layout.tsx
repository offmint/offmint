import "./globals.css";
import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";

const font = Schibsted_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-schibsted" });

export const metadata: Metadata = {
  title: "Offmint: they price the weekend, we supply it",
  description:
    "Weekend supply for newly listed Robinhood Chain stock tokens: a 4-step sell ladder above Friday's price while token creation is frozen, and a capped buyback on Monday.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={font.variable}>
      <body>{children}</body>
    </html>
  );
}

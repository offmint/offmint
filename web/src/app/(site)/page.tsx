import type { ReactNode } from "react";
import { Hero } from "@/components/landing/Hero";
import { Explainer } from "@/components/landing/Explainer";
import { Features } from "@/components/landing/Features";
import { MintOffWindow } from "@/components/MintOffWindow";
import { StatBand } from "@/components/landing/StatBand";
import { WeekStrip } from "@/components/landing/WeekStrip";
import { Evidence } from "@/components/landing/Evidence";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Bot } from "@/components/landing/Bot";
import { LiveNow } from "@/components/landing/LiveNow";
import { Verify } from "@/components/landing/Verify";
import { BigStats, Facts, TickerStrip } from "@/components/landing/DarkBand";
import { Faq } from "@/components/landing/Faq";

/** Light rounded panel inset on the dark band. */
function Panel({ children }: { children: ReactNode }) {
  return <div className="mx-2 my-3 overflow-hidden rounded-[20px] bg-mist pt-10 text-matte sm:mx-3 md:pt-14">{children}</div>;
}

// Structure: light hero with live cards at its base -> dark band (ticker strip, facts, light panels, evidence,
// totals, FAQ, verify) -> footer card (in the layout).
export default function Landing() {
  return (
    <main>
      <div className="bg-mist">
        <Hero />
        <StatBand />
      </div>
      <div className="bg-matte text-paper-text">
        <TickerStrip />
        <Facts />
        <Panel>
          <Explainer />
          <Features />
        </Panel>
        <Panel>
          <div className="gutter pb-6"><MintOffWindow /></div>
          <WeekStrip />
        </Panel>
        <Evidence />
        <Panel>
          <HowItWorks />
          <Bot />
          <LiveNow />
        </Panel>
        <BigStats />
        <Faq />
        <Verify />
      </div>
    </main>
  );
}

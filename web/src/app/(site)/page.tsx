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

export default function Landing() {
  return (
    <main>
      <Hero />
      <Explainer />
      <Features />
      <div className="gutter pb-12"><MintOffWindow /></div>
      <StatBand />
      <WeekStrip />
      <Evidence />
      <HowItWorks />
      <Bot />
      <LiveNow />
      <Verify />
    </main>
  );
}

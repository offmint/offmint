import { Hero } from "@/components/landing/Hero";
import { StatBand } from "@/components/landing/StatBand";
import { WeekStrip } from "@/components/landing/WeekStrip";
import { Evidence } from "@/components/landing/Evidence";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { TwoWays } from "@/components/landing/TwoWays";
import { Bot } from "@/components/landing/Bot";
import { LiveNow } from "@/components/landing/LiveNow";
import { Verify } from "@/components/landing/Verify";

export default function Landing() {
  return (
    <main>
      <Hero />
      <StatBand />
      <WeekStrip />
      <Evidence />
      <HowItWorks />
      <TwoWays />
      <Bot />
      <LiveNow />
      <Verify />
    </main>
  );
}

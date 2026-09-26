import Link from "next/link";
import { HeroChart } from "./HeroChart";
import { LiveBadge } from "./LiveBadge";

/** Centred hero: live badge, two-line headline, one line, two buttons, then the product card (the real HIMS weekend). */
export function Hero() {
  return (
    <section id="hero" className="gutter pb-8 pt-12 md:pt-16">
      <div className="flex flex-col items-center text-center">
        <LiveBadge />
        <h1 className="h-display mt-6 text-[46px] sm:text-[68px] lg:text-[84px] xl:text-[96px]">
          They price the weekend.
          <br />
          <span className="text-tide">We supply it.</span>
        </h1>
        <p className="mt-6 max-w-[52ch] text-lg text-ink-soft md:text-xl">
          New stock tokens can&apos;t be created on weekends, so they spike. Offmint sells into the spike in steps above
          Friday&apos;s price and buys back on Monday.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/vault/HIMS" className="btn-primary rounded-full px-6 py-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide">Try it on testnet</Link>
          <a href="#live" className="btn-ghost rounded-full px-6 py-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide">See live prices</a>
        </div>
      </div>
      <div className="mx-auto mt-12 max-w-6xl">
        <HeroChart />
      </div>
    </section>
  );
}

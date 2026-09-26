import Link from "next/link";
import { HeroChart } from "./HeroChart";

export function Hero() {
  return (
    <section id="hero" className="gutter pb-6 pt-14 md:pt-20">
      <h1 className="h-display text-[50px] sm:text-[72px] lg:text-[86px] xl:text-[100px] 2xl:text-[120px]">
        They price the weekend.
        <br />
        <span className="text-tide">We supply it.</span>
      </h1>
      <div className="mt-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <p className="max-w-[48ch] text-lg text-ink-soft md:text-xl">
          New stock tokens can&apos;t be created on weekends, so they spike. Offmint sells into the spike in steps above
          Friday&apos;s price and buys back on Monday.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/vault/HIMS" className="btn-primary rounded-[6px] px-5 py-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide">Try it on testnet</Link>
          <a href="#live" className="btn-ghost rounded-[6px] px-5 py-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide">See live prices</a>
        </div>
      </div>
      <div className="mt-10">
        <HeroChart />
      </div>
    </section>
  );
}

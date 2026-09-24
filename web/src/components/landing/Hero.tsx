import Link from "next/link";
import { HeroCard } from "./HeroCard";

export function Hero() {
  return (
    <section id="hero" className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-14 pt-12 md:grid-cols-[1fr_1.05fr] md:pt-16">
      <div>
        <h1 className="text-[44px] font-bold leading-[1.02] tracking-tight md:text-[64px]">
          They price the weekend. <span className="text-tide">We supply it.</span>
        </h1>
        <p className="mt-5 max-w-[46ch] text-lg text-ink-soft">
          New stock tokens can&apos;t be created on weekends, so they spike. Offmint sells into the spike in steps above
          Friday&apos;s price and buys back on Monday.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/app" className="btn-primary rounded-[6px] px-5 py-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide">Try it on testnet</Link>
          <a href="#live" className="btn-ghost rounded-[6px] px-5 py-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide">See live prices</a>
        </div>
      </div>
      <HeroCard />
    </section>
  );
}

import Link from "next/link";
import { COMMUNITY } from "@/lib/claims";

const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;

/**
 * Plain-English top of the page (docs/DECISIONS.md D2): the community vault only, with the real simulated numbers and
 * the risk in the same breath. MetaVault gets one line. Every figure comes from COMMUNITY (supply/replay.json).
 */
export function Explainer() {
  const c = COMMUNITY;
  const { low, high } = c.spike;
  const steps = [
    ["Connect", "your wallet on Robinhood Chain testnet."],
    ["Deposit", "stock tokens you already hold. You add no new exposure: you held them anyway."],
    ["Withdraw", "any weekday. After a weekend where the token spiked, you can get back more tokens than you put in."],
  ];
  return (
    <section id="explainer" className="gutter pb-10">
      <div className="rounded-[12px] border border-paper-line bg-paper-card p-6 md:p-8">
        <h2 className="text-xl font-semibold md:text-2xl">How it works, in plain English</h2>
        <p className="mt-2 max-w-[75ch] text-ink-soft">
          On weekends and US holidays nobody can create new stock tokens, so a token can trade far above the real share
          price. The vault offers some of your tokens for sale only above that real price, then buys them back after
          Monday&apos;s reopen, never paying more than the fresh price plus 1%. The difference is extra tokens for you.
        </p>
        <ol className="mt-5 grid gap-3 md:grid-cols-3">
          {steps.map(([t, d], i) => (
            <li key={t} className="rounded-[8px] border border-paper-line bg-white p-4">
              <div className="text-sm text-ink-faint">{`Step ${i + 1}`}</div>
              <div className="font-semibold">{t}</div>
              <div className="mt-1 text-sm text-ink-soft">{d}</div>
            </li>
          ))}
        </ol>
        <h3 className="mt-6 font-semibold">{`What it would have done, per $${c.sizeUsd.toLocaleString("en-US")} of tokens deposited`}</h3>
        <table className="data mt-2">
          <tbody>
            <tr>
              <td>A big spike weekend</td>
              <td className="num">{low && high ? `${signed(low.r.excessPctExLpFees)} (${low.e.ticker}) to ${signed(high.r.excessPctExLpFees)} (${high.e.ticker})${c.spikesPending ? `; on ${c.spikesPending} of these ${c.spikeCount}, part of the buyback was still waiting on Monday (valued at the cap)` : ""}` : "–"}</td>
            </tr>
            <tr>
              <td>A normal weekend</td>
              <td className="num">{`about 0%: nothing sells (${c.normal.count} of ${c.screened} ticker-weekends)`}</td>
            </tr>
            <tr>
              <td>The worst weekend we replayed</td>
              <td className="num">{c.worst ? `${signed(c.worst.r.excessPctExLpFees)} (${c.worst.e.ticker}, ${c.worst.e.weekend}), mostly the gas we charge each weekend ($${c.normal.gasUsd} per $${c.sizeUsd.toLocaleString("en-US")})` : "–"}</td>
            </tr>
            <tr>
              <td>Fee</td>
              <td className="num">{`${c.feePct}% of profit, nothing otherwise`}</td>
            </tr>
            <tr>
              <td>Capacity today</td>
              <td className="num">{c.capacityUsd !== null && c.capacityMin !== null && c.capacityMax !== null
                ? `about $${Math.round(c.capacityUsd).toLocaleString("en-US")} per pool can be bought back on Monday within the 1% cap (middle of ${c.capacityEvents} weekends where the cap was reached; range $${Math.round(c.capacityMin).toLocaleString("en-US")} to $${Math.round(c.capacityMax).toLocaleString("en-US")})`
                : "–"}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-sm text-caution">
          Simulated on real weekend swaps, with our own orders in the pool. Past weekends do not predict the next one. If
          the price opens higher on Monday, the vault buys back what it can within its cap and retries, so you can end with
          fewer tokens than you deposited. Unaudited. Testnet only.
        </p>
        <p className="mt-2 text-xs text-ink-faint">
          Excludes LP fee income, after the fee on profit and gas. Source: web/public/data/supply/replay.json (backtest/src/supply.ts).
        </p>
        <p className="mt-4 text-sm text-ink-soft">
          MetaVault (deposit dollars instead of tokens) is experimental, coming later: its weekly picker, replayed with only
          the data it would have had, did not pick HIMS before the 29 Aug spike.
        </p>
        <Link href="/vault/HIMS" className="btn-primary mt-5 inline-block rounded-[6px] px-5 py-3">Try the vault on testnet</Link>
      </div>
    </section>
  );
}

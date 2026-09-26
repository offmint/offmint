"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SandboxChart } from "@/components/SandboxChart";
import { runSandbox, PRESETS, DEPTHS, SAT, MON, type Depth, type Scenario } from "@/lib/sandbox";
import { PARAMS } from "@/lib/claims";
import sandboxDeployment from "@/config/addresses.sandbox-46630.json";
import { explorerAddr } from "@/lib/config";

const REPO = "https://github.com/offmint/offmint/blob/main";

const REF = 30; // an example real share price; everything scales with it
const tok = (x: number, d = 2) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (t: number) => {
  const d = new Date(t * 1000);
  return `${d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} ${d.toISOString().slice(11, 16)} UTC`;
};

const STEPS = ["You deposit", "Friday: the ladder goes up", "The weekend: buyers arrive", "Sunday night: everything is pulled", "Monday: buy back, capped", "Your result"];
const UNTIL = [SAT, SAT + 300, MON - 900, MON, MON + 3600, MON + 3600];

/**
 * In-browser sandbox (decision 26 Sep): one illustrative weekend, run through the same engine as our published replay.
 * The market is made up; the vault's rules are the real ones. No wallet, no chain.
 */
export default function Sandbox() {
  const [preset, setPreset] = useState<keyof typeof PRESETS | "custom">("spike");
  const [sc, setSc] = useState<Scenario>({ tokens: 100, refUsd: REF, ...PRESETS.spike.s });
  const [step, setStep] = useState(0);
  const run = useMemo(() => runSandbox(sc), [sc]);
  const r = run.result;
  const deposit = sc.tokens;
  const kept = deposit - run.deployTokens;
  const soldTokens = run.deployTokens - r.stockBack;
  const pending = r.usdgLeft > 0;
  const finalTokens = kept + r.netStock;
  const set = (patch: Partial<Scenario>) => { setSc({ ...sc, ...patch }); setPreset("custom"); };
  const pick = (k: keyof typeof PRESETS) => { setSc({ ...sc, ...PRESETS[k].s }); setPreset(k); setStep(0); };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Sandbox: one weekend, step by step</h1>
          <span className="rounded-full border border-caution-line bg-caution-bg px-2 py-0.5 text-xs text-caution">Simulation in your browser · no wallet</span>
        </div>
        <p className="mt-2 max-w-[80ch] text-sm text-ink-soft">
          Pick a kind of weekend and walk through what the community vault does with your tokens. The market here is made
          up so you can try any case; the vault&apos;s rules are the real ones, run by the same engine that produced our
          published results (default ladder, sell steps pulled when they sell out, one buyback on Monday capped at the fresh
          price + {PARAMS.vault.buybackSlippageBps / 100}%, {PARAMS.vault.perfFeeBps / 100}% fee on profit).
        </p>
      </div>

      {/* simulated vs onchain: no ambiguity (FINISH C5) */}
      <div className="card grid gap-4 text-sm md:grid-cols-2">
        <div>
          <div className="label">Simulated in your browser (this page)</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
            <li>The market: the pool, the weekend buyers and sellers, the price path.</li>
            <li>Every number on this page: steps sold, USDG received, buyback, your result.</li>
            <li>Run by the same code as our published replay, with the vault&apos;s real rules. Nothing is sent to a chain.</li>
          </ul>
        </div>
        <div>
          <div className="label">Real, onchain (Robinhood Chain testnet)</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
            <li>
              The same vault contract, deployed as a sandbox with a manual clock:{" "}
              <a className="underline" href={explorerAddr(sandboxDeployment.vault)} target="_blank" rel="noreferrer">community vault</a>{" · "}
              <a className="underline" href={explorerAddr(sandboxDeployment.clock)} target="_blank" rel="noreferrer">clock</a>.
            </li>
            <li>A full cycle we ran on it (deposit, weekend, squeeze, lock, Monday buyback, withdraw), every transaction linked: <a className="underline" href={`${REPO}/docs/verification/vault-live.md`} target="_blank" rel="noreferrer">vault run</a>.</li>
            <li>A personal sell order placed, filled and collected from a wallet: <a className="underline" href={`${REPO}/docs/verification/sellorder-live.md`} target="_blank" rel="noreferrer">sell-order run</a>.</li>
            <li>Try it yourself with test tokens: <Link className="underline" href="/vault/HIMS">vault</Link> · <Link className="underline" href="/sell">sell order</Link>.</li>
          </ul>
        </div>
      </div>

      {/* scenario */}
      <div className="card space-y-4">
        <div className="label">1. Choose a weekend</div>
        <div className="grid gap-2 md:grid-cols-3">
          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => (
            <button key={k} onClick={() => pick(k)} className={`rounded-[8px] border p-3 text-left ${preset === k ? "border-tide bg-mist" : "border-paper-line bg-white"}`}>
              <div className="font-medium">{PRESETS[k].label}</div>
              <div className="mt-1 text-xs text-ink-soft">{PRESETS[k].blurb}</div>
            </button>
          ))}
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-soft">Adjust it yourself</summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="block">Tokens you deposit: <b className="num">{sc.tokens}</b>
              <input type="range" min={10} max={1000} step={10} value={sc.tokens} onChange={(e) => set({ tokens: Number(e.target.value) })} className="w-full" /></label>
            <label className="block">Highest weekend price: <b className="num">{`+${sc.peakPct}%`}</b> over the real price
              <input type="range" min={0} max={300} step={1} value={sc.peakPct} onChange={(e) => set({ peakPct: Number(e.target.value) })} className="w-full" /></label>
            <label className="block">Real price on Monday: <b className="num">{`${sc.reopenPct >= 0 ? "+" : ""}${sc.reopenPct}%`}</b> vs Friday
              <input type="range" min={-10} max={40} step={0.5} value={sc.reopenPct} onChange={(e) => set({ reopenPct: Number(e.target.value) })} className="w-full" /></label>
            <div>Pool depth
              <div className="mt-1 flex gap-2">{(Object.keys(DEPTHS) as Depth[]).map((d) => (
                <button key={d} onClick={() => set({ depth: d })} className={sc.depth === d ? "btn-primary" : "btn-ghost"}>{DEPTHS[d].label}</button>
              ))}</div>
              <div className="mt-1 text-xs text-ink-faint">{DEPTHS[sc.depth].note}</div>
            </div>
          </div>
        </details>
      </div>

      {/* stepper */}
      <div className="card space-y-4">
        <div className="flex flex-wrap gap-2">
          {STEPS.map((s, i) => (
            <button key={s} onClick={() => setStep(i)} className={`rounded-full px-3 py-1 text-xs ${i === step ? "bg-matte text-paper-text" : i < step ? "bg-mist text-ink" : "border border-paper-line text-ink-faint"}`}>{`${i + 1}. ${s}`}</button>
          ))}
        </div>
        <SandboxChart run={run} until={UNTIL[step]} />

        {step === 0 && (
          <Step title="You deposit your tokens" what={`You put ${deposit} mHIMS into the community vault. At the real price of ${usd(REF)} that is ${usd(deposit * REF)}. You receive vault shares: your slice of everything the vault holds.`}
            why="You already owned these tokens, so depositing adds no new bet on the stock. If the stock moves, your tokens move exactly as before.">
            <Row k="Deposited" v={`${deposit} mHIMS (${usd(deposit * REF)})`} />
            <Row k="Deposit fee" v="none" />
          </Step>
        )}
        {step === 1 && (
          <Step title="Friday close: minting stops, the vault posts its sell steps"
            what={`From Saturday 00:00 UTC nobody can create new tokens until Monday. The vault offers ${PARAMS.vault.defaultDeployBps / 100}% of the deposits (${tok(run.deployTokens)} mHIMS) for sale in ${run.rungs.length} steps, all above the real price. The other ${tok(kept)} mHIMS are never offered.`}
            why="Nothing can sell unless a buyer pays more than the real share is worth. Each step is a range order on Uniswap: it sells gradually as the price climbs through it.">
            <table className="data">
              <thead><tr><th>Step</th><th>Sells between</th><th>Tokens offered</th></tr></thead>
              <tbody>{run.rungs.map((g) => (
                <tr key={g.premiumPct}><td>{`+${g.premiumPct}%`}</td><td className="num">{`${usd(g.fromUsd)} – ${usd(g.toUsd)}`}</td><td className="num">{tok(g.tokens)}</td></tr>
              ))}</tbody>
            </table>
            <p className="text-xs text-ink-faint">Step prices are rounded outward to the pool&apos;s price grid, so each starts at or slightly above its % level.</p>
          </Step>
        )}
        {step === 2 && (
          <Step title="The weekend: buyers arrive and the steps sell"
            what={`Buyers push the price up to ${usd(run.peakWithout)} (+${sc.peakPct}%). As the price passes a step, its tokens turn into USDG. When a step is completely sold, it is pulled at once.`}
            why="Pulling a sold-out step matters: if the price falls back through it, a range order would buy the tokens back at the high price. Pulled, its USDG is safe for the Monday buyback.">
            <table className="data">
              <thead><tr><th>Step</th><th>Sold</th><th>What happened</th></tr></thead>
              <tbody>{run.rungs.map((g) => (
                <tr key={g.premiumPct}><td>{`+${g.premiumPct}%`}</td><td className="num">{`${tok(g.soldPct, 1)}%`}</td>
                  <td className="text-sm">{g.soldPct >= 99.9 && g.lockedAt !== null && g.lockedAt < MON - 900 ? `sold out, pulled ${when(g.lockedAt)}` : g.soldPct > 0 ? "partly sold, still in the pool" : "price never reached it"}</td></tr>
              ))}</tbody>
            </table>
            <Row k="Tokens sold" v={`${tok(soldTokens)} mHIMS`} />
            <Row k="USDG received" v={usd(r.usdgReceived)} hint={r.lpFeesUsd > 0 ? `includes ${usd(r.lpFeesUsd)} of pool trading fees earned by the steps` : undefined} />
            <Row k="Highest price" v={`${usd(run.peakWithout)} without Offmint · ${usd(run.peakWith)} with the vault's steps`} hint="At this size the vault's steps barely change the peak. Deeper steps would, but they would also earn less per token." />
          </Step>
        )}
        {step === 3 && (
          <Step title="Sunday night: every remaining step is pulled"
            what="15 minutes before minting reopens, anything still in the pool is removed. Unsold tokens come back to the vault; the USDG from sales waits for Monday."
            why="Once minting reopens, traders can create new tokens and sell them, so the price usually drops fast. Pulling first means the vault never buys back into that drop by accident.">
            <Row k="Tokens back unsold" v={`${tok(r.stockBack)} mHIMS`} />
            <Row k="USDG waiting to buy back" v={usd(r.usdgReceived)} />
          </Step>
        )}
        {step === 4 && (
          <Step title="Monday: buy the tokens back, never above the cap"
            what={`With minting back on, the real price is ${usd(run.freshUsd)} (${sc.reopenPct >= 0 ? "+" : ""}${sc.reopenPct}% vs Friday). The vault spends its USDG buying tokens, but only up to ${usd(run.capUsd)} (fresh price + ${PARAMS.vault.buybackSlippageBps / 100}%).`}
            why="The cap stops anyone from forcing a bad buyback, for example by pushing the pool price up just before it. If the pool can't supply enough tokens under the cap, the vault keeps the rest in USDG and retries later instead of chasing the price.">
            <Row k="Tokens bought back" v={`${tok(r.stockBought)} mHIMS`} hint={r.buybackAvgUsd ? `average ${usd(r.buybackAvgUsd)} each, including the pool fee` : undefined} />
            <Row k="USDG still waiting" v={pending ? usd(r.usdgLeft) : "none: the buyback completed"} hint={pending ? "The 1% cap was reached: the pool is too thin to buy it all back at the fresh price. This is the capacity limit we measured on real pools." : undefined} />
          </Step>
        )}
        {step === 5 && (
          <Step title="Your result" what="What you could withdraw once the cycle is done, compared with simply holding your tokens all weekend."
            why={`The vault keeps ${PARAMS.vault.perfFeeBps / 100}% of the profit, paid in tokens, and nothing when there is no profit. Gas is left out here (cents on Robinhood Chain).`}>
            <Row k="You deposited" v={`${deposit} mHIMS`} />
            <Row k="You can withdraw" v={`${tok(finalTokens, 4)} mHIMS${pending ? ` (incl. ${usd(r.usdgLeft)} of USDG still to buy back, valued at the cap)` : ""}`} />
            <Row k="Difference" v={`${r.extraShares >= 0 ? "+" : ""}${tok(r.extraShares, 4)} mHIMS (${r.excessPct >= 0 ? "+" : ""}${tok(r.excessPct, 2)}%, ${usd(r.excessUsd)} at the Monday price)`} strong good={r.extraShares > 1e-9} bad={r.extraShares < -1e-9} />
            <Row k="Fee paid" v={`${tok(r.perfFeeStock, 4)} mHIMS`} />
            <div className="rounded-md bg-paper p-3 text-sm text-ink-soft">
              {r.extraShares > 1e-9
                ? "You end with more tokens: buyers paid a premium for the ones the vault sold, and it bought them back cheaper once minting reopened."
                : Math.abs(r.extraShares) <= 1e-9
                  ? "Nothing sold, so nothing changed: you keep exactly your tokens. This is what most weekends look like."
                  : "You end with fewer tokens: the vault sold during the weekend, but the real stock rose by Monday and the capped buyback could not get them all back. This is the main risk."}
            </div>
          </Step>
        )}
        <div className="flex justify-between">
          <button className="btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
          <button className="btn-primary" disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)}>Next step</button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-2 text-sm">
          <div className="label">How to read this honestly</div>
          <ul className="list-disc space-y-1 pl-5 text-ink-soft">
            <li>The market is invented; the rules are the vault&apos;s. Past weekends don&apos;t predict the next one.</li>
            <li>Most weekends nothing sells. Real results on past weekends are in the <Link className="underline" href="/weekends">weekend report</Link> and on the <Link className="underline" href="/">home page</Link>.</li>
            <li>It is not market-neutral if the stock rises while your tokens are sold; the Monday cap limits what the vault pays, not whether you end with fewer tokens.</li>
            <li>The contracts are unaudited and on testnet only. You can try them with test tokens on the <Link className="underline" href="/vault/HIMS">vault page</Link>.</li>
          </ul>
        </div>
        <details className="card text-sm" open>
          <summary className="label cursor-pointer">Words used here</summary>
          <dl className="mt-2 space-y-2 text-ink-soft">
            <div><dt className="font-medium text-ink">Real price (reference)</dt><dd>The stock&apos;s last official close. Tokens trade at it on weekdays because anyone can mint or redeem.</dd></div>
            <div><dt className="font-medium text-ink">Minting off</dt><dd>Weekends and US market holidays: no new tokens can be created, so the token price can drift above the real price.</dd></div>
            <div><dt className="font-medium text-ink">Sell step (range order)</dt><dd>Tokens offered on Uniswap across a price range; they sell gradually as the price climbs through it.</dd></div>
            <div><dt className="font-medium text-ink">Pulled</dt><dd>The step is removed from the pool, so it can&apos;t trade any more.</dd></div>
            <div><dt className="font-medium text-ink">Buyback cap</dt><dd>The highest price the vault will pay on Monday: fresh price + {PARAMS.vault.buybackSlippageBps / 100}%.</dd></div>
          </dl>
        </details>
      </div>
    </div>
  );
}

function Step({ title, what, why, children }: { title: string; what: string; why: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm">{what}</p>
      <p className="text-sm text-ink-soft"><b>Why:</b> {why}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ k, v, hint, strong, good, bad }: { k: string; v: string; hint?: string; strong?: boolean; good?: boolean; bad?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-paper-line py-1.5 text-sm md:flex-row md:justify-between">
      <span className="text-ink-soft">{k}</span>
      <span className={`num text-right ${strong ? "font-semibold" : ""} ${good ? "text-tide" : ""} ${bad ? "text-loss" : ""}`}>{v}{hint && <span className="block text-xs font-normal text-ink-faint">{hint}</span>}</span>
    </div>
  );
}

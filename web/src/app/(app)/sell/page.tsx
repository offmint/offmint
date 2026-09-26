"use client";
import { useEffect, useMemo, useState } from "react";
import { decodeEventLog, erc20Abi, formatUnits, parseUnits, type Address } from "viem";
import { useAccount, useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { addrs, explorerTx } from "@/lib/config";
import { short } from "@/lib/format";
import { Token } from "@/components/TokenLogo";
import { FaucetButton } from "@/components/FaucetButton";
import { sessionNow } from "@/components/landing/StatBand";
import { sellOrderRange, SellOrderError, MIN_PREMIUM_BPS } from "@/lib/range/sellOrder";
import { liquidityForStock, amountsForLiquidity, sqrtPriceX96ToUsd, tickToUsd, buybackSqrtCap } from "@/lib/range/rangeMath";
import { getSqrtPriceAtTick } from "@/lib/range/tickMath";
import { WEEKENDS } from "@/lib/weekends";
import {
  POSITION_MANAGER, PERMIT2, POOL_KEY, SLOT0, STOCK_IS_0, TICK_SPACING, SWAP_ROUTER,
  pmAbi, permit2Abi, priceRefAbi, pmStateAbi, swapAbi, decodeSlot0, decodePositionInfo, mintCalldata, collectCalldata, deadline, savedOrders, saveOrders,
} from "@/lib/sellOrder";

const SUGGESTED = [1000, 2000, 4000]; // +10%, +20%, +40%
const WIDTH_BPS = 1000;
const HISTORY_TICKER = addrs.ticker; // the sandbox token mirrors this real ticker's history

/** How often past mint-off windows reached a level for the real ticker: "k of n" from the weekend report. */
function reached(bps: number) {
  const rows = WEEKENDS.windows.flatMap((w) => w.tokens.filter((t) => t.ticker === HISTORY_TICKER && t.active && t.peakPct !== null));
  return { k: rows.filter((t) => (t.peakPct as number) >= bps / 100).length, n: rows.length };
}
const usdOf = (sq: bigint, feedDec: number) => Number(sqrtPriceX96ToUsd(sq, { feed: feedDec, stock: 18, usd: 6 }, STOCK_IS_0)) / 10 ** feedDec;

export default function Sell() {
  const { address } = useAccount();
  const symbol = `m${addrs.ticker}`;
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const market = useReadContracts({
    contracts: [
      { address: addrs.priceRef, abi: priceRefAbi, functionName: "read" },
      { address: addrs.poolManager, abi: pmStateAbi, functionName: "extsload", args: [SLOT0] },
    ],
    query: { refetchInterval: 15_000 },
  });
  const ref = market.data?.[0]?.result as readonly [bigint, number, bigint] | undefined;
  const slot = market.data?.[1]?.result ? decodeSlot0(market.data[1].result as `0x${string}`) : undefined;
  const d = ref ? { feed: Number(ref[1]), stock: 18, usd: 6 } : undefined;
  const refUsd = ref && d ? Number(ref[0]) / 10 ** d.feed : undefined;
  const poolUsd = slot && d ? usdOf(slot.sqrtPriceX96, d.feed) : undefined;
  const session = now !== null ? sessionNow(now) : null;

  const [amt, setAmt] = useState("");
  const [bps, setBps] = useState(SUGGESTED[0]);
  const [custom, setCustom] = useState("");
  const premiumBps = custom ? Math.round(Number(custom) * 100) : bps;
  const amount = useMemo(() => { try { return amt ? parseUnits(amt, 18) : 0n; } catch { return 0n; } }, [amt]);

  // range from the verified reference, never the pool (docs/DECISIONS.md D5); refused if the pool is at/above the level
  const plan = useMemo(() => {
    if (!ref || !slot || !d) return null;
    try {
      const r = sellOrderRange(ref[0], premiumBps, WIDTH_BPS, slot.tick, TICK_SPACING, d, STOCK_IS_0);
      const [a, b] = [Number(tickToUsd(r.tickLower, d, STOCK_IS_0)), Number(tickToUsd(r.tickUpper, d, STOCK_IS_0))].map((x) => x / 10 ** d.feed).sort((x, y) => x - y);
      return { ok: true as const, ...r, band: [a, b] as [number, number] };
    } catch (e) {
      return { ok: false as const, error: e instanceof SellOrderError ? e.message : String(e) };
    }
  }, [ref, slot, d, premiumBps]);

  const allow = useReadContracts({
    contracts: address
      ? [
          { address: addrs.stock, abi: erc20Abi, functionName: "allowance", args: [address, PERMIT2] },
          { address: PERMIT2, abi: permit2Abi, functionName: "allowance", args: [address, addrs.stock, POSITION_MANAGER] },
          { address: addrs.stock, abi: erc20Abi, functionName: "balanceOf", args: [address] },
        ]
      : [],
    query: { enabled: !!address },
  });
  const erc20Ok = ((allow.data?.[0]?.result as bigint | undefined) ?? 0n) >= amount;
  const p2 = allow.data?.[1]?.result as readonly [bigint, number, number] | undefined;
  const permitOk = !!p2 && p2[0] >= amount && p2[1] > Math.floor(Date.now() / 1000) + 600;
  const bal = allow.data?.[2]?.result as bigint | undefined;

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const rcpt = useWaitForTransactionReceipt({ hash });
  const [orders, setOrders] = useState<string[]>([]);
  useEffect(() => { if (address) setOrders(savedOrders(address)); }, [address]);
  useEffect(() => {
    if (!rcpt.isSuccess || !address) return;
    allow.refetch();
    market.refetch();
    // remember a newly minted order id (Transfer from 0x0 to the user)
    for (const log of rcpt.data.logs) {
      if (log.address.toLowerCase() !== POSITION_MANAGER.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: pmAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "Transfer" && /^0x0{40}$/i.test(ev.args.from) && ev.args.to.toLowerCase() === address.toLowerCase()) {
          const next = [...savedOrders(address), ev.args.id.toString()];
          saveOrders(address, next);
          setOrders(next);
        }
      } catch { /* not a Transfer */ }
    }
  }, [rcpt.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = isPending || rcpt.isLoading;

  const place = () => {
    if (!address || !plan?.ok || amount === 0n) return;
    if (!erc20Ok) return writeContract({ address: addrs.stock, abi: erc20Abi, functionName: "approve", args: [PERMIT2, amount] });
    if (!permitOk) return writeContract({ address: PERMIT2, abi: permit2Abi, functionName: "approve", args: [addrs.stock, POSITION_MANAGER, amount, Math.floor(Date.now() / 1000) + 3600] });
    const L = liquidityForStock(amount, getSqrtPriceAtTick(plan.tickLower), getSqrtPriceAtTick(plan.tickUpper), STOCK_IS_0);
    writeContract({ address: POSITION_MANAGER, abi: pmAbi, functionName: "modifyLiquidities", args: [mintCalldata(plan.tickLower, plan.tickUpper, L, amount, address), deadline()] });
  };
  const step = !erc20Ok ? `Approve ${symbol} for Permit2` : !permitOk ? "Allow the Uniswap position manager (Permit2)" : "Place sell order";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Personal sell order</h1>
        <p className="mt-2 max-w-[70ch] text-sm text-ink-soft">
          Offer your tokens for sale only above the real share price, from your own wallet. Offmint never holds your tokens:
          the order is a Uniswap v4 position you own. Testnet only.
        </p>
      </div>
      <div className="rounded-md border border-caution-line bg-caution-bg p-3 text-sm text-caution">
        This is a sell order. If it fills you hold USDG, not the stock. If the real price rises, you don&apos;t get your shares
        back automatically.
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card"><div className="label">Reference (real) price</div><div className="num text-xl">{refUsd !== undefined ? `$${refUsd.toFixed(2)}` : "…"}</div><div className="text-xs text-ink-faint">{ref ? `verified reference, updated ${new Date(Number(ref[2]) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC` : market.isError ? "reference unavailable: ordering disabled" : ""}</div></div>
        <div className="card"><div className="label">Pool price now</div><div className="num text-xl">{poolUsd !== undefined ? `$${poolUsd.toFixed(2)}` : "…"}</div><div className="text-xs text-ink-faint">{poolUsd !== undefined && refUsd ? (() => { const d = Math.round((poolUsd / refUsd - 1) * 1000) / 10; return `${d > 0 ? "+" : ""}${(d === 0 ? 0 : d).toFixed(1)}% vs the reference`; })() : ""}</div></div>
        <div className="card"><div className="label">Minting</div><div className="text-xl">{session ? (session.off ? "Off (weekend)" : "On") : "…"}</div><div className="text-xs text-ink-faint">{session ? `${session.off ? "reopens" : "turns off"} ${new Date(session.next).toUTCString().slice(0, 22)} UTC` : ""}</div></div>
      </div>

      {!address ? (
        <div className="card flex flex-col items-start gap-3"><div className="label">Connect to place an order</div><ConnectButton /></div>
      ) : (
        <div className="card space-y-4">
          <FaucetButton onClaimed={() => allow.refetch()} />
          <div className="flex items-center gap-3"><Token ticker={addrs.ticker} size={22} /><span className="text-sm text-ink-soft">{`sandbox ${symbol} · wallet ${bal !== undefined ? Number(formatUnits(bal, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 }) : "…"}`}</span></div>
          <input className="w-full rounded-md border border-paper-line px-3 py-2 num" placeholder={`Amount of ${symbol}`} value={amt} onChange={(e) => { setAmt(e.target.value); reset(); }} />
          <div>
            <div className="label mb-2">Sell only above</div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED.map((b) => {
                const h = reached(b);
                return (
                  <button key={b} className={!custom && bps === b ? "btn-primary" : "btn-ghost"} onClick={() => { setBps(b); setCustom(""); reset(); }}>
                    {`+${b / 100}%`}<span className="ml-2 text-xs opacity-80">{h.n ? `${addrs.ticker} reached it ${h.k} of ${h.n} windows` : "no history yet"}</span>
                  </button>
                );
              })}
              <input className="w-28 rounded-md border border-paper-line px-3 py-2 num" placeholder="custom %" value={custom} onChange={(e) => { setCustom(e.target.value); reset(); }} />
            </div>
            {premiumBps < MIN_PREMIUM_BPS && <div className="mt-1 text-xs text-loss">{`Minimum +${MIN_PREMIUM_BPS / 100}% over the reference.`}</div>}
          </div>
          <div className="text-sm">
            {plan?.ok ? (
              <span>{`Sells between $${plan.band[0].toFixed(2)} and $${plan.band[1].toFixed(2)} (reference x ${(1 + premiumBps / 10_000).toFixed(2)} to x ${(1 + (premiumBps + WIDTH_BPS) / 10_000).toFixed(2)}, rounded to the pool's tick spacing).`}</span>
            ) : plan ? <span className="text-loss">{plan.error}</span> : <span className="text-ink-faint">Loading prices…</span>}
          </div>
          <button className="btn-primary w-full" disabled={busy || !plan?.ok || amount === 0n || amount > (bal ?? 0n)} onClick={place}>{busy ? "Waiting for confirmation…" : step}</button>
          {hash && <a className="block text-xs underline" href={explorerTx(hash)} target="_blank">{rcpt.isSuccess ? "confirmed" : "pending"}: {short(hash)}</a>}
          {error && <div className="text-xs text-loss">{(error as any).shortMessage ?? error.message}</div>}
        </div>
      )}

      {address && orders.length > 0 && d && slot && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Your orders</h2>
          {orders.map((id) => <Order key={id} id={BigInt(id)} owner={address} d={d} sqrtPriceX96={slot.sqrtPriceX96} refAnswer={ref![0]} minting={!session?.off} symbol={symbol} onDone={() => { market.refetch(); allow.refetch(); }} />)}
        </div>
      )}
    </div>
  );
}

function Order(p: { id: bigint; owner: Address; d: { feed: number; stock: number; usd: number }; sqrtPriceX96: bigint; refAnswer: bigint; minting: boolean; symbol: string; onDone: () => void }) {
  const r = useReadContracts({
    contracts: [
      { address: POSITION_MANAGER, abi: pmAbi, functionName: "getPositionLiquidity", args: [p.id] },
      { address: POSITION_MANAGER, abi: pmAbi, functionName: "positionInfo", args: [p.id] },
    ],
    query: { refetchInterval: 15_000 },
  });
  const L = r.data?.[0]?.result as bigint | undefined;
  const info = r.data?.[1]?.result as bigint | undefined;
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const rcpt = useWaitForTransactionReceipt({ hash });
  useEffect(() => { if (rcpt.isSuccess) { r.refetch(); p.onDone(); } }, [rcpt.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
  const usdg = useReadContract({ address: addrs.usdg, abi: erc20Abi, functionName: "balanceOf", args: [p.owner] });
  const routerAllowance = useReadContract({ address: addrs.usdg, abi: erc20Abi, functionName: "allowance", args: [p.owner, SWAP_ROUTER] });
  const [buyAmt, setBuyAmt] = useState("");
  useEffect(() => { if (rcpt.isSuccess) { usdg.refetch(); routerAllowance.refetch(); } }, [rcpt.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
  if (L === undefined || info === undefined) return <div className="card text-sm">{`Order #${p.id}…`}</div>;
  const { tickLower, tickUpper } = decodePositionInfo(info);
  const [sa, sb] = [getSqrtPriceAtTick(tickLower), getSqrtPriceAtTick(tickUpper)];
  const now = amountsForLiquidity(L, p.sqrtPriceX96, sa, sb);
  const full = amountsForLiquidity(L, STOCK_IS_0 ? 0n : 2n ** 159n, sa, sb); // all stock, before any fill
  const [stockNow, usdgNow, stockFull] = STOCK_IS_0 ? [now.amount0, now.amount1, full.amount0] : [now.amount1, now.amount0, full.amount1];
  const filled = stockFull > 0n ? Number(((stockFull - stockNow) * 10_000n) / stockFull) / 100 : 0;
  const closed = L === 0n;
  // buy back after reopen: USDG -> stock, capped at fresh reference x 1.01 (same cap as the vault)
  const cap = buybackSqrtCap(p.refAnswer, 100n, p.d, STOCK_IS_0);
  const capUsd = (Number(p.refAnswer) / 10 ** p.d.feed) * 1.01;
  const wallet = (usdg.data as bigint | undefined) ?? 0n;
  const buy = (() => { try { return buyAmt ? parseUnits(buyAmt, 6) : 0n; } catch { return 0n; } })();
  const needApprove = ((routerAllowance.data as bigint | undefined) ?? 0n) < buy;
  return (
    <div className="card space-y-2 text-sm">
      <div className="flex items-center justify-between"><span className="font-medium">{`Order #${p.id}`}</span><span className="text-xs text-ink-faint">{closed ? "collected" : `${filled.toFixed(1)}% filled`}</span></div>
      {!closed && <div className="text-ink-soft">{`${Number(formatUnits(usdgNow, 6)).toFixed(2)} USDG received so far · ${Number(formatUnits(stockNow, 18)).toFixed(4)} ${p.symbol} still offered`}</div>}
      <div className="flex flex-wrap gap-2">
        {!closed && <button className="btn-ghost" disabled={isPending || rcpt.isLoading} onClick={() => writeContract({ address: POSITION_MANAGER, abi: pmAbi, functionName: "modifyLiquidities", args: [collectCalldata(p.id, L, p.owner), deadline()] })}>Collect</button>}
        {closed && p.minting && wallet > 0n && (
          <span className="flex flex-wrap items-center gap-2">
            <input className="w-32 rounded-md border border-paper-line px-2 py-1 num" placeholder="USDG to spend" value={buyAmt} onChange={(e) => setBuyAmt(e.target.value)} />
            <button className="btn-ghost" disabled={isPending || rcpt.isLoading || buy === 0n || buy > wallet}
              title={`Buys at most up to $${capUsd.toFixed(2)} (fresh reference + 1%); unspent USDG stays in your wallet`}
              onClick={() => needApprove
                ? writeContract({ address: addrs.usdg, abi: erc20Abi, functionName: "approve", args: [SWAP_ROUTER, buy] })
                : writeContract({ address: SWAP_ROUTER, abi: swapAbi, functionName: "swap", args: [POOL_KEY, { zeroForOne: !STOCK_IS_0, amountSpecified: -buy, sqrtPriceLimitX96: cap }, { takeClaims: false, settleUsingBurn: false }, "0x"] })}>
              {needApprove ? "Approve USDG for the buy back" : `Buy back, capped at $${capUsd.toFixed(2)}`}
            </button>
          </span>
        )}
      </div>
      {closed && !p.minting && <div className="text-xs text-ink-faint">Buy back opens after Monday&apos;s reopen, at a fresh price.</div>}
      {hash && <a className="block text-xs underline" href={explorerTx(hash)} target="_blank">{rcpt.isSuccess ? "confirmed" : "pending"}: {short(hash)}</a>}
      {error && <div className="text-xs text-loss">{(error as any).shortMessage ?? error.message}</div>}
    </div>
  );
}

"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits, parseUnits, type Address } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { metaVaultAbi } from "@/abi/MetaVault";
import { offmintVaultAbi } from "@/abi/OffmintVault";
import { addrs, explorerAddr, explorerTx } from "@/lib/config";
import { Countdown } from "@/components/Countdown";
import { FaucetButton } from "@/components/FaucetButton";
import { Token } from "@/components/TokenLogo";
import { RiskDisclosure, JurisdictionNotice } from "@/components/Risk";
import { short, usd, utc } from "@/lib/format";

const META = { address: addrs.metaVault, abi: metaVaultAbi } as const;
const PHASES = ["NONE", "BUY-IN (held, stop-loss active)", "ARMED (in the weekend ladder)", "UNWIND (selling to USDG)"];
const SUB = ["OPEN", "ARMED", "PENDING_BUYBACK", "OPEN_MIXED"];

export default function AppPage() {
  const { address } = useAccount();
  const me = (address ?? "0x0000000000000000000000000000000000000000") as Address;
  const base = useReadContracts({
    contracts: [
      { ...META, functionName: "totalAssets" },
      { ...META, functionName: "totalSupply" },
      { ...META, functionName: "openPositionCount" },
      { ...META, functionName: "openPositions" },
      { ...META, functionName: "getParams" },
      { ...META, functionName: "balanceOf", args: [me] },
      { ...META, functionName: "maxWithdraw", args: [me] },
      { ...META, functionName: "maxDeposit", args: [me] },
      { address: addrs.usdg, abi: erc20Abi, functionName: "balanceOf", args: [me] },
      { address: addrs.usdg, abi: erc20Abi, functionName: "allowance", args: [me, addrs.metaVault] },
    ],
    query: { refetchInterval: 15_000 },
  });
  const r = base.data?.map((x) => x.result);
  const [nav, supply, openCount, openList, params, shares, maxW, maxD, usdgBal, allowance] = (r ?? []) as any[];
  const idle = openCount === 0n;

  const positions = useReadContracts({
    contracts: ((openList as Address[] | undefined) ?? []).map((s) => ({ ...META, functionName: "position" as const, args: [s] as const })),
    query: { enabled: !!openList?.length, refetchInterval: 15_000 },
  });
  const instState = useReadContract({ address: addrs.metaInstance, abi: offmintVaultAbi, functionName: "state", query: { refetchInterval: 15_000 } });

  // live NAV series (sampled while the page is open)
  const [series, setSeries] = useState<{ t: number; nav: number }[]>([]);
  useEffect(() => {
    if (nav === undefined) return;
    setSeries((s) => [...s.slice(-240), { t: Math.floor(Date.now() / 1000), nav: Number(formatUnits(nav, 6)) }]);
  }, [nav]);

  const pps = nav !== undefined && supply ? Number(nav) / Number(supply) * 1e6 : null; // USDG per 1 share-unit x1e6 (offset 6)
  const myValue = shares !== undefined && pps !== null ? (Number(shares) / 1e12) * (pps / 1e6) * 1e6 / 1e6 : null;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">MetaVault</h1>
          <div className="text-sm text-ink-soft">
            Deposit USDG · <a className="underline" href={explorerAddr(addrs.metaVault)} target="_blank">{short(addrs.metaVault)}</a> · Robinhood Chain testnet
          </div>
        </div>
        <div className="text-right text-sm">
          <Countdown />
        </div>
      </div>

      <div className="rounded-md border border-caution-line bg-caution-bg p-3 text-sm text-caution">
        <b>Experimental, coming later.</b> MetaVault&apos;s weekly picker, replayed with only the data it would have had, did
        not pick HIMS before the 29 Aug spike. It buys into new listings with real market risk. Start with the{" "}
        <a className="underline" href="/vault/HIMS">community vault</a> instead.
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="NAV (USDG)" value={nav !== undefined ? usd(Number(formatUnits(nav, 6))) : "…"} />
        <Stat label="Cycle state" value={openCount === undefined ? "…" : idle ? "IDLE" : "CYCLE ACTIVE"} hint={idle ? "deposits and withdrawals open" : "deposits and withdrawals pause until every position is back in USDG"} />
        <Stat label="Your position (USDG)" value={address ? (maxW !== undefined && idle ? usd(Number(formatUnits(maxW, 6))) : myValue !== null ? `~${usd(myValue)}` : "…") : "connect"} hint={idle ? "withdrawable now, after the 0.5% exit fee" : "valued at the reference price"} />
        <Stat label="Entry / exit fee" value={params ? `${Number(params.txFeeBps) / 100}% / ${Number(params.txFeeBps) / 100}%` : "…"} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="label mb-2">This week</div>
          {idle ? (
            <p className="text-sm text-ink-soft">
              No open position. The keeper scores the basket on Wednesday/Thursday (volume growth + share of trading in
              non-USDG pools) and buys into at most {params ? Number(params.maxConcurrent) : 2} picks above the bar.
              Zero picks is the normal outcome most weeks.{" "}
              <b>The picker is experimental and unvalidated:</b> replayed with only the data it would have had, it did not
              pick HIMS before the 29 Aug spike.
            </p>
          ) : (
            <table className="data">
              <thead><tr><th>Stock</th><th>Phase</th><th>Bought for</th><th>Buy-in ref. price</th><th>Weekend ends</th></tr></thead>
              <tbody>
                {positions.data?.map((p, i) => {
                  const pos = p.result as any;
                  if (!pos) return null;
                  return (
                    <tr key={i}>
                      <td><Link href={`/vault/${addrs.ticker}`}><Token ticker={addrs.ticker} size={22} /></Link> <span className="text-xs text-ink-faint">{short(pos.stock)}</span></td>
                      <td>{PHASES[pos.phase]}{pos.phase === 2 && instState.data !== undefined ? ` · instance ${SUB[instState.data]}` : ""}</td>
                      <td className="num">{usd(Number(formatUnits(pos.usdgSpent, 6)))} USDG</td>
                      <td className="num">${(Number(pos.buyInPrice) / 10 ** pos.priceDecimals).toFixed(2)}</td>
                      <td className="num text-xs">{utc(Number(pos.weekendEnd))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="mt-4 h-40">
            <div className="label">NAV since this page opened</div>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={series}>
                <XAxis dataKey="t" hide />
                <YAxis domain={["auto", "auto"]} width={60} tick={{ fontSize: 11, fill: "#8a95a1" }} />
                <Tooltip labelFormatter={(t) => utc(Number(t))} formatter={(v: number) => [`${usd(v)} USDG`, "NAV"]} />
                <Line dataKey="nav" stroke="#1f5f8b" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <DepositWithdraw
          idle={!!idle}
          usdgBal={usdgBal as bigint | undefined}
          allowance={allowance as bigint | undefined}
          maxD={maxD as bigint | undefined}
          shares={shares as bigint | undefined}
          maxW={maxW as bigint | undefined}
          onDone={() => base.refetch()}
        />
      </div>

      <History />
      <RiskDisclosure compact />
      <JurisdictionNotice />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="num mt-1 text-xl">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}

function DepositWithdraw(p: { idle: boolean; usdgBal?: bigint; allowance?: bigint; maxD?: bigint; shares?: bigint; maxW?: bigint; onDone: () => void }) {
  const { address } = useAccount();
  const [amt, setAmt] = useState("");
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const rcpt = useWaitForTransactionReceipt({ hash });
  useEffect(() => {
    if (rcpt.isSuccess) p.onDone();
  }, [rcpt.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo(() => {
    try {
      return amt ? parseUnits(amt, 6) : 0n;
    } catch {
      return 0n;
    }
  }, [amt]);
  const needsApprove = (p.allowance ?? 0n) < value;
  const busy = isPending || rcpt.isLoading;

  if (!address) return <div className="card flex flex-col items-start gap-3"><div className="label">Deposit / withdraw</div><ConnectButton /></div>;
  return (
    <div className="card space-y-3">
      <div className="label">Deposit / withdraw USDG</div>
      <FaucetButton onClaimed={p.onDone} />
      <div className="text-xs text-ink-soft">Wallet: <span className="num">{p.usdgBal !== undefined ? usd(Number(formatUnits(p.usdgBal, 6))) : "…"}</span> USDG</div>
      <input className="w-full rounded-md border border-paper-line px-3 py-2 num" placeholder="0.00" value={amt} onChange={(e) => { setAmt(e.target.value); reset(); }} />
      {!p.idle && <div className="text-xs text-caution">A cycle is active: deposits and withdrawals reopen once every position is back in USDG.</div>}
      <div className="flex gap-2">
        {needsApprove ? (
          <button className="btn-primary flex-1" disabled={!p.idle || busy || value === 0n}
            onClick={() => writeContract({ address: addrs.usdg, abi: erc20Abi, functionName: "approve", args: [addrs.metaVault, value] })}>Approve</button>
        ) : (
          <button className="btn-primary flex-1" disabled={!p.idle || busy || value === 0n || value > (p.maxD ?? 0n)}
            onClick={() => writeContract({ ...META, functionName: "deposit", args: [value, address] })}>Deposit</button>
        )}
        <button className="btn-ghost flex-1" disabled={!p.idle || busy || value === 0n || value > (p.maxW ?? 0n)}
          onClick={() => writeContract({ ...META, functionName: "withdraw", args: [value, address, address] })}>Withdraw</button>
      </div>
      <button className="text-xs text-accent underline disabled:opacity-40" disabled={!p.idle || busy || !p.shares}
        onClick={() => writeContract({ ...META, functionName: "redeem", args: [p.shares!, address, address] })}>Withdraw everything</button>
      <div className="text-xs text-ink-faint">0.5% fee on deposit and on withdrawal. You pay your own gas (ETH on Robinhood Chain testnet).</div>
      {hash && <a className="block text-xs underline" href={explorerTx(hash)} target="_blank">{rcpt.isSuccess ? "confirmed" : "pending"}: {short(hash)}</a>}
      {error && <div className="text-xs text-loss">{(error as any).shortMessage ?? error.message}</div>}
    </div>
  );
}

function History() {
  const client = usePublicClient();
  const [rows, setRows] = useState<{ block: bigint; kind: string; text: string; hash: string }[] | null>(null);
  useEffect(() => {
    if (!client) return;
    (async () => {
      const [buys, closes, early] = await Promise.all([
        client.getContractEvents({ ...META, eventName: "BuyIn", fromBlock: 0n }),
        client.getContractEvents({ ...META, eventName: "PositionClosed", fromBlock: 0n }),
        client.getContractEvents({ ...META, eventName: "EarlyUnwind", fromBlock: 0n }),
      ]);
      const out = [
        ...buys.map((e: any) => ({ block: e.blockNumber, kind: "buy-in", hash: e.transactionHash, text: `${usd(Number(formatUnits(e.args.usdgSpent, 6)))} USDG → ${Number(formatUnits(e.args.stockBought, 18)).toFixed(4)} ${addrs.ticker}` })),
        ...early.map((e: any) => ({ block: e.blockNumber, kind: "stop-loss", hash: e.transactionHash, text: `exited early, loss ${usd(Number(formatUnits(e.args.lossUsdg, 6)))} USDG` })),
        ...closes.map((e: any) => {
          const spent = Number(formatUnits(e.args.usdgSpent, 6)), back = Number(formatUnits(e.args.usdgBack, 6));
          const r = ((back - spent) / spent) * 100;
          return { block: e.blockNumber, kind: r > 0 ? "win" : r < 0 ? "loss" : "flat", hash: e.transactionHash, text: `${usd(spent)} → ${usd(back)} USDG (${r >= 0 ? "+" : ""}${r.toFixed(2)}%)${e.args.blacklisted ? " · blacklisted 28 days" : ""}` };
        }),
      ].sort((a, b) => Number(b.block - a.block));
      setRows(out);
    })().catch(() => setRows([]));
  }, [client]);
  return (
    <div className="card">
      <div className="label mb-2">Past cycles (from onchain events)</div>
      {rows === null ? <div className="text-sm text-ink-faint">loading…</div> : rows.length === 0 ? <div className="text-sm text-ink-faint">No cycles yet.</div> : (
        <table className="data">
          <thead><tr><th>Event</th><th>Detail</th><th>Tx</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.hash + r.kind}>
              <td className={r.kind === "win" ? "text-gain" : r.kind === "loss" || r.kind === "stop-loss" ? "text-loss" : ""}>{r.kind}</td>
              <td className="num">{r.text}</td>
              <td><a className="underline text-xs" href={explorerTx(r.hash)} target="_blank">{short(r.hash)}</a></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

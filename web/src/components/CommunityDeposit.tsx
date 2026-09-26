"use client";
import { useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useAccount, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { offmintVaultAbi } from "@/abi/OffmintVault";
import { FaucetButton } from "@/components/FaucetButton";
import { addrs, explorerTx } from "@/lib/config";
import { short } from "@/lib/format";

const STATES = ["OPEN", "ARMED", "PENDING_BUYBACK", "OPEN_MIXED"];
const fmt = (v?: bigint) => (v === undefined ? "…" : Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 }));

/**
 * The community vault, end to end (docs/DECISIONS.md D2): connect -> deposit tokens you already hold -> withdraw with extra
 * after a spike weekend. Deposits and withdrawals are open only while the vault is OPEN (weekdays).
 */
export function CommunityDeposit({ symbol }: { symbol: string }) {
  const { address } = useAccount();
  const V = { address: addrs.vault, abi: offmintVaultAbi } as const;
  const S = { address: addrs.stock, abi: erc20Abi } as const;
  const reads = useReadContracts({
    contracts: address
      ? [
          { ...S, functionName: "balanceOf", args: [address] },
          { ...S, functionName: "allowance", args: [address, addrs.vault] },
          { ...V, functionName: "balanceOf", args: [address] },
          { ...V, functionName: "maxDeposit", args: [address] },
          { ...V, functionName: "maxWithdraw", args: [address] },
          { ...V, functionName: "state" },
        ]
      : [],
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const [bal, allowance, shares, maxD, maxW, state] = (reads.data ?? []).map((r) => r.result) as [bigint?, bigint?, bigint?, bigint?, bigint?, number?];
  const redeemable = useReadContracts({
    contracts: shares !== undefined ? [{ ...V, functionName: "convertToAssets", args: [shares] }] : [],
    query: { enabled: shares !== undefined },
  });
  const worth = redeemable.data?.[0]?.result as bigint | undefined;
  const [amt, setAmt] = useState("");
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const rcpt = useWaitForTransactionReceipt({ hash });
  useEffect(() => {
    if (rcpt.isSuccess) {
      reads.refetch();
      redeemable.refetch();
    }
  }, [rcpt.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo(() => {
    try {
      return amt ? parseUnits(amt, 18) : 0n;
    } catch {
      return 0n;
    }
  }, [amt]);
  const open = state === 0;
  const busy = isPending || rcpt.isLoading;

  if (!address)
    return (
      <div className="card flex flex-col items-start gap-3">
        <div className="label">Community vault: deposit / withdraw {symbol}</div>
        <p className="text-sm text-ink-soft">Connect a wallet on Robinhood Chain testnet to start.</p>
        <ConnectButton />
      </div>
    );
  return (
    <div className="card space-y-3">
      <div className="label">Community vault: deposit / withdraw {symbol}</div>
      <FaucetButton onClaimed={() => reads.refetch()} />
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><div className="label">In your wallet</div><span className="num">{fmt(bal)}</span> {symbol}</div>
        <div><div className="label">In the vault (yours)</div><span className="num">{fmt(worth)}</span> {symbol}</div>
      </div>
      <input className="w-full rounded-md border border-paper-line px-3 py-2 num" placeholder={`0.0 ${symbol}`} value={amt} onChange={(e) => { setAmt(e.target.value); reset(); }} />
      {state !== undefined && !open && (
        <div className="text-xs text-caution">{`The vault is ${STATES[state] ?? state}: deposits and withdrawals reopen after Monday's buyback.`}</div>
      )}
      <div className="flex gap-2">
        {(allowance ?? 0n) < value ? (
          <button className="btn-primary flex-1" disabled={!open || busy || value === 0n}
            onClick={() => writeContract({ ...S, functionName: "approve", args: [addrs.vault, value] })}>Approve</button>
        ) : (
          <button className="btn-primary flex-1" disabled={!open || busy || value === 0n || value > (maxD ?? 0n) || value > (bal ?? 0n)}
            onClick={() => writeContract({ ...V, functionName: "deposit", args: [value, address] })}>Deposit</button>
        )}
        <button className="btn-ghost flex-1" disabled={!open || busy || value === 0n || value > (maxW ?? 0n)}
          onClick={() => writeContract({ ...V, functionName: "withdraw", args: [value, address, address] })}>Withdraw</button>
      </div>
      <button className="text-xs text-accent underline disabled:opacity-40" disabled={!open || busy || !shares}
        onClick={() => writeContract({ ...V, functionName: "redeem", args: [shares!, address, address] })}>Withdraw everything</button>
      <div className="text-xs text-ink-faint">
        No deposit or withdrawal fee; 10% of profit only. You keep the stock exposure you already had. If Monday opens higher,
        the capped buyback can leave you with fewer tokens. Unaudited, testnet only.
      </div>
      {hash && <a className="block text-xs underline" href={explorerTx(hash)} target="_blank">{rcpt.isSuccess ? "confirmed" : "pending"}: {short(hash)}</a>}
      {error && <div className="text-xs text-loss">{(error as any).shortMessage ?? error.message}</div>}
    </div>
  );
}

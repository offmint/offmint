"use client";
import { useEffect } from "react";
import { parseAbi } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { addrs, explorerTx } from "@/lib/config";
import { short } from "@/lib/format";

const faucetAbi = parseAbi(["function claim()", "function waitFor(address) view returns (uint256)", "function usdgPerClaim() view returns (uint256)", "function stockPerClaim() view returns (uint256)"]);

/** One-click test tokens (testnet Faucet contract: 1,000 test USDG + 10 mHIMS per address per 24 h). */
export function FaucetButton({ onClaimed }: { onClaimed?: () => void }) {
  const { address } = useAccount();
  const wait = useReadContract({ address: addrs.faucet, abi: faucetAbi, functionName: "waitFor", args: address ? [address] : undefined, query: { enabled: !!address && !!addrs.faucet } });
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const rcpt = useWaitForTransactionReceipt({ hash, query: { enabled: !!hash } });
  useEffect(() => {
    if (rcpt.isSuccess) {
      onClaimed?.();
      wait.refetch();
    }
  }, [rcpt.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!addrs.faucet) return null;
  const secs = Number(wait.data ?? 0n);
  return (
    <div className="space-y-2 rounded-md border border-paper-line bg-paper p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium">Get test tokens</div>
          <div className="text-xs text-ink-soft">1,000 test USDG + 10 mHIMS, once per 24 h per wallet.</div>
        </div>
        <button className="btn-primary" disabled={!address || secs > 0 || isPending || rcpt.isLoading}
          onClick={() => writeContract({ address: addrs.faucet, abi: faucetAbi, functionName: "claim" })}>
          {rcpt.isLoading ? "Sending…" : secs > 0 ? `Again in ${Math.ceil(secs / 3600)}h` : "Claim"}
        </button>
      </div>
      <div className="text-xs text-ink-faint">
        You also need a little testnet ETH for gas: <a className="underline" href="https://faucet.testnet.chain.robinhood.com" target="_blank">Robinhood Chain testnet faucet</a>.
      </div>
      {hash && <a className="block text-xs underline" href={explorerTx(hash)} target="_blank">{rcpt.isSuccess ? "received" : "pending"}: {short(hash)}</a>}
      {error && <div className="text-xs text-loss">{(error as any).shortMessage ?? error.message}</div>}
    </div>
  );
}

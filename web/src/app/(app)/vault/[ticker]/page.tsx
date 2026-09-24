"use client";
import { use } from "react";
import { formatUnits, type Address } from "viem";
import { useReadContracts } from "wagmi";
import { offmintVaultAbi } from "@/abi/OffmintVault";
import { addrs, explorerAddr } from "@/lib/config";
import { short, utc } from "@/lib/format";
import { Token } from "@/components/TokenLogo";

const STATES = ["OPEN", "ARMED", "PENDING_BUYBACK", "OPEN_MIXED"];

/** Transparency view (SPEC §9): both instances of a ticker side by side, so nobody wonders which pool they would join. */
export default function VaultPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const known = ticker.toUpperCase() === addrs.ticker.toUpperCase();
  return (
    <div className="space-y-6">
      <h1 className="flex items-center gap-3 text-2xl font-semibold"><Token ticker={ticker.toUpperCase()} size={24} /> both vault instances</h1>
      {!known ? (
        <p className="text-sm text-ink-soft">No vault for this ticker on this deployment.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Instance title="Community pool (open)" vault={addrs.vault}
            blurb="For people who already hold the stock: deposit it, the vault posts sell orders above the Friday close over the weekend and buys back Monday. You keep stock exposure you already had; no USDG fee." />
          <Instance title="MetaVault's own instance (mb)" vault={addrs.metaInstance}
            blurb="Only MetaVault can deposit here: this week's actively bought-in capital. Same ladder mechanics, separate accounting, so MetaVault's speculative timing never shapes a community depositor's risk." />
        </div>
      )}
    </div>
  );
}

function Instance({ title, vault, blurb }: { title: string; vault: Address; blurb: string }) {
  const V = { address: vault, abi: offmintVaultAbi } as const;
  const q = useReadContracts({
    contracts: [
      { ...V, functionName: "symbol" },
      { ...V, functionName: "restrictedDepositor" },
      { ...V, functionName: "state" },
      { ...V, functionName: "totalAssets" },
      { ...V, functionName: "currentEpoch" },
      { ...V, functionName: "epochCount" },
    ],
    query: { refetchInterval: 15_000 },
  });
  const [sym, restricted, st, assets, epoch, count] = (q.data?.map((x) => x.result) ?? []) as any[];
  const rungs = useReadContracts({
    contracts: count ? [{ ...V, functionName: "epochRungs", args: [count] }] : [],
    query: { enabled: !!count, refetchInterval: 15_000 },
  });
  const rs = (rungs.data?.[0]?.result as any[]) ?? [];
  return (
    <div className="card space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="font-medium">{title}</div>
        <a className="text-xs underline" href={explorerAddr(vault)} target="_blank">{sym ?? "…"} · {short(vault)}</a>
      </div>
      <p className="text-sm text-ink-soft">{blurb}</p>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div><div className="label">State</div>{st !== undefined ? STATES[st] : "…"}</div>
        <div><div className="label">STOCK held</div><span className="num">{assets !== undefined ? Number(formatUnits(assets, 18)).toFixed(4) : "…"}</span></div>
        <div><div className="label">Depositor</div><span className="text-xs">{restricted === undefined ? "…" : /^0x0{40}$/i.test(restricted) ? "anyone" : `only ${short(restricted)}`}</span></div>
      </div>
      {epoch && Number(epoch.id) > 0 && (
        <div className="text-sm">
          <div className="label mb-1">Epoch #{Number(epoch.id)} · armed {utc(Number(epoch.armedAt))}{Number(epoch.settledAt) ? ` · settled ${utc(Number(epoch.settledAt))}` : ""}</div>
          <div className="num text-xs">deployed {Number(formatUnits(epoch.stockDeployed, 18)).toFixed(4)} · USDG from fills {Number(formatUnits(epoch.usdgReceived, 6)).toFixed(2)} · bought back {Number(formatUnits(epoch.stockBought, 18)).toFixed(4)} · PnL {Number(formatUnits(epoch.pnlStock, 18)).toFixed(4)} STOCK</div>
          {rs.length > 0 && (
            <table className="data mt-2">
              <thead><tr><th>Rung</th><th>Ticks</th><th>STOCK in</th><th>Removed</th><th>USDG out</th></tr></thead>
              <tbody>{rs.map((r: any, i: number) => (
                <tr key={i}><td>{i}</td><td className="num text-xs">{r.tickLower}..{r.tickUpper}</td><td className="num">{Number(formatUnits(r.stockDeployed, 18)).toFixed(3)}</td><td>{r.removed ? "yes" : "live"}</td><td className="num">{Number(formatUnits(r.usdgReceived, 6)).toFixed(2)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

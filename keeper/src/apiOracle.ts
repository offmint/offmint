// Robinhood-API price poster for PushPriceReference (stock tokens without a Chainlink feed). Deterministic, no model.
//   npm run api-oracle -w keeper -- --tickers BB,AMC,RCAT --dry-run          # print what would be posted
//   ORACLE_POSTER_PRIVATE_KEY=0x... RPC_URL=... npm run api-oracle -w keeper -- --tickers BB --refs refs.json
// Source: GET https://api.robinhood.com/rhj/prices/{symbol} (raw underlying bid/ask, NOT multiplier-adjusted; 15s cache)
//         GET https://api.robinhood.com/rhj/assets (currentMultiplier, 18 dp shares-per-token)
// Token price = mid(bid, ask) x currentMultiplier. `observedAt` = when the quote last CHANGED (the API's generatedAt is
// the response time, which would make a closed market look fresh).
// The poster key MUST differ from the vault keeper: a keeper that can set prices could move the band and the buyback cap.
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const API = "https://api.robinhood.com/rhj";
const E18 = 10n ** 18n;

/** Parses a non-negative decimal string into an integer scaled by 10^dp (truncating extra digits). */
export function parseDec(s: string, dp: number): bigint {
  const t = s.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`bad decimal: ${s}`);
  const [i, f = ""] = t.split(".");
  return BigInt(i) * 10n ** BigInt(dp) + BigInt((f + "0".repeat(dp)).slice(0, dp) || "0");
}

/** USD per token with 8 decimals from the API's raw bid/ask and the asset's currentMultiplier. */
export function tokenPriceE8(bid: string, ask: string, currentMultiplier: string): bigint {
  const mid18 = (parseDec(bid, 18) + parseDec(ask, 18)) / 2n;
  return (mid18 * parseDec(currentMultiplier, 18)) / E18 / 10n ** 10n;
}

/**
 * Converts a source price into token terms exactly once. Chainlink stock feeds ALREADY include the multiplier; the
 * Robinhood /prices endpoint does not. Multiplying a Chainlink answer again double-counts dividends and splits.
 */
export function toTokenPriceE8(src: { kind: "chainlink"; answerE8: bigint } | { kind: "api-raw"; bid: string; ask: string; multiplier: string }): bigint {
  return src.kind === "chainlink" ? src.answerE8 : tokenPriceE8(src.bid, src.ask, src.multiplier);
}

export interface TrackState {
  priceE8: bigint;
  observedAt: number;
  postedAt: number;
}

/** Tracks when the quote last changed; returns whether a new post is due. Same price never refreshes observedAt. */
export function track(prev: TrackState | undefined, priceE8: bigint, now: number): { state: TrackState; post: boolean } {
  if (prev && prev.priceE8 === priceE8) return { state: prev, post: false };
  return { state: { priceE8, observedAt: now, postedAt: prev?.postedAt ?? 0 }, post: true };
}

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { "user-agent": "offmint-api-oracle/0.1" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

const refAbi = parseAbi([
  "function post(uint256 price_, uint256 observedAt_, bool halted_)",
  "function poster() view returns (address)",
  "function observedAt() view returns (uint256)",
]);

async function main() {
  const args = process.argv.slice(2);
  const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const tickers = (opt("--tickers") ?? "BB,AMC,RCAT").split(",");
  const dry = args.includes("--dry-run");
  const once = args.includes("--once") || dry;
  // refs.json: { "BB": "0x<PushPriceReference>", ... } (written by the deploy script once approved)
  const refs: Record<string, Address> = opt("--refs") ? JSON.parse(await (await import("node:fs/promises")).readFile(opt("--refs")!, "utf8")) : {};
  let wallet: ReturnType<typeof createWalletClient> | undefined;
  let pub: ReturnType<typeof createPublicClient> | undefined;
  if (!dry) {
    const pk = process.env.ORACLE_POSTER_PRIVATE_KEY as Hex | undefined;
    const rpc = process.env.RPC_URL;
    if (!pk || !rpc) throw new Error("set ORACLE_POSTER_PRIVATE_KEY and RPC_URL (or use --dry-run)");
    if (process.env.KEEPER_PRIVATE_KEY && process.env.KEEPER_PRIVATE_KEY.toLowerCase() === pk.toLowerCase()) {
      throw new Error("refusing to run: the oracle poster key must NOT be the vault keeper key");
    }
    pub = createPublicClient({ transport: http(rpc) });
    wallet = createWalletClient({ transport: http(rpc), account: privateKeyToAccount(pk) });
  }
  const state: Record<string, TrackState> = {};
  for (;;) {
    const assets = (await getJson(`${API}/assets`)).assets as any[];
    for (const t of tickers) {
      const a = assets.find((x) => x.tokenSymbol === t);
      const q = (await getJson(`${API}/prices/${t}`)).quotes?.[0];
      if (!a || !q) {
        console.log(JSON.stringify({ ticker: t, error: "missing asset or quote" }));
        continue;
      }
      const priceE8 = toTokenPriceE8({ kind: "api-raw", bid: q.bid, ask: q.ask, multiplier: a.currentMultiplier });
      const now = Math.floor(Date.now() / 1000);
      const { state: st, post } = track(state[t], priceE8, now);
      state[t] = st;
      const rec = { ticker: t, bid: q.bid, ask: q.ask, multiplier: a.currentMultiplier, priceE8: priceE8.toString(), observedAt: st.observedAt, halted: !!q.isTradingHalt, post };
      if (dry || !post) {
        console.log(JSON.stringify({ ...rec, action: dry ? "dry-run" : "unchanged" }));
        continue;
      }
      const ref = refs[t];
      if (!ref) {
        console.log(JSON.stringify({ ...rec, error: "no PushPriceReference address for ticker" }));
        continue;
      }
      const hash = await wallet!.writeContract({ address: ref, abi: refAbi, functionName: "post", args: [priceE8, BigInt(st.observedAt), !!q.isTradingHalt], chain: null } as any);
      await pub!.waitForTransactionReceipt({ hash });
      st.postedAt = now;
      console.log(JSON.stringify({ ...rec, action: "posted", hash }));
    }
    if (once) return;
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

if (process.argv[1] && (await import("node:path")).resolve(process.argv[1]) === (await import("node:url")).fileURLToPath(import.meta.url)) await main();

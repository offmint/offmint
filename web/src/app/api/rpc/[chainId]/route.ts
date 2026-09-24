// Server-side JSON-RPC proxy: the browser talks to /api/rpc/<chainId>, the Alchemy key stays on the server.
// Read-only methods only (wallet transactions go through the user's own wallet RPC, never through here).
import { NextResponse } from "next/server";

const UPSTREAM: Record<string, string | undefined> = {
  // `||` so an empty variable falls through to the next option
  "46630": process.env.ALCHEMY_RH_TESTNET_URL || process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com",
  "4663": process.env.ALCHEMY_RH_MAINNET_URL || process.env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com",
};
// Alchemy's free tier limits eth_getLogs to 10 blocks, so log queries go to the public endpoint
const LOGS: Record<string, string> = {
  "46630": process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com",
  "4663": process.env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com",
};
const READ_ONLY = new Set([
  "eth_chainId", "eth_blockNumber", "eth_call", "eth_getLogs", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBalance", "eth_getCode", "eth_getStorageAt",
  "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getTransactionCount", "net_version",
]);

export async function POST(req: Request, { params }: { params: Promise<{ chainId: string }> }) {
  const { chainId } = await params;
  const upstream = UPSTREAM[chainId];
  if (!upstream) return NextResponse.json({ error: "unknown chain" }, { status: 404 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length > 50 || calls.some((c) => !READ_ONLY.has(c?.method))) {
    return NextResponse.json({ error: "method not allowed" }, { status: 403 });
  }
  const target = calls.some((c) => c.method === "eth_getLogs") ? LOGS[chainId] : upstream;
  const r = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

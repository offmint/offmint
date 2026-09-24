import testnet from "@/config/addresses.46630.json";
import type { Address } from "viem";

/** Testnet deployment (written by scripts/export-abi.mjs from contracts/deployments/46630.json). */
export const addrs = testnet as unknown as {
  chainId: number;
  ticker: string;
  metaVault: Address;
  metaInstance: Address;
  vault: Address; // community instance
  factory: Address;
  priceRef: Address;
  stock: Address;
  usdg: Address;
  clock: Address;
  poolManager: Address;
};

/** Read-only paper-mode service (Railway): /health, /basket.json, /paper/*. */
export const PAPER_API = process.env.NEXT_PUBLIC_PAPER_API ?? "https://offmint-keeper-production.up.railway.app";

export const EXPLORER = "https://explorer.testnet.chain.robinhood.com";
export const explorerAddr = (a: string) => `${EXPLORER}/address/${a}`;
export const explorerTx = (h: string) => `${EXPLORER}/tx/${h}`;

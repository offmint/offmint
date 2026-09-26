import main from "@/config/addresses.46630.json";
import sandbox from "@/config/addresses.sandbox-46630.json";
import type { Address } from "viem";

/**
 * Testnet deployment (written by scripts/export-abi.mjs from contracts/deployments/*.json). Default: the main testnet
 * stack the keeper runs on the real clock. NEXT_PUBLIC_TESTNET_DEPLOYMENT=sandbox builds against the separate sandbox
 * stack (manual clock; owner = keeper = a dedicated test wallet), used for real end-to-end testnet runs.
 */
export const DEPLOYMENT = process.env.NEXT_PUBLIC_TESTNET_DEPLOYMENT === "sandbox" ? "sandbox" : "main";
const testnet = DEPLOYMENT === "sandbox" ? sandbox : main;
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
  faucet: Address;
};

/** Read-only paper-mode service (Railway): /health, /basket.json, /paper/*. */
export const PAPER_API = process.env.NEXT_PUBLIC_PAPER_API ?? "https://offmint-keeper-production.up.railway.app";

export const EXPLORER = "https://explorer.testnet.chain.robinhood.com";
export const explorerAddr = (a: string) => `${EXPLORER}/address/${a}`;
export const explorerTx = (h: string) => `${EXPLORER}/tx/${h}`;

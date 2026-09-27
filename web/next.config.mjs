import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NEXT_DIST_DIR lets a second build (e.g. NEXT_PUBLIC_TESTNET_DEPLOYMENT=sandbox for testnet end-to-end runs) live
  // next to the default one instead of overwriting it
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // web/ has its own lockfile (kept out of the root npm workspaces so the keeper's Docker build is unaffected)
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  webpack: (config) => {
    // wagmi's Base Account connector imports the Coinbase CDP SDK, whose x402 payment modules are optional peers we
    // never use (no payments, no sponsored gas: SPEC §9.1)
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core/client": false,
      "@x402/evm": false,
      "@x402/evm/exact/client": false,
      "@x402/evm/upto/client": false,
      "@x402/svm/exact/client": false,
      // MetaMask SDK's React Native storage path, unused in the browser
      "@react-native-async-storage/async-storage": false,
      // wagmi / WalletConnect pull optional node-only deps. Aliased to empty modules rather than marked external, so the
      // server bundle doesn't keep a require() the Cloudflare Worker build can't resolve
      "pino-pretty": false,
      lokijs: false,
      encoding: false,
    };
    return config;
  },
};
export default nextConfig;

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // web/ has its own lockfile (kept out of the root npm workspaces so the keeper's Docker build is unaffected)
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  webpack: (config) => {
    // wagmi / WalletConnect pull optional node-only deps; keep them out of the browser bundle
    config.externals.push("pino-pretty", "lokijs", "encoding");
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
    };
    return config;
  },
};
export default nextConfig;

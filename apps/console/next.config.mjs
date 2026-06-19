import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output produces a self-contained server bundle for the
  // multi-stage Docker image (on-prem, no external runtime deps).
  output: "standalone",
  // Pin the trace root to this app so the monorepo's parent lockfile doesn't
  // confuse standalone file tracing in the Docker build.
  outputFileTracingRoot: __dirname,
  reactStrictMode: true,
  poweredByHeader: false,
  // Allow remote logo URLs configured via branding settings, plus data URIs.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
};

export default nextConfig;

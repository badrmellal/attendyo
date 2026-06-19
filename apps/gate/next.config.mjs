/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output: produces a self-contained server bundle for the on-prem
  // Docker image (no node_modules copy, no external fetch at runtime).
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // The kiosk talks to the Liwan API directly from the browser via
  // NEXT_PUBLIC_API_URL; nothing is proxied or sent to a cloud.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8088",
  },
};

export default nextConfig;

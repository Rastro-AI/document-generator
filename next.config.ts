import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "esbuild",
    "@resvg/resvg-js",
    "@sparticuz/chromium-min",
    "puppeteer-core",
  ],
};

export default nextConfig;

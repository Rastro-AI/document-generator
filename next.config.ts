import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "esbuild",
    "@resvg/resvg-js",
    "@sparticuz/chromium",
    "puppeteer-core",
  ],
};

export default nextConfig;

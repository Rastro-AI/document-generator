import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "esbuild",
    "@resvg/resvg-js",
    "@sparticuz/chromium-min",
    "puppeteer-core",
    "pdf-to-png-converter",
    "@napi-rs/canvas",
    "canvas",
  ],
};

export default nextConfig;

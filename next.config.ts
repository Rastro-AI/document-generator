import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["esbuild", "@resvg/resvg-js"],
};

export default nextConfig;

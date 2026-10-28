import type { NextConfig } from "next";

const pagesBase = process.env.PAGES_BASE ?? ""

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  ...(pagesBase ? { basePath: pagesBase, assetPrefix: pagesBase } : {}),
  env: { NEXT_PUBLIC_BASE_PATH: pagesBase },
  // GitHub Pages can only serve the static export. Local `next dev` keeps the API routes.
  ...(process.env.PAGES_EXPORT === "1" ? { output: "export" as const, trailingSlash: true } : {}),
};

export default nextConfig;

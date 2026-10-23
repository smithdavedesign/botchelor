import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local fallback database) ships WASM files and must be loaded by Node, not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;

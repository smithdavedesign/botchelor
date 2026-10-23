import type { NextConfig } from "next";
import { afterDarkNextConfig } from "./lib/after-dark-host";
import { siteUrl } from "./lib/site";

const nextConfig: NextConfig = {
  // PGlite (local fallback database) ships WASM files and must be loaded by Node, not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // After Dark on a host of its own (lib/after-dark-host.ts): adds nothing unless AFTER_DARK_ORIGIN is set at build time.
  ...afterDarkNextConfig(process.env, siteUrl(process.env)),
};

export default nextConfig;

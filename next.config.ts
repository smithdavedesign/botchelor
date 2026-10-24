import type { NextConfig } from "next";
import { AI_HEADERS } from "./lib/ai-mark";
import { afterDarkNextConfig } from "./lib/after-dark-host";
import { siteUrl } from "./lib/site";

const nextConfig: NextConfig = {
  // PGlite (local fallback database) ships WASM files and must be loaded by Node, not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // The house cast's portraits and the venue backdrops in public/cast were drawn by a model: they carry the XMP mark
  // (scripts/stamp-ai-marks.mjs) and go out with the same "AI-generated" headers as every other generated file
  // (lib/ai-mark.ts, EU AI Act Art. 50).
  headers: async () => [{ source: "/cast/:file*", headers: Object.entries(AI_HEADERS).map(([key, value]) => ({ key, value })) }],
  // After Dark on a host of its own (lib/after-dark-host.ts): adds nothing unless AFTER_DARK_ORIGIN is set at build time.
  ...afterDarkNextConfig(process.env, siteUrl(process.env)),
};

export default nextConfig;

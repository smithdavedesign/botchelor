import type { NextConfig } from "next";
import { AI_HEADERS } from "./lib/ai-mark";
import { afterDarkNextConfig } from "./lib/after-dark-host";
import { siteUrl } from "./lib/site";

const nextConfig: NextConfig = {
  // PGlite (local fallback database) ships WASM files and must be loaded by Node, not bundled. ffmpeg-static is a path to
  // a binary (lib/media-tools/ffmpeg.ts), loaded by Node too.
  serverExternalPackages: ["@electric-sql/pglite", "ffmpeg-static"],
  // The ffmpeg binary (~75 MB) goes only with the routes that cut clips (lib/adult/moments.ts): a clip's moments, and a
  // clip kept going from a moment of one (lib/adult/clips.ts).
  outputFileTracingIncludes: {
    "/api/admin/after-dark/moments": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/admin/after-dark/clips": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  // The house cast's portraits and the venue backdrops in public/cast were drawn by a model: they carry the XMP mark
  // (scripts/stamp-ai-marks.mjs) and go out with the same "AI-generated" headers as every other generated file
  // (lib/ai-mark.ts, EU AI Act Art. 50).
  headers: async () => [{ source: "/cast/:file*", headers: Object.entries(AI_HEADERS).map(([key, value]) => ({ key, value })) }],
  // After Dark on a host of its own (lib/after-dark-host.ts): adds nothing unless AFTER_DARK_ORIGIN is set at build time.
  ...afterDarkNextConfig(process.env, siteUrl(process.env)),
};

export default nextConfig;

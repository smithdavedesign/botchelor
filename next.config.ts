import type { NextConfig } from "next";
import { AI_HEADERS } from "./lib/ai-mark";
import { afterDarkNextConfig } from "./lib/after-dark-host";
import { siteUrl } from "./lib/site";

/** ffmpeg-static's binary and what Node needs to load the package (lib/media-tools/ffmpeg.ts). */
const FFMPEG = ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffmpeg-static/index.js", "./node_modules/ffmpeg-static/package.json"];

const nextConfig: NextConfig = {
  // PGlite (local fallback database) ships WASM files and must be loaded by Node, not bundled. ffmpeg-static is a path to
  // a binary (lib/media-tools/ffmpeg.ts), loaded by Node too.
  serverExternalPackages: ["@electric-sql/pglite", "ffmpeg-static"],
  // The ffmpeg binary (~75 MB) goes with the three routes that run it: the moments route (lib/adult/moments.ts: a clip's
  // moments, the frame a clip keeps going from) and After Dark's exports (lib/media-tools/export.ts re-encodes clips).
  // lib/media-tools/ffmpeg.ts loads the package by a name made at run time, so the file tracer doesn't follow it into
  // every route (2026-10-26: it was in 236, and production's deploy ran out of disk).
  // public/ is served by the CDN, never read by a function; lib/media-tools/ffmpeg.ts's temp-folder reads made the
  // tracer copy all of it (about 3 MB) into every route that can reach ffmpeg (19, about 60 MB a deploy).
  outputFileTracingExcludes: { "/**": ["./public/**/*"] },
  outputFileTracingIncludes: {
    "/api/admin/after-dark/moments": FFMPEG,
    "/api/admin/after-dark/export": FFMPEG,
    // Living portraits (lib/showcase-loops.ts): three frames of each clip, cut for the PG check.
    "/api/admin/showcase/animate": FFMPEG,
    // The PG check on After Dark posts still rated explicit (lib/showcase-check.ts): three frames of each clip.
    "/api/jobs/showcase-check": FFMPEG,
  },
  // The house cast's portraits and the venue backdrops in public/cast were drawn by a model: they carry the XMP mark
  // (scripts/stamp-ai-marks.mjs) and go out with the same "AI-generated" headers as every other generated file
  // (lib/ai-mark.ts, EU AI Act Art. 50).
  headers: async () => [{ source: "/cast/:file*", headers: Object.entries(AI_HEADERS).map(([key, value]) => ({ key, value })) }],
  // After Dark on a host of its own (lib/after-dark-host.ts): adds nothing unless AFTER_DARK_ORIGIN is set at build time.
  ...afterDarkNextConfig(process.env, siteUrl(process.env)),
};

export default nextConfig;

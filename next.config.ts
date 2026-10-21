import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local fallback database) ships WASM files and must be loaded by Node, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "ffmpeg-static"],
  // The reel's last-frame step (lib/adult/frames.ts) runs ffmpeg-static's binary, which the trace doesn't find on its
  // own: shipped with the two routes that advance a reel.
  outputFileTracingIncludes: {
    "/api/admin/after-dark/reel": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/mcp": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;

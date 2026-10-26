import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import config from "@/next.config";

// ffmpeg's binary (~75 MB) ships with one route only (2026-10-26: a static import let the build's file tracer follow
// ffmpeg-static into 236 of 247 routes, and production's deploy ran out of disk; #929 reverted it).
describe("the ffmpeg binary", () => {
  it("is never imported by its package's name, anywhere in the app", () => {
    expect(readFileSync("lib/media-tools/ffmpeg.ts", "utf8")).not.toMatch(/["'`]ffmpeg-static["'`]/);
    // git grep exits 1 when nothing matches.
    let hits = "";
    try {
      hits = execFileSync("git", ["grep", "-l", "-E", "from [\"']ffmpeg-static[\"']|import\\([\"']ffmpeg-static[\"']\\)|require\\([\"']ffmpeg-static[\"']\\)", "--", "lib", "app"], { encoding: "utf8" }).trim();
    } catch (err) {
      if ((err as { status?: number }).status !== 1) throw err;
    }
    expect(hits).toBe("");
  });

  it("goes with the one route that runs it", () => {
    expect(Object.keys(config.outputFileTracingIncludes ?? {})).toEqual(["/api/admin/after-dark/moments"]);
  });
});

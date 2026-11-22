import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { limitSharp } from "@/lib/sharp-limits";
import config from "@/next.config";

// The show's 1 GB instance climbed to ~950 MB within an hour of each deploy with a ~200 MB heap (2026-11-22 audit): sharp's
// cache and threads and glibc's arenas, held to limits from the start (lib/sharp-limits.ts, instrumentation.ts).
describe("sharp's memory limits", () => {
  afterAll(async () => {
    // libvips's defaults again, for the other test files in this worker.
    const { default: sharp } = await import("sharp");
    sharp.cache(true);
    sharp.concurrency(0);
  });

  it("keeps no operation cache and one thread per image, in the instance every module imports", async () => {
    await limitSharp();
    const { default: sharp } = await import("sharp");
    const stats = sharp.cache();
    expect([stats.memory.max, stats.files.max, stats.items.max]).toEqual([0, 0, 0]);
    expect(sharp.concurrency()).toBe(1);
  });

  it("starts with the server, on both hosts, before the After Dark-only work", () => {
    const src = readFileSync("instrumentation.ts", "utf8");
    const register = src.slice(src.indexOf("export async function register"));
    expect(register.indexOf("limitSharp()")).toBeGreaterThan(0);
    expect(register.indexOf("limitSharp()")).toBeLessThan(register.indexOf("afterDarkOnly()"));
  });

  it("gives Next's own image optimizer the same limits, and the allocator two arenas", () => {
    expect(config.experimental).toMatchObject({ imgOptConcurrency: 1, imgOptOperationCache: false });
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.start).toBe("MALLOC_ARENA_MAX=2 next start");
  });
});

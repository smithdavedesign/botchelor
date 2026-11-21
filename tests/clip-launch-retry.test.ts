// The clip scripts' Chromium launch retries (2026-11-20: one 180 s launch timed out on a starved Mac at 17:01, so the
// day had no clip and no kit; the same launch took 3 s that night).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { launchChromium } from "../scripts/clips/daily-clip.mjs";

function fake(failures: number) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    chromium: {
      async launch(options: Record<string, unknown>) {
        calls.push(options);
        if (calls.length <= failures) throw new Error("browserType.launch: Timeout 90000ms exceeded.\nCall log: …");
        return { browser: calls.length };
      },
    },
  };
}

describe("launchChromium", () => {
  it("returns the first browser that starts, each try with its own timeout, waiting between tries", async () => {
    const { calls, chromium } = fake(2);
    const waits: number[] = [];
    const lines: string[] = [];
    const b = await launchChromium(chromium, { executablePath: "/chrome", sleep: async (ms) => void waits.push(ms), log: (l) => void lines.push(l) });
    expect(b).toEqual({ browser: 3 });
    expect(calls).toEqual([0, 1, 2].map(() => ({ executablePath: "/chrome", timeout: 90_000 })));
    expect(waits).toEqual([60_000, 60_000]);
    expect(lines).toEqual([
      "Chromium didn't start (try 1 of 3): browserType.launch: Timeout 90000ms exceeded.",
      "Chromium didn't start (try 2 of 3): browserType.launch: Timeout 90000ms exceeded.",
    ]);
  });

  it("gives up after the last try with the launch's own error, and doesn't wait after it", async () => {
    const { calls, chromium } = fake(5);
    const waits: number[] = [];
    await expect(launchChromium(chromium, { executablePath: "/chrome", attempts: 2, timeout: 5, wait: 7, sleep: async (ms) => void waits.push(ms), log: () => {} })).rejects.toThrow(/Timeout 90000ms/);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([7]);
  });

  it("passes other launch options through, and a first-try start never waits", async () => {
    const { calls, chromium } = fake(0);
    const waits: number[] = [];
    await launchChromium(chromium, { executablePath: "/chrome", headless: true, sleep: async (ms) => void waits.push(ms) });
    expect(calls).toEqual([{ executablePath: "/chrome", headless: true, timeout: 90_000 }]);
    expect(waits).toEqual([]);
  });

  it("is how every clip script starts Chromium", () => {
    for (const f of ["daily-clip.mjs", "post-kit.mjs", "episode-cut.mjs"]) {
      const src = readFileSync(`scripts/clips/${f}`, "utf8");
      expect(src, f).toContain("await launchChromium(chromium)");
      expect(src, f).not.toMatch(/chromium\.launch\(\{ executablePath/);
    }
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { balanceShards } from "./shards.mjs";

// CI's four shards split by time, not by file count (tests/shards.mjs; the 2026-11-22 audit: one shard 3 minutes slower).
describe("CI's test shards", () => {
  const times = JSON.parse(readFileSync("tests/shard-times.json", "utf8")) as Record<string, number>;
  const files = readdirSync("tests")
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => `tests/${f}`);

  it("run every test file exactly once between them", () => {
    const shards = balanceShards(files, times, 4);
    const all = shards.flatMap((s) => [...s]);
    expect(all.sort()).toEqual([...files].sort());
    expect(new Set(all).size).toBe(files.length);
  });

  it("come out within one file's time of each other, the same split every time", () => {
    const shards = balanceShards(files, times, 4);
    const load = (s: Set<string>) => [...s].reduce((n, f) => n + (times[f] ?? 0), 0);
    const loads = shards.map(load);
    const longest = Math.max(...files.map((f) => times[f] ?? 0));
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(longest);
    expect(balanceShards([...files].reverse(), times, 4).map((s) => [...s].sort())).toEqual(shards.map((s) => [...s].sort()));
  });

  it("count a file with no time yet as the median, and still place it", () => {
    const times = { "tests/a.test.ts": 10, "tests/b.test.ts": 50, "tests/c.test.ts": 100 };
    const shards = balanceShards(["tests/a.test.ts", "tests/b.test.ts", "tests/c.test.ts", "tests/new.test.ts"], times, 2);
    // new weighs 50 (the median), so it joins b and a evens out c's shard; at 0 it would have trailed a onto b's.
    expect(shards.map((s) => [...s])).toEqual([
      ["tests/c.test.ts", "tests/a.test.ts"],
      ["tests/b.test.ts", "tests/new.test.ts"],
    ]);
  });

  it("has a time for most files (scripts/shard-times.mjs refreshes them)", () => {
    const timed = files.filter((f) => f in times).length;
    expect(timed / files.length).toBeGreaterThan(0.8);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { clearSharedCache, forViewer, setSharedCacheForTests, shared, SHARED_TTL_MS } from "@/lib/shared-cache";

// David, 2026-11-02: "other performance benefits". The main pages took 0.7–1.1 s, one database round trip after
// another; someone signed out now gets what everyone sees from a few seconds' shared copy.

afterEach(() => setSharedCacheForTests(null));

describe("the signed-out pages' shared copy", () => {
  it("loads once for everyone inside the window, then again after it", async () => {
    setSharedCacheForTests(true);
    let loads = 0;
    const load = async () => ({ n: ++loads, at: new Date(0) });
    const t0 = 1_000_000;
    expect((await shared("k", load, t0)).n).toBe(1);
    expect((await shared("k", load, t0 + SHARED_TTL_MS)).n).toBe(1);
    expect((await shared("k", load, t0 + SHARED_TTL_MS + 1)).n).toBe(2);
    // A different key is its own.
    expect((await shared("other", load, t0)).n).toBe(3);
  });

  it("gives each caller its own copy, Dates and all, so one page can't change the next one's", async () => {
    setSharedCacheForTests(true);
    const first = await shared("list", async () => ({ items: [3, 1, 2], at: new Date(5) }));
    first.items.sort();
    first.items.push(9);
    const second = await shared("list", async () => ({ items: [], at: new Date(0) }));
    expect(second.items).toEqual([3, 1, 2]);
    expect(second.at).toBeInstanceOf(Date);
    expect(second.at.getTime()).toBe(5);
  });

  it("runs one load at a time per key, and doesn't keep a failed one", async () => {
    setSharedCacheForTests(true);
    let loads = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async () => {
      loads++;
      await gate;
      return loads;
    };
    const both = Promise.all([shared("slow", slow), shared("slow", slow)]);
    release();
    expect(await both).toEqual([1, 1]);
    await expect(shared("bad", async () => Promise.reject(new Error("db down")))).rejects.toThrow("db down");
    expect(await shared("bad", async () => "fine")).toBe("fine");
  });

  it("is only for someone signed out, and is dropped on demand", async () => {
    setSharedCacheForTests(true);
    let loads = 0;
    const load = async () => ++loads;
    expect(await forViewer(null, "page", load)).toBe(1);
    expect(await forViewer(null, "page", load)).toBe(1);
    // A signed-in viewer always reads live.
    expect(await forViewer("user-1", "page", load)).toBe(2);
    clearSharedCache();
    expect(await forViewer(null, "page", load)).toBe(3);
  });

  it("is off in tests and scripts unless turned on", async () => {
    let loads = 0;
    const load = async () => ++loads;
    expect(await shared("off", load)).toBe(1);
    expect(await shared("off", load)).toBe(2);
  });
});

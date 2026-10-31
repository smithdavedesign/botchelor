import { afterEach, describe, expect, it, vi } from "vitest";

// The host's own collector of videos being made (lib/adult/reel-collector.ts; the audit, 2026-10-31: six finished shots
// sat 20 minutes because only the page asked after them).
const advanceReel = vi.fn(async (_db: unknown, _owner: string, _id: string): Promise<null> => null);
vi.mock("@/lib/adult/reels", () => ({ advanceReel: (db: unknown, owner: string, id: string) => advanceReel(db, owner, id) }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({ query: async () => ({ rows: [] }) }) }));

const { collectMakingReels, startReelCollector, stopReelCollector } = await import("@/lib/adult/reel-collector");

afterEach(() => {
  advanceReel.mockClear();
  stopReelCollector();
  vi.useRealTimers();
});

describe("collectMakingReels", () => {
  it("asks after every reel still being made, oldest first, and leaves the newest to the page", async () => {
    const now = Date.parse("2026-10-31T09:00:00Z");
    const rows = [
      { id: "old", owner_id: "o1", created_at: new Date(now - 20 * 60_000).toISOString() },
      { id: "mid", owner_id: "o2", created_at: new Date(now - 2 * 60_000).toISOString() },
      { id: "new", owner_id: "o3", created_at: new Date(now - 10_000).toISOString() },
    ];
    const queries: string[] = [];
    const db = { query: async (sql: string) => (queries.push(sql), { rows }) } as never;
    const r = await collectMakingReels(db, now);
    expect(r.asked).toEqual(["old", "mid"]);
    expect(advanceReel.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["o1", "old"],
      ["o2", "mid"],
    ]);
    expect(queries[0]).toMatch(/status = 'making'/);
  });

  it("carries on past one reel that throws", async () => {
    const now = Date.now();
    const rows = [
      { id: "bad", owner_id: "o1", created_at: new Date(now - 600_000).toISOString() },
      { id: "good", owner_id: "o2", created_at: new Date(now - 600_000).toISOString() },
    ];
    advanceReel.mockImplementationOnce(async () => {
      throw new Error("provider down");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = { query: async () => ({ rows }) } as never;
    const r = await collectMakingReels(db, now);
    expect(r.asked).toEqual(["good"]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("startReelCollector", () => {
  it("starts one timer, and a second start is a no-op", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "setInterval");
    startReelCollector(1000);
    startReelCollector(1000);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

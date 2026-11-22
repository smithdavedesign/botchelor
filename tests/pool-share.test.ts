import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { poolShare, withinShare } from "@/lib/pool-share";

/** A database whose queries each take `ms`, counting how many run at once. */
function slowDb(ms: number, fail?: (sql: string) => boolean) {
  const seen = { now: 0, most: 0, order: [] as string[] };
  const db: Db = {
    query: async <T,>(sql: string) => {
      seen.now++;
      seen.most = Math.max(seen.most, seen.now);
      seen.order.push(sql);
      await new Promise((r) => setTimeout(r, ms));
      seen.now--;
      if (fail?.(sql)) throw new Error("boom");
      return { rows: [] as T[] };
    },
    exec: async () => {},
  };
  return { db, seen };
}

describe("a share of the database pool (lib/pool-share.ts)", () => {
  it("runs at most its share at once, in the order asked, and every query still runs", async () => {
    const { db, seen } = slowDb(15);
    const shared = withinShare(db, poolShare(3));
    await Promise.all(Array.from({ length: 12 }, (_, i) => shared.query(`q${i}`)));
    expect(seen.most).toBe(3);
    expect(seen.order).toEqual(Array.from({ length: 12 }, (_, i) => `q${i}`));
  });

  it("is one share for everyone given it: two requests' queries count together", async () => {
    const { db, seen } = slowDb(10);
    const share = poolShare(2);
    const a = withinShare(db, share);
    const b = withinShare(db, share);
    await Promise.all([a.query("a1"), a.query("a2"), b.query("b1"), b.query("b2"), b.query("b3")]);
    expect(seen.most).toBe(2);
    expect(share.running).toBe(0);
    expect(share.waiting).toHaveLength(0);
  });

  it("a query that fails gives its place back", async () => {
    const { db } = slowDb(5, (sql) => sql === "bad");
    const share = poolShare(1);
    const shared = withinShare(db, share);
    const results = await Promise.allSettled([shared.query("bad"), shared.query("good"), shared.query("bad"), shared.query("good")]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled", "rejected", "fulfilled"]);
    expect(share.running).toBe(0);
  });
});

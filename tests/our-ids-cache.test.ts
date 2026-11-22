import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { loadOurIds, OUR_IDS_TTL_MS, setOurIdsCacheForTests } from "@/lib/our-traffic";

// loadOurIds held a database connection 4–7 s, and an admin page asked for it several times at once (2026-11-22 audit).
// One load is shared by everyone asking, and kept OUR_IDS_TTL_MS.
afterEach(() => setOurIdsCacheForTests(null));

/** A database that answers the one query slowly and counts how often it was asked. */
function countingDb(rows: () => { id: string }[]) {
  const seen = { queries: 0 };
  const db = {
    async query() {
      seen.queries++;
      await new Promise((r) => setTimeout(r, 20));
      return { rows: rows() };
    },
    async exec() {},
  } as unknown as Db;
  return { db, seen };
}

describe("our own identities, kept for a while", () => {
  it("shares one load between callers at once and keeps it for ten minutes, then loads again", async () => {
    setOurIdsCacheForTests(true);
    let version = 1;
    const { db, seen } = countingDb(() => [{ id: `admin-${version}` }, { id: "system" }]);
    const t0 = 1_000_000;
    const [a, b, c] = await Promise.all([loadOurIds(db, t0), loadOurIds(db, t0), loadOurIds(db, t0 + 5)]);
    expect(seen.queries).toBe(1);
    expect(a).toEqual(["admin-1", "system"]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    version = 2;
    expect(await loadOurIds(db, t0 + OUR_IDS_TTL_MS - 1)).toEqual(["admin-1", "system"]);
    expect(seen.queries).toBe(1);
    expect(await loadOurIds(db, t0 + OUR_IDS_TTL_MS)).toEqual(["admin-2", "system"]);
    expect(seen.queries).toBe(2);
  });

  it("hands each caller its own copy, keeps one list per database, and never keeps a failed load", async () => {
    setOurIdsCacheForTests(true);
    const one = countingDb(() => [{ id: "a" }]);
    const mine = await loadOurIds(one.db, 1);
    mine.push("changed by a caller");
    expect(await loadOurIds(one.db, 2)).toEqual(["a"]);
    const two = countingDb(() => [{ id: "b" }]);
    expect(await loadOurIds(two.db, 3)).toEqual(["b"]);
    let fail = true;
    const flaky = {
      async query() {
        if (fail) throw new Error("connection refused");
        return { rows: [{ id: "c" }] };
      },
      async exec() {},
    } as unknown as Db;
    await expect(loadOurIds(flaky, 4)).rejects.toThrow("connection refused");
    fail = false;
    expect(await loadOurIds(flaky, 5)).toEqual(["c"]);
  });

  it("reads afresh every time outside production, so tests and scripts see what they just wrote", async () => {
    const { db, seen } = countingDb(() => [{ id: "a" }]);
    await loadOurIds(db);
    await loadOurIds(db);
    expect(seen.queries).toBe(2);
  });
});

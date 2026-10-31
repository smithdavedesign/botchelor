import { afterEach, describe, expect, it, vi } from "vitest";

// The bucket backfill (lib/adult/faststart-backfill.ts; the 2026-10-31 audit: old clips weren't faststart and the
// oldest carried no AI mark). The transform itself is lib/mp4-faststart + lib/ai-mark, tested there and on real clips;
// here we test the orchestration: only the clips that need it are rewritten, every row is marked seen, one bad object
// doesn't stop the batch.
const needsWork = new Set<string>();
vi.mock("@/lib/mp4-faststart", () => ({
  isFaststart: (b: Buffer) => !needsWork.has(b.toString()),
  faststart: (b: Buffer) => b,
}));
vi.mock("@/lib/ai-mark", () => ({
  readMp4Xmp: () => "xmp",
  markAiVideo: (b: Buffer) => b,
}));

const { backfillClips } = await import("@/lib/adult/faststart-backfill");

type Row = { id: string; object_key: string };
function fakeDb(rows: Row[]) {
  const seen = new Set<string>();
  const updates: string[] = [];
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("update adult_images set faststart_at")) {
        const id = (params as string[])[0];
        seen.add(id);
        updates.push(id);
        return { rows: [] };
      }
      if (sql.includes("count(*)")) return { rows: [{ n: rows.filter((r) => !seen.has(r.id)).length }] };
      return { rows: rows.filter((r) => !seen.has(r.id)).slice(0, (params as number[])[0]) };
    },
  };
  return { db: db as never, updates };
}

afterEach(() => needsWork.clear());

describe("backfillClips", () => {
  it("rewrites only the clips that need it and marks every row seen", async () => {
    needsWork.add("key-b"); // its stored bytes aren't faststart yet
    const put = vi.fn(async (_k: string, _b: Buffer, _m: string) => {});
    const store = { get: async (k: string) => Buffer.from(k === "key-b" ? "key-b" : "ok"), put, presign: async () => ({ url: "", maxAge: 0 }), remove: async () => {} };
    const { db, updates } = fakeDb([
      { id: "a", object_key: "key-a" },
      { id: "b", object_key: "key-b" },
    ]);
    const r = await backfillClips(db, store as never, 20);
    expect(r).toEqual({ checked: 2, fixed: 1, missing: 0, left: 0 });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toBe("key-b");
    expect(updates.sort()).toEqual(["a", "b"]);
  });

  it("counts a missing object and carries past one that throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = {
      get: async (k: string) => {
        if (k === "gone") return null;
        if (k === "bad") throw new Error("storage down");
        return Buffer.from("ok");
      },
      put: async () => {},
      presign: async () => ({ url: "", maxAge: 0 }),
      remove: async () => {},
    };
    const { db, updates } = fakeDb([
      { id: "g", object_key: "gone" },
      { id: "x", object_key: "bad" },
      { id: "o", object_key: "ok" },
    ]);
    const r = await backfillClips(db, store as never, 20);
    expect(r.missing).toBe(1);
    // The row whose object threw is left for next time (not marked), the other two are done.
    expect(updates.sort()).toEqual(["g", "o"]);
    expect(r.left).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

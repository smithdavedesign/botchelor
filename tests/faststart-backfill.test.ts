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

const { backfillClips, rekeyClips } = await import("@/lib/adult/faststart-backfill");
const { mediaKey } = await import("@/lib/object-store");

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


type RKRow = { id: string; object_key: string };
function fakeDbRekey(rows: RKRow[]) {
  const seen = new Set<string>();
  const keys: Record<string, string> = Object.fromEntries(rows.map((r) => [r.id, r.object_key]));
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("set object_key")) {
        const [id, key] = params as [string, string];
        keys[id] = key;
        return { rows: [] };
      }
      if (sql.includes("set rekeyed_at")) {
        seen.add((params as string[])[0]);
        return { rows: [] };
      }
      if (sql.includes("count(*)")) return { rows: [{ n: rows.filter((r) => !seen.has(r.id)).length }] };
      return { rows: rows.filter((r) => !seen.has(r.id)).map((r) => ({ id: r.id, object_key: keys[r.id] })).slice(0, (params as number[])[0]) };
    },
  };
  return { db: db as never, keys };
}

describe("rekeyClips", () => {
  it("rewrites a clip under its content-hash key and repoints it; leaves one already on its key", async () => {
    const bytesA = Buffer.from("clip-a-bytes");
    const bytesB = Buffer.from("clip-b-bytes");
    const keyA = mediaKey("after-dark", "a", bytesA, "video/mp4"); // already on its content key
    const keyBnew = mediaKey("after-dark", "b", bytesB, "video/mp4");
    const put = vi.fn(async (_k: string, _b: Buffer, _m: string) => {});
    const remove = vi.fn(async (_k: string) => {});
    const store = { get: async (k: string) => (k === keyA ? bytesA : bytesB), put, remove, presign: async () => ({ url: "", maxAge: 0 }) };
    const { db, keys } = fakeDbRekey([
      { id: "a", object_key: keyA },
      { id: "b", object_key: "after-dark/b-0000000000000000.mp4" },
    ]);
    const r = await rekeyClips(db, store as never, 20);
    expect(r).toEqual({ checked: 2, rekeyed: 1, same: 1, missing: 0, left: 0 });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toBe(keyBnew);
    expect(remove).toHaveBeenCalledWith("after-dark/b-0000000000000000.mp4");
    expect(keys.b).toBe(keyBnew);
    expect(keys.a).toBe(keyA); // untouched
  });

  it("counts a missing object and carries past one that throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = {
      get: async (k: string) => (k === "gone" ? null : k === "bad" ? (() => { throw new Error("down"); })() : Buffer.from("x")),
      put: async () => {},
      remove: async () => {},
      presign: async () => ({ url: "", maxAge: 0 }),
    };
    const { db } = fakeDbRekey([
      { id: "g", object_key: "gone" },
      { id: "x", object_key: "bad" },
      { id: "o", object_key: "after-dark/o-1111111111111111.mp4" },
    ]);
    const r = await rekeyClips(db, store as never, 20);
    expect(r.missing).toBe(1);
    expect(r.left).toBe(1); // the throwing row is left for a retry
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

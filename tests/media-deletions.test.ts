import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAccount, deleteCharacter } from "@/lib/account";
import { deleteDueMedia, MEDIA_DELETE_DELAY_MS, MEDIA_DELETE_TRIES, MEDIA_KEY_COLUMNS } from "@/lib/media-deletions";
import { setObjectStoreForTests, type ObjectStore } from "@/lib/object-store";
import { deletePgPicture } from "@/lib/studio/pg";
import { api, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";
import { readSchemaSql, schemaColumns, statements } from "./schema-sql";

// The files of what's deleted (lib/media-deletions.ts, 2026-11-22): each row that names a file queues it as the row goes
// (a trigger per column, lib/db.ts), and the daily upkeep deletes it from the stores a week on if nothing names it then.
// A deletion in Bunny can't be undone, so nothing goes sooner.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from media_deletions");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

/** A store that records what it was asked to delete, and fails on `failOn`. */
function fakeStore(failOn?: string) {
  const removed: string[] = [];
  const store: ObjectStore = {
    put: async () => {},
    get: async () => null,
    remove: async (key) => {
      if (key === failOn) throw new Error("store down");
      removed.push(key);
    },
    presign: async () => ({ url: "", maxAge: 0 }),
  };
  return { store, removed };
}
const DAY = 24 * 60 * 60 * 1000;
type Queued = { key: string; due_at: Date; reason: string; done_at: Date | null; outcome: string | null; tries: number; last_error: string | null };
const queued = async () => (await t.db.query<Queued>(`select key, due_at, reason, done_at, outcome, tries, last_error from media_deletions order by key`)).rows;
const keys = async () => (await queued()).map((r) => r.key);
const dueAt = (r: Queued) => new Date(r.due_at).getTime();
/** A file already queued, its week over (as a trigger would have put it, then waited). */
const due = (key: string) => t.db.query(`insert into media_deletions (key, due_at, reason) values ($1, now() - interval '1 minute', 'test')`, [key]);

async function owner(name: string) {
  const cookie = newUserCookie();
  const id = userIdOf(cookie);
  const character = (await (await api.createCharacter(validCharacter({ name }), cookie)).json()).id as string;
  expect(character).toBeTruthy();
  return { id, character };
}
const adultImage = async (ownerId: string, characterId: string, key: string) => {
  const id = randomUUID();
  await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, object_key) values ($1, $2, $3, 'scene', 'p', 'image/png', $4)`, [id, ownerId, characterId, key]);
  return id;
};
const pgPicture = async (ownerId: string, characterId: string, key: string) => {
  const id = randomUUID();
  await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, mime, object_key, content_rating) values ($1, $2, $3, 'image/png', $4, 'pg')`, [id, ownerId, characterId, key]);
  return id;
};

describe("which files are known", () => {
  it("every column in the schema that keeps a file in the stores is checked before one is deleted, and queues it as its row goes", () => {
    // A store key sits beside its bytes' column for a Postgres fallback (object_key/data, audio_key/audio_data, …).
    const FILE_COLUMN = /^(object_key|audio_key|mp4_key|loop_key|poster_key|cut_key)$/;
    const inSchema = schemaColumns()
      .filter((c) => FILE_COLUMN.test(c.column))
      .map((c) => `${c.table}.${c.column}`)
      .sort();
    const listed = MEDIA_KEY_COLUMNS.map(([table, column]) => `${table}.${column}`).sort();
    expect(listed).toEqual(inSchema);
    const triggered = statements(readSchemaSql())
      .map((st) => /^create or replace trigger \w+ after delete or update of (\w+) on (\w+) for each row execute function media_file_gone\('(\w+)'\)$/i.exec(st))
      .filter((m): m is RegExpExecArray => m !== null && m[1] === m[3])
      .map((m) => `${m[2]}.${m[1]}`)
      .sort();
    expect(triggered).toEqual(listed);
    // The wait in the trigger is the one the code says.
    expect(readSchemaSql()).toContain(`now() + interval '${MEDIA_DELETE_DELAY_MS / DAY} days'`);
  });
});

describe("queued as the rows go", () => {
  it("deleting an account queues its files and its characters', and a week on deletes the ones nothing names", async () => {
    const me = await owner("Noor Vance");
    const other = await owner("Ilse Marrow");
    await adultImage(me.id, me.character, "after-dark/mine.png");
    await adultImage(me.id, me.character, "after-dark/shared.png");
    await adultImage(other.id, other.character, "after-dark/shared.png");
    await pgPicture(me.id, me.character, "studio-pg/mine.webp");
    await adultImage(other.id, other.character, "after-dark/theirs.png");
    const before = Date.now();
    await deleteAccount(t.db, me.id);

    const rows = await queued();
    expect(rows.map((r) => r.key)).toEqual(["after-dark/mine.png", "after-dark/shared.png", "studio-pg/mine.webp"]);
    for (const r of rows) {
      expect(dueAt(r)).toBeGreaterThanOrEqual(before + MEDIA_DELETE_DELAY_MS - 60_000);
      expect(dueAt(r)).toBeLessThanOrEqual(Date.now() + MEDIA_DELETE_DELAY_MS + 60_000);
      expect(r.done_at).toBeNull();
    }
    const { store, removed } = fakeStore();
    // Not before the week is out.
    expect(await deleteDueMedia(t.db, { stores: [{ store, bunny: true }], now: new Date(before + MEDIA_DELETE_DELAY_MS - DAY) })).toMatchObject({ deleted: 0 });
    expect(removed).toEqual([]);
    const run = await deleteDueMedia(t.db, { stores: [{ store, bunny: true }], now: new Date(Date.now() + MEDIA_DELETE_DELAY_MS + 60_000) });
    expect(run).toMatchObject({ deleted: 2, kept: 1, failed: 0 });
    expect(removed.sort()).toEqual(["after-dark/mine.png", "studio-pg/mine.webp"]);
    expect((await queued()).map((r) => [r.key, r.outcome])).toEqual([
      ["after-dark/mine.png", "deleted"],
      ["after-dark/shared.png", "kept"],
      ["studio-pg/mine.webp", "deleted"],
    ]);
    // Done is done: the next run asks nothing.
    expect(await deleteDueMedia(t.db, { stores: [{ store, bunny: true }], now: new Date(Date.now() + MEDIA_DELETE_DELAY_MS + DAY) })).toMatchObject({ deleted: 0, kept: 0 });
  });

  it("deleting a character queues the files its rows kept, the cascades' included", async () => {
    const me = await owner("Tobin Hale");
    await adultImage(me.id, me.character, "after-dark/char.png");
    await t.db.query(`insert into face_kits (id, character_id, source_id, part, status, object_key) values ($1, $2, 's', 'portrait', 'ready', 'companion/kit.webp')`, [randomUUID(), me.character]);
    expect(await deleteCharacter(t.db, me.id, me.character)).toMatchObject({ deleted: true });
    expect(await keys()).toEqual(["after-dark/char.png", "companion/kit.webp"]);
    expect((await queued())[0].reason).toBe("adult_images.object_key delete");
  });

  it("deleting a picture queues its file", async () => {
    const me = await owner("Wren Calder");
    const picture = await pgPicture(me.id, me.character, "studio-pg/one.webp");
    expect(await deletePgPicture(t.db, me.id, picture)).toBe(true);
    expect(await keys()).toEqual(["studio-pg/one.webp"]);
  });

  it("a row that names another file queues the one it named; the same file, or none before, queues nothing", async () => {
    const me = await owner("Ada Quill");
    const id = randomUUID();
    await t.db.query(`insert into adult_presence (id, owner_id, character_id, face_id, part, status, object_key) values ($1, $2, $3, 'f', 'portrait', 'ready', null)`, [
      id,
      me.id,
      me.character,
    ]);
    await t.db.query(`update adult_presence set object_key = 'after-dark/first.png' where id = $1`, [id]);
    await t.db.query(`update adult_presence set object_key = 'after-dark/first.png', status = 'ready' where id = $1`, [id]);
    await t.db.query(`update adult_presence set status = 'ready' where id = $1`, [id]);
    expect(await keys()).toEqual([]);
    await t.db.query(`update adult_presence set object_key = 'after-dark/second.png' where id = $1`, [id]);
    expect(await keys()).toEqual(["after-dark/first.png"]);
    expect((await queued())[0].reason).toBe("adult_presence.object_key update");
    // Drawn again with its bytes kept in Postgres: the file it named goes all the same.
    await t.db.query(`update adult_presence set object_key = null where id = $1`, [id]);
    expect(await keys()).toEqual(["after-dark/first.png", "after-dark/second.png"]);
  });

  it("a key already waiting keeps its time; one done before waits its week again", async () => {
    const me = await owner("Bram Oake");
    const first = await adultImage(me.id, me.character, "after-dark/twice.png");
    const second = await adultImage(me.id, me.character, "after-dark/twice.png");
    await t.db.query(`delete from adult_images where id = $1`, [first]);
    await t.db.query(`update media_deletions set due_at = now() - interval '1 day'`);
    await t.db.query(`delete from adult_images where id = $1`, [second]);
    expect(dueAt((await queued())[0])).toBeLessThan(Date.now());
    const { store, removed } = fakeStore();
    expect(await deleteDueMedia(t.db, { stores: [{ store, bunny: true }] })).toMatchObject({ deleted: 1 });
    expect(removed).toEqual(["after-dark/twice.png"]);
    const again = await adultImage(me.id, me.character, "after-dark/twice.png");
    await t.db.query(`delete from adult_images where id = $1`, [again]);
    const [row] = await queued();
    expect(row).toMatchObject({ done_at: null, outcome: null, tries: 0 });
    expect(dueAt(row)).toBeGreaterThan(Date.now() + MEDIA_DELETE_DELAY_MS - 60_000);
  });
});

describe("the daily run (deleteDueMedia)", () => {
  it("asks a failing store again the next day, and after MEDIA_DELETE_TRIES leaves the file for a person", async () => {
    await due("looks/x.webp");
    const { store } = fakeStore("looks/x.webp");
    let at = Date.now();
    for (let i = 1; i < MEDIA_DELETE_TRIES; i++) {
      expect(await deleteDueMedia(t.db, { stores: [{ store, bunny: true }], now: new Date(at) })).toMatchObject({ failed: 1 });
      const [row] = await queued();
      expect(row).toMatchObject({ tries: i, done_at: null, last_error: expect.stringContaining("store down") });
      // Not again the same day.
      expect(await deleteDueMedia(t.db, { stores: [{ store, bunny: true }], now: new Date(at + DAY / 2) })).toMatchObject({ failed: 0 });
      at += DAY + 60_000;
    }
    expect(await deleteDueMedia(t.db, { stores: [{ store, bunny: true }], now: new Date(at) })).toMatchObject({ failed: 1 });
    expect((await queued())[0]).toMatchObject({ outcome: "failed", done_at: expect.anything() });
  });

  it("keeps Bunny's files (After Dark's, the cast's hellos) waiting where Bunny isn't, and deletes from every store", async () => {
    await due("after-dark/y.mp4");
    await due("intros/hello.mp4");
    await due("looks/z.webp");
    const bucket = fakeStore();
    expect(await deleteDueMedia(t.db, { stores: [{ store: bucket.store, bunny: false }] })).toMatchObject({ deleted: 1, waiting: 2 });
    expect(bucket.removed).toEqual(["looks/z.webp"]);
    const bunny = fakeStore();
    const bucket2 = fakeStore();
    const both = [
      { store: bunny.store, bunny: true },
      { store: bucket2.store, bunny: false },
    ];
    expect(await deleteDueMedia(t.db, { stores: both })).toMatchObject({ deleted: 2, waiting: 0 });
    expect(bunny.removed.sort()).toEqual(["after-dark/y.mp4", "intros/hello.mp4"]);
    expect(bucket2.removed.sort()).toEqual(["after-dark/y.mp4", "intros/hello.mp4"]);
  });

  it("deletes only on the live show: never on a developer's machine, a preview or After Dark's own host", async () => {
    await due("looks/live.webp");
    const { store, removed } = fakeStore();
    setObjectStoreForTests(store);
    try {
      for (const env of [{}, { DEPLOY_ENV: "preview" }, { DEPLOY_ENV: "production", AFTER_DARK_ONLY: "1", AFTER_DARK_ORIGIN: "https://ad.example.com" }]) {
        expect(await deleteDueMedia(t.db, { env })).toMatchObject({ skipped: "not_live_show", deleted: 0 });
      }
      expect(removed).toEqual([]);
      expect(await deleteDueMedia(t.db, { env: { DEPLOY_ENV: "production" } })).toMatchObject({ deleted: 1 });
      expect(removed).toEqual(["looks/live.webp"]);
    } finally {
      setObjectStoreForTests(undefined);
    }
  });

  it("touches nothing without a store, once a file is taken off the queue, or past its time", async () => {
    await due("looks/later.webp");
    expect(await deleteDueMedia(t.db, { stores: [] })).toMatchObject({ skipped: "no_store", deleted: 0 });
    // Stopped by hand in its week: its row deleted.
    await t.db.query(`delete from media_deletions where key = 'looks/later.webp'`);
    const { store, removed } = fakeStore();
    expect(await deleteDueMedia(t.db, { stores: [{ store, bunny: true }] })).toMatchObject({ deleted: 0 });
    await due("looks/budget.webp");
    expect(await deleteDueMedia(t.db, { stores: [{ store, bunny: true }], budgetMs: -1 })).toMatchObject({ deleted: 0 });
    expect(removed).toEqual([]);
    expect((await queued())[0]).toMatchObject({ key: "looks/budget.webp", done_at: null });
  });
});

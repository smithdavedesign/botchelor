import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as introGet } from "@/app/api/cast-intro/[id]/[file]/route";
import { introOf } from "@/lib/cast-intros";
import { mediaKey } from "@/lib/object-store";
import { introKeyFor, introsToMove, moveIntros } from "../scripts/intros-to-bunny.mjs";
import { api, BASE_URL, newUserCookie, startTestDb, validCharacter } from "./helpers";

// Moving the cast's intro clips to Bunny's CDN (scripts/intros-to-bunny.mjs): what a dry run lists, what --apply copies
// and repoints, and what it never touches; then the card's clip is a redirect to a signed link there, under a new URL.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const sha16 = (b: Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const BUCKET_CLIP = Buffer.from("ftypisom-a-clip-in-the-bucket");
const DB_CLIP = Buffer.from("ftypisom-a-clip-kept-in-postgres");
// Built from parts, as tests/bunny-store.test.ts does: GitGuardian scans every commit.
const BUNNY = {
  MEDIA_BUNNY_ZONE: "botchelor-ad",
  MEDIA_BUNNY_KEY: ["bunny", "storage", "password", "not", "real"].join("-"),
  MEDIA_BUNNY_REGION: "ny",
  MEDIA_BUNNY_CDN_HOST: "https://media.botchelor.com/",
  MEDIA_BUNNY_TOKEN_KEY: ["bunny", "token", "key", "not", "real"].join("-"),
};

/** A store in memory, counting what it was asked. */
function memory(files: Record<string, Buffer> = {}) {
  const m = new Map(Object.entries(files));
  const asked = { get: 0, put: 0 };
  return {
    files: m,
    asked,
    store: {
      async get(k: string) {
        asked.get++;
        return m.get(k) ?? null;
      },
      async put(k: string, b: Buffer) {
        asked.put++;
        m.set(k, b);
      },
      async size(k: string) {
        return m.get(k)?.length ?? null;
      },
    },
  };
}

/** One intro, for a character of its own (one intro a character), last rendered a day ago. */
async function intro(id: string, cols: { status?: string; object_key?: string | null; data?: Buffer | null }): Promise<string> {
  const character = (await (await api.createCharacter(validCharacter({ name: `Cast ${id}` }), newUserCookie())).json()).id as string;
  await t.db.query(
    `insert into character_intros (id, character_id, line, voice, renderer, status, mime, object_key, data, updated_at)
     values ($1, $2, 'Hi.', 'aura', 'omnihuman', $3, 'video/mp4', $4, $5, now() - interval '1 day')`,
    [id, character, cols.status ?? "ready", cols.object_key ?? null, cols.data ?? null],
  );
  return character;
}

const row = async (id: string) =>
  (await t.db.query<{ object_key: string | null; data: Uint8Array | null; updated_at: string }>(`select object_key, data, updated_at::text from character_intros where id = $1`, [id])).rows[0];

describe("moving the cast's intros to Bunny (scripts/intros-to-bunny.mjs)", () => {
  const inBucket = `companion/intro-in-bucket-${sha16(BUCKET_CLIP)}.mp4`;

  async function cast() {
    await intro("in-bucket", { object_key: inBucket });
    await intro("in-db", { data: DB_CLIP });
    await intro("moved", { object_key: `intros/moved-${sha16(BUCKET_CLIP)}.mp4` });
    await intro("failed", { status: "failed", object_key: null });
    await intro("lost", { object_key: `companion/intro-lost-${sha16(DB_CLIP)}.mp4` });
  }

  it("names each key as the app's own (lib/object-store.ts mediaKey)", () => {
    expect(introKeyFor("in-db", sha16(DB_CLIP))).toBe(mediaKey("intros", "in-db", DB_CLIP, "video/mp4"));
  });

  it("lists the ready intros not under intros/ yet; a dry run writes nothing and reads no clip", async () => {
    await cast();
    expect((await introsToMove(t.db)).map((r) => r.id)).toEqual(["in-bucket", "in-db", "lost"]);
    const before = await row("in-bucket");
    const lines: string[] = [];
    const from = memory({ [inBucket]: BUCKET_CLIP });
    const to = memory();
    expect(await moveIntros(t.db, { from: from.store, to: to.store, log: (l) => lines.push(l), warn: (l) => lines.push(l) })).toBe(0);
    expect(lines.join("\n")).toContain(`would move intro in-bucket (character `);
    expect(lines.join("\n")).toContain(`to ${introKeyFor("in-bucket", sha16(BUCKET_CLIP))}`);
    expect(lines.join("\n")).toContain("would move intro in-db");
    expect(lines.at(-1)).toBe("dry run: 3 intros would move to Bunny; nothing was written (run with --apply)");
    expect(from.asked).toEqual({ get: 0, put: 0 });
    expect(to.asked).toEqual({ get: 0, put: 0 });
    expect(await row("in-bucket")).toEqual(before);
  });

  it("copies each to Bunny, checked against its key, then repoints its row under a new URL; deletes nothing; a second run copies nothing", async () => {
    await cast();
    const card = (await introOf(t.db, (await t.db.query<{ character_id: string }>(`select character_id from character_intros where id = 'in-bucket'`)).rows[0].character_id))!;
    const from = memory({ [inBucket]: BUCKET_CLIP });
    const to = memory();
    const warned: string[] = [];
    expect(await moveIntros(t.db, { apply: true, from: from.store, to: to.store, log: () => {}, warn: (l) => warned.push(l) })).toBe(0);
    const k1 = introKeyFor("in-bucket", sha16(BUCKET_CLIP));
    const k2 = introKeyFor("in-db", sha16(DB_CLIP));
    expect([...to.files.keys()].sort()).toEqual([k1, k2].sort());
    expect(to.files.get(k1)).toEqual(BUCKET_CLIP);
    expect(to.files.get(k2)).toEqual(DB_CLIP);
    expect((await row("in-bucket")).object_key).toBe(k1);
    expect((await row("in-db")).object_key).toBe(k2);
    // Nothing deleted: the bucket keeps its copy, the row its own bytes.
    expect(from.files.get(inBucket)).toEqual(BUCKET_CLIP);
    expect(Buffer.from((await row("in-db")).data!)).toEqual(DB_CLIP);
    // The one whose clip is nowhere is left as it is, and said.
    expect((await row("lost")).object_key).toBe(`companion/intro-lost-${sha16(DB_CLIP)}.mp4`);
    expect(warned.join("\n")).toContain("intro lost: its clip isn't in the bucket");
    // A new URL for the card, so Cloudflare's year-long copy of the old answer isn't used for it.
    const characterId = (await t.db.query<{ character_id: string }>(`select character_id from character_intros where id = 'in-bucket'`)).rows[0].character_id;
    expect((await introOf(t.db, characterId))!.url).not.toBe(card.url);
    // Already there: nothing copied again.
    expect(await moveIntros(t.db, { apply: true, from: from.store, to: to.store, log: () => {}, warn: () => {} })).toBe(0);
    expect(to.asked.put).toBe(2);
  });

  it("refuses bytes that don't hash to their key, and leaves a row a re-render changed meanwhile", async () => {
    await intro("bad", { object_key: `companion/intro-bad-${sha16(DB_CLIP)}.mp4` });
    await intro("busy", { object_key: inBucket });
    const from = memory({ [`companion/intro-bad-${sha16(DB_CLIP)}.mp4`]: BUCKET_CLIP, [inBucket]: BUCKET_CLIP });
    const to = memory();
    // A re-render lands while the clip is copied.
    const put = to.store.put;
    to.store.put = async (k, b) => {
      await put(k, b);
      await t.db.query(`update character_intros set object_key = 'intros/busy-rerendered.mp4' where id = 'busy'`);
    };
    const warned: string[] = [];
    expect(await moveIntros(t.db, { apply: true, from: from.store, to: to.store, log: () => {}, warn: (l) => warned.push(l) })).toBe(2);
    expect(warned.join("\n")).toContain("intro bad: the bytes for companion/intro-bad-");
    expect(warned.join("\n")).toContain("intro busy: changed while it was copied; run again");
    expect((await row("bad")).object_key).toBe(`companion/intro-bad-${sha16(DB_CLIP)}.mp4`);
    expect((await row("busy")).object_key).toBe("intros/busy-rerendered.mp4");
    expect([...to.files.keys()]).toEqual([introKeyFor("busy", sha16(BUCKET_CLIP))]);
  });
});

describe("the card's clip, once it's on Bunny", () => {
  const get = (id: string, file: string, headers: Record<string, string> = {}) =>
    introGet(new Request(`${BASE_URL}/api/cast-intro/${id}/${file}`, { headers }), { params: Promise.resolve({ id, file }) });

  it("is a redirect to a token-signed CDN link (byte ranges from the edge), kept no longer than the link is handed out", async () => {
    for (const [k, v] of Object.entries(BUNNY)) vi.stubEnv(k, v);
    const key = introKeyFor("on-cdn", sha16(BUCKET_CLIP));
    await intro("on-cdn", { object_key: key });
    const res = await get("on-cdn", "intro-1795214028.mp4", { range: "bytes=0-1023" });
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(`${to.origin}${to.pathname}`).toBe(`https://media.botchelor.com/${key}`);
    expect([...to.searchParams.keys()]).toEqual(["token", "expires"]);
    expect(res.headers.get("location")).not.toContain(BUNNY.MEDIA_BUNNY_TOKEN_KEY);
    const maxAge = Number(/^public, max-age=(\d+)$/.exec(res.headers.get("cache-control") ?? "")?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(3600);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    // The plain name too (links made before the version moved into the path).
    expect((await get("on-cdn", "intro.mp4")).status).toBe(302);
  });

  it("is sent from here, with byte ranges, while it's still in the bucket or Postgres, or where Bunny isn't set", async () => {
    for (const [k, v] of Object.entries(BUNNY)) vi.stubEnv(k, v);
    await intro("in-db", { data: DB_CLIP });
    const head = await get("in-db", "intro.mp4", { range: "bytes=0-3" });
    expect(head.status).toBe(206);
    expect(head.headers.get("content-range")).toBe(`bytes 0-3/${DB_CLIP.length}`);
    // An intros/ key with no Bunny here: no link to send it to, so its bytes come from the store or the row.
    vi.unstubAllEnvs();
    await t.db.query(`update character_intros set object_key = $1 where id = 'in-db'`, [introKeyFor("in-db", sha16(DB_CLIP))]);
    const whole = await get("in-db", "intro.mp4");
    expect(whole.status).toBe(200);
    expect(Buffer.from(await whole.arrayBuffer()).equals(DB_CLIP)).toBe(true);
    // Unknown, or not ready: a 404.
    expect((await get("nobody", "intro.mp4")).status).toBe(404);
    await intro("failed", { status: "failed" });
    expect((await get("failed", "intro.mp4")).status).toBe(404);
  });
});

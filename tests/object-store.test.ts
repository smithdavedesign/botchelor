import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as mediaGet } from "@/app/api/admin/after-dark/media/[id]/route";
import { GET as tileGet } from "@/app/api/looks/[id]/route";
import { claimAdmin } from "@/lib/admins";
import { HIVE_MODERATION, HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { makePicture, pollClip, setMediaFetchForTests, signedMediaUrl, startClip, VENICE_IMAGE } from "@/lib/adult/media";
import { saveAdultSettings } from "@/lib/adult/settings";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { tileSpecs } from "@/lib/looks";
import { drawTile, LOOKS_PG_MODEL, setLooksFetchForTests } from "@/lib/looks-draw";
import {
  keepBytes,
  LINK_WINDOW_MS,
  mediaKey,
  s3Store,
  setObjectStoreFetchForTests,
  setObjectStoreForTests,
  storeConfig,
  type ObjectStore,
} from "@/lib/object-store";
import { mediaKey as scriptMediaKey } from "../scripts/media-to-object-store.mjs";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Media bytes in a private S3-compatible bucket (lib/object-store.ts) instead of Postgres: written there when it's
// configured, read back with a fallback to the data column, and served by a presigned redirect only to someone let in.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query(`delete from look_tiles`);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setObjectStoreForTests(undefined);
  setObjectStoreFetchForTests(null);
  setMediaFetchForTests(null);
  setLooksFetchForTests(null);
  setCheckFetchForTests(null);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const MP4 = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 9, 9]);
const [CAST_A] = [HOUSE_CHARACTERS[0].id];
const CONFIG = {
  MEDIA_S3_ENDPOINT: "https://br-test-123.storage.c-1.us-east-1.aws.neon.tech/",
  MEDIA_S3_BUCKET: "botchelor-media",
  MEDIA_S3_ACCESS_KEY_ID: "test-access-key-id",
  MEDIA_S3_SECRET_ACCESS_KEY: "test-secret-access-key-not-real",
};

/** An in-memory bucket: what was put, what links were handed out, and what was removed. */
function memoryStore() {
  const objects = new Map<string, { bytes: Buffer; mime: string }>();
  const presigned: string[] = [];
  const puts: string[] = [];
  const store: ObjectStore = {
    async put(key, bytes, mime) {
      puts.push(key);
      objects.set(key, { bytes: Buffer.from(bytes), mime });
    },
    async get(key) {
      return objects.get(key)?.bytes ?? null;
    },
    async remove(key) {
      objects.delete(key);
    },
    async presign(key) {
      presigned.push(key);
      return { url: `https://bucket.test/${key}?X-Amz-Signature=fake`, maxAge: 120 };
    },
  };
  setObjectStoreForTests(store);
  return { store, objects, presigned, puts };
}

/** fal (a picture at once, a clip after one poll) and Hive (clean, adults) stand-ins. */
function fakeProviders(bodies: Record<string, string> = {}) {
  setMediaFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.body) bodies[url] = String(init.body);
    if (url.startsWith("https://fal.run/")) return Response.json({ images: [{ url: "https://cdn.fal.test/pic.png" }] });
    if (url.startsWith("https://queue.fal.run/") && init?.method === "POST") return Response.json({ request_id: "req-1" });
    if (url.endsWith("/status")) return Response.json({ status: "COMPLETED" });
    if (url.includes("/requests/req-1")) return Response.json({ video: { url: "https://cdn.fal.test/clip.mp4" } });
    if (url.endsWith(".png")) return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    if (url.endsWith(".mp4")) return new Response(new Uint8Array(MP4), { headers: { "content-type": "video/mp4" } });
    return new Response("nope", { status: 404 });
  });
  hive();
}
const CLEAN = { output: [{ classes: [{ class: "no_child_present", value: 0.99 }, { class: "yes_child_present", value: 0.01 }, { class: "general_nsfw", value: 0.01 }] }] };
const ADULTS = { choices: [{ message: { content: "ADULTS" } }] };
const hive = (vlm: unknown = ADULTS) =>
  setCheckFetchForTests(async (input: RequestInfo | URL) => (String(input) === HIVE_MODERATION ? Response.json(CLEAN) : String(input) === HIVE_VLM ? Response.json(vlm) : new Response("?", { status: 500 })));

const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
const media = (id: string, cookie?: string, url = `${BASE_URL}/api/admin/after-dark/media/${id}`) =>
  mediaGet(new Request(url, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });
const tile = (id: string, cookie?: string) => tileGet(new Request(`${BASE_URL}/api/looks/${id}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });
const row = async (table: "adult_images" | "look_tiles", id: string) =>
  (await t.db.query<{ data: Buffer | null; object_key: string | null }>(`select data, object_key from ${table} where id = $1`, [id])).rows[0];

describe("the store's settings and client", () => {
  it("is off unless all four settings are there, and reads the region from the endpoint", () => {
    expect(storeConfig({})).toBeNull();
    expect(storeConfig({ ...CONFIG, MEDIA_S3_SECRET_ACCESS_KEY: "" })).toBeNull();
    expect(storeConfig(CONFIG)).toMatchObject({ endpoint: "https://br-test-123.storage.c-1.us-east-1.aws.neon.tech", bucket: "botchelor-media", region: "us-east-1" });
    expect(storeConfig({ ...CONFIG, MEDIA_S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com", MEDIA_S3_REGION: "auto" })?.region).toBe("auto");
    expect(storeConfig({ ...CONFIG, MEDIA_S3_ENDPOINT: "https://minio.example.com" })?.region).toBe("us-east-1");
  });

  it("signs path-style requests: a PUT with its payload's hash, a missing object as null", async () => {
    const seen: { url: string; method: string; headers: Headers }[] = [];
    setObjectStoreFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers) });
      return init?.method === "GET" ? new Response("NoSuchKey", { status: 404 }) : new Response(null, { status: 200 });
    });
    const store = s3Store(storeConfig(CONFIG)!);
    await store.put("after-dark/abc-0123.png", PNG, "image/png");
    expect(await store.get("after-dark/missing.png")).toBeNull();
    expect(seen[0]).toMatchObject({ url: "https://br-test-123.storage.c-1.us-east-1.aws.neon.tech/botchelor-media/after-dark/abc-0123.png", method: "PUT" });
    expect(seen[0].headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=test-access-key-id\/\d{8}\/us-east-1\/s3\/aws4_request/);
    expect(seen[0].headers.get("x-amz-content-sha256")).toMatch(/^[0-9a-f]{64}$/);
    expect(seen[0].headers.get("content-type")).toBe("image/png");
    expect(JSON.stringify(seen.map((s) => [s.url, [...s.headers]]))).not.toContain(CONFIG.MEDIA_S3_SECRET_ACCESS_KEY);
  });

  it("retries a throttled request, and throws on a refusal", async () => {
    let n = 0;
    setObjectStoreFetchForTests(async () => (++n < 3 ? new Response("SlowDown", { status: 503 }) : new Response(new Uint8Array(PNG))));
    const store = s3Store(storeConfig(CONFIG)!);
    expect(await store.get("k")).toEqual(PNG);
    setObjectStoreFetchForTests(async () => new Response("AccessDenied", { status: 403 }));
    await expect(store.put("k", PNG, "image/png")).rejects.toThrow(/403/);
  });

  it("presigns the same link all through a window (so the browser's copy is reused), and a new one after", async () => {
    const store = s3Store(storeConfig(CONFIG)!);
    const start = Math.floor(Date.UTC(2026, 9, 20, 13) / LINK_WINDOW_MS) * LINK_WINDOW_MS;
    const a = await store.presign("after-dark/x.mp4", start + 1000);
    const b = await store.presign("after-dark/x.mp4", start + LINK_WINDOW_MS - 1000);
    const c = await store.presign("after-dark/x.mp4", start + LINK_WINDOW_MS + 1000);
    expect(a.url).toBe(b.url);
    expect(c.url).not.toBe(a.url);
    expect(a.maxAge).toBe(LINK_WINDOW_MS / 1000 - 1);
    expect(b.maxAge).toBe(1);
    const q = new URL(a.url).searchParams;
    expect(q.get("X-Amz-Expires")).toBe(String((2 * LINK_WINDOW_MS) / 1000));
    expect(q.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(q.get("response-cache-control")).toMatch(/^private/);
    expect(a.url).not.toContain(CONFIG.MEDIA_S3_SECRET_ACCESS_KEY);
  });

  it("names a file by area, id and its bytes' hash, the same way the copy script does", () => {
    const key = mediaKey("after-dark", "pic-1", PNG, "image/png");
    expect(key).toMatch(/^after-dark\/pic-1-[0-9a-f]{16}\.png$/);
    expect(scriptMediaKey("after-dark", "pic-1", PNG, "image/png")).toBe(key);
    expect(mediaKey("looks", "nsfw-x", MP4, "video/mp4")).not.toBe(mediaKey("looks", "nsfw-x", PNG, "video/mp4"));
  });
});

describe("keeping bytes", () => {
  it("unconfigured: the data column, exactly as before", async () => {
    expect(await keepBytes("after-dark", "x", PNG, "image/png")).toEqual({ data: PNG, object_key: null });
  });

  it("configured: the bucket, and the column stays empty; an upload that fails falls back to the column", async () => {
    const { objects } = memoryStore();
    const kept = await keepBytes("after-dark", "x", PNG, "image/png");
    expect(kept.data).toBeNull();
    expect(objects.get(kept.object_key!)?.bytes).toEqual(PNG);
    setObjectStoreForTests({ ...memoryStore().store, put: async () => Promise.reject(new Error("down")) });
    expect(await keepBytes("after-dark", "y", PNG, "image/png")).toEqual({ data: PNG, object_key: null });
  });
});

describe("After Dark's media in the bucket", () => {
  const picture = async (ownerId: string, face_of: string | null = null) =>
    makePicture(t.db, ownerId, { prompt: "an adult, waist-up", kind: "baseline", character_id: CAST_A, face_of });

  it("stores a picture and a clip in the bucket, and reads the baseline back from it for the face reference", async () => {
    const { id } = await admin();
    await saveAdultSettings(t.db, { fal_key: "placeholder-fal", hive_key: "placeholder-hive" });
    const { objects } = memoryStore();
    fakeProviders();
    const pic = await picture(id);
    const stored = await row("adult_images", pic.id);
    expect(stored.data).toBeNull();
    expect(stored.object_key).toMatch(new RegExp(`^after-dark/${pic.id}-[0-9a-f]{16}\\.png$`));
    expect(objects.get(stored.object_key!)?.bytes).toEqual(PNG);
    // The next picture of them uses that baseline as its face, read from the bucket.
    const bodies: Record<string, string> = {};
    fakeProviders(bodies);
    await picture(id, CAST_A);
    expect(JSON.parse(bodies["https://fal.run/fal-ai/ip-adapter-face-id"]).face_image_url).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
    // A clip from the first picture, stored in the bucket once fal's done.
    fakeProviders();
    const clip = await startClip(t.db, id, pic.id, "a slow turn");
    expect(await pollClip(t.db, clip.id, id)).toBe("ready");
    const c = await row("adult_images", clip.id);
    expect(c.data).toBeNull();
    expect(objects.get(c.object_key!)?.bytes).toEqual(MP4);
  });

  it("redirects an admin to a presigned link, and never presigns for anyone else", async () => {
    const { id, cookie } = await admin();
    await saveAdultSettings(t.db, { fal_key: "placeholder-fal", hive_key: "placeholder-hive" });
    const { presigned } = memoryStore();
    fakeProviders();
    const pic = await picture(id);
    expect((await media(pic.id)).status).toBe(404);
    expect((await media(pic.id, signedIn(userIdOf(newUserCookie())))).status).toBe(404);
    expect(presigned).toEqual([]);
    const shown = await media(pic.id, cookie);
    expect(shown.status).toBe(302);
    expect(shown.headers.get("location")).toMatch(/^https:\/\/bucket\.test\/after-dark\//);
    expect(shown.headers.get("cache-control")).toBe("private, max-age=120");
    expect(presigned).toHaveLength(1);
  });

  it("sends a provider's signed start frame from the bucket (no redirect), and never a clip", async () => {
    const { id } = await admin();
    const { objects } = memoryStore();
    const keyPic = mediaKey("after-dark", "pic-1", PNG, "image/png");
    const keyVid = mediaKey("after-dark", "vid-1", MP4, "video/mp4");
    objects.set(keyPic, { bytes: PNG, mime: "image/png" });
    objects.set(keyVid, { bytes: MP4, mime: "video/mp4" });
    await t.db.query(
      `insert into adult_images (id, owner_id, kind, prompt, mime, object_key) values ('pic-1', $1, 'scene', 'p', 'image/png', $2), ('vid-1', $1, 'video', 'p', 'video/mp4', $3)`,
      [id, keyPic, keyVid],
    );
    const frame = await media("pic-1", undefined, signedMediaUrl("pic-1", BASE_URL));
    expect(frame.status).toBe(200);
    expect(frame.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await frame.arrayBuffer())).toEqual(PNG);
    expect((await media("vid-1", undefined, signedMediaUrl("vid-1", BASE_URL))).status).toBe(404);
  });

  it("serves a row still only in Postgres from its column, and a copied row from the bucket (or its column when the store's off)", async () => {
    const { id, cookie } = await admin();
    const { objects } = memoryStore();
    const key = mediaKey("after-dark", "copied", PNG, "image/png");
    objects.set(key, { bytes: PNG, mime: "image/png" });
    await t.db.query(
      `insert into adult_images (id, owner_id, kind, prompt, mime, data, object_key) values ('legacy', $1, 'scene', 'p', 'image/png', $2, null), ('copied', $1, 'scene', 'p', 'image/png', $2, $3)`,
      [id, PNG, key],
    );
    const legacy = await media("legacy", cookie);
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(Buffer.from(await legacy.arrayBuffer())).toEqual(PNG);
    expect((await media("copied", cookie)).status).toBe(302);
    setObjectStoreForTests(null);
    const off = await media("copied", cookie);
    expect(off.status).toBe(200);
    expect(Buffer.from(await off.arrayBuffer())).toEqual(PNG);
  });

  it("unconfigured: a new picture's bytes are in the column and served from it, as before", async () => {
    const { id, cookie } = await admin();
    await saveAdultSettings(t.db, { fal_key: "placeholder-fal", hive_key: "placeholder-hive" });
    fakeProviders();
    const pic = await picture(id);
    const stored = await row("adult_images", pic.id);
    expect(stored.object_key).toBeNull();
    expect(Buffer.from(stored.data!)).toEqual(PNG);
    const shown = await media(pic.id, cookie);
    expect(shown.status).toBe(200);
    expect(Buffer.from(await shown.arrayBuffer())).toEqual(PNG);
  });
});

describe("looks tiles in the bucket", () => {
  const keys = () => saveAdultSettings(t.db, { fal_key: "placeholder-fal", hive_key: "placeholder-hive", venice_key: "placeholder-venice", moderation: { pg_via: "hive" } });
  function fakeLooks() {
    setLooksFetchForTests(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `https://fal.run/${LOOKS_PG_MODEL}`) return Response.json({ images: [{ url: "https://cdn.fal.test/tile.jpg" }], has_nsfw_concepts: [false] });
      if (url === VENICE_IMAGE) return Response.json({ images: [PNG.toString("base64")] });
      return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/jpeg" } });
    });
  }
  const spec = (id: string) => tileSpecs().find((s) => s.id === id)!;

  it("draws into the bucket; serves a show tile's bytes publicly, and redirects only someone who can open After Dark", async () => {
    await keys();
    const { objects, presigned } = memoryStore();
    fakeLooks();
    hive();
    expect(await drawTile(t.db, spec("pg-woman-eyes-green"))).toBe("ready");
    expect(await drawTile(t.db, spec("nsfw-woman-body-curvy"))).toBe("ready");
    const pgRow = await row("look_tiles", "pg-woman-eyes-green");
    expect(pgRow.data).toBeNull();
    expect(objects.has(pgRow.object_key!)).toBe(true);
    const pg = await tile("pg-woman-eyes-green");
    expect(pg.status).toBe(200);
    expect(pg.headers.get("cache-control")).toMatch(/public/);
    expect(Buffer.from(await pg.arrayBuffer())).toEqual(PNG);
    expect((await tile("nsfw-woman-body-curvy")).status).toBe(404);
    expect((await tile("nsfw-woman-body-curvy", signedIn(userIdOf(newUserCookie())))).status).toBe(404);
    expect(presigned).toEqual([]);
    const { cookie } = await admin();
    const ad = await tile("nsfw-woman-body-curvy", cookie);
    expect(ad.status).toBe(302);
    expect(ad.headers.get("cache-control")).toMatch(/^private/);
    expect(presigned).toEqual([(await row("look_tiles", "nsfw-woman-body-curvy")).object_key]);
  });

  it("screens a kept unscreened picture again without uploading it twice, and a refusal leaves the bucket", async () => {
    await keys();
    const { objects, puts } = memoryStore();
    fakeLooks();
    setCheckFetchForTests(async () => new Response("slow down", { status: 429 }));
    const s = spec("pg-woman-hair_color-red");
    expect(await drawTile(t.db, s)).toBe("failed");
    const kept = (await row("look_tiles", s.id)).object_key!;
    expect(objects.has(kept)).toBe(true);
    await t.db.query(`update look_tiles set updated_at = now() - interval '1 hour' where id = $1`, [s.id]);
    // That 429 was Hive's daily limit (lib/adult/hive-limit.ts): screened again once its pause is over.
    await t.db.query(`update adult_media_cooldowns set until = now() - interval '1 minute' where provider = 'hive'`);
    hive();
    expect(await drawTile(t.db, s)).toBe("ready");
    expect(puts).toEqual([kept]);
    expect((await row("look_tiles", s.id)).object_key).toBe(kept);

    const r = spec("pg-woman-hair_color-black");
    setCheckFetchForTests(async () => new Response("slow down", { status: 429 }));
    expect(await drawTile(t.db, r)).toBe("failed");
    const refusedKey = (await row("look_tiles", r.id)).object_key!;
    await t.db.query(`update look_tiles set updated_at = now() - interval '1 hour' where id = $1`, [r.id]);
    await t.db.query(`update adult_media_cooldowns set until = now() - interval '1 minute' where provider = 'hive'`);
    hive({ choices: [{ message: { content: "UNSURE" } }] });
    expect(await drawTile(t.db, r)).toBe("refused");
    expect(objects.has(refusedKey)).toBe(false);
    expect(await row("look_tiles", r.id)).toEqual({ data: null, object_key: null });
  });
});

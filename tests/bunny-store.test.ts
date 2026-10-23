import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as mediaGet } from "@/app/api/admin/after-dark/media/[id]/route";
import { claimAdmin } from "@/lib/admins";
import { sessionCookies } from "@/lib/http";
import {
  BUNNY_STORAGE_HOSTS,
  bunnyConfig,
  bunnyStore,
  bunnyToken,
  keepBytes,
  LINK_WINDOW_MS,
  mediaKey,
  objectStore,
  readBytes,
  setObjectStoreFetchForTests,
  setObjectStoreForTests,
} from "@/lib/object-store";
import { BUNNY_STORAGE_HOSTS as SCRIPT_HOSTS, bunnyStorage, copyAll, keyHashMatches, verifyAll, type CopyStore } from "../scripts/media-to-bunny.mjs";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Bunny (lib/object-store.ts bunnyStore) for After Dark's own host: Edge Storage over its HTTP API, served by a pull
// zone with Token Authentication. Secrets are built from parts: GitGuardian scans every commit.
const STORAGE_KEY = ["bunny", "storage", "password", "not", "real"].join("-");
const TOKEN_KEY = ["bunny", "token", "key", "not", "real"].join("-");
const BUNNY = {
  MEDIA_BUNNY_ZONE: "botchelor-ad",
  MEDIA_BUNNY_KEY: STORAGE_KEY,
  MEDIA_BUNNY_REGION: "ny",
  MEDIA_BUNNY_CDN_HOST: "https://media.botchelor.com/",
  MEDIA_BUNNY_TOKEN_KEY: TOKEN_KEY,
};
const S3 = {
  MEDIA_S3_ENDPOINT: "https://br-test-123.storage.c-1.us-east-1.aws.neon.tech",
  MEDIA_S3_BUCKET: "botchelor-media",
  MEDIA_S3_ACCESS_KEY_ID: "test-access-key-id",
  MEDIA_S3_SECRET_ACCESS_KEY: "test-secret-access-key-not-real",
};
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const MP4 = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 9, 9]);
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

type Seen = { url: string; method: string; headers: Headers; body: Buffer | null };
/** A fetch that records each request and answers from `reply`. */
function recorder(reply: (s: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const f = async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? Buffer.from(init.body as Uint8Array) : null;
    const s = { url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body };
    seen.push(s);
    return reply(s);
  };
  return { seen, fetch: f as typeof fetch };
}

afterEach(() => {
  vi.unstubAllEnvs();
  setObjectStoreForTests(undefined);
  setObjectStoreFetchForTests(null);
});

describe("Bunny's settings", () => {
  it("is off unless the zone, its key, the pull zone's host and its token key are all set", () => {
    expect(bunnyConfig({})).toBeNull();
    for (const k of ["MEDIA_BUNNY_ZONE", "MEDIA_BUNNY_KEY", "MEDIA_BUNNY_CDN_HOST", "MEDIA_BUNNY_TOKEN_KEY"]) expect(bunnyConfig({ ...BUNNY, [k]: " " })).toBeNull();
    expect(bunnyConfig(BUNNY)).toEqual({ zone: "botchelor-ad", key: STORAGE_KEY, storageHost: "ny.storage.bunnycdn.com", cdnHost: "media.botchelor.com", tokenKey: TOKEN_KEY });
  });

  it("finds the storage endpoint from the region (Frankfurt by default), or takes the host itself", () => {
    expect(bunnyConfig({ ...BUNNY, MEDIA_BUNNY_REGION: "" })?.storageHost).toBe("storage.bunnycdn.com");
    expect(bunnyConfig({ ...BUNNY, MEDIA_BUNNY_REGION: "SYD" })?.storageHost).toBe("syd.storage.bunnycdn.com");
    expect(bunnyConfig({ ...BUNNY, MEDIA_BUNNY_REGION: "https://la.storage.bunnycdn.com/" })?.storageHost).toBe("la.storage.bunnycdn.com");
    expect(() => bunnyConfig({ ...BUNNY, MEDIA_BUNNY_REGION: "mars" })).toThrow(/isn't a Bunny storage region/);
    expect(SCRIPT_HOSTS).toEqual(BUNNY_STORAGE_HOSTS); // the copy script's list is the app's
  });

  it("is the store when set (ahead of the S3 bucket); the bucket alone, or nothing, works as before", async () => {
    const link = async (env: Record<string, string>) => (await objectStore(env)?.presign("after-dark/x.png"))?.url ?? null;
    expect(new URL((await link({ ...S3, ...BUNNY }))!).host).toBe("media.botchelor.com");
    expect(new URL((await link(S3))!).host).toBe("br-test-123.storage.c-1.us-east-1.aws.neon.tech");
    expect(await link({})).toBeNull();
  });
});

describe("Bunny's URL token (Advanced Token Authentication)", () => {
  // Bunny's own cross-language vectors: github.com/BunnyWay/BunnyCDN.TokenAuthentication e2e/inputs.json and
  // e2e/vectors.json (at 48ff1af): key "SecurityKey", expires 1598024587.
  const KEY = "SecurityKey";
  const EXPIRES = 1598024587;
  it("matches Bunny's published vectors", () => {
    expect(bunnyToken(KEY, "/300kb.jpg", EXPIRES)).toBe("HS256-o10JRWlsAItyAsdKS6jJKjabHN4FrFsplDHPV1idcX4");
    expect(bunnyToken(KEY, "/abc/300kb.jpg", EXPIRES, { token_path: "/abc" })).toBe("HS256-uVZvT3SbEoVKYJyDJgbcsDmSFf73cv-uNUVaJiKWpbQ");
    expect(bunnyToken(KEY, "/300kb.jpg", EXPIRES, { token_countries: "CA,US" })).toBe("HS256-i5s3Uv7mnrFfN5nznwU2BxhILpnipYeE18TapV0WNFM");
    expect(bunnyToken(KEY, "/300kb.jpg", EXPIRES, { limit: "1000" })).toBe("HS256-DAVapqNNED3Z7JkjRTYX0UOIHNtbHEuuhRNEc4A7mMQ");
  });

  it("changes with the path, the expiry and the key", () => {
    const t = bunnyToken(KEY, "/300kb.jpg", EXPIRES);
    expect(bunnyToken(KEY, "/301kb.jpg", EXPIRES)).not.toBe(t);
    expect(bunnyToken(KEY, "/300kb.jpg", EXPIRES + 1)).not.toBe(t);
    expect(bunnyToken(`${KEY}x`, "/300kb.jpg", EXPIRES)).not.toBe(t);
    expect(t).toMatch(/^HS256-[A-Za-z0-9_-]{43}$/); // base64url, unpadded
  });
});

describe("the Bunny store", () => {
  const store = () => bunnyStore(bunnyConfig(BUNNY)!);

  it("uploads to the zone's endpoint with the AccessKey header and the body's SHA-256, upper-case", async () => {
    const r = recorder(() => new Response(null, { status: 201 }));
    setObjectStoreFetchForTests(r.fetch);
    await store().put("after-dark/abc-0123.png", PNG, "image/png");
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]).toMatchObject({ url: "https://ny.storage.bunnycdn.com/botchelor-ad/after-dark/abc-0123.png", method: "PUT", body: PNG });
    expect(r.seen[0].headers.get("accesskey")).toBe(STORAGE_KEY);
    expect(r.seen[0].headers.get("content-type")).toBe("image/png");
    expect(r.seen[0].headers.get("checksum")).toBe(sha256(PNG).toUpperCase());
  });

  it("reads a file, a missing one as null; deletes, a missing one quietly; and throws on a refusal", async () => {
    const files = new Map([["/botchelor-ad/after-dark/a.png", PNG]]);
    const r = recorder(({ url, method }) => {
      const path = new URL(url).pathname;
      if (method === "GET") return files.has(path) ? new Response(new Uint8Array(files.get(path)!)) : new Response("Not Found", { status: 404 });
      if (method === "DELETE") return path.endsWith("/locked.png") ? new Response("Unauthorized", { status: 401 }) : new Response(null, { status: files.has(path) ? 200 : 404 });
      return new Response("Bad request", { status: 400 });
    });
    setObjectStoreFetchForTests(r.fetch);
    expect(await store().get("after-dark/a.png")).toEqual(PNG);
    expect(await store().get("after-dark/missing.png")).toBeNull();
    await store().remove("after-dark/a.png");
    await store().remove("after-dark/missing.png");
    await expect(store().remove("after-dark/locked.png")).rejects.toThrow(/401/);
    await expect(store().put("after-dark/b.png", PNG, "image/png")).rejects.toThrow(/refused after-dark\/b\.png \(400\)/);
    for (const s of r.seen) {
      expect(s.headers.get("accesskey")).toBe(STORAGE_KEY);
      expect(s.url).not.toContain(STORAGE_KEY);
    }
  });

  it("tries a throttled request again", async () => {
    let n = 0;
    setObjectStoreFetchForTests(async () => (++n < 3 ? new Response("busy", { status: 503 }) : new Response(new Uint8Array(MP4))));
    expect(await store().get("after-dark/c.mp4")).toEqual(MP4);
    expect(n).toBe(3);
  });

  it("signs the same CDN link all through a window (so the browser's copy is reused), and a new one after, with no request", async () => {
    const r = recorder(() => new Response(null, { status: 500 }));
    setObjectStoreFetchForTests(r.fetch);
    const start = Math.floor(Date.UTC(2026, 9, 22, 13) / LINK_WINDOW_MS) * LINK_WINDOW_MS;
    const a = await store().presign("after-dark/x.mp4", start + 1000);
    const b = await store().presign("after-dark/x.mp4", start + LINK_WINDOW_MS - 1000);
    const c = await store().presign("after-dark/x.mp4", start + LINK_WINDOW_MS + 1000);
    expect(a.url).toBe(b.url);
    expect(c.url).not.toBe(a.url);
    expect(a.maxAge).toBe(LINK_WINDOW_MS / 1000 - 1);
    expect(b.maxAge).toBe(1);
    const u = new URL(a.url);
    const expires = (start + 2 * LINK_WINDOW_MS) / 1000; // a link lives two windows, as the bucket's do
    expect(`${u.origin}${u.pathname}`).toBe("https://media.botchelor.com/after-dark/x.mp4");
    expect([...u.searchParams.keys()]).toEqual(["token", "expires"]);
    expect(u.searchParams.get("expires")).toBe(String(expires));
    expect(u.searchParams.get("token")).toBe(bunnyToken(TOKEN_KEY, "/after-dark/x.mp4", expires));
    expect(a.url).not.toContain(TOKEN_KEY);
    expect(a.url).not.toContain(STORAGE_KEY);
    expect(r.seen).toEqual([]);
  });

  it("keeps a new file's bytes in Bunny and reads them back from it, set by the environment alone", async () => {
    for (const [k, v] of Object.entries(BUNNY)) vi.stubEnv(k, v);
    const files = new Map<string, Buffer>();
    setObjectStoreFetchForTests(
      recorder(({ url, method, body }) => {
        const path = new URL(url).pathname;
        if (method === "PUT") files.set(path, body!);
        if (method === "GET") return files.has(path) ? new Response(new Uint8Array(files.get(path)!)) : new Response(null, { status: 404 });
        return new Response(null, { status: 201 });
      }).fetch,
    );
    const kept = await keepBytes("after-dark", "pic-1", PNG, "image/png");
    expect(kept).toEqual({ data: null, object_key: mediaKey("after-dark", "pic-1", PNG, "image/png") });
    expect([...files.keys()]).toEqual([`/botchelor-ad/${kept.object_key}`]);
    expect(await readBytes(kept)).toEqual(PNG);
  });
});

describe("After Dark's media links come from Bunny when it's set", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
    vi.stubEnv("ADULT_MODE", "1");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
  });

  it("redirects an admin to a token-signed CDN link, and nobody else", async () => {
    for (const [k, v] of Object.entries(BUNNY)) vi.stubEnv(k, v);
    const r = recorder(() => new Response(null, { status: 500 }));
    setObjectStoreFetchForTests(r.fetch);
    const admin = userIdOf(newUserCookie());
    await claimAdmin(t.db, admin);
    const key = mediaKey("after-dark", "pic-1", PNG, "image/png");
    await t.db.query(`insert into adult_images (id, owner_id, kind, prompt, mime, object_key) values ('pic-1', $1, 'scene', 'p', 'image/png', $2)`, [admin, key]);
    const media = (cookie?: string) =>
      mediaGet(new Request(`${BASE_URL}/api/admin/after-dark/media/pic-1`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id: "pic-1" }) });
    const signedIn = (id: string) => sessionCookies({ userId: id, authenticated: true })[0].split(";")[0];
    expect((await media()).status).toBe(404);
    expect((await media(signedIn(userIdOf(newUserCookie())))).status).toBe(404);
    const shown = await media(signedIn(admin));
    expect(shown.status).toBe(302);
    const to = new URL(shown.headers.get("location")!);
    expect(`${to.origin}${to.pathname}`).toBe(`https://media.botchelor.com/${key}`);
    expect(to.searchParams.get("token")).toMatch(/^HS256-/);
    expect(shown.headers.get("cache-control")).toMatch(/^private, max-age=\d+$/);
    expect(r.seen).toEqual([]); // signing a link reads nothing
  });
});

describe("copying the bucket to Bunny (scripts/media-to-bunny.mjs)", () => {
  /** A store in memory, counting what it was asked. */
  function memory(name: string, files: Record<string, Buffer> = {}, withHash = false) {
    const m = new Map(Object.entries(files));
    const asked = { get: 0, put: 0, sha: 0 };
    const store: CopyStore = {
      name,
      async put(k, b) {
        asked.put++;
        m.set(k, b);
      },
      async get(k) {
        asked.get++;
        return m.get(k) ?? null;
      },
      async size(k) {
        return m.get(k)?.length ?? null;
      },
      ...(withHash
        ? {
            async sha256(k: string) {
              asked.sha++;
              return m.has(k) ? sha256(m.get(k)!) : null;
            },
          }
        : {}),
    };
    return { store, files: m, asked };
  }
  const k1 = mediaKey("after-dark", "pic-1", PNG, "image/png");
  const k2 = mediaKey("after-dark", "vid-1", MP4, "video/mp4");
  const k3 = mediaKey("looks", "nsfw-woman", PNG, "image/png");
  const rows: Record<string, { id: string; object_key: string; mime: string | null }[]> = {
    adult_images: [
      { id: "pic-1", object_key: k1, mime: "image/png" },
      { id: "vid-1", object_key: k2, mime: "video/mp4" },
    ],
    look_tiles: [{ id: "nsfw-woman", object_key: k3, mime: "image/png" }],
  };
  const db = { query: async (sql: string) => ({ rows: rows[/from (\w+)/.exec(sql)![1]] ?? [] }) };
  const quiet = { log: () => {}, warn: () => {} };

  it("copies only what Bunny lacks, checking each file against its key; a dry run writes nothing; a second run copies nothing", async () => {
    const from = memory("bucket", { [k1]: PNG, [k2]: MP4, [k3]: PNG });
    const to = memory("bunny", { [k3]: PNG });
    expect(await copyAll(db, from.store, to.store, { ...quiet, dryRun: true })).toBe(0);
    expect(to.asked.put).toBe(0);
    expect(await copyAll(db, from.store, to.store, quiet)).toBe(0);
    expect(to.files.get(k1)).toEqual(PNG);
    expect(to.files.get(k2)).toEqual(MP4);
    expect(to.asked.put).toBe(2);
    expect(await copyAll(db, from.store, to.store, quiet)).toBe(0);
    expect(to.asked.put).toBe(2);
  });

  it("refuses bytes that don't hash to their key, and reports a file the source doesn't have", async () => {
    const warned: string[] = [];
    const from = memory("bucket", { [k1]: MP4 }); // the wrong bytes under k1, and no k2 or k3
    const to = memory("bunny");
    expect(await copyAll(db, from.store, to.store, { log: () => {}, warn: (l) => warned.push(l) })).toBe(1);
    expect(to.files.size).toBe(0);
    expect(warned.join("\n")).toMatch(/don't hash to its name/);
    expect(warned.join("\n")).toMatch(/isn't in bucket/);
    expect(keyHashMatches(k1, PNG)).toBe(true);
    expect(keyHashMatches(k1, MP4)).toBe(false);
  });

  it("goes back the same way, and verifies by downloading, or by the bucket's stored hash", async () => {
    const bunny = memory("bunny", { [k1]: PNG, [k2]: MP4, [k3]: PNG });
    const bucket = memory("bucket", {}, true);
    expect(await copyAll(db, bunny.store, bucket.store, quiet)).toBe(0);
    expect(bucket.files.size).toBe(3);
    expect(await verifyAll(db, bucket.store, quiet)).toBe(0);
    expect(bucket.asked.get).toBe(0); // the stored hash, not a download
    expect(await verifyAll(db, bunny.store, quiet)).toBe(0);
    expect(bunny.asked.get).toBeGreaterThan(3 - 1);
    bunny.files.set(k2, PNG);
    bunny.files.delete(k3);
    const logged: string[] = [];
    expect(await verifyAll(db, bunny.store, { log: (l) => logged.push(l) })).toBe(2);
    expect(logged.join("\n")).toMatch(/1\/3 files match/);
  });

  it("talks to Bunny's storage API with its key: uploads with the checksum, and lists each directory once", async () => {
    const r = recorder(({ url, method }) => {
      if (method === "PUT") return new Response(null, { status: 201 });
      if (url.endsWith("/after-dark/")) return Response.json([{ ObjectName: k1.split("/")[1], Length: PNG.length, IsDirectory: false }, { ObjectName: "old", IsDirectory: true }]);
      return new Response("Not Found", { status: 404 });
    });
    const bunny = bunnyStorage(BUNNY, r.fetch, async () => {});
    await bunny.put(k2, MP4, "video/mp4");
    expect(r.seen[0]).toMatchObject({ url: `https://ny.storage.bunnycdn.com/botchelor-ad/${k2}`, method: "PUT" });
    expect(r.seen[0].headers.get("accesskey")).toBe(STORAGE_KEY);
    expect(r.seen[0].headers.get("checksum")).toBe(sha256(MP4).toUpperCase());
    expect(await bunny.size(k1)).toBe(PNG.length);
    expect(await bunny.size(k2)).toBeNull();
    expect(await bunny.size(k3)).toBeNull(); // looks/ isn't there yet: an empty listing
    expect(r.seen.filter((s) => s.method === "GET").map((s) => new URL(s.url).pathname)).toEqual(["/botchelor-ad/after-dark/", "/botchelor-ad/looks/"]);
    expect(() => bunnyStorage({ MEDIA_BUNNY_ZONE: "z" })).toThrow(/MEDIA_BUNNY_KEY/);
  });
});

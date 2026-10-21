/**
 * Media bytes in an S3-compatible bucket, not in Postgres.
 * After Dark's pictures and clips (adult_images, ~10 MB a clip) and the looks tiles (look_tiles) were bytea, read back
 * on every view; that used up the database project's network transfer and took the site down (2026-10-20). With the bucket
 * configured, a new file's bytes go to the bucket under a stable key kept in the row's object_key, and data stays
 * null. Unconfigured (tests, local), everything stays in bytea exactly as before.
 *
 * The bucket is PRIVATE: nothing in it has a public URL. A file is read with our credentials, or by a short-lived
 * presigned link handed only to someone the route has already let in (an admin, an After Dark subscriber).
 *
 * Any S3-compatible store that takes SigV4 and path-style URLs (Neon Object Storage in a project of its own, since
 * the database's region has none; R2, B2, S3 itself). Config:
 *   MEDIA_S3_ENDPOINT            the store's endpoint, e.g. https://br-….storage.c-N.us-east-1.aws.neon.tech
 *   MEDIA_S3_BUCKET              the bucket's name
 *   MEDIA_S3_ACCESS_KEY_ID       an access key that can read and write the bucket
 *   MEDIA_S3_SECRET_ACCESS_KEY   its secret
 *   MEDIA_S3_REGION              optional; read from the endpoint when it names one (…us-east-1…), else us-east-1
 * scripts/media-to-object-store.mjs copies existing rows' bytes into the bucket.
 */
import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";

export type ObjectStore = {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  /** The object's bytes, or null when there's no such object. */
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
  /** A link that reads one object without credentials for a while, and how long a browser may keep the redirect to it. */
  presign(key: string, now?: number): Promise<{ url: string; maxAge: number }>;
};

export type StoreConfig = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string };

/** The bucket's settings, or null when any of them is missing (then every file stays in Postgres). */
export function storeConfig(env: Record<string, string | undefined> = process.env): StoreConfig | null {
  const endpoint = env.MEDIA_S3_ENDPOINT?.trim().replace(/\/+$/, "");
  const bucket = env.MEDIA_S3_BUCKET?.trim();
  const accessKeyId = env.MEDIA_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.MEDIA_S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  const region = env.MEDIA_S3_REGION?.trim() || endpoint.match(/[./]([a-z]{2}-[a-z]+-\d)\./)?.[1] || "us-east-1";
  return { endpoint, bucket, region, accessKeyId, secretAccessKey };
}

/**
 * Presigned links are signed from the start of a window, not from now, so every view in the same window gets the
 * same URL and the browser's copy of the file (kept under that URL) is used again instead of downloading it: a
 * store's egress is metered too (Neon counts it against the project's network transfer allowance). A link lives two windows,
 * so a redirect kept until its window ends still points at a live link.
 */
export const LINK_WINDOW_MS = 6 * 60 * 60 * 1000;
const LINK_LIFE_S = (2 * LINK_WINDOW_MS) / 1000;
/** A stored file's bytes never change (its key holds their hash), so whoever may read it may keep it. */
const KEEP = "private, max-age=31536000, immutable";

type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
export function setObjectStoreFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);

/** undefined: from the environment; null: none (as if unconfigured); a store: that one. */
let testStore: ObjectStore | null | undefined;
export function setObjectStoreForTests(s: ObjectStore | null | undefined): void {
  testStore = s;
}

const signingKeys = new Map();
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const amzDate = (ms: number) => new Date(ms).toISOString().replace(/[:-]|\.\d{3}/g, "");

/** Throttled (503 SlowDown, 429) or briefly down: a couple more tries, a moment apart. */
async function withRetry(send: () => Promise<Response>): Promise<Response> {
  let res = await send();
  for (let i = 1; i <= 2 && (res.status === 503 || res.status === 500 || res.status === 429); i++) {
    await new Promise((r) => setTimeout(r, testFetch ? 0 : 250 * i));
    res = await send();
  }
  return res;
}

export function s3Store(cfg: StoreConfig): ObjectStore {
  const aws = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: "s3", region: cfg.region, cache: signingKeys });
  // Path-style (endpoint/bucket/key): the one form every S3-compatible store takes (Neon serves no other).
  const url = (key: string) => `${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const send = async (key: string, init: RequestInit & { headers?: Record<string, string> }) => {
    const req = await aws.sign(url(key), init);
    return doFetch(req.url, { method: req.method, headers: req.headers, body: init.body });
  };
  return {
    async put(key, bytes, mime) {
      // The payload's hash is signed, so the store refuses a body that arrived different from what we sent.
      const hash = sha256(bytes);
      const res = await withRetry(() =>
        send(key, {
          method: "PUT",
          body: new Uint8Array(bytes),
          headers: { "content-type": mime, "cache-control": KEEP, "x-amz-content-sha256": hash, "x-amz-meta-sha256": hash },
        }),
      );
      if (!res.ok) throw new Error(`object store refused ${key} (${res.status}): ${(await res.text()).slice(0, 200)}`);
    },
    async get(key) {
      const res = await withRetry(() => send(key, { method: "GET" }));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`object store couldn't read ${key} (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
    async remove(key) {
      const res = await withRetry(() => send(key, { method: "DELETE" }));
      if (!res.ok && res.status !== 404) throw new Error(`object store couldn't delete ${key} (${res.status})`);
    },
    async presign(key, now = Date.now()) {
      const start = Math.floor(now / LINK_WINDOW_MS) * LINK_WINDOW_MS;
      const u = new URL(url(key));
      u.searchParams.set("X-Amz-Expires", String(LINK_LIFE_S));
      // The file's own cache-control, signed in, so the browser keeps it for as long as the link can be handed out. No
      // spaces: a URL writes them as "+", which not every store decodes before checking the signature.
      u.searchParams.set("response-cache-control", `private,max-age=${LINK_LIFE_S},immutable`);
      const signed = await aws.sign(u.toString(), { method: "GET", aws: { signQuery: true, datetime: amzDate(start) } });
      return { url: signed.url, maxAge: Math.max(1, Math.ceil((start + LINK_WINDOW_MS - now) / 1000)) };
    },
  };
}

/** The configured bucket, or null: then every file is kept and read in Postgres, as before. */
export function objectStore(env: Record<string, string | undefined> = process.env): ObjectStore | null {
  if (testStore !== undefined) return testStore;
  const cfg = storeConfig(env);
  return cfg ? s3Store(cfg) : null;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4" };

/**
 * A file's key: its area, its row's id and the start of its bytes' sha256, e.g. after-dark/<uuid>-<16 hex>.mp4. The
 * hash makes a key name exactly one file, so a redrawn tile can't be confused with an old copy anywhere. The copy
 * script builds the same key (scripts/media-to-object-store.mjs).
 */
export type MediaArea = "after-dark" | "looks";
export function mediaKey(area: MediaArea, id: string, bytes: Buffer, mime: string): string {
  return `${area}/${id}-${sha256(bytes).slice(0, 16)}.${EXT[mime] ?? "bin"}`;
}

/**
 * Where a new file's bytes go: the bucket when it's configured (data null, the key kept), else the bytea column as
 * before. An upload that fails falls back to the column, so a picture that was paid for is never lost; the copy
 * script moves it later.
 */
export async function keepBytes(area: MediaArea, id: string, bytes: Buffer, mime: string): Promise<{ data: Buffer | null; object_key: string | null }> {
  const store = objectStore();
  if (!store) return { data: bytes, object_key: null };
  const key = mediaKey(area, id, bytes, mime);
  try {
    await store.put(key, bytes, mime);
    return { data: null, object_key: key };
  } catch (err) {
    console.error(`[object-store] kept ${area}/${id} in Postgres: ${err instanceof Error ? err.message : "error"}`);
    return { data: bytes, object_key: null };
  }
}

/**
 * The data column for a select: null for a row whose bytes are in the bucket, so they aren't pulled out of Postgres
 * as well (a row the copy script moved still has both until its column is freed). With no bucket configured, the
 * column is always read.
 */
export function dataColumn(table?: string): string {
  const t = table ? `${table}.` : "";
  return objectStore() ? `case when ${t}object_key is null then ${t}data end as data` : `${t}data as data`;
}

/** A row's bytes: from the bucket when it has a key, else (or if the bucket has lost it) its own data column. */
export async function readBytes(row: { data?: Buffer | Uint8Array | null; object_key?: string | null }): Promise<Buffer | null> {
  const store = row.object_key ? objectStore() : null;
  if (store && row.object_key) {
    const got = await store.get(row.object_key);
    if (got) return got;
    console.error(`[object-store] ${row.object_key} is missing from the bucket`);
  }
  return row.data ? Buffer.from(row.data) : null;
}

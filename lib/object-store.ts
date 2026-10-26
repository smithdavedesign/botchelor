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
 *
 * Or Bunny (bunny.net), whose terms allow adult content, for After Dark's own host (docs/after-dark-hosting.md): its
 * Edge Storage holds the files, and a pull zone with Token Authentication serves them by links that expire. Set, it's
 * the store (ahead of MEDIA_S3_*); unset, nothing changes. Config, all five or none:
 *   MEDIA_BUNNY_ZONE             the storage zone's name
 *   MEDIA_BUNNY_KEY              its password (Access → API / HTTP), sent as the AccessKey header
 *   MEDIA_BUNNY_REGION           its primary region: de (Frankfurt, the default), uk, ny, la, sg, se, br, jh or syd;
 *                                or the storage endpoint's host name itself
 *   MEDIA_BUNNY_CDN_HOST         the pull zone's host name: media.botchelor.com, or <pull zone>.b-cdn.net
 *   MEDIA_BUNNY_TOKEN_KEY        the pull zone's URL Token Authentication Key (Security → Token Authentication)
 * scripts/media-to-bunny.mjs copies the bucket's files across (and back).
 */
import { createHash, createHmac } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { markAiImage, markAiVideo } from "./ai-mark";

export type ObjectStore = {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  /** The object's bytes, or null when there's no such object. */
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
  /**
   * A link that reads one object without credentials for a while, and how long a browser may keep the redirect to it.
   * `download`: the file name a browser saves it as (S3 signs the header in; Bunny can't, so the key's own last part,
   * already that name for an export, is what's saved).
   */
  presign(key: string, now?: number, opts?: { download?: string }): Promise<{ url: string; maxAge: number }>;
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
          // x-amz-meta-ai-generated: the store sends it back as a header with the file, so a video or a voice read by a
          // presigned link is marked AI-generated too (lib/ai-mark.ts; everything kept here was made by a model).
          headers: { "content-type": mime, "cache-control": KEEP, "x-amz-content-sha256": hash, "x-amz-meta-sha256": hash, "x-amz-meta-ai-generated": "true" },
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
    async presign(key, now = Date.now(), opts = {}) {
      const start = Math.floor(now / LINK_WINDOW_MS) * LINK_WINDOW_MS;
      const u = new URL(url(key));
      u.searchParams.set("X-Amz-Expires", String(LINK_LIFE_S));
      // The file's own cache-control, signed in, so the browser keeps it for as long as the link can be handed out. No
      // spaces: a URL writes them as "+", which not every store decodes before checking the signature.
      u.searchParams.set("response-cache-control", `private,max-age=${LINK_LIFE_S},immutable`);
      // Saved under its own name (an export's zip, lib/media-tools/export.ts): an ASCII name with no spaces, as above.
      if (opts.download) u.searchParams.set("response-content-disposition", `attachment;filename=${opts.download.replace(/[^A-Za-z0-9._-]/g, "-")}`);
      const signed = await aws.sign(u.toString(), { method: "GET", aws: { signQuery: true, datetime: amzDate(start) } });
      return { url: signed.url, maxAge: Math.max(1, Math.ceil((start + LINK_WINDOW_MS - now) / 1000)) };
    },
  };
}

export type BunnyConfig = { zone: string; key: string; storageHost: string; cdnHost: string; tokenKey: string };

/** Each primary region's storage endpoint (bunny.net/docs/storage/http.md). */
export const BUNNY_STORAGE_HOSTS: Readonly<Record<string, string>> = {
  de: "storage.bunnycdn.com",
  uk: "uk.storage.bunnycdn.com",
  ny: "ny.storage.bunnycdn.com",
  la: "la.storage.bunnycdn.com",
  sg: "sg.storage.bunnycdn.com",
  se: "se.storage.bunnycdn.com",
  br: "br.storage.bunnycdn.com",
  jh: "jh.storage.bunnycdn.com",
  syd: "syd.storage.bunnycdn.com",
};

const hostName = (v: string | undefined) =>
  v?.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase() || undefined;

/**
 * Bunny's settings, or null when any of them is missing (then the S3 bucket, or Postgres, as before). A region that
 * isn't one throws: a store that would quietly be something else is worse than one that says it's misconfigured.
 */
export function bunnyConfig(env: Record<string, string | undefined> = process.env): BunnyConfig | null {
  const zone = env.MEDIA_BUNNY_ZONE?.trim();
  const key = env.MEDIA_BUNNY_KEY?.trim();
  const cdnHost = hostName(env.MEDIA_BUNNY_CDN_HOST);
  const tokenKey = env.MEDIA_BUNNY_TOKEN_KEY?.trim();
  if (!zone || !key || !cdnHost || !tokenKey) return null;
  const region = hostName(env.MEDIA_BUNNY_REGION) ?? "de";
  const storageHost = region.includes(".") ? region : BUNNY_STORAGE_HOSTS[region];
  if (!storageHost) throw new Error(`MEDIA_BUNNY_REGION "${region}" isn't a Bunny storage region (${Object.keys(BUNNY_STORAGE_HOSTS).join(", ")}) or host name`);
  return { zone, key, storageHost, cdnHost, tokenKey };
}

/**
 * A Bunny CDN URL token, Advanced Token Authentication (bunny.net/docs/cdn/security/token-authentication/advanced.md):
 * "HS256-" + base64url, unpadded, of HMAC-SHA256 keyed with the pull zone's token key over the signed path, the expiry
 * (Unix seconds), then the extra parameters sorted by name as name=value&…. The signed path is the URL's path, or
 * `token_path` when that's one of the parameters (a token for everything under it). No IP is signed: IP-locked tokens
 * need the zone's Token IP Validation on (which also turns its IPv6 off), and a viewer's address moves between
 * networks within the twelve hours a link lives. Checked against Bunny's own test vectors
 * (github.com/BunnyWay/BunnyCDN.TokenAuthentication e2e/vectors.json) in tests/bunny-store.test.ts.
 */
export function bunnyToken(tokenKey: string, path: string, expires: number, params: Record<string, string> = {}): string {
  const signed = params.token_path || path;
  const data = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return `HS256-${createHmac("sha256", tokenKey).update(signed).update(String(expires)).update(data).digest("base64url")}`;
}

/** A key as a URL path (/after-dark/x-0123.png): each segment encoded, the same in the storage API and the CDN. */
const keyPath = (key: string) => `/${key.split("/").map(encodeURIComponent).join("/")}`;

export function bunnyStore(cfg: BunnyConfig): ObjectStore {
  const url = (key: string) => `https://${cfg.storageHost}/${encodeURIComponent(cfg.zone)}${keyPath(key)}`;
  const send = (key: string, init: RequestInit & { headers?: Record<string, string> }) =>
    doFetch(url(key), { ...init, headers: { ...init.headers, AccessKey: cfg.key } });
  return {
    async put(key, bytes, mime) {
      // Bunny hashes what arrived and refuses it unless it matches this (SHA-256, upper-case hex).
      const res = await withRetry(() =>
        send(key, { method: "PUT", body: new Uint8Array(bytes), headers: { "content-type": mime, checksum: sha256(bytes).toUpperCase() } }),
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
      // As for S3: one link for the whole window (its expiry counted from the window's start), living two windows. The
      // pull zone sets how long a browser keeps the file (docs/after-dark-hosting.md: browser cache time, 12 hours).
      const start = Math.floor(now / LINK_WINDOW_MS) * LINK_WINDOW_MS;
      const expires = Math.floor(start / 1000) + LINK_LIFE_S;
      const path = keyPath(key);
      const q = new URLSearchParams({ token: bunnyToken(cfg.tokenKey, path, expires), expires: String(expires) });
      return { url: `https://${cfg.cdnHost}${path}?${q}`, maxAge: Math.max(1, Math.ceil((start + LINK_WINDOW_MS - now) / 1000)) };
    },
  };
}

/** The configured store (Bunny, else the S3 bucket), or null: then every file is kept and read in Postgres, as before. */
export function objectStore(env: Record<string, string | undefined> = process.env): ObjectStore | null {
  if (testStore !== undefined) return testStore;
  const bunny = bunnyConfig(env);
  if (bunny) return bunnyStore(bunny);
  const cfg = storeConfig(env);
  return cfg ? s3Store(cfg) : null;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4" };

/**
 * A file's key: its area, its row's id and the start of its bytes' sha256, e.g. after-dark/<uuid>-<16 hex>.mp4. The
 * hash makes a key name exactly one file, so a redrawn tile can't be confused with an old copy anywhere. The copy
 * script builds the same key (scripts/media-to-object-store.mjs).
 */
export type MediaArea = "after-dark" | "looks" | "studio-pg";
export function mediaKey(area: MediaArea, id: string, bytes: Buffer, mime: string): string {
  return `${area}/${id}-${sha256(bytes).slice(0, 16)}.${EXT[mime] ?? "bin"}`;
}

/**
 * Where a new file's bytes go: the bucket when it's configured (data null, the key kept), else the bytea column as
 * before. An upload that fails falls back to the column, so a picture that was paid for is never lost; the copy
 * script moves it later.
 */
export async function keepBytes(area: MediaArea, id: string, original: Buffer, mime: string): Promise<{ data: Buffer | null; object_key: string | null }> {
  // Everything kept here was made by a model (After Dark's pictures, keyframes, clips and voices; the looks tiles): a
  // picture, and an MP4, gets the machine-readable "AI-generated" mark before it's stored anywhere (lib/ai-mark.ts, EU AI
  // Act Art. 50). Audio is marked by its routes' headers instead.
  const bytes = mime.startsWith("image/") ? markAiImage(original) : mime === "video/mp4" ? markAiVideo(original) : original;
  let store: ObjectStore | null;
  try {
    store = objectStore();
  } catch (err) {
    // A misconfigured store (bunnyConfig) fails every read loudly, but never costs a file that was paid for.
    console.error(`[object-store] kept ${area}/${id} in Postgres: ${err instanceof Error ? err.message : "error"}`);
    return { data: bytes, object_key: null };
  }
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

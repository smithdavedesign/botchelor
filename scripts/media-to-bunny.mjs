#!/usr/bin/env node
/**
 * Copies the media files in the S3 bucket (MEDIA_S3_*: Neon Object Storage today) to Bunny's storage zone
 * (MEDIA_BUNNY_*) under the same keys, for After Dark's own host (docs/after-dark-hosting.md, lib/object-store.ts).
 * Every row with an object_key (adult_images, look_tiles) is copied unless Bunny already has its file. Rows whose bytes
 * are only in Postgres need nothing: both deployments read those from the database. Idempotent: stop it and run it
 * again, and run it again just before switching, for whatever was made meanwhile. Nothing in the database changes, and
 * nothing is deleted anywhere.
 *
 *   node scripts/media-to-bunny.mjs --dry-run         # what would be copied, and how much; writes nothing
 *   node scripts/media-to-bunny.mjs                   # copy (3 files at a time)
 *   node scripts/media-to-bunny.mjs --batch 5 --limit 100 --table adult_images
 *   node scripts/media-to-bunny.mjs --verify          # every keyed row: Bunny's file hashes to its key (downloads it)
 *   node scripts/media-to-bunny.mjs --back            # the other way, Bunny to the bucket: for switching back
 *   node scripts/media-to-bunny.mjs --back --verify   # the bucket's files, by the hash stored with each (no download)
 *
 * Every file is checked on the way: its bytes must hash to the 16 hex characters its key names (lib/object-store.ts
 * mediaKey), and Bunny refuses an upload whose SHA-256 isn't the one sent with it.
 *
 * Reads DATABASE_URL; MEDIA_S3_ENDPOINT, MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID, MEDIA_S3_SECRET_ACCESS_KEY (and
 * MEDIA_S3_REGION); MEDIA_BUNNY_ZONE, MEDIA_BUNNY_KEY and MEDIA_BUNNY_REGION. Prints no secrets. Reading the bucket
 * counts against its network transfer (Neon's media project: 4.5 GB a month); Bunny's storage API egress is free.
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { bucket } from "./media-to-object-store.mjs";

const TABLES = ["adult_images", "look_tiles"];
/** Each primary region's storage endpoint: the same list as lib/object-store.ts BUNNY_STORAGE_HOSTS (a test keeps them equal). */
export const BUNNY_STORAGE_HOSTS = {
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

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** The hash a key names: the 16 hex characters before its extension (lib/object-store.ts mediaKey), if it has them. */
const namedHash = (key) => /-([0-9a-f]{16})\.[A-Za-z0-9]+$/.exec(key)?.[1] ?? null;

/** Whether these bytes are the ones the key names; a key that names no hash passes. */
export function keyHashMatches(key, bytes) {
  const named = namedHash(key);
  return !named || sha256(bytes).startsWith(named);
}

/** Bunny Edge Storage over its HTTP API (AccessKey header), with what the copy needs: put, get, and whether it has a file. */
export function bunnyStorage(env, fetchImpl = fetch, pause = sleep) {
  const zone = env.MEDIA_BUNNY_ZONE?.trim();
  const key = env.MEDIA_BUNNY_KEY?.trim();
  if (!zone || !key) throw new Error("set MEDIA_BUNNY_ZONE and MEDIA_BUNNY_KEY (and MEDIA_BUNNY_REGION, unless the zone is in de)");
  const region = env.MEDIA_BUNNY_REGION?.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase() || "de";
  const host = region.includes(".") ? region : BUNNY_STORAGE_HOSTS[region];
  if (!host) throw new Error(`MEDIA_BUNNY_REGION "${region}" isn't a Bunny storage region (${Object.keys(BUNNY_STORAGE_HOSTS).join(", ")}) or host name`);
  const path = (k) => k.split("/").map(encodeURIComponent).join("/");
  const base = `https://${host}/${encodeURIComponent(zone)}`;
  async function send(url, init = {}) {
    for (let i = 0; ; i++) {
      const res = await fetchImpl(url, { ...init, headers: { ...init.headers, AccessKey: key } });
      if (i < 4 && (res.status === 429 || res.status >= 500)) {
        await pause(250 * 2 ** i);
        continue;
      }
      return res;
    }
  }
  /** One listing per directory: file name → size. */
  const listings = new Map();
  async function list(dir) {
    const res = await send(`${base}/${dir ? `${path(dir)}/` : ""}`);
    if (res.status === 404) return new Map();
    if (!res.ok) throw new Error(`list ${dir || "/"}: ${res.status}`);
    const items = await res.json();
    return new Map(items.filter((o) => !o.IsDirectory).map((o) => [o.ObjectName, Number(o.Length)]));
  }
  return {
    name: `Bunny (${zone})`,
    async put(k, bytes, mime) {
      const res = await send(`${base}/${path(k)}`, { method: "PUT", body: bytes, headers: { "content-type": mime, checksum: sha256(bytes).toUpperCase() } });
      if (!res.ok) throw new Error(`PUT ${k}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    async get(k) {
      const res = await send(`${base}/${path(k)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET ${k}: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async size(k) {
      const cut = k.lastIndexOf("/");
      const dir = cut === -1 ? "" : k.slice(0, cut);
      if (!listings.has(dir)) listings.set(dir, list(dir));
      return (await listings.get(dir)).get(k.slice(cut + 1)) ?? null;
    },
  };
}

/** The S3 bucket, shaped the same way (scripts/media-to-object-store.mjs's client). */
async function s3Storage(env) {
  const b = await bucket(env);
  return {
    name: `the bucket (${env.MEDIA_S3_BUCKET?.trim()})`,
    put: (k, bytes, mime) => b.put(k, bytes, mime),
    get: (k) => b.get(k),
    size: async (k) => (await b.head(k))?.size ?? null,
    sha256: async (k) => (await b.head(k))?.sha256 ?? null,
  };
}

function args(argv) {
  const a = { dryRun: false, verify: false, back: false, batch: 3, limit: Infinity, tables: TABLES };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--dry-run") a.dryRun = true;
    else if (v === "--verify") a.verify = true;
    else if (v === "--back") a.back = true;
    else if (v === "--batch") a.batch = Math.max(1, Math.min(10, Number(argv[++i]) || 3));
    else if (v === "--limit") a.limit = Math.max(1, Number(argv[++i]) || Infinity);
    else if (v === "--table") a.tables = [argv[++i]].filter((t) => TABLES.includes(t));
    else throw new Error(`unknown argument: ${v}`);
  }
  if (!a.tables.length) throw new Error(`--table must be one of: ${TABLES.join(", ")}`);
  return a;
}

/** The rows whose bytes are in a store: id, key and mime. Read-only. */
async function keyedRows(db, table) {
  return (await db.query(`select id, object_key, mime from ${table} where object_key is not null order by id`)).rows;
}

/** Copies every keyed file `to` doesn't have from `from`, `batch` at a time. Returns how many failed. */
export async function copyAll(db, from, to, opts = {}) {
  const a = { dryRun: false, batch: 3, limit: Infinity, tables: TABLES, log: console.log, warn: console.error, ...opts };
  const n = { copied: 0, there: 0, missing: 0, failed: 0, bytes: 0, seen: 0 };
  for (const table of a.tables) {
    const rows = await keyedRows(db, table);
    for (let i = 0; i < rows.length && n.seen < a.limit; i += a.batch) {
      const page = rows.slice(i, i + Math.min(a.batch, a.limit - n.seen));
      n.seen += page.length;
      await Promise.all(
        page.map(async (r) => {
          try {
            if ((await to.size(r.object_key)) !== null) {
              n.there++;
              return;
            }
            // A dry run only asks the size; a copy reads the bytes, checks them against the key, and writes them.
            const bytes = a.dryRun ? null : await from.get(r.object_key);
            const size = a.dryRun ? await from.size(r.object_key) : (bytes?.length ?? null);
            if (size === null) {
              n.missing++;
              a.warn(`  ${table}/${r.id}: ${r.object_key} isn't in ${from.name}`);
              return;
            }
            if (bytes) {
              if (!keyHashMatches(r.object_key, bytes)) throw new Error(`${from.name} has bytes for ${r.object_key} that don't hash to its name`);
              await to.put(r.object_key, bytes, r.mime ?? "application/octet-stream");
            }
            n.copied++;
            n.bytes += size;
          } catch (err) {
            n.failed++;
            a.warn(`  ${table}/${r.id}: ${err instanceof Error ? err.message : err}`);
          }
        }),
      );
    }
  }
  const missing = n.missing ? `; ${n.missing} not in ${from.name} (those rows read their Postgres copy, if they still have one)` : "";
  a.log(`${a.dryRun ? "would copy" : "copied"} ${n.copied} files (${mb(n.bytes)}) to ${to.name}; ${n.there} already there${missing}${n.failed ? `; ${n.failed} failed (run again)` : ""}`);
  return n.failed;
}

/** Every keyed row's file in `store`: there, and its bytes (or the hash stored with them) are the ones its key names. */
export async function verifyAll(db, store, opts = {}) {
  const a = { tables: TABLES, log: console.log, ...opts };
  const bad = [];
  let total = 0;
  for (const table of a.tables) {
    for (const r of await keyedRows(db, table)) {
      total++;
      try {
        // The bucket keeps each file's sha256 beside it (x-amz-meta-sha256), so it's checked without a download.
        const stored = store.sha256 ? await store.sha256(r.object_key) : null;
        if (stored) {
          const named = namedHash(r.object_key);
          if (named && !stored.startsWith(named)) bad.push(`${table}/${r.id} (hash differs)`);
          continue;
        }
        const bytes = await store.get(r.object_key);
        if (!bytes) bad.push(`${table}/${r.id} (missing)`);
        else if (!keyHashMatches(r.object_key, bytes)) bad.push(`${table}/${r.id} (hash differs)`);
      } catch (err) {
        bad.push(`${table}/${r.id} (${err instanceof Error ? err.message : err})`);
      }
    }
  }
  a.log(`${store.name}: ${total - bad.length}/${total} files match their keys`);
  for (const b of bad.slice(0, 20)) a.log(`  bad: ${b}`);
  return bad.length;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("set DATABASE_URL");
  const s3 = await s3Storage(process.env);
  const bunny = bunnyStorage(process.env);
  const [from, to] = a.back ? [bunny, s3] : [s3, bunny];
  const { default: pg } = await import("pg");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL.replace(/([?&]sslmode=)(require|prefer|verify-ca)(?=&|$)/, "$1verify-full") });
  await db.connect();
  try {
    process.exitCode = (a.verify ? await verifyAll(db, to, a) : await copyAll(db, from, to, a)) ? 1 : 0;
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

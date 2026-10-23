#!/usr/bin/env node
/**
 * Copies the media bytes still in Postgres (adult_images.data, look_tiles.data) into the private bucket
 * (lib/object-store.ts) and records each one's object_key, a few rows at a time. Idempotent: a row with an object_key
 * is skipped, so it can be stopped and run again. It never nulls or deletes `data`: once a row has a key the app reads
 * the bucket and stops pulling the column, and freeing the column is a separate, later, explicit step (--free-db below).
 *
 *   node scripts/media-to-object-store.mjs --dry-run            # what would be copied, and how much; writes nothing
 *   node scripts/media-to-object-store.mjs                      # copy (3 rows at a time)
 *   node scripts/media-to-object-store.mjs --batch 5 --limit 100 --table look_tiles
 *   node scripts/media-to-object-store.mjs --verify             # every copied row: the bucket's size and hash match
 *   node scripts/media-to-object-store.mjs --cors https://botchelor.com,https://botchelor.vercel.app
 *
 * --cors sets the bucket's CORS rule (GET/HEAD from those origins), which the reel player needs to preload shots that
 * redirect to the bucket. It doesn't make anything public: every read still needs a presigned link.
 *
 * Reads DATABASE_URL and MEDIA_S3_ENDPOINT, MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID, MEDIA_S3_SECRET_ACCESS_KEY (and
 * optionally MEDIA_S3_REGION) from the environment; prints no secrets. Reading every row's bytes once counts against
 * the database's network transfer, so run it when the month's allowance has room.
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const TABLES = { adult_images: "after-dark", look_tiles: "looks" };
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4" };
const KEEP = "private, max-age=31536000, immutable";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** The same key lib/object-store.ts mediaKey builds: area, row id, the start of the bytes' sha256, extension. */
export function mediaKey(area, id, bytes, mime) {
  return `${area}/${id}-${sha256(bytes).slice(0, 16)}.${EXT[mime] ?? "bin"}`;
}

function args(argv) {
  const a = { dryRun: false, verify: false, freeDb: false, batch: 3, limit: Infinity, tables: Object.keys(TABLES), cors: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--dry-run") a.dryRun = true;
    else if (v === "--verify") a.verify = true;
    else if (v === "--free-db") a.freeDb = true;
    else if (v === "--batch") a.batch = Math.max(1, Math.min(10, Number(argv[++i]) || 3));
    else if (v === "--limit") a.limit = Math.max(1, Number(argv[++i]) || Infinity);
    else if (v === "--table") a.tables = [argv[++i]].filter((t) => t in TABLES);
    else if (v === "--cors") a.cors = String(argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else throw new Error(`unknown argument: ${v}`);
  }
  if (!a.tables.length) throw new Error(`--table must be one of: ${Object.keys(TABLES).join(", ")}`);
  return a;
}

/** The S3 bucket's client (also scripts/media-to-bunny.mjs's, for copying to and from Bunny). */
export async function bucket(env) {
  const endpoint = env.MEDIA_S3_ENDPOINT?.trim().replace(/\/+$/, "");
  const name = env.MEDIA_S3_BUCKET?.trim();
  const accessKeyId = env.MEDIA_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.MEDIA_S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !name || !accessKeyId || !secretAccessKey) throw new Error("set MEDIA_S3_ENDPOINT, MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID and MEDIA_S3_SECRET_ACCESS_KEY");
  const region = env.MEDIA_S3_REGION?.trim() || endpoint.match(/[./]([a-z]{2}-[a-z]+-\d)\./)?.[1] || "us-east-1";
  const { AwsClient } = await import("aws4fetch");
  // aws4fetch retries a 5xx or 429 (a store throttling: 503 SlowDown) with backoff.
  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region, retries: 4, initRetryMs: 250 });
  const url = (key) => `${endpoint}/${encodeURIComponent(name)}${key ? `/${key.split("/").map(encodeURIComponent).join("/")}` : ""}`;
  const send = (u, init) => aws.fetch(u, init);
  return {
    async put(key, bytes, mime) {
      const hash = sha256(bytes);
      const res = await send(url(key), {
        method: "PUT",
        body: bytes,
        headers: { "content-type": mime, "cache-control": KEEP, "x-amz-content-sha256": hash, "x-amz-meta-sha256": hash },
      });
      if (!res.ok) throw new Error(`PUT ${key}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    async get(key) {
      const res = await send(url(key), { method: "GET" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET ${key}: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async head(key) {
      const res = await send(url(key), { method: "HEAD" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HEAD ${key}: ${res.status}`);
      return { size: Number(res.headers.get("content-length")), sha256: res.headers.get("x-amz-meta-sha256") };
    },
    async cors(origins) {
      const rule = origins.map((o) => `<AllowedOrigin>${o}</AllowedOrigin>`).join("");
      const body = `<CORSConfiguration><CORSRule>${rule}<AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>Content-Length</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
      const md5 = createHash("md5").update(body).digest("base64");
      const res = await send(`${url("")}?cors`, { method: "PUT", body, headers: { "content-type": "application/xml", "content-md5": md5 } });
      if (!res.ok) throw new Error(`PutBucketCors: ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
  };
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Copies one table's rows that have bytes and no key yet, `batch` at a time, keyset-paged by id. */
async function copyTable(db, store, table, a) {
  const area = TABLES[table];
  let last = "";
  let rows = 0;
  let bytes = 0;
  let failed = 0;
  for (;;) {
    if (rows >= a.limit) break;
    const page = (
      await db.query(
        `select id, mime, length(data)::bigint as size from ${table} where object_key is null and data is not null and id > $1 order by id limit $2`,
        [last, Math.min(a.batch, a.limit - rows)],
      )
    ).rows;
    if (!page.length) break;
    last = page[page.length - 1].id;
    rows += page.length;
    bytes += page.reduce((n, r) => n + Number(r.size), 0);
    if (a.dryRun) continue;
    await Promise.all(
      page.map(async (r) => {
        try {
          // One row's bytes at a time, so a page of clips never sits in memory at once.
          const { data } = (await db.query(`select data from ${table} where id = $1`, [r.id])).rows[0];
          const mime = r.mime ?? "application/octet-stream";
          const key = mediaKey(area, r.id, data, mime);
          await store.put(key, data, mime);
          const seen = await store.head(key);
          if (!seen || seen.size !== data.length) throw new Error(`the bucket has ${seen ? seen.size : "no"} bytes for ${key}, expected ${data.length}`);
          // Only now does the app start reading the bucket for this row; data stays put.
          await db.query(`update ${table} set object_key = $2 where id = $1 and object_key is null`, [r.id, key]);
        } catch (err) {
          failed++;
          console.error(`  ${table}/${r.id}: ${err instanceof Error ? err.message : err}`);
        }
      }),
    );
    process.stdout.write(`  ${table}: ${rows} rows, ${mb(bytes)}\r`);
  }
  console.log(`${table}: ${a.dryRun ? "would copy" : "copied"} ${rows - failed} rows (${mb(bytes)})${failed ? `, ${failed} failed (run again)` : ""}`);
  return failed;
}

/**
 * Every row with both a key and data: the bucket's object has the same size and sha256 as the column. The hash is
 * computed in Postgres (sha256(data)), so verifying pulls no bytes out of the database.
 */
async function verifyTable(db, store, table) {
  const { rows } = await db.query(
    `select id, object_key, length(data)::bigint as size, encode(sha256(data), 'hex') as sha from ${table} where object_key is not null and data is not null order by id`,
  );
  const bad = [];
  for (const r of rows) {
    const seen = await store.head(r.object_key).catch((err) => ({ error: err.message }));
    const ok = seen && !seen.error && seen.size === Number(r.size) && seen.sha256 === r.sha && r.object_key.includes(`-${r.sha.slice(0, 16)}.`);
    if (!ok) bad.push(`${r.id} (${seen?.error ?? (seen ? `size ${seen.size}/${r.size}, sha ${seen.sha256 ? "differs" : "missing"}` : "missing")})`);
  }
  const missing = Number((await db.query(`select count(*) as n from ${table} where object_key is null and data is not null`)).rows[0].n);
  console.log(`${table}: ${rows.length - bad.length}/${rows.length} copied rows verify; ${missing} not copied yet`);
  for (const b of bad.slice(0, 20)) console.log(`  bad: ${b}`);
  return { bad: bad.length, missing };
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("set DATABASE_URL");
  const store = await bucket(process.env);
  if (a.cors) {
    if (!a.cors.length || a.cors.some((o) => !/^https?:\/\/[^/]+$/.test(o))) throw new Error("--cors takes origins like https://botchelor.com,https://botchelor.vercel.app");
    await store.cors(a.cors);
    console.log(`CORS set: GET/HEAD from ${a.cors.join(", ")}`);
    return;
  }
  const { default: pg } = await import("pg");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL.replace(/([?&]sslmode=)(require|prefer|verify-ca)(?=&|$)/, "$1verify-full") });
  await db.connect();
  try {
    if (a.freeDb) {
      // Freeing the column is off in this version: it's a separate, explicit step, after the copy has run, the app has
      // read from the bucket for a while, and David has said so. To turn it on, uncomment the block below; it refuses
      // to free anything unless every row with bytes is copied and verifies by size and hash.
      console.error("--free-db is disabled in this version (see scripts/media-to-object-store.mjs). Nothing was changed.");
      process.exitCode = 1;
      return;
      // let problems = 0;
      // for (const table of a.tables) {
      //   const { bad, missing } = await verifyTable(db, store, table);
      //   problems += bad + missing;
      // }
      // if (problems) {
      //   console.error(`Refusing to free anything: ${problems} rows are not copied or don't verify. Run the copy, then --verify.`);
      //   process.exitCode = 1;
      //   return;
      // }
      // if (a.dryRun) return console.log("Every row verifies; --free-db without --dry-run would null their data.");
      // for (const table of a.tables) {
      //   // Row by row, each one checked again just before its column is nulled.
      //   const { rows } = await db.query(`select id from ${table} where object_key is not null and data is not null order by id`);
      //   for (const { id } of rows) {
      //     const r = (await db.query(`select object_key, length(data)::bigint as size, encode(sha256(data), 'hex') as sha from ${table} where id = $1`, [id])).rows[0];
      //     const seen = await store.head(r.object_key);
      //     if (!seen || seen.size !== Number(r.size) || seen.sha256 !== r.sha) throw new Error(`${table}/${id} stopped verifying; stopping`);
      //     await db.query(`update ${table} set data = null where id = $1 and object_key = $2`, [id, r.object_key]);
      //   }
      //   console.log(`${table}: freed ${rows.length} rows (run VACUUM FULL ${table} to give the space back)`);
      // }
    }
    if (a.verify) {
      let problems = 0;
      for (const table of a.tables) problems += (await verifyTable(db, store, table)).bad;
      process.exitCode = problems ? 1 : 0;
      return;
    }
    let failed = 0;
    for (const table of a.tables) failed += await copyTable(db, store, table, a);
    process.exitCode = failed ? 1 : 0;
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

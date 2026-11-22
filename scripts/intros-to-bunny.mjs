#!/usr/bin/env node
/**
 * Moves the cast's intro clips (character_intros, lib/cast-intros.ts) to Bunny's CDN under intros/ (lib/object-store.ts
 * BUNNY_AREAS), so each contestant card's clip plays straight from the edge with byte ranges: /api/cast-intro redirects
 * a clip kept there to a signed link. A clip rendered before 2026-11-22 was kept in the bucket
 * (companion/intro-<id>-<hash>.mp4) or in Postgres, and sent through the app, where Next 16.4 streams the body without
 * its Content-Length, so Cloudflare kept it whole and answered a range with all 3.5 MB (the 2026-11-22 audit).
 *
 * For each ready intro not under intros/ yet: its bytes are read (the bucket, else the row's own column), checked
 * against the hash its key names, put on Bunny as intros/<id>-<hash>.mp4 (Bunny refuses an upload whose SHA-256 isn't
 * the one sent with it), and only then is the row pointed at the new key, with a new updated_at: the card's URL
 * (intro-<render time>.mp4) changes with it, so Cloudflare's year-long copy of the old answer is never used for it.
 * Nothing is deleted anywhere: the bucket keeps its copy, and a row's own bytes stay where they are. Idempotent: a
 * second run finds nothing to move.
 *
 *   node scripts/intros-to-bunny.mjs            # dry run (the default): what would move, read-only, needs only DATABASE_URL
 *   node scripts/intros-to-bunny.mjs --apply    # copy each to Bunny, then repoint its row
 *
 * Reads DATABASE_URL; with --apply also MEDIA_S3_ENDPOINT, MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID,
 * MEDIA_S3_SECRET_ACCESS_KEY (the bucket, read) and MEDIA_BUNNY_ZONE, MEDIA_BUNNY_KEY, MEDIA_BUNNY_REGION (Bunny's
 * storage, written). Prints no secrets.
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { bunnyStorage, keyHashMatches } from "./media-to-bunny.mjs";
import { bucket } from "./media-to-object-store.mjs";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
/** The hash a key names: the 16 hex characters before its extension (lib/object-store.ts mediaKey). */
const namedHash = (key) => /-([0-9a-f]{16})\.[A-Za-z0-9]+$/.exec(key ?? "")?.[1] ?? null;

/** Its key under intros/, as lib/object-store.ts mediaKey("intros", id, bytes, "video/mp4") makes it. */
export const introKeyFor = (id, hash16) => `intros/${id}-${hash16}.mp4`;

/** The ready intros not on Bunny yet, with where their bytes are. Read-only. */
export async function introsToMove(db) {
  const { rows } = await db.query(
    `select id, character_id, object_key, mime, coalesce(octet_length(data), 0)::int as db_bytes, updated_at::text as updated_at
       from character_intros
      where status = 'ready' and (object_key is null or object_key not like 'intros/%')
      order by updated_at`,
  );
  return rows;
}

/**
 * Moves them: a dry run (no `from`/`to`) lists each with the key it would get; --apply copies and repoints, one at a
 * time. Returns how many failed (0 when all moved, or on a dry run).
 */
export async function moveIntros(db, { apply = false, from = null, to = null, log = console.log, warn = console.error } = {}) {
  const rows = await introsToMove(db);
  const n = { moved: 0, missing: 0, failed: 0, bytes: 0 };
  if (!rows.length) {
    log("every ready intro is on Bunny already (intros/); nothing to move");
    return 0;
  }
  for (const r of rows) {
    const where = r.object_key ? `the bucket (${r.object_key})` : r.db_bytes ? `Postgres (${mb(r.db_bytes)})` : "nowhere";
    if (!apply) {
      const hash = namedHash(r.object_key);
      log(`would move intro ${r.id} (character ${r.character_id}): from ${where} to ${hash ? introKeyFor(r.id, hash) : `intros/${r.id}-<its hash>.mp4`}`);
      continue;
    }
    try {
      let bytes = r.object_key ? await from.get(r.object_key) : null;
      if (!bytes && r.db_bytes) bytes = Buffer.from((await db.query(`select data from character_intros where id = $1`, [r.id])).rows[0]?.data ?? []);
      if (!bytes?.length) {
        n.missing++;
        warn(`  intro ${r.id}: its clip isn't in ${where}; left as it is`);
        continue;
      }
      if (r.object_key && !keyHashMatches(r.object_key, bytes)) throw new Error(`the bytes for ${r.object_key} don't hash to its name`);
      const key = introKeyFor(r.id, sha256(bytes).slice(0, 16));
      if ((await to.size(key)) !== bytes.length) await to.put(key, bytes, r.mime ?? "video/mp4");
      // Repointed only if nobody changed the row meanwhile (a re-render): then this run leaves it for the next.
      const done = await db.query(
        `update character_intros set object_key = $2, updated_at = now() where id = $1 and status = 'ready' and object_key is not distinct from $3 returning id`,
        [r.id, key, r.object_key],
      );
      if (done.rows.length !== 1) {
        warn(`  intro ${r.id}: changed while it was copied; run again`);
        n.failed++;
        continue;
      }
      n.moved++;
      n.bytes += bytes.length;
      log(`  moved intro ${r.id} to ${key} (${mb(bytes.length)})`);
    } catch (err) {
      n.failed++;
      warn(`  intro ${r.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (!apply) log(`dry run: ${rows.length} intro${rows.length === 1 ? "" : "s"} would move to Bunny; nothing was written (run with --apply)`);
  else log(`moved ${n.moved} of ${rows.length} intros (${mb(n.bytes)}) to Bunny${n.missing ? `; ${n.missing} had no clip to move` : ""}${n.failed ? `; ${n.failed} failed (run again)` : ""}`);
  return n.failed;
}

function args(argv) {
  const a = { apply: false };
  for (const v of argv) {
    if (v === "--apply") a.apply = true;
    else if (v === "--dry-run") a.apply = false;
    else throw new Error(`unknown argument: ${v}`);
  }
  return a;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("set DATABASE_URL");
  const from = a.apply ? await bucket(process.env) : null;
  const to = a.apply ? bunnyStorage(process.env) : null;
  const { default: pg } = await import("pg");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL.replace(/([?&]sslmode=)(require|prefer|verify-ca)(?=&|$)/, "$1verify-full") });
  await db.connect();
  try {
    // A dry run can't write, whatever the role could.
    if (!a.apply) await db.query("set default_transaction_read_only = on");
    process.exitCode = (await moveIntros(db, { apply: a.apply, from, to })) ? 1 : 0;
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

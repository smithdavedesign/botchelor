#!/usr/bin/env node
/**
 * Small cuts of the venue backdrops for the date packs' pictures (lib/pack-venues.ts): 192×128, WebP, about 5 KB each.
 * Reads the ids from lib/pack-venues.ts and each venue's current backdrop from public/cast; writes
 * public/cast/venue-thumb-<id>.webp. Run again after a venue's backdrop is redrawn:
 *
 *   node scripts/venue-thumbs.mjs && node scripts/stamp-ai-marks.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dirname, "..");
const CAST = join(ROOT, "public", "cast");
const src = readFileSync(join(ROOT, "lib", "pack-venues.ts"), "utf8");
const block = src.slice(src.indexOf("PACK_VENUES"), src.indexOf("};", src.indexOf("PACK_VENUES")));
const ids = [...new Set([...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))];
const files = readdirSync(CAST);

for (const id of ids) {
  // The newest version of the venue's backdrop (venue-<id>-v2.webp, -v3.webp…).
  const backdrop = files
    .filter((f) => new RegExp(`^venue-${id}-v\\d+\\.webp$`).test(f))
    .sort((a, b) => Number(a.match(/-v(\d+)\./)[1]) - Number(b.match(/-v(\d+)\./)[1]))
    .at(-1);
  if (!backdrop) throw new Error(`no backdrop for ${id}`);
  const out = join(CAST, `venue-thumb-${id}.webp`);
  const info = await sharp(join(CAST, backdrop)).resize(192, 128, { fit: "cover", position: "centre" }).webp({ quality: 68 }).toFile(out);
  console.log(`${id}: ${backdrop} → venue-thumb-${id}.webp (${info.size} B)`);
}

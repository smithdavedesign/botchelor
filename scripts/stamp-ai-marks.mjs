#!/usr/bin/env node
/**
 * Writes the machine-readable "AI-generated" mark (lib/ai-mark.ts: XMP with IPTC trainedAlgorithmicMedia) into the
 * pictures shipped in public/cast: the house cast's portraits and the venue backdrops, all drawn by a model
 * (scripts/portraits.mjs). In place, without re-encoding, and a no-op on a file that already has it, so it's safe to
 * run again after new portraits land (tests/ai-mark.test.ts fails until it has been).
 *
 *   node scripts/stamp-ai-marks.mjs            # stamps public/cast
 *   node scripts/stamp-ai-marks.mjs <dir>…     # or these folders
 *
 * Needs a Node that runs TypeScript directly (22.18+, 23.6+), since it imports lib/ai-mark.ts.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasAiMark, markAiImage } from "../lib/ai-mark.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : [join(root, "public", "cast")];
let stamped = 0;
let already = 0;
let skipped = 0;
for (const dir of dirs) {
  for (const f of readdirSync(dir).filter((x) => /\.(webp|png|jpe?g)$/i.test(x))) {
    const path = join(dir, f);
    const bytes = readFileSync(path);
    if (hasAiMark(bytes)) {
      already++;
      continue;
    }
    const marked = markAiImage(bytes);
    if (marked === bytes) {
      skipped++;
      console.warn(`couldn't stamp ${f} (not a JPEG, PNG or WebP it can parse)`);
      continue;
    }
    writeFileSync(path, marked);
    stamped++;
  }
}
console.log(`stamped ${stamped}, already marked ${already}, skipped ${skipped}`);

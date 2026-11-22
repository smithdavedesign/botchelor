#!/usr/bin/env node
/**
 * Shrinks new proof screenshots under docs/screenshots before they're committed, keeping each file's name. A page
 * screenshot drawn again in 256 colours with dithering looks the same and takes about a third of the bytes; that copy
 * is kept only when it stays within 44 dB PSNR of the original (no visible change) and saves 20% or more. Otherwise
 * the same pixels are written again at the strongest zlib level, kept when that saves 5% or more.
 *
 * Run it after taking screenshots and before `git add`: a committed picture stays in the history for good (nothing is
 * rewritten or deleted here), so shrinking it after the commit only adds a second copy. `npm run gate` runs it on the
 * screenshots not committed yet.
 *
 *   npm run screenshots:shrink                         the PNGs under docs/screenshots that aren't committed yet
 *   node scripts/shrink-screenshots.mjs <file…>        those files
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const DIR = "docs/screenshots";
const MIN_PSNR = 44;

/** Peak signal-to-noise ratio between two pictures' raw bytes, in dB (Infinity when they're the same). */
export function psnr(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return sum === 0 ? Infinity : 10 * Math.log10((255 * 255 * a.length) / sum);
}

const pixels = (bytes) => sharp(bytes).ensureAlpha().raw().toBuffer();

/** A smaller PNG that looks the same as this screenshot, or null when there's none worth having. */
export async function shrinkPng(bytes) {
  const meta = await sharp(bytes).metadata();
  if (meta.format !== "png" || meta.depth !== "uchar" || meta.isPalette) return null;
  const original = await pixels(bytes);
  const palette = await sharp(bytes).png({ palette: true, quality: 100, dither: 1, compressionLevel: 9 }).toBuffer();
  if (palette.length <= bytes.length * 0.8 && psnr(original, await pixels(palette)) >= MIN_PSNR) return palette;
  const lossless = await sharp(bytes).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  if (lossless.length <= bytes.length * 0.95 && (await pixels(lossless)).equals(original)) return lossless;
  return null;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

async function main() {
  const given = process.argv.slice(2);
  const files = given.length
    ? given
    : [...new Set([...git("diff", "--name-only", "HEAD", "--", DIR), ...git("ls-files", "--others", "--exclude-standard", "--", DIR)])];
  let saved = 0;
  let shrunk = 0;
  for (const file of files.filter((f) => f.endsWith(".png") && existsSync(f))) {
    const bytes = readFileSync(file);
    const out = await shrinkPng(bytes);
    if (!out) continue;
    writeFileSync(file, out);
    saved += bytes.length - out.length;
    shrunk += 1;
    console.log(`${file}: ${Math.round(bytes.length / 1024)} KB → ${Math.round(out.length / 1024)} KB`);
  }
  console.log(shrunk ? `Shrank ${shrunk} screenshot(s), ${(saved / 1024 / 1024).toFixed(1)} MB saved: git add them.` : "No screenshot to shrink.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

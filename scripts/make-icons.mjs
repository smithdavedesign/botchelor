#!/usr/bin/env node
/**
 * node scripts/make-icons.mjs: the installable app's PNG icons (app/manifest.ts, the apple-touch icon, the notification
 * badge), drawn from public/icon.svg in a real browser (Chromium via CHROMIUM_PATH, never downloaded) into public/icons/.
 * PG only, like every app icon: the show's gradient tile and its heart, nothing else. Run it again after changing
 * public/icon.svg, and commit the PNGs it writes.
 *
 *   icon-192.png, icon-512.png   the tile as it is (rounded corners): "any" in the manifest
 *   icon-maskable-512.png        the gradient to the edges, the heart inside the middle 80% the system may crop to
 *   apple-touch-icon.png         180×180, square and opaque (iOS rounds the corners itself)
 *   badge-96.png                 the heart alone, white on transparent: Android draws a notification badge from its shape
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "icons");

const source = readFileSync(join(ROOT, "public", "icon.svg"), "utf8");
const gradient = source.match(/<linearGradient[\s\S]*?<\/linearGradient>/)?.[0];
const heart = source.match(/<path d="([^"]+)"/)?.[1];
const tileRadius = Number(source.match(/<rect[^>]*\brx="([\d.]+)"/)?.[1] ?? 8);
if (!gradient || !heart) throw new Error("public/icon.svg: expected a linearGradient and the heart's path");

// The heart's middle in the 32-unit drawing (its path spans x 7–25, y 9.2–25.5): scaled about it, then centred.
const HEART_CENTRE = { x: 16, y: 17.35 };

/** One icon as SVG, at its pixel size: the 32-unit drawing scaled up. */
function svg({ size, radius, heartScale, background = true }) {
  const t = `translate(16 16) scale(${heartScale}) translate(${-HEART_CENTRE.x} ${-HEART_CENTRE.y})`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <defs>${gradient}</defs>
  ${background ? `<rect width="32" height="32" rx="${radius}" fill="url(#g)"/>` : ""}
  <path d="${heart}" fill="#fff" transform="${t}"/>
</svg>`;
}

const ICONS = [
  { file: "icon-192.png", size: 192, radius: tileRadius, heartScale: 1 },
  { file: "icon-512.png", size: 512, radius: tileRadius, heartScale: 1 },
  { file: "icon-maskable-512.png", size: 512, radius: 0, heartScale: 0.78 },
  { file: "apple-touch-icon.png", size: 180, radius: 0, heartScale: 0.92 },
  { file: "badge-96.png", size: 96, radius: 0, heartScale: 1.45, background: false },
];

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chrome or Chromium; this script never downloads one.");
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    for (const icon of ICONS) {
      const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg(icon)}</body></html>`);
      const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: icon.size, height: icon.size } });
      writeFileSync(join(OUT, icon.file), png);
      console.log(`  public/icons/${icon.file} (${icon.size}×${icon.size})`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`make-icons failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

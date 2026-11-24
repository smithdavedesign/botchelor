#!/usr/bin/env node
/**
 * node scripts/make-icons.mjs: every file of the show's icon, drawn from scripts/icon-art.mjs (the blindfolded heart,
 * David's pick on 2026-11-23) in a real browser (Chromium via CHROMIUM_PATH, never downloaded). PG only, like every app
 * icon. Run it again after changing the art, and commit the files it writes (docs/brand.md, "The app icon").
 *
 *   public/icon.svg                         the browser tab: a tighter crop, no tails, a bolder smile (reads at 16px)
 *   public/brand/botchelor-icon.svg         the icon itself, full bleed: the press kit's logo
 *   public/brand/botchelor-icon-1024.png    the same as a PNG: listings, Product Hunt, anywhere that won't take SVG
 *   public/brand/botchelor-avatar-1024.png  the figure at 90%, so a social network's round crop keeps the knot's tails
 *   public/icons/icon-192.png, icon-512.png the installed app's tiles, rounded: "any" in the manifest
 *   public/icons/icon-maskable-512.png      full bleed, the figure inside the middle 80% the system may crop to
 *   public/icons/apple-touch-icon.png       180×180, square and opaque (iOS rounds the corners itself)
 *   public/icons/badge-96.png               white on transparent: Android draws a notification badge from its shape
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { badge, icon, tabIcon } from "./icon-art.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");

const SVGS = [
  { file: "icon.svg", svg: tabIcon(32) },
  { file: "brand/botchelor-icon.svg", svg: icon({ size: 512 }) },
];

const PNGS = [
  { file: "brand/botchelor-icon-1024.png", size: 1024, svg: icon({ size: 1024 }) },
  { file: "brand/botchelor-avatar-1024.png", size: 1024, svg: icon({ size: 1024, scale: 0.9 }) },
  { file: "icons/icon-192.png", size: 192, svg: icon({ size: 192, radius: 0.22 }) },
  { file: "icons/icon-512.png", size: 512, svg: icon({ size: 512, radius: 0.22 }) },
  { file: "icons/icon-maskable-512.png", size: 512, svg: icon({ size: 512, scale: 0.8 }) },
  { file: "icons/apple-touch-icon.png", size: 180, svg: icon({ size: 180, scale: 0.92 }) },
  { file: "icons/badge-96.png", size: 96, svg: badge(96) },
];

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chrome or Chromium; this script never downloads one.");
  for (const { file, svg } of SVGS) {
    mkdirSync(dirname(join(PUBLIC, file)), { recursive: true });
    writeFileSync(join(PUBLIC, file), `${svg}\n`);
    console.log(`  public/${file}`);
  }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    for (const { file, size, svg } of PNGS) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`);
      const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
      mkdirSync(dirname(join(PUBLIC, file)), { recursive: true });
      writeFileSync(join(PUBLIC, file), png);
      console.log(`  public/${file} (${size}×${size})`);
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

/**
 * npm run screenshots:showcase: real-browser screenshots of the creator showcase (lib/showcase.ts, docs/PRDs/showcase.md),
 * desktop and phone, into docs/screenshots/: the showcase with its filters, a filtered view, a post open in the viewer,
 * and a creator's page. It checks the filters narrow the grid and the page never scrolls sideways on a phone.
 *
 * It builds the app and runs it on a throwaway local database. Nothing is drawn and nothing explicit is shown: the posts
 * are PG stand-ins made here from the repo's own cast portraits (public/cast) with ffmpeg, seeded straight in.
 *
 * Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { PGlite } from "@electric-sql/pglite";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "showcase-screenshots");
const DB_DIR = join(DATA_DIR, "pglite");
const CAST = ["house-juniper", "house-dex"];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** PG stand-ins: each portrait in a few looks and shapes. */
function placeholders() {
  const dir = join(DATA_DIR, "media");
  mkdirSync(dir, { recursive: true });
  const run = (args) => {
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "inherit"] });
    if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
  };
  const LOOKS = [
    ["natural", "", "384:512"],
    ["golden", ",colorbalance=rs=0.22:gs=0.08:bs=-0.18", "384:683"],
    ["moody", ",colorbalance=rs=0.25:bs=-0.2,eq=brightness=-0.08:contrast=1.2", "400:500"],
    ["cool", ",colorbalance=bs=0.2:rs=-0.05", "480:480"],
  ];
  const out = {};
  for (const id of CAST) {
    for (const [look, filter, size] of LOOKS) {
      const file = join(dir, `${id}-${look}.png`);
      run(["-i", join(ROOT, "public", "cast", `${id}-v3.webp`), "-vf", `scale=${size}:force_original_aspect_ratio=increase,crop=${size}${filter}`, "-frames:v", "1", file]);
      out[`${id}-${look}`] = readFileSync(file);
    }
  }
  return out;
}

/** Two creators, each with a handle, and their PG posts: places, shapes, likes and a follow. */
async function seed() {
  const db = new PGlite(DB_DIR);
  try {
    const media = placeholders();
    const creators = [
      ["u-mara", "mara_makes", "Mara Makes", "Golden hour, every hour. Juniper's photographer."],
      ["u-ode", "ode_studio", "Ode Studio", "Quiet portraits of loud people."],
    ];
    for (const [id, handle, name, bio] of creators) await db.query(`insert into creator_profiles (user_id, handle, display_name, bio) values ($1, $2, $3, $4)`, [id, handle, name, bio]);
    const shapes = { natural: "3:4", golden: "9:16", moody: "4:5", cool: "1:1" };
    const places = ["park", "cafe", "beach", "rooftop"];
    let n = 0;
    for (const [owner] of creators) {
      for (const character of CAST) {
        for (const [i, look] of Object.keys(shapes).entries()) {
          n++;
          const pic = `pg-${n}`;
          const place = places[n % places.length];
          await db.query(
            `insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, data, content_rating, aspect, tags) values ($1, $2, $3, 'PG placeholder', 'image/png', $4, 'pg', $5, $6::jsonb)`,
            [pic, owner, character, media[`${character}-${look}`], shapes[look], JSON.stringify([{ kind: "made", value: "shoot" }, { kind: "place", value: place }])],
          );
          await db.query(
            `insert into showcase_posts (id, owner_id, source, media_id, character_id, rating, medium, aspect, place, caption, status, published_at, tags)
             values ($1, $2, 'pg', $3, $4, 'pg', 'picture', $5, $6, $7, 'live', now() - ($8 || ' minutes')::interval, '[]'::jsonb)`,
            [`post-${n}`, owner, pic, character, shapes[look], place, n % 3 === 0 ? "Caught the light just as it went." : null, String(n * 7)],
          );
          for (let k = 0; k < (n * 5) % 4; k++) await db.query(`insert into showcase_likes (post_id, user_id) values ($1, $2)`, [`post-${n}`, `fan-${k}`]);
        }
      }
    }
    await db.query(`insert into creator_follows (follower_id, creator_id) values ('fan-1', 'u-mara'), ('fan-2', 'u-mara')`);
  } finally {
    await db.close();
  }
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const env = appEnv(showrunner.address().port, DB_DIR);
  const port = await freePort();
  // Once to make the schema and the house cast, then the posts seeded straight in.
  let app = await startApp(port, env);
  // The schema is made on the first request that reads the database.
  assert((await fetch(`${app.base}/api/showcase`)).ok, "the showcase's API didn't answer");
  await stopApp(app);
  await seed();
  app = await startApp(port, env);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const shot = async (page, file) => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT_DIR, `${file}.png`) });
    console.log(`  📸 docs/screenshots/${file}.png`);
  };
  const noSideways = async (page, name) => {
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    const width = page.viewportSize()?.width ?? 0;
    assert(scroll <= width, `${name}: the page scrolls sideways on a phone (${scroll}px on ${width}px)`);
    console.log(`  ✓ ${name}: no sideways scroll on a phone`);
  };
  try {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const page = await ctx.newPage();
    for (const [w, h, size] of [
      [1280, 900, "desktop"],
      [390, 844, "phone"],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${app.base}/showcase`);
      await page.locator(".showcase-tile img").first().waitFor({ timeout: 30_000 });
      const all = await page.locator(".showcase-tile").count();
      assert(all === 16, `the showcase shows ${all} posts, not 16`);
      // The first row loaded (the rest are lazy, below the fold), each a real picture from the showcase's own gate.
      await page.waitForFunction(() => [...document.querySelectorAll(".showcase-tile img")].slice(0, 4).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15_000 });
      if (size === "phone") await noSideways(page, "the showcase");
      await shot(page, `showcase-${size}`);
      // A filter: one place.
      await page.locator('[role="group"][aria-label="Place"] a').filter({ hasText: "Beach" }).click();
      await page.waitForURL(/place=beach/);
      await page.locator(".showcase-tile img").first().waitFor({ timeout: 15_000 });
      const beach = await page.locator(".showcase-tile").count();
      assert(beach > 0 && beach < all, `the Beach filter shows ${beach} of ${all}`);
      console.log(`  ✓ the Beach filter narrows the grid (${beach} of ${all})`);
      await shot(page, `showcase-filtered-${size}`);
      // A post open in the viewer.
      await page.goto(`${app.base}/showcase`);
      await page.locator(".showcase-open").first().click();
      await page.locator(".showcase-viewer img").waitFor({ timeout: 10_000 });
      // The viewer fills the screen (not some box on the page), its picture in view.
      const box = await page.locator(".showcase-viewer").boundingBox();
      assert(box && box.x === 0 && box.y === 0 && box.width === w, `the viewer doesn't fill the screen: ${JSON.stringify(box)}`);
      assert(await page.locator(".showcase-viewer img").isVisible(), "the viewer's picture isn't in view");
      if (size === "phone") await noSideways(page, "the viewer");
      await shot(page, `showcase-viewer-${size}`);
      await page.keyboard.press("Escape");
      // A creator's page.
      await page.goto(`${app.base}/creators/mara_makes`);
      await page.locator(".creator-head h1").waitFor({ timeout: 10_000 });
      assert((await page.locator(".showcase-tile").count()) === 8, "Mara's page doesn't show her 8 posts");
      if (size === "phone") await noSideways(page, "a creator's page");
      await shot(page, `showcase-creator-${size}`);
    }
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * npm run screenshots:showcase: real-browser screenshots of the creator showcase (lib/showcase.ts, docs/PRDs/showcase.md),
 * desktop and phone, into docs/screenshots/: the showcase with its filters, a filtered view, a post open in the viewer,
 * a creator's page, and the reels (app/showcase/reels). It checks the filters narrow the grid, a clip plays on hover and
 * stops after, the viewer says how a post was made (its model and prompt, lib/showcase-made.ts), the reels move a
 * still, swipe to the next, load more as they go and play a clip on screen, and nothing scrolls sideways on a phone.
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
  // A short PG clip: the portrait, slowly pushing in (a stand-in for an animated picture).
  const clip = join(dir, "clip.mp4");
  run(["-loop", "1", "-i", join(ROOT, "public", "cast", `${CAST[0]}-v3.webp`), "-vf", "scale=480:640:force_original_aspect_ratio=increase,crop=480:640,zoompan=z='min(zoom+0.003,1.25)':d=60:s=480x640:fps=30", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", clip]);
  out.clip = readFileSync(clip);
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
            `insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, data, content_rating, aspect, tags, model) values ($1, $2, $3, $4, 'image/png', $5, 'pg', $6, $7::jsonb, 'qwen-image-2-1-turbo-edit')`,
            [
              pic,
              owner,
              character,
              `A candid photograph of the person in Picture 1, ${look === "golden" ? "in golden-hour light" : look === "moody" ? "in moody evening light" : "in soft daylight"}, at the ${place}, a relaxed natural smile, everyday clothes. Fully clothed, tasteful and everyday, safe for work. Photorealistic. Everyone shown is an adult.`,
              media[`${character}-${look}`],
              shapes[look],
              JSON.stringify([{ kind: "made", value: "shoot" }, { kind: "place", value: place }]),
            ],
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
    // One clip, the newest, so it's the first tile.
    await db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, content_rating, model, provider) values ('clip-1', 'u-mara', $1, 'video', 'A slow push-in on her portrait.', 'video/mp4', $2, 'ready', 'pg', 'wan-3-0-image-to-video', 'venice')`, [CAST[0], media.clip]);
    await db.query(
      `insert into showcase_posts (id, owner_id, source, media_id, character_id, rating, medium, aspect, status, published_at, tags) values ('post-clip', 'u-mara', 'after_dark', 'clip-1', $1, 'pg', 'clip', '3:4', 'live', now(), '[]'::jsonb)`,
      [CAST[0]],
    );
    // One After Dark post (a PG stand-in, only ever counted for a visitor): the reels' "🌙 1 more of Juniper after dark".
    await db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, content_rating) values ('ad-1', 'u-mara', $1, 'scene', 'p', 'image/png', $2, 'ready', 'nsfw')`, [CAST[0], media[`${CAST[0]}-natural`]]);
    await db.query(`insert into showcase_posts (id, owner_id, source, media_id, character_id, rating, medium, status, published_at, tags) values ('post-ad', 'u-mara', 'after_dark', 'ad-1', $1, 'nsfw', 'picture', 'live', now() - interval '1 day', '[]'::jsonb)`, [CAST[0]]);
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
    for (const [w, h, size] of [
      [1280, 900, "desktop"],
      [390, 844, "phone"],
    ]) {
      // A phone is a touch screen (no hover), not just a narrow window: that's what decides how clips play.
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(size === "phone" ? { isMobile: true, hasTouch: true } : {}) });
      await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
      const page = await ctx.newPage();
      await page.goto(`${app.base}/showcase`);
      await page.locator(".showcase-tile img").first().waitFor({ timeout: 30_000 });
      const all = await page.locator(".showcase-tile").count();
      assert(all === 17, `the showcase shows ${all} posts, not 17`);
      // The first row loaded (the rest are lazy, below the fold), each a real picture from the showcase's own gate.
      await page.waitForFunction(() => [...document.querySelectorAll(".showcase-tile img")].slice(0, 4).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15_000 });
      if (size === "phone") await noSideways(page, "the showcase");
      // The clip: still until hovered, playing while hovered, stopped (and back at the start) after; on a phone, playing in view.
      const clip = page.locator(".showcase-tile video").first();
      await clip.waitFor({ timeout: 10_000 });
      const paused = () => clip.evaluate((v) => v.paused);
      if (size === "desktop") {
        assert(await paused(), "the clip plays before it's hovered");
        await clip.hover();
        await page.waitForFunction(() => !document.querySelector(".showcase-tile video").paused && document.querySelector(".showcase-tile video").currentTime > 0.2, null, { timeout: 10_000 });
        await page.mouse.move(0, 0);
        await page.waitForFunction(() => document.querySelector(".showcase-tile video").paused, null, { timeout: 5_000 });
        assert((await clip.evaluate((v) => v.currentTime)) === 0, "the clip doesn't go back to its start once the mouse leaves");
        console.log("  ✓ a clip plays on hover and stops after");
      } else {
        await page.waitForFunction(() => !document.querySelector(".showcase-tile video").paused, null, { timeout: 10_000 });
        console.log("  ✓ on a phone, a clip plays while it's in view");
      }
      await shot(page, `showcase-${size}`);
      // A filter: one place.
      await page.locator('[role="group"][aria-label="Place"] a').filter({ hasText: "Beach" }).click();
      await page.waitForURL(/place=beach/);
      await page.locator(".showcase-tile img").first().waitFor({ timeout: 15_000 });
      const beach = await page.locator(".showcase-tile").count();
      assert(beach > 0 && beach < all, `the Beach filter shows ${beach} of ${all}`);
      console.log(`  ✓ the Beach filter narrows the grid (${beach} of ${all})`);
      await shot(page, `showcase-filtered-${size}`);
      // A post open in the viewer (the second tile: the first is the clip, which opens just the same).
      await page.goto(`${app.base}/showcase`);
      await page.locator(".showcase-open").first().click();
      await page.locator(".showcase-viewer video").waitFor({ timeout: 10_000 });
      console.log("  ✓ a click on the clip still opens it full size");
      await page.keyboard.press("Escape");
      await page.locator(".showcase-open").nth(1).click();
      await page.locator(".showcase-viewer img").waitFor({ timeout: 10_000 });
      // The viewer fills the screen (not some box on the page), its picture in view.
      const box = await page.locator(".showcase-viewer").boundingBox();
      assert(box && box.x === 0 && box.y === 0 && box.width === w, `the viewer doesn't fill the screen: ${JSON.stringify(box)}`);
      assert(await page.locator(".showcase-viewer img").isVisible(), "the viewer's picture isn't in view");
      // How it was made: the model by name, the prompt folded under it.
      await page.locator(".showcase-made").getByText("Qwen Image 2.1 Turbo Edit").waitFor({ timeout: 10_000 });
      assert((await page.locator(".showcase-prompt summary").count()) === 1, "the viewer doesn't offer the prompt");
      if (size === "desktop") await page.locator(".showcase-prompt summary").click();
      console.log("  ✓ the viewer says how it was made: the model and the prompt");
      if (size === "phone") await noSideways(page, "the viewer");
      await shot(page, `showcase-viewer-${size}`);
      await page.keyboard.press("Escape");
      // A creator's page.
      await page.goto(`${app.base}/creators/mara_makes`);
      await page.locator(".creator-head h1").waitFor({ timeout: 10_000 });
      assert((await page.locator(".showcase-tile").count()) === 9, "Mara's page doesn't show her 9 posts");
      if (size === "phone") await noSideways(page, "a creator's page");
      await shot(page, `showcase-creator-${size}`);
      // The reels: a still moving, the next one a swipe (or ↓) away, more loading as they go, the clip playing on screen.
      await page.goto(`${app.base}/showcase/reels`);
      const slide = (i) => page.locator(`[role="feed"] [data-i="${i}"]`);
      await slide(0).locator("img").first().waitFor({ timeout: 15_000 });
      await page.waitForFunction(() => document.querySelector('[role="feed"] [data-i="0"]')?.getAttribute("aria-current") === "true", null, { timeout: 10_000 });
      const moving = await slide(0).locator("img:not([aria-hidden])").evaluate((img) => getComputedStyle(img).animationName);
      assert(moving && moving !== "none", `the first still doesn't move (${moving})`);
      assert((await slide(0).getByRole("link", { name: /^💘 Date / }).count()) === 1, "the first reel doesn't ask for a date");
      if (size === "phone") await noSideways(page, "the reels");
      await shot(page, `showcase-reels-${size}`);
      const next = async (i) => {
        if (size === "desktop") await page.keyboard.press("ArrowDown");
        else await page.locator('[role="feed"]').evaluate((f, n) => f.scrollTo({ top: n * f.clientHeight }), i);
        await page.waitForFunction((n) => document.querySelector(`[role="feed"] [data-i="${n}"]`)?.getAttribute("aria-current") === "true", i, { timeout: 10_000 });
      };
      await next(1);
      console.log(`  ✓ the reels: a still moves (${moving}), and the next is a ${size === "desktop" ? "↓" : "swipe"} away`);
      const first = await page.locator('[role="feed"] [data-i]').count();
      for (let i = 2; i <= 7; i++) await next(i);
      await page.waitForFunction((n) => document.querySelectorAll('[role="feed"] [data-i]').length > n, first, { timeout: 10_000 });
      console.log(`  ✓ the reels load more as they go (${first} → ${await page.locator('[role="feed"] [data-i]').count()} screens)`);
      // The card after the first few, and the After Dark count on Juniper's reels for a visitor.
      assert((await page.getByText("Make your own character").count()) > 0, "no card to make a character");
      assert((await page.getByText(/🌙 1 more of Juniper after dark/).count()) > 0, "no After Dark count on Juniper's reels");
      // The clip: playing once it's the one on screen.
      const clipAt = await page.locator('[role="feed"] video[data-v]').first().getAttribute("data-v");
      await page.locator('[role="feed"]').evaluate((f, n) => f.querySelector(`[data-i="${n}"]`).scrollIntoView(), clipAt);
      await page.waitForFunction((n) => { const v = document.querySelector(`video[data-v="${n}"]`); return v && !v.paused; }, clipAt, { timeout: 10_000 });
      console.log("  ✓ the reels play a clip while it's on screen");
      await ctx.close();
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

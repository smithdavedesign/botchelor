#!/usr/bin/env node
/**
 * The visual pop audit's first pass, part B (docs/audits/2026-11-20-visual-pop-audit.md): a character page's top as a
 * contestant card (app/characters/[id]/page.tsx), proven in a real browser on a local build at 1280 x 860 and 390 x 844.
 * Four kinds of page: a house character with a hello clip (house-juniper, as in production: a stand-in clip, the ad loop's
 * bytes, as a ready character_intros row, since the real clips live in production; Barnaby isn't in a local database), a house character with aired dates and no clip
 * (house-teo), a character someone made with dates, and one just made with none. For each: no sideways scroll, one h1,
 * the card's words at opacity 1 at rest, no console error; then reduced motion (no push-in) and the dark theme.
 *
 * Writes the key shots to docs/screenshots/pop-pass1-contestant-*.png and the rest to .data/pop-pass1-contestant/.
 * Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build.
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright-core";
import { appEnv, build, client, freePort, persona, ROOT, seedDataset, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const SCRATCH = join(ROOT, ".data", "pop-pass1-contestant");
const DATA_DIR = join(ROOT, ".data", "pop-pass1-contestant-db");
const SIZES = [
  ["desktop", { width: 1280, height: 860 }],
  ["phone", { width: 390, height: 844 }],
];

async function settle(page) {
  await page.mouse.move(0, 0);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
}

async function main() {
  if (!process.env.SKIP_BUILD) build();
  mkdirSync(SCRATCH, { recursive: true });
  rmSync(DATA_DIR, { recursive: true, force: true });
  const showrunner = await startShowrunner();
  const env = appEnv(showrunner.address().port, DATA_DIR);
  const port = await freePort();
  let app = await startApp(port, env);
  const problems = [];
  let browser;
  try {
    const data = await seedDataset(app.base);
    const made = data.chars[0];
    const fresh = await client(app.base)(
      "/api/characters",
      { name: "Wren Halloway", age: 31, bio: "A ferry pilot who knows every lighthouse on the coast by its blink.", traits: ["steady", "dry", "kind"], want: "Someone who likes the quiet hours", dealbreaker: "Being late for the tide", attest: true, keep_name: true },
      persona(),
    );
    // Juniper's hello, as production has it: a ready intro row. The bytes are the ad loop's, a stand-in (no new video).
    await stopApp(app);
    const db = new PGlite(DATA_DIR);
    try {
      await db.query(
        `insert into character_intros (id, character_id, line, voice, renderer, status, seconds, mime, data) values ('intro-juniper-local', 'house-juniper', 'Hello.', 'stand-in', 'stand-in', 'ready', 8, 'video/mp4', $1)`,
        [readFileSync(join(ROOT, "public", "press", "video", "botchelor-ad-loop.mp4"))],
      );
    } finally {
      await db.close();
    }
    app = await startApp(port, env);

    /** [path, file name, kept in docs/screenshots] */
    const pages = [
      ["/characters/house-juniper", "juniper", true],
      ["/characters/house-teo", "teo", false],
      [`/characters/${made.id}`, "made", true],
      [`/characters/${fresh.id}`, "no-dates", true],
    ];
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    for (const [size, viewport] of SIZES) {
      const ctx = await browser.newContext({ viewport });
      await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(e.message));
      for (const [path, name, keep] of pages) {
        errors.length = 0;
        const res = await page.goto(`${app.base}${path}`);
        if (!res?.ok()) problems.push(`${path}: HTTP ${res?.status()}`);
        const opacity = await page.evaluate(() => {
          const meta = document.querySelector(".contestant-card .meta");
          return meta ? getComputedStyle(meta).opacity : "missing";
        });
        await settle(page);
        const facts = await page.evaluate(() => ({
          h1s: document.querySelectorAll("main h1").length,
          scroll: document.documentElement.scrollWidth,
          width: window.innerWidth,
          intro: !!document.querySelector(".contestant-card .intro-clip video"),
          oldIntro: !!document.querySelector(".intro-card"),
          chips: document.querySelectorAll(".contestant-stats li").length,
        }));
        if (opacity !== "1") problems.push(`${path} (${size}): the card's words start at opacity ${opacity}`);
        if (facts.h1s !== 1) problems.push(`${path} (${size}): ${facts.h1s} h1s`);
        if (facts.scroll > facts.width) problems.push(`${path} (${size}): scrolls sideways, ${facts.scroll}px on ${facts.width}px`);
        if (facts.oldIntro) problems.push(`${path} (${size}): the hello is still under the header too`);
        if (name === "juniper" && !facts.intro) problems.push(`${path} (${size}): no hello in the card`);
        if (!facts.chips) problems.push(`${path} (${size}): no count chips`);
        const real = errors.filter((e) => !/Failed to load resource|MEDIA_ERR|NotSupportedError|play\(\)/.test(e));
        if (real.length) problems.push(`${path} (${size}): console: ${real.join(" | ")}`);
        await page.screenshot({ path: join(keep ? OUT_DIR : SCRATCH, `pop-pass1-contestant-${name}-${size}.png`) });
        console.log(`shot ${path} ${size}`);
      }
      await ctx.close();
    }

    // Reduced motion: the place behind and the portrait hold still.
    const calm = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" });
    await calm.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const cp = await calm.newPage();
    await cp.goto(`${app.base}/characters/house-teo`);
    await settle(cp);
    const still = await cp.evaluate(() => ({
      stage: getComputedStyle(document.querySelector(".contestant-card-stage img")).animationName,
      face: getComputedStyle(document.querySelector(".contestant-card-face .avatar")).animationName,
    }));
    if (still.stage !== "none" || still.face !== "none") problems.push(`reduced motion: ${JSON.stringify(still)}`);
    await calm.close();

    // The dark theme: the card is dark in both.
    const dark = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" });
    await dark.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const dp = await dark.newPage();
    await dp.goto(`${app.base}/characters/house-teo`);
    await settle(dp);
    await dp.screenshot({ path: join(OUT_DIR, "pop-pass1-contestant-teo-dark.png") });
    await dark.close();
  } finally {
    await browser?.close();
    await stopApp(app);
    showrunner.close();
  }
  if (problems.length) {
    console.error(`Problems:\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log("All pages fine.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * The visual pop audit's first pass, part C (docs/audits/2026-11-20-visual-pop-audit.md): /seasons and a lead season's
 * page (app/seasons/[slug]/SeasonLive.tsx) on the elimination set, the lead large and the next premiere's clock, proven
 * in a real browser on a local build at 1280 x 860 and 390 x 844. December 2026 is made a lead season with Nell as its
 * lead, as production has it, so its pilot (Sunday 29 November, 23:00 UTC) is the next premiere.
 *
 * For each page: no sideways scroll, one h1, the band's words at opacity 1 at rest, the clock's numbers blank in the
 * server's HTML and ticking once the page is live, and no console error (a hydration mismatch is one). Then the clock as
 * ON AIR (the browser's clock set to a minute into the pilot), reduced motion, and the dark theme.
 *
 * Writes the key shots to docs/screenshots/pop-pass1-seasons-*.png and the rest to .data/pop-pass1-seasons/. Set
 * CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright-core";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const SCRATCH = join(ROOT, ".data", "pop-pass1-seasons");
const DATA_DIR = join(ROOT, ".data", "pop-pass1-seasons-db");
const SIZES = [
  ["desktop", { width: 1280, height: 860 }],
  ["phone", { width: 390, height: 844 }],
];
const PAGES = [
  ["/seasons", "index"],
  ["/seasons/december-2026", "december"],
];

async function settle(page) {
  await page.mouse.move(0, 0);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
}

async function main() {
  if (!process.env.SKIP_BUILD) build();
  mkdirSync(SCRATCH, { recursive: true });
  rmSync(DATA_DIR, { recursive: true, force: true });
  const showrunner = await startShowrunner();
  const env = appEnv(showrunner.address().port, DATA_DIR);
  const port = await freePort();
  // The first start makes the schema; then December becomes a lead season with its lead, as in production.
  let app = await startApp(port, env);
  await fetch(`${app.base}/api/health`).catch(() => null);
  await stopApp(app);
  const db = new PGlite(DATA_DIR);
  try {
    await db.query(`insert into season_formats (season_id, slug) values ('2026-12-01', 'botchelor') on conflict (season_id) do update set slug = excluded.slug`);
    await db.query(`insert into season_leads (season_id, character_id) values ('2026-12-01', 'house-nell') on conflict (season_id) do update set character_id = excluded.character_id`);
  } finally {
    await db.close();
  }
  app = await startApp(port, env);
  const problems = [];
  let browser;
  try {
    // The server's HTML: the time in words, the numbers blank (nothing in it depends on the clock).
    for (const [path] of PAGES) {
      const html = await (await fetch(`${app.base}${path}`, { headers: { cookie: "bz_adult=1" } })).text();
      if (!html.includes('class="premiere-countdown is-soon"')) problems.push(`${path}: no premiere clock in the HTML`);
      if ((html.match(/<b>--<\/b>/g) ?? []).length !== 4) problems.push(`${path}: the clock's numbers aren't blank in the HTML`);
      if (!/Sunday 29 November, 23:00 UTC/.test(html)) problems.push(`${path}: the pilot's time in words is missing`);
    }
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    for (const [size, viewport] of SIZES) {
      const ctx = await browser.newContext({ viewport });
      await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(e.message));
      for (const [path, name] of PAGES) {
        errors.length = 0;
        const res = await page.goto(`${app.base}${path}`);
        if (!res?.ok()) problems.push(`${path}: HTTP ${res?.status()}`);
        const opacity = await page.evaluate(() => {
          const words = document.querySelector(".set-hero-words");
          return words ? getComputedStyle(words).opacity : "missing";
        });
        await settle(page);
        const facts = await page.evaluate(() => ({
          h1s: document.querySelectorAll("main h1").length,
          scroll: document.documentElement.scrollWidth,
          width: window.innerWidth,
          lead: !!document.querySelector(".set-hero .season-lead-face"),
          ticking: [...document.querySelectorAll(".premiere-clock b")].map((b) => b.textContent).join(":"),
        }));
        if (opacity !== "1") problems.push(`${path} (${size}): the band's words start at opacity ${opacity}`);
        if (facts.h1s !== 1) problems.push(`${path} (${size}): ${facts.h1s} h1s`);
        if (facts.scroll > facts.width) problems.push(`${path} (${size}): scrolls sideways, ${facts.scroll}px on ${facts.width}px`);
        if (!facts.lead) problems.push(`${path} (${size}): no lead in the hero`);
        if (!/^\d+:\d\d:\d\d:\d\d$/.test(facts.ticking)) problems.push(`${path} (${size}): the clock isn't ticking (${facts.ticking})`);
        const real = errors.filter((e) => !/Failed to load resource|MEDIA_ERR|NotSupportedError|play\(\)/.test(e));
        if (real.length) problems.push(`${path} (${size}): console: ${real.join(" | ")}`);
        await page.screenshot({ path: join(OUT_DIR, `pop-pass1-seasons-${name}-${size}.png`) });
        console.log(`shot ${path} ${size}: ${facts.ticking}`);
      }
      await ctx.close();
    }

    // ON AIR: the browser's clock a minute into the pilot (the server still drew it as to come; the light follows the
    // browser's clock once the page is live).
    const air = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await air.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const ap = await air.newPage();
    await ap.clock.install({ time: new Date("2026-11-29T23:01:00Z") });
    await ap.goto(`${app.base}/seasons/december-2026`);
    await settle(ap);
    const onAir = await ap.evaluate(() => ({
      cls: document.querySelector(".premiere-countdown")?.className,
      light: document.querySelector(".premiere-light")?.textContent,
      go: document.querySelector(".premiere-go a")?.textContent,
    }));
    if (!/is-live/.test(onAir.cls ?? "") || !/On air/.test(onAir.light ?? "") || onAir.go !== "Watch now") problems.push(`on air: ${JSON.stringify(onAir)}`);
    await ap.screenshot({ path: join(OUT_DIR, "pop-pass1-seasons-on-air-desktop.png") });
    await air.close();

    // Reduced motion: the set still, the light without its pulse.
    const calm = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" });
    await calm.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const cp = await calm.newPage();
    await cp.goto(`${app.base}/seasons`);
    await settle(cp);
    const art = await cp.evaluate(() => getComputedStyle(document.querySelector(".set-hero-art")).animationName);
    if (art !== "none") problems.push(`reduced motion: the set moves (${art})`);
    await calm.close();

    // The dark theme: the band is dark in both.
    const dark = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" });
    await dark.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const dp = await dark.newPage();
    await dp.goto(`${app.base}/seasons`);
    await settle(dp);
    await dp.screenshot({ path: join(SCRATCH, "pop-pass1-seasons-index-dark.png"), fullPage: true });
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

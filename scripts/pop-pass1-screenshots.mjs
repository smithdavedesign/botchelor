#!/usr/bin/env node
/**
 * The visual pop audit's first pass (docs/audits/2026-11-20-visual-pop-audit.md), proven in a real browser on a local
 * build: every page that took a set hero (app/SetHero.tsx) or the house ribbon (app/FaceRibbon.tsx), at 1280 x 860 and
 * 390 x 844. For each: no sideways scroll, exactly one h1, the band's words readable at rest (opacity 1 before anything
 * moves), and no console error. Then reduced motion (the set still, the ribbon one wrapped row) and the dark theme.
 *
 * Writes the key shots to docs/screenshots/pop-pass1-*.png and the rest to .data/pop-pass1/. Set CHROMIUM_PATH;
 * SKIP_BUILD=1 reuses the last build. PAGES=/pricing,/agents shoots only those.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const SCRATCH = join(ROOT, ".data", "pop-pass1");
const DATA_DIR = join(ROOT, ".data", "pop-pass1-db");

/** [path, file name, kept in docs/screenshots] */
const ALL = [
  ["/pricing", "pricing", true],
  ["/shop", "shop", false],
  ["/alternatives/character-ai", "alternatives", true],
  ["/alternatives/janitor-ai", "alternatives-janitor", false],
  ["/import", "import", true],
  ["/import?from=cai", "import-cai", false],
  ["/agents", "agents", true],
  ["/press", "press", true],
  ["/about", "about", false],
  ["/reviews", "reviews", false],
  ["/casting", "casting", false],
  ["/faq", "faq", true],
  ["/costs", "costs", false],
  ["/newsletter", "newsletter", true],
  ["/everything", "everything", true],
  ["/companion", "companion", false],
];
const SIZES = [
  ["desktop", { width: 1280, height: 860 }],
  ["phone", { width: 390, height: 844 }],
];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function settle(page) {
  await page.mouse.move(0, 0);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
}

async function main() {
  if (!process.env.SKIP_BUILD) build();
  mkdirSync(SCRATCH, { recursive: true });
  const only = process.env.PAGES ? new Set(process.env.PAGES.split(",")) : null;
  const pages = ALL.filter(([path]) => !only || only.has(path));
  const showrunner = await startShowrunner();
  // Companions open, as live, so /companion shows a visitor its ribbon (lib/companion-shared.ts companionOpen).
  const env = { ...appEnv(showrunner.address().port, DATA_DIR), COMPANION_OPEN: "1" };
  const app = await startApp(await freePort(), env);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const problems = [];
  try {
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
        assert(res?.ok(), `${path}: HTTP ${res?.status()}`);
        // At rest, before anything has moved: the band's words are opaque from the first paint.
        const opacity = await page.evaluate(() => {
          const words = document.querySelector(".set-hero-words");
          return words ? getComputedStyle(words).opacity : "1";
        });
        await settle(page);
        const atRest = await page.evaluate(() => ({ h1s: document.querySelectorAll("main h1").length, heroH1: !!document.querySelector(".set-hero h1"), opacity: "" }));
        atRest.opacity = opacity;
        const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
        if (scroll > width) problems.push(`${path} (${size}): scrolls sideways, ${scroll}px on ${width}px`);
        if (atRest.h1s !== 1) problems.push(`${path} (${size}): ${atRest.h1s} h1s`);
        if (atRest.opacity !== "1") problems.push(`${path} (${size}): the band's words start at opacity ${atRest.opacity}`);
        // A clip that can't load in a headless shell (no H.264) is the browser's, not the page's.
        const real = errors.filter((e) => !/Failed to load resource|MEDIA_ERR|NotSupportedError|play\(\)/.test(e));
        if (real.length) problems.push(`${path} (${size}): console: ${real.join(" | ")}`);
        const file = `pop-pass1-${name}-${size}.png`;
        await page.screenshot({ path: join(keep ? OUT_DIR : SCRATCH, file) });
        console.log(`shot ${path} ${size}${atRest.heroH1 ? " (hero)" : ""}`);
      }
      await ctx.close();
    }

    // Reduced motion: the set is a still frame, the ribbon one wrapped row with its copy and its switch gone.
    const calm = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" });
    await calm.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const cp = await calm.newPage();
    await cp.goto(`${app.base}/newsletter`);
    await settle(cp);
    const still = await cp.evaluate(() => ({
      art: getComputedStyle(document.querySelector(".set-hero-art")).animationName,
      track: getComputedStyle(document.querySelector(".face-ribbon-track")).animationName,
      copy: getComputedStyle(document.querySelector('.face-ribbon-list[aria-hidden="true"]')).display,
      pause: getComputedStyle(document.querySelector(".face-ribbon-pause")).display,
      wrap: getComputedStyle(document.querySelector(".face-ribbon-list")).flexWrap,
    }));
    if (still.art !== "none" || still.track !== "none" || still.copy !== "none" || still.pause !== "none" || still.wrap !== "wrap") problems.push(`reduced motion: ${JSON.stringify(still)}`);
    await cp.screenshot({ path: join(SCRATCH, "pop-pass1-newsletter-reduced.png"), fullPage: true });
    await calm.close();

    // The dark theme: the band is dark in both, the page under it follows the theme.
    const dark = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" });
    await dark.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const dp = await dark.newPage();
    for (const [path, name] of [["/pricing", "pricing"], ["/everything", "everything"]]) {
      await dp.goto(`${app.base}${path}`);
      await settle(dp);
      await dp.screenshot({ path: join(path === "/pricing" ? OUT_DIR : SCRATCH, `pop-pass1-${name}-dark.png`) });
    }
    await dark.close();
  } finally {
    await browser.close();
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

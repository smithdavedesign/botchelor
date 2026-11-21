#!/usr/bin/env node
/**
 * The cast's face loops (app/FaceLoop.tsx, lib/face-loops.ts), proven in a real browser on a local build:
 *
 *   1. on /step-in and /characters, each of the show's cast with a loop plays it while on screen, faded in over the
 *      still portrait, muted;
 *   2. with reduced motion, none plays: the portraits stay still.
 *
 * Writes docs/screenshots/face-loops-*.png (desktop and phone). Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build.
 */
import { join } from "node:path";
import { chromium } from "playwright-core";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "face-loops-screenshots");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Each face loop on the page: whether it's playing, muted, and shown. */
const loops = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("video[data-autoplay]")]
      .filter((v) => /-loop-(tall-)?[a-z0-9]+\.mp4$/.test(v.getAttribute("src") ?? ""))
      .map((v) => ({ src: v.getAttribute("src"), playing: !v.paused && v.currentTime > 0, muted: v.muted, shown: getComputedStyle(v).opacity === "1" })),
  );

async function main() {
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const env = appEnv(showrunner.address().port, DATA_DIR);
  const app = await startApp(await freePort(), env);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    for (const [tag, viewport, mobile] of [["desktop", { width: 1280, height: 860 }, false], ["phone", { width: 390, height: 844 }, true]]) {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
      await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
      const page = await ctx.newPage();
      for (const [name, path] of [["step-in", "/step-in"], ["characters", "/characters"]]) {
        await page.goto(app.base + path, { waitUntil: "networkidle" });
        if (name === "characters") await page.locator("video[data-autoplay]").first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(2500);
        const found = await loops(page);
        assert(found.length > 0, `${name} (${tag}): no face loops on the page`);
        const live = found.filter((l) => l.playing);
        assert(live.length > 0, `${name} (${tag}): no face loop playing: ${JSON.stringify(found)}`);
        assert(live.every((l) => l.muted && l.shown), `${name} (${tag}): a playing loop has sound or isn't shown: ${JSON.stringify(live)}`);
        const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
        assert(scroll <= width, `${name} (${tag}): the page scrolls sideways`);
        await page.screenshot({ path: join(OUT_DIR, `face-loops-${name}-${tag}.png`) });
        console.log(`${name} ${tag}: ${live.length} of ${found.length} loops playing`);
      }
      await ctx.close();
    }
    // Reduced motion: still portraits.
    const calm = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" });
    await calm.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const page = await calm.newPage();
    await page.goto(app.base + "/step-in", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const still = await loops(page);
    assert(still.every((l) => !l.playing), `reduced motion: a loop played: ${JSON.stringify(still)}`);
    console.log(`reduced motion: ${still.length} loops, none playing`);
    await calm.close();
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

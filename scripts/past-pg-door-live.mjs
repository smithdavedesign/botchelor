#!/usr/bin/env node
/**
 * Live proof of the past-PG door on /create (lib/adult/past-pg.ts, #1836): a sentence that goes past PG, typed into the
 * one-sentence box, is refused before any model reads it, and the refusal offers "Keep them PG" or After Dark instead of
 * a dead end. Phone and desktop, against the live site, into docs/screenshots/.
 *
 *   node scripts/past-pg-door-live.mjs            # LIVE_BASE=https://botchelor.com by default; CHROMIUM_PATH if needed
 *
 * It says it is 18 or older (the gate's cookie), as anyone offered the door has. It is our own check by its user agent
 * (lib/our-traffic.ts), and its browser sends none of the page's events (/api/e) or third-party analytics, so it is never
 * counted as a visitor. It saves nothing: the refusal happens before a character exists.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromiumPath } from "./clips/daily-clip.mjs";

const BASE = process.env.LIVE_BASE ?? "https://botchelor.com";
const OUT = process.env.OUT_DIR ?? "docs/screenshots";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 botchelor-live-check/1.0 (Claude)";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 botchelor-live-check/1.0 (Claude)";
/** Past PG for the show's sheet check (tests/past-pg-door.test.ts): an explicit word, refused before any model call. */
const SENTENCE = "A lighthouse keeper who writes erotic poetry by the lamp at night.";
const QUIET = /\/api\/e(?:\?|$)|google-analytics\.com|googletagmanager\.com|\/api\/ideas\/signal|\/_vercel\/(insights|speed-insights)\//;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
let failed = false;
try {
  for (const [label, opts] of [
    ["phone", { userAgent: PHONE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ["desktop", { userAgent: DESKTOP_UA, viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }],
  ]) {
    const ctx = await browser.newContext(opts);
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: BASE }]);
    await ctx.route(QUIET, (route) => route.abort());
    const page = await ctx.newPage();
    await page.goto(`${BASE}/create`, { waitUntil: "domcontentloaded" });
    await page.locator("#express-text").fill(SENTENCE);
    await page.getByRole("button", { name: "Meet them" }).click();
    const door = page.locator('[data-past-pg-door="express"]');
    try {
      await door.waitFor({ timeout: 20_000 });
    } catch {
      failed = true;
      console.error(`${label}: no door after the refusal`);
    }
    // The refusal and the door together, in the middle of the screen (the box gives way to the form with their words).
    await door.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
    await page.waitForTimeout(400);
    const file = join(OUT, `past-pg-door-${label}.png`);
    await page.screenshot({ path: file });
    const text = (await door.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    console.log(`${label}: ${file}\n  ${text}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);

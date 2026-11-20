#!/usr/bin/env node
/**
 * Live proof of a date's first minute (lib/cold-open.ts, lib/home-clip.ts episodeCut): the date's page with the short
 * version beside Watch in theater, the theater's cold open before the first line, the short version playing in its
 * sheet, and the date started from the card. Phone and desktop, against the live site, into docs/screenshots/.
 *
 *   node scripts/cold-open-live.mjs <episode id>     # a date with a cut; LIVE_BASE=https://botchelor.com by default
 *
 * Our own check by its user agent (lib/our-traffic.ts); its browser sends none of the page's events (/api/e) or
 * third-party analytics, so it is never counted as a viewer. It only watches.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromiumPath } from "./clips/daily-clip.mjs";

const BASE = process.env.LIVE_BASE ?? "https://botchelor.com";
const OUT = process.env.OUT_DIR ?? "docs/screenshots";
const EPISODE = process.argv[2];
if (!EPISODE) {
  console.error("usage: node scripts/cold-open-live.mjs <episode id>");
  process.exit(2);
}
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 botchelor-live-check/1.0 (Claude)";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 botchelor-live-check/1.0 (Claude)";
const QUIET = /\/api\/e(?:\?|$)|google-analytics\.com|googletagmanager\.com|\/api\/ideas\/signal|\/_vercel\/(insights|speed-insights)\//;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromiumPath(), args: ["--autoplay-policy=no-user-gesture-required"] });
const problems = [];
try {
  for (const [label, opts] of [
    ["phone", { userAgent: PHONE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ["desktop", { userAgent: DESKTOP_UA, viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }],
  ]) {
    const ctx = await browser.newContext(opts);
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: BASE }]);
    await ctx.route(QUIET, (route) => route.abort());
    const page = await ctx.newPage();
    const shot = (name) => page.screenshot({ path: join(OUT, `${name}-${label}.png`) });
    await page.goto(`${BASE}/episodes/${EPISODE}`, { waitUntil: "domcontentloaded" });

    // 1. The hero: Watch in theater, and the short version beside it.
    const short = page.locator(".episode-hero-cta").getByRole("button", { name: /The short version/ });
    await short.waitFor({ timeout: 20_000 }).catch(() => problems.push(`${label}: no short version on the page`));
    // The portraits and the venue fade in after the page is up: shot before they land, the faces are their colour tiles.
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(800);
    await shot("episode-short-version-button");

    // 2. The theater opens on the cold open; no line has played behind it.
    await page.getByRole("button", { name: "Watch in theater" }).click();
    const card = page.locator(".theater .cold-open");
    await card.waitFor({ timeout: 20_000 }).catch(() => problems.push(`${label}: no cold open`));
    await page.waitForTimeout(2500);
    const behind = await page.locator(".theater-convo .chat-bubble:not(.chat-typing)").count();
    if (behind) problems.push(`${label}: ${behind} line(s) played behind the card`);
    await shot("cold-open");
    console.log(`${label}: ${(await card.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 400)}`);

    // 3. The short version from the card: its sheet, playing with its voices.
    await card.getByRole("button", { name: /The short version/ }).click();
    const video = page.locator("dialog video.cut-video");
    await video.waitFor({ timeout: 20_000 }).catch(() => problems.push(`${label}: no short version sheet`));
    await video.evaluate((v) => v.play().catch(() => {})).catch(() => {});
    const played = await page
      .waitForFunction(() => (document.querySelector("dialog video.cut-video")?.currentTime ?? 0) > 3, null, { timeout: 30_000 })
      .then(() => true, () => false);
    if (!played) problems.push(`${label}: the short version didn't play`);
    const audio = await video.evaluate((v) => ({ muted: v.muted, duration: Math.round(v.duration || 0), audio: v.mozHasAudio ?? v.webkitAudioDecodedByteCount > 0 ?? null })).catch(() => null);
    console.log(`${label}: short version ${JSON.stringify(audio)}`);
    await shot("short-version");
    await page.keyboard.press("Escape");

    // 4. Start the date from the card: the first line comes.
    await card.getByRole("button", { name: /Start the date/ }).click();
    await page.locator(".theater-convo .chat-bubble:not(.chat-typing)").first().waitFor({ timeout: 20_000 }).catch(() => problems.push(`${label}: Start played nothing`));
    await page.waitForTimeout(3500);
    await shot("cold-open-started");
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (problems.length) console.error(problems.join("\n"));
process.exit(problems.length ? 1 : 0);

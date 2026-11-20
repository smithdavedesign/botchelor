#!/usr/bin/env node
/**
 * Live proof of the date report card (lib/report-card.ts, app/episodes/[id]/report-card, app/api/og/report-card/[id]):
 * a recent aired public date's card on phone and desktop, its share picture (a PNG), its preview tags, the link to it
 * from the episode's box score, and an unaired date's card that isn't there. Against the live site, into
 * docs/screenshots/.
 *
 *   node scripts/report-card-live.mjs           # LIVE_BASE=https://botchelor.com; EPISODE=<id> to pick one; CHROMIUM_PATH if needed
 *
 * Our own check by its user agent (lib/our-traffic.ts); its browser sends none of the page's events (/api/e) or
 * third-party analytics, so it is never counted as a visitor. It only reads.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromiumPath } from "./clips/daily-clip.mjs";

const BASE = process.env.LIVE_BASE ?? "https://botchelor.com";
const OUT = process.env.OUT_DIR ?? "docs/screenshots";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 botchelor-live-check/1.0 (Claude)";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 botchelor-live-check/1.0 (Claude)";
const QUIET = /\/api\/e(?:\?|$)|google-analytics\.com|googletagmanager\.com|\/api\/ideas\/signal|\/_vercel\/(insights|speed-insights)\//;

const problems = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};
const get = (path) => fetch(`${BASE}${path}`, { headers: { "user-agent": DESKTOP_UA }, redirect: "manual" });

// An aired public date with a box score (the feed's newest first), or the one asked for; and one not yet aired.
const feed = (await (await get("/api/episodes?limit=30")).json()).episodes ?? [];
const aired = process.env.EPISODE ?? feed.find((e) => e.revealed && e.ending && e.box_score)?.id;
const unaired = feed.find((e) => !e.revealed)?.id;
check(Boolean(aired), `an aired date to grade (${aired})`);
if (!aired) process.exit(1);
const path = `/episodes/${aired}/report-card`;

// The picture: a PNG, and the page's preview tags point at it.
const pic = await get(`/api/og/report-card/${aired}`);
check(pic.status === 200 && pic.headers.get("content-type") === "image/png", `the share picture is a PNG (${pic.status} ${pic.headers.get("content-type")})`);
mkdirSync(OUT, { recursive: true });
if (pic.status === 200) writeFileSync(join(OUT, "report-card-picture.png"), Buffer.from(await pic.arrayBuffer()));
const html = await (await get(path)).text();
check(html.includes(`/api/og/report-card/${aired}`) && /property="og:image"/.test(html), "og:image is the report card picture");
check(/name="robots" content="noindex, follow"/.test(html), "the page isn't indexed (a share, not a page to find)");
if (unaired) {
  const none = await get(`/api/og/report-card/${unaired}`);
  check(none.status === 404, `an unaired date has no picture (${none.status})`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
try {
  for (const [label, opts] of [
    ["phone", { userAgent: PHONE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ["desktop", { userAgent: DESKTOP_UA, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }],
  ]) {
    const ctx = await browser.newContext(opts);
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: BASE }]);
    await ctx.route(QUIET, (route) => route.abort());
    const page = await ctx.newPage();

    const res = await page.goto(`${BASE}${path}?ref=report`, { waitUntil: "domcontentloaded" });
    check(res?.status() === 200, `${label}: the report card opens (${res?.status()})`);
    const card = page.locator("[data-report-card]");
    await card.waitFor({ timeout: 20_000 }).catch(() => {});
    const overall = await card.getAttribute("data-report-card").catch(() => null);
    check(Boolean(overall), `${label}: an overall grade (${overall})`);
    check((await page.locator("[data-subject]").count()) === 4, `${label}: four subjects`);
    check((await page.getByRole("button", { name: /Share the report card/ }).count()) === 1, `${label}: the share button`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: no sideways scroll`);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.screenshot({ path: join(OUT, `report-card-${label}.png`), fullPage: label === "phone" });

    // The way in from the episode: the box score's link.
    await page.goto(`${BASE}/episodes/${aired}`, { waitUntil: "domcontentloaded" });
    const link = page.locator(`.boxscore a[href="${path}"]`);
    await link.waitFor({ timeout: 20_000 }).catch(() => {});
    check((await link.count()) === 1, `${label}: the box score links the report card`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (problems.length) console.error(`\n${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);

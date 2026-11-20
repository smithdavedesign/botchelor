#!/usr/bin/env node
/**
 * Live proof of the random OC generator (app/tools/random-oc-generator, lib/random-oc.ts): the page as a search visitor
 * lands on it (no gate, six characters, its canonical), "Six more" (another six, not indexed), a character's chemistry
 * with the next one (the OC chemistry test's result), and "Make this character" into /create, where the one-sentence box
 * drafts them. Phone and desktop, against the live site, into docs/screenshots/.
 *
 *   node scripts/random-oc-live.mjs            # LIVE_BASE=https://botchelor.com by default; CHROMIUM_PATH if needed
 *
 * Our own check by its user agent (lib/our-traffic.ts); its browser sends none of the page's events (/api/e) or
 * third-party analytics, so it is never counted as a visitor. The one write-free cost: on desktop only, /create drafts
 * one character from its sentence (one model call, under the draft caps); nothing is saved.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromiumPath } from "./clips/daily-clip.mjs";

const BASE = process.env.LIVE_BASE ?? "https://botchelor.com";
const OUT = process.env.OUT_DIR ?? "docs/screenshots";
const PATH = "/tools/random-oc-generator";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 botchelor-live-check/1.0 (Claude)";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 botchelor-live-check/1.0 (Claude)";
const QUIET = /\/api\/e(?:\?|$)|google-analytics\.com|googletagmanager\.com|\/api\/ideas\/signal|\/_vercel\/(insights|speed-insights)\//;

const problems = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};
const settle = async (page) => {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(500);
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
try {
  for (const [label, opts] of [
    ["phone", { userAgent: PHONE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ["desktop", { userAgent: DESKTOP_UA, viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }],
  ]) {
    const ctx = await browser.newContext(opts);
    await ctx.route(QUIET, (route) => route.abort());
    const page = await ctx.newPage();

    // 1. The page as search lands on it: no gate, six characters, its own canonical, indexable.
    const res = await page.goto(`${BASE}${PATH}`, { waitUntil: "domcontentloaded" });
    check(res?.status() === 200 && new URL(page.url()).pathname === PATH, `${label}: opens with no gate (${res?.status()} ${new URL(page.url()).pathname})`);
    const cards = page.locator(".random-oc");
    await cards.first().waitFor({ timeout: 20_000 }).catch(() => {});
    check((await cards.count()) === 6, `${label}: six characters (${await cards.count()})`);
    check((await page.locator('link[rel="canonical"]').getAttribute("href")) === `${BASE}${PATH}`, `${label}: canonical is the page`);
    check((await page.locator('meta[name="robots"][content*="noindex"]').count()) === 0, `${label}: the page is indexable`);
    const first = (await page.locator(".random-oc-name").allTextContents())[0];
    console.log(`${label}: ${(await cards.first().innerText()).replace(/\s+/g, " ").trim()}`);
    await settle(page);
    await page.screenshot({ path: join(OUT, `random-oc-${label}.png`) });

    // 2. Six more: another six, followed but not indexed.
    await page.getByRole("link", { name: "Six more characters" }).click();
    await page.waitForURL(/batch=2/, { timeout: 20_000 }).catch(() => {});
    await cards.first().waitFor({ timeout: 20_000 }).catch(() => {});
    const second = (await page.locator(".random-oc-name").allTextContents())[0];
    check(second && second !== first, `${label}: six more are new (${first} → ${second})`);
    check((await page.locator('meta[name="robots"][content*="noindex"]').count()) === 1, `${label}: batch 2 isn't indexed`);

    // 3. A character's chemistry with the next one.
    await page.goto(`${BASE}${PATH}`, { waitUntil: "domcontentloaded" });
    await page.locator(".random-oc").first().getByRole("link", { name: /Their chemistry with/ }).click();
    await page.waitForURL(/oc-chemistry-test\/result/, { timeout: 20_000 }).catch(() => {});
    const result = page.locator("main");
    await result.getByText(/out of 100|\/100|second date|just friends|disaster/i).first().waitFor({ timeout: 20_000 }).catch(() => problems.push(`${label}: no chemistry result`));
    check(page.url().includes("/oc-chemistry-test/result"), `${label}: chemistry result opens`);
    await settle(page);
    await page.screenshot({ path: join(OUT, `random-oc-chemistry-${label}.png`) });

    // 4. Make this character (desktop only: it drafts with a model): /create opens on the drafted character.
    if (label === "desktop") {
      await ctx.addCookies([{ name: "bz_adult", value: "1", url: BASE }]);
      await page.goto(`${BASE}${PATH}`, { waitUntil: "domcontentloaded" });
      const make = page.locator(".random-oc").first().getByRole("link", { name: "Make this character" });
      const href = await make.getAttribute("href");
      check(Boolean(href?.startsWith("/create?say=")) && decodeURIComponent(href.split("say=")[1]).startsWith(first), `${label}: Make this character carries ${first}`);
      await make.click();
      await page.waitForURL(/\/create/, { timeout: 20_000 }).catch(() => {});
      // The builder drafts from the sentence and takes it out of the address.
      const drafted = await page
        .waitForFunction((name) => [...document.querySelectorAll("input")].some((i) => i.value === name) || document.body.innerText.includes(name), first, { timeout: 60_000 })
        .then(() => true, () => false);
      check(drafted, `${label}: /create drafted ${first}`);
      check(!page.url().includes("say="), `${label}: the sentence left the address`);
      await settle(page);
      await page.screenshot({ path: join(OUT, `random-oc-create-${label}.png`) });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (problems.length) console.error(`\n${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);

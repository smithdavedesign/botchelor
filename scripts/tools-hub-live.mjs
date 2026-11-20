#!/usr/bin/env node
/**
 * Live proof of the 2026-11-19 SEO change: robots.txt keeps crawlers off the framework's prefetch requests (`/*_rsc=`,
 * lib/bots.ts), and /tools gathers the free OC tools (app/tools/page.tsx), linked from a ship page's end
 * (app/tools/MoreTools.tsx). Phone and desktop, against the live site, into docs/screenshots/.
 *
 *   node scripts/tools-hub-live.mjs            # LIVE_BASE=https://botchelor.com by default; CHROMIUM_PATH if needed
 *
 * It comes as a search visitor does, without the 18+ cookie (the tools are open to them). It is our own check by its
 * user agent (lib/our-traffic.ts), and its browser sends none of the page's events (/api/e) or third-party analytics,
 * so it is never counted as a visitor. It only reads.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromiumPath } from "./clips/daily-clip.mjs";

const BASE = process.env.LIVE_BASE ?? "https://botchelor.com";
const OUT = process.env.OUT_DIR ?? "docs/screenshots";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 botchelor-live-check/1.0 (Claude)";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 botchelor-live-check/1.0 (Claude)";
const QUIET = /\/api\/e(?:\?|$)|google-analytics\.com|googletagmanager\.com|\/api\/ideas\/signal|\/_vercel\/(insights|speed-insights)\//;
const TOOLS = ["/tools/oc-name-generator", "/tools/oc-questions", "/tools/ship-name-generator", "/tools/oc-chemistry-test"];

const problems = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};

// robots.txt: the prefetch rule for everyone and for the AI crawlers by name.
const robots = await (await fetch(`${BASE}/robots.txt`, { headers: { "user-agent": DESKTOP_UA } })).text();
check((robots.match(/^Disallow: \/\*_rsc=$/gm) ?? []).length === 2, "robots.txt disallows /*_rsc= in both groups");
check(/^Allow: \/$/m.test(robots), "robots.txt still allows /");

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

    // 1. The hub, as a search visitor lands on it: no gate, every tool linked, its own canonical and structured data.
    const res = await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded" });
    check(res?.status() === 200 && new URL(page.url()).pathname === "/tools", `${label}: /tools opens with no gate (${res?.status()} ${new URL(page.url()).pathname})`);
    await page.locator("h1", { hasText: "Free tools for original characters" }).waitFor({ timeout: 20_000 }).catch(() => {});
    for (const path of TOOLS) check((await page.locator(`main a[href="${path}"]`).count()) > 0, `${label}: /tools links ${path}`);
    check((await page.locator('link[rel="canonical"]').getAttribute("href")) === `${BASE}/tools`, `${label}: canonical is /tools`);
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    check(ld.some((s) => s.includes('"ItemList"') && TOOLS.every((p) => s.includes(p))), `${label}: ItemList names the four tools`);
    await page.screenshot({ path: join(OUT, `tools-hub-${label}.png`) });

    // 2. A ship page's end: the other tools and the hub.
    await page.goto(`${BASE}/ship/juniper/dex`, { waitUntil: "domcontentloaded" });
    const more = page.locator(".more-tools");
    await more.waitFor({ timeout: 20_000 }).catch(() => {});
    check((await more.locator('a[href="/tools"]').count()) === 1, `${label}: a ship page links the hub`);
    await more.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `ship-more-tools-${label}.png`) });
    console.log(`${label}: ${(await more.innerText().catch(() => "")).replace(/\s+/g, " ").trim()}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (problems.length) console.error(`\n${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);

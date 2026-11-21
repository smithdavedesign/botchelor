#!/usr/bin/env node
/**
 * Live proof of the social network (docs/PRDs/social-network.md, built 2026-11-20): /graph's views (Love, Friends and
 * family, Rivals, Gossip, Everything), "X's world" (/graph/world/<id>), every tie between two characters on their couple
 * page, the tense triangles under the sky, and a character's People tab. Phone and desktop, against the live site, into
 * docs/screenshots/.
 *
 *   node scripts/social-live.mjs            # LIVE_BASE=https://botchelor.com by default; CHROMIUM_PATH if needed
 *
 * WORLD (default house-nell) is the character whose world and People tab it shoots; PAIR (default house-nell/house-sable)
 * the couple page. It is our own check by its user agent (lib/our-traffic.ts), and its browser sends none of the page's
 * events (/api/e) or third-party analytics, so it is never counted as a visitor. It only reads. Every picture is a public
 * page any visitor sees: no After Dark, nothing private.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromiumPath } from "./clips/daily-clip.mjs";

const BASE = process.env.LIVE_BASE ?? "https://botchelor.com";
const OUT = process.env.OUT_DIR ?? "docs/screenshots";
const WORLD = process.env.WORLD ?? "house-nell";
const PAIR = process.env.PAIR ?? "house-nell/house-sable";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 botchelor-live-check/1.0 (Claude)";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 botchelor-live-check/1.0 (Claude)";
const QUIET = /\/api\/e(?:\?|$)|google-analytics\.com|googletagmanager\.com|\/api\/ideas\/signal|\/_vercel\/(insights|speed-insights)\//;
const LENSES = ["friends", "rivals", "gossip", "all"];

const problems = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};
const getJson = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: { "user-agent": DESKTOP_UA } });
  return { status: res.status, body: res.ok ? await res.json().catch(() => null) : null };
};

// 1. The reads behind the pages: each view, the tense triangles, a world and a pair.
for (const lens of LENSES) {
  const { status, body } = await getJson(`/api/graph/lens?lens=${lens}`);
  check(status === 200 && (body?.nodes?.length ?? 0) > 0, `/api/graph/lens?lens=${lens}: ${status}, ${body?.nodes?.length ?? 0} characters, ${body?.pairs?.length ?? 0} pairs, ${body?.places?.length ?? 0} places`);
}
const tense = await getJson("/api/graph/tense");
check(tense.status === 200, `/api/graph/tense: ${tense.status}, ${tense.body?.hooks?.length ?? "?"} hooks`);
const world = await getJson(`/api/social/world/${WORLD}`);
check(world.status === 200 && (world.body?.ties?.length ?? 0) > 0, `/api/social/world/${WORLD}: ${world.status}, ${world.body?.ties?.length ?? 0} ties, ${world.body?.people?.length ?? 0} off-screen people`);
const pair = await getJson(`/api/social/pair/${PAIR}`);
const pairKinds = (pair.body?.ties ?? []).map((t) => t.kind);
check(pair.status === 200 && pairKinds.length >= 3, `/api/social/pair/${PAIR}: ${pair.status}, ${pairKinds.join(", ")}`);

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromiumPath() });
try {
  for (const [label, opts] of [
    ["phone", { userAgent: PHONE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ["desktop", { userAgent: DESKTOP_UA, viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }],
  ]) {
    const ctx = await browser.newContext(opts);
    await ctx.addCookies([
      { name: "bz_adult", value: "1", url: BASE },
      { name: "repohq_notrack", value: "1", url: BASE },
    ]);
    await ctx.route(QUIET, (route) => route.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const shoot = async (name) => page.screenshot({ path: join(OUT, `social-${name}-${label}.png`) });
    const settle = (ms = 800) => page.waitForTimeout(ms);
    // The site's header is sticky: scroll a section to just under it.
    const scrollTo = (sel) =>
      page
        .locator(sel)
        .first()
        .evaluate(
          (el) => {
            const head = document.querySelector("header");
            window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - (head ? head.getBoundingClientRect().height : 0) - 8 });
          },
          null,
          { timeout: 5_000 },
        )
        .catch(() => {});

    // 2. /graph's views: the switch, its numbers line, the sky in Friends and family and in Rivals.
    for (const lens of label === "phone" ? ["friends", "rivals"] : ["friends", "all"]) {
      const res = await page.goto(`${BASE}/graph?lens=${lens}`, { waitUntil: "domcontentloaded" });
      const tabs = page.locator(".constellation-lenses");
      await tabs.waitFor({ timeout: 30_000 }).catch(() => {});
      const words = (await tabs.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      check(res?.status() === 200 && ["Love", "Friends and family", "Rivals", "Gossip", "Everything"].every((w) => words.includes(w)), `${label}: /graph?lens=${lens} has the five views (${words})`);
      await page.locator(".constellation-stage canvas, .constellation canvas, canvas").first().waitFor({ timeout: 20_000 }).catch(() => {});
      await settle(4000); // the sky settles
      await scrollTo(".constellation-lenses");
      await settle(1200);
      const numbers = (await page.locator(".constellation-stats").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      check(numbers.length > 0, `${label}: ${lens}'s numbers line: ${numbers.slice(0, 160)}`);
      check(!(await sideways()), `${label}: /graph?lens=${lens} doesn't scroll sideways`);
      await shoot(`graph-${lens}`);
    }

    // 3. "X's world": the server-drawn picture, its list, its metadata.
    const res = await page.goto(`${BASE}/graph/world/${WORLD}`, { waitUntil: "domcontentloaded" });
    await page.locator("svg").first().waitFor({ timeout: 20_000 }).catch(() => {});
    await settle(2000);
    const title = await page.title();
    check(res?.status() === 200 && /'s world/.test(title), `${label}: /graph/world/${WORLD} opens (${res?.status()}, "${title}")`);
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    check(ld.some((s) => s.includes('"BreadcrumbList"')), `${label}: the world page has breadcrumb JSON-LD`);
    check((await page.locator('link[rel="canonical"]').getAttribute("href")) === `${BASE}/graph/world/${WORLD}`, `${label}: the world page's canonical is itself`);
    const faces = await page.locator(".world-face").count();
    check(faces > 3, `${label}: the world draws ${faces} faces`);
    // Every face a small copy (app/Avatar.tsx sized): an original is a 1–2 MB PNG read from the database past the CDN,
    // and a world's ~100 at once tied up the site's connections (#1948).
    const originals = await page
      .locator(".world-sky image")
      .evaluateAll((els) => els.filter((e) => /^\/api\/assets\/[^/?.]+$/.test(e.getAttribute("href") ?? "")).length);
    check(originals === 0, `${label}: the world's faces are small copies (${originals} full-size originals)`);
    check(!(await sideways()), `${label}: the world page doesn't scroll sideways`);
    await scrollTo(".world-sky");
    await settle(600);
    await shoot("world");

    // 4. Everything between two characters, on their couple page.
    await page.goto(`${BASE}/couples/${PAIR}`, { waitUntil: "domcontentloaded" });
    const ties = page.locator(".couple-ties");
    await ties.waitFor({ timeout: 20_000 }).catch(() => {});
    const rows = await ties.locator(".pair-ties-list > li").count();
    check(rows >= 2, `${label}: the couple page lists ${rows} ties between them`);
    console.log(`${label}: ${(await ties.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 240)}`);
    check(!(await sideways()), `${label}: the couple page doesn't scroll sideways`);
    await scrollTo(".couple-ties");
    await settle(600);
    await shoot("pair");

    // 5. Tense triangles under the sky, fetched as the section nears the screen.
    if (label === "desktop") {
      await page.goto(`${BASE}/graph`, { waitUntil: "domcontentloaded" });
      const section = page.locator(".constellation-tense");
      await section.waitFor({ timeout: 30_000 }).catch(() => {});
      await scrollTo(".constellation-tense");
      await page.locator(".tense-triangle").first().waitFor({ timeout: 20_000 }).catch(() => {});
      await settle(800);
      const hooks = await page.locator(".tense-triangle").count();
      check(hooks > 0, `${label}: /graph lists ${hooks} tense triangles`);
      console.log(`${label}: ${(await page.locator(".tense-hook").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim()}`);
      await shoot("tense");
    }

    // 6. A character's People tab, as a stranger sees it: their people off the show, their ties, their places.
    // The tabs are the client's (PageTabs): wait for the page to load and hydrate, then open People.
    await page.goto(`${BASE}/characters/${WORLD}`, { waitUntil: "load" });
    const tab = page.locator("#tab-people");
    await tab.waitFor({ timeout: 20_000 }).catch(() => {});
    await settle(1500);
    const panel = page.locator("#panel-people:not([hidden])");
    for (let i = 0; i < 3 && !(await panel.isVisible().catch(() => false)); i++) {
      await tab.click().catch(() => {});
      await panel.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
    }
    check(await panel.isVisible().catch(() => false), `${label}: ${WORLD}'s People tab opens`);
    const people = page.locator(".their-people");
    const peopleRows = await people.locator(".people-row").count();
    check(peopleRows > 0, `${label}: ${WORLD}'s People tab has ${peopleRows} rows`);
    check(!(await sideways()), `${label}: the People tab doesn't scroll sideways`);
    await scrollTo(".their-people");
    await settle(600);
    await shoot("people");

    check(errors.length === 0, `${label}: no page errors${errors.length ? ` (${errors.slice(0, 3).join(" | ")})` : ""}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (problems.length) console.error(`\n${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);

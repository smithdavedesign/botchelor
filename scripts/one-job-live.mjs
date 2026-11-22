#!/usr/bin/env node
/**
 * Live proof of "one screen, one job" (2026-11-21): a first visit's home (app/HomeOpen.tsx), an owner's Tonight card
 * (app/TonightVotes.tsx), and the money pages with one obvious upgrade (/shop, /pricing, /agents/pricing). Phone and
 * desktop, against the live site, into docs/screenshots/.
 *
 *   node scripts/one-job-live.mjs            # LIVE_BASE=https://botchelor.com by default
 *
 * It only reads. The owner's view signs in as the audit account (its password comes from the keychain and is never
 * printed) and every request that isn't a GET is blocked. Our own check by its user agent (lib/our-traffic.ts); its
 * browser sends none of the page's events (/api/e) or third-party analytics.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromiumPath } from "./clips/daily-clip.mjs";

const BASE = process.env.LIVE_BASE ?? "https://botchelor.com";
const OUT = process.env.OUT_DIR ?? "docs/screenshots";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 botchelor-live-check/1.0 (Claude)";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 botchelor-live-check/1.0 (Claude)";
const QUIET = /\/api\/e(?:\?|$)|google-analytics\.com|googletagmanager\.com|\/api\/ideas\/signal|\/_vercel\/(insights|speed-insights)\//;
const VIEWS = [
  ["phone", { userAgent: PHONE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ["desktop", { userAgent: DESKTOP_UA, viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }],
];

const problems = [];
const check = (ok, line) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${line}`);
  if (!ok) problems.push(line);
};

/** What a page shows, read in the browser. A loud control is one painted with the brand gradient (the primary button). */
const read = (page, scope) =>
  page.evaluate((sel) => {
    const root = document.querySelector(sel) ?? document.body;
    const seen = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const loud = [...root.querySelectorAll("button, a")].filter((el) => seen(el) && getComputedStyle(el).backgroundImage.includes("gradient"));
    return {
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      loud: loud.map((el) => el.textContent.trim().replace(/\s+/g, " ").slice(0, 40)),
      links: new Set([...document.querySelectorAll("main a[href]")].map((a) => a.getAttribute("href"))).size,
      height: document.documentElement.scrollHeight,
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      text: (document.querySelector("main")?.textContent ?? "").replace(/\s+/g, " "),
    };
  }, scope);

/**
 * Loud controls in the site's header bar. None: the page's own primary button is the one loud thing on a screen, and the
 * bar's "Make your character" is the outline button (2026-11-22 audit: it was a second gradient button beside the
 * page's). The wordmark's gradient is its letters (background-clip: text), not a button's paint.
 */
const headerLoud = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".nav a, .nav button")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.backgroundImage.includes("gradient") && !`${cs.backgroundClip} ${cs.webkitBackgroundClip}`.includes("text");
      })
      .map((el) => el.textContent.trim().replace(/\s+/g, " ").slice(0, 40)),
  );

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromiumPath(), args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  for (const [label, opts] of VIEWS) {
    // ---- A stranger: no cookie but the age gate's.
    const ctx = await browser.newContext(opts);
    await ctx.addCookies([
      { name: "bz_adult", value: "1", url: BASE },
      { name: "repohq_notrack", value: "1", url: BASE },
    ]);
    await ctx.route(QUIET, (route) => route.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const shoot = (name) => page.screenshot({ path: join(OUT, `${name}-${label}.png`) });
    /** Pictures in view have loaded, and motion has settled. */
    const settle = async () => {
      await page
        .waitForFunction(() => [...document.images].every((img) => { const r = img.getBoundingClientRect(); return r.bottom < 0 || r.top > innerHeight || r.width === 0 || (img.complete && img.naturalWidth > 0); }), null, { timeout: 10_000 })
        .catch(() => {});
      await page.waitForTimeout(1200);
    };
    // The site's header is sticky: scroll a block to just under it.
    const under = (sel) =>
      page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return;
        el.scrollIntoView({ block: "start" });
        const header = [...document.querySelectorAll("header")].find((h) => ["sticky", "fixed"].includes(getComputedStyle(h).position));
        window.scrollBy(0, -((header?.getBoundingClientRect().height ?? 0) + 12));
      }, sel);

    // 1. Home, a first visit: one screen, the clip, one loud button.
    await page.goto(`${BASE}/`, { waitUntil: "load" });
    await settle();
    const home = await read(page, ".home-open");
    const clip = await page.locator(".home-open .home-clip").count();
    check(home.h1 !== null && (await page.locator(".home-open.home-open--one").count()) === 1, `${label} /: the one-screen opening, "${home.h1}"`);
    check(home.loud.length === 1, `${label} /: one loud button in the opening (${JSON.stringify(home.loud)})`);
    const homeBar = await headerLoud(page);
    check(homeBar.length === 0, `${label} /: nothing loud in the header (${JSON.stringify(homeBar)})`);
    check(clip === 1, `${label} /: the clip plays beside it (${clip})`);
    check(home.links <= 12, `${label} /: ${home.links} links on the page, ${home.height}px tall`);
    check(!home.sideways, `${label} /: no sideways scroll`);
    await shoot("home-first-visit");

    // 2. /shop: the packs alone as tiles, the bigger one first with the one loud button.
    await page.goto(`${BASE}/shop`, { waitUntil: "load" });
    await settle();
    const shop = await read(page, "main");
    const tiles = await page.locator(".money-tiles [data-shop-sku]").evaluateAll((els) => els.map((el) => el.getAttribute("data-shop-sku")));
    const strays = await page.locator(".money-tiles [data-shop-plan], .money-tiles [data-shop-plus]").count();
    check(tiles.length >= 1 && strays === 0, `${label} /shop: the tiles are the packs alone (${tiles.join(", ")})`);
    check(tiles.length < 2 || tiles[0] === "pack_15", `${label} /shop: the bigger pack comes first`);
    check(shop.loud.length === 1 && /^Buy /.test(shop.loud[0] ?? ""), `${label} /shop: one loud button, a pack's Buy (${JSON.stringify(shop.loud)})`);
    const shopBar = await headerLoud(page);
    check(shopBar.length === 0, `${label} /shop: nothing loud in the header (${JSON.stringify(shopBar)})`);
    check(!shop.sideways, `${label} /shop: no sideways scroll`);
    if (label === "phone") await under(".money-tiles");
    await settle();
    await shoot("shop-one-upgrade");

    // 3. /pricing: two cards, Free and one upgrade, then the rest as lines.
    await page.goto(`${BASE}/pricing`, { waitUntil: "load" });
    await settle();
    const pricing = await read(page, "main");
    const cards = await page.locator(".pricing-grid > .pricing-card").evaluateAll((els) => els.map((el) => el.id));
    const others = await page.locator(".pricing-also > li").evaluateAll((els) => els.map((el) => el.id));
    check(cards.length === 2 && cards[0] === "free", `${label} /pricing: two cards (${cards.join(", ")})`);
    check(pricing.loud.length === 1, `${label} /pricing: one loud button (${JSON.stringify(pricing.loud)})`);
    const pricingBar = await headerLoud(page);
    check(pricingBar.length === 0, `${label} /pricing: nothing loud in the header (${JSON.stringify(pricingBar)})`);
    check(others.length >= 1 && others.includes("own-key"), `${label} /pricing: the rest are lines (${others.join(", ")})`);
    check(!/operator pass/i.test(pricing.text), `${label} /pricing: no operator pass`);
    check(!pricing.sideways, `${label} /pricing: no sideways scroll`);
    if (label === "phone") await under(".pricing-grid");
    await settle();
    await shoot("pricing-one-upgrade");

    // 4. /agents/pricing: what's free, and no pass to buy.
    await page.goto(`${BASE}/agents/pricing`, { waitUntil: "load" });
    await settle();
    const agents = await read(page, "main");
    const plans = await page.locator(".money-plans > .money-plan").count();
    check(plans === 1 && !/operator pass/i.test(agents.text) && agents.loud.length === 0, `${label} /agents/pricing: one card, no pass, nothing to buy (${plans} card(s), loud ${JSON.stringify(agents.loud)})`);
    check(errors.length === 0, `${label}: no page errors as a stranger${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
    await ctx.close();

    // ---- An owner: the audit account, reading only.
    const password = execFileSync("security", ["find-generic-password", "-s", "vault/botchelor/AUDIT_ACCOUNT_PASSWORD", "-w"], { encoding: "utf8" }).trim();
    const mine = await browser.newContext(opts);
    await mine.addCookies([
      { name: "bz_adult", value: "1", url: BASE },
      { name: "repohq_notrack", value: "1", url: BASE },
    ]);
    const login = await mine.request.post(`${BASE}/api/auth/login`, { data: { handle: "nightaudit", password }, headers: { origin: BASE } });
    check(login.ok(), `${label}: signed in as the audit account (${login.status()})`);
    await mine.route(/./, (route) => {
      const req = route.request();
      if (QUIET.test(req.url())) return route.abort();
      return ["GET", "HEAD"].includes(req.method()) ? route.continue() : route.abort("blockedbyclient");
    });
    const own = await mine.newPage();
    const ownErrors = [];
    own.on("pageerror", (e) => ownErrors.push(e.message));
    await own.goto(`${BASE}/`, { waitUntil: "load" });
    const votes = await own.evaluate(() => {
      const card = document.querySelector("#tonight-votes");
      const boards = [...document.querySelectorAll("main .situation")].filter((el) => el.id === "situation" || el.id === "dare");
      return {
        card: Boolean(card),
        inside: card ? boards.filter((b) => card.contains(b)).map((b) => b.id) : [],
        boards: boards.map((b) => b.id),
        heading: card?.querySelector("h2")?.textContent?.trim() ?? null,
        sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    // Both votes run most nights. On a night with one board, it stands alone as its own card, as before.
    if (votes.boards.length === 2) check(votes.card && votes.inside.length === 2, `${label} / as an owner: one Tonight card holds both votes ("${votes.heading}": ${votes.inside.join(" + ")})`);
    else console.log(`note ${label} / as an owner: ${votes.boards.length} vote(s) tonight (${votes.boards.join(", ") || "none"}), so there is no pair to join`);
    check(!votes.sideways, `${label} / as an owner: no sideways scroll`);
    check(ownErrors.length === 0, `${label}: no page errors as an owner${ownErrors.length ? `: ${ownErrors.slice(0, 3).join(" | ")}` : ""}`);
    if (votes.card) {
      await own.evaluate(() => {
        const el = document.querySelector("#tonight-votes");
        el.scrollIntoView({ block: "start" });
        const header = [...document.querySelectorAll("header")].find((h) => ["sticky", "fixed"].includes(getComputedStyle(h).position));
        window.scrollBy(0, -((header?.getBoundingClientRect().height ?? 0) + 12));
      });
      await own
        .waitForFunction(() => [...document.images].every((img) => { const r = img.getBoundingClientRect(); return r.bottom < 0 || r.top > innerHeight || r.width === 0 || (img.complete && img.naturalWidth > 0); }), null, { timeout: 10_000 })
        .catch(() => {});
      await own.waitForTimeout(1200);
      await own.screenshot({ path: join(OUT, `home-tonight-card-${label}.png`) });
    }
    await mine.close();
  }
} finally {
  await browser.close();
}
if (problems.length) console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
process.exit(problems.length ? 1 : 0);

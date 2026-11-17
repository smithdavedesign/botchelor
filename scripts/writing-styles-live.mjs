// Live proof of writing styles (docs/writing-styles.md) on production, as the audit account (an admin): the narrated
// style on a real show date and a real After Dark step, and a story of each. Desktop and phone screenshots.
// What it writes, all under the audit account and nobody else's: its two styles (set back to the script at the end),
// one PRIVATE show date between its own character and a house one, two After Dark steps for its own pair, and a story of
// each. A few cents of model spend. The password comes from the keychain and is never printed.
// Usage: node scripts/writing-styles-live.mjs <out dir> [pg|ad|both]
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(new URL("../package.json", import.meta.url));
const { chromium } = require("playwright-core");
const SHOW = "https://botchelor.com";
const AD = "https://ad.botchelor.com";
// A person's browser to lib/bots.ts (HeadlessChrome is a bot there), and ours to the analytics filter.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 botchelor-live-check/1.0 (Claude)";
const CHROMIUM = process.env.CHROMIUM_PATH || `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const [OUT, WHICH = "both"] = process.argv.slice(2);
if (!OUT) throw new Error("usage: node scripts/writing-styles-live.mjs <out dir> [pg|ad|both]");
mkdirSync(OUT, { recursive: true });
// The audit account's own two characters, and a house partner for the show date.
const OWN = { a: "00636e8a-da92-4aa5-b046-1db4cb038b45", b: "ec97336d-e5b5-4419-8d7e-0f40cc51cf41" };
const HOUSE = process.env.HOUSE_PARTNER || "house-juniper";
const password = execFileSync("security", ["find-generic-password", "-s", "vault/botchelor/AUDIT_ACCOUNT_PASSWORD", "-w"], { encoding: "utf8" }).trim();
const SIZES = [
  [{ viewport: { width: 1280, height: 900 } }, "desktop"],
  [{ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, "phone"],
];
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, base, opts) {
  const ctx = await browser.newContext({ userAgent: UA, ...opts });
  await ctx.addCookies([
    { name: "bz_adult", value: "1", url: base },
    { name: "repohq_notrack", value: "1", url: base },
  ]);
  const login = await ctx.request.post(`${base}/api/auth/login`, { data: { handle: "nightaudit", password } });
  if (!login.ok()) throw new Error(`sign-in on ${base}: HTTP ${login.status()}`);
  const page = await ctx.newPage();
  return { ctx, page };
}
/** JSON over the page's own fetch (same origin, the session's cookies). */
const api = (page, method, path, body, timeoutMs = 240_000) =>
  page.evaluate(
    async ([m, p, b, t]) => {
      const res = await fetch(p, { method: m, headers: b === undefined ? {} : { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b), signal: AbortSignal.timeout(t) });
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* not JSON */
      }
      return { status: res.status, data };
    },
    [method, path, body, timeoutMs],
  );
const beatsOf = (lines) => lines.filter((l) => l.beat && (l.beat.before || l.beat.after)).length;

const browser = await chromium.launch({ executablePath: CHROMIUM });
let failed = false;
const must = (cond, msg) => {
  if (!cond) {
    failed = true;
    throw new Error(msg);
  }
};
try {
  // ------------------------------------------------------------------------------------------------ the show (PG)
  if (WHICH !== "ad") {
    const { ctx, page } = await open(browser, SHOW, SIZES[0][0]);
    await page.goto(`${SHOW}/account`, { waitUntil: "domcontentloaded" });
    const set = await api(page, "POST", "/api/writing-style", { side: "show", style: "narrated" });
    must(set.status === 200, `set show style: HTTP ${set.status} ${JSON.stringify(set.data)}`);
    log("show style:", JSON.stringify(set.data.styles));
    // EPISODE_ID=<id>: a narrated date from an earlier run, so a rerun books (and spends) nothing new.
    let id = process.env.EPISODE_ID || null;
    if (!id) {
      let booked = await api(page, "POST", "/api/episodes", { character_id: OWN.a, partner_id: HOUSE, visibility: "private" });
      if (booked.status === 429 && booked.data?.error === "episode_limit_reached") {
        // An admin tops up its own dates (lib/admins.ts ADMIN_TOKEN_GRANT).
        const grant = await api(page, "POST", "/api/admin/tokens", {});
        log("admin token grant:", grant.status);
        booked = await api(page, "POST", "/api/episodes", { character_id: OWN.a, partner_id: HOUSE, visibility: "private" });
      }
      must(booked.status === 200, `book the date: HTTP ${booked.status} ${JSON.stringify(booked.data).slice(0, 300)}`);
      id = booked.data.id;
      log("date booked:", id);
    } else log("reusing date:", id);
    const t0 = Date.now();
    let ep = null;
    for (let i = 0; i < 100; i++) {
      await sleep(4000);
      const got = await api(page, "GET", `/api/episodes/${id}`);
      if (got.status === 200 && got.data?.status === "ready") {
        ep = got.data;
        break;
      }
      if (got.status === 404) must(false, "the date failed and was deleted");
    }
    must(ep, "the date wasn't ready in time");
    const lines = ep.transcript ?? [];
    log(`date ready in ${Math.round((Date.now() - t0) / 1000)}s: ${lines.length} lines, ${beatsOf(lines)} with prose`);
    must(lines.length > 0 && beatsOf(lines) >= Math.ceil(lines.length / 2), "fewer than half the lines got prose");
    for (const l of lines.slice(0, 6)) log(`  [${l.side}] ${l.beat?.before ? `«${l.beat.before}» ` : ""}"${l.dialogue}"${l.beat?.after ? ` «${l.beat.after}»` : ""}`);
    const story = await api(page, "POST", `/api/episodes/${id}/story`, {});
    must(story.status === 200, `story: HTTP ${story.status} ${JSON.stringify(story.data)}`);
    log(`story: "${story.data.story.title}", ${story.data.story.paragraphs.length} paragraphs, made: ${story.data.made}`);
    for (const p of story.data.story.paragraphs.slice(0, 3)) log(`  ${p}`);
    await ctx.close();
    for (const [opts, size] of SIZES) {
      const s = await open(browser, SHOW, opts);
      await s.page.goto(`${SHOW}/account`, { waitUntil: "domcontentloaded" });
      const card = s.page.locator(".writing-style").first();
      await card.waitFor({ timeout: 20_000 });
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: join(OUT, `writing-styles-live-picker-${size}.png`) });
      await s.page.goto(`${SHOW}/episodes/${id}`, { waitUntil: "domcontentloaded" });
      // The whole date, on the page: one tap past its first exchange.
      const more = s.page.locator("details.episode-read-more > summary").first();
      if (await more.count()) await more.click().catch(() => {});
      const beat = s.page.locator(".chat-beat").first();
      await beat.waitFor({ timeout: 20_000 });
      await beat.scrollIntoViewIfNeeded();
      await s.page.waitForTimeout(600);
      await s.page.screenshot({ path: join(OUT, `writing-styles-live-date-${size}.png`) });
      const btn = s.page.locator(".episode-story button").first();
      await btn.scrollIntoViewIfNeeded();
      // The story is kept: it shows open, at once.
      await s.page.locator(".episode-story .story-text").waitFor({ timeout: 20_000 });
      await s.page.locator(".episode-story").scrollIntoViewIfNeeded();
      await s.page.waitForTimeout(400);
      await s.page.screenshot({ path: join(OUT, `writing-styles-live-story-${size}.png`) });
      log("show shots", size);
      await s.ctx.close();
    }
    const back = await open(browser, SHOW, SIZES[0][0]);
    await back.page.goto(`${SHOW}/account`, { waitUntil: "domcontentloaded" });
    log("show style back to script:", (await api(back.page, "POST", "/api/writing-style", { side: "show", style: "script" })).status);
    await back.ctx.close();
  }
  // ------------------------------------------------------------------------------------------------ After Dark
  if (WHICH !== "pg") {
    const { ctx, page } = await open(browser, AD, SIZES[0][0]);
    await page.goto(`${AD}/after-dark/account`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => sessionStorage.setItem("bz-threshold:after-dark", "1"));
    const set = await api(page, "POST", "/api/writing-style", { side: "adult", style: "narrated" });
    must(set.status === 200, `set adult style: HTTP ${set.status} ${JSON.stringify(set.data)}`);
    log("after dark style:", JSON.stringify(set.data.styles));
    let pair = OWN;
    // AD_NO_STEPS=1: the night's steps were written by an earlier run; only its story and the screenshots.
    if (!process.env.AD_NO_STEPS) {
      let first = await api(page, "POST", "/api/admin/after-dark", { a: pair.a, b: pair.b });
      if (first.status === 404) {
        pair = { a: "house-juniper", b: "house-rafe" };
        first = await api(page, "POST", "/api/admin/after-dark", { a: pair.a, b: pair.b });
      }
      must(first.status === 200, `first step: HTTP ${first.status} ${JSON.stringify(first.data).slice(0, 300)}`);
      const l1 = first.data.scene.lines;
      log(`step 1: ${l1.length} lines in the chapter, ${beatsOf(l1)} with prose (stage ${first.data.scene.stage})`);
      // Only the first step's prose is printed: the night's opening, before anything heats up.
      for (const l of l1.slice(-6)) log(`  [${l.who}] ${l.beat?.before ? `«${l.beat.before}» ` : ""}…${l.beat?.after ? ` «${l.beat.after}»` : ""}`);
      const second = await api(page, "POST", "/api/admin/after-dark", { a: pair.a, b: pair.b });
      must(second.status === 200, `second step: HTTP ${second.status} ${JSON.stringify(second.data).slice(0, 300)}`);
      const l2 = second.data.scene.lines;
      log(`step 2: ${l2.length} lines in the chapter, ${beatsOf(l2)} with prose`);
      must(beatsOf(l2) >= Math.ceil(l2.length / 2), "fewer than half the lines got prose");
    }
    const story = await api(page, "POST", "/api/admin/after-dark/story", { a: pair.a, b: pair.b, chapter: "now" });
    must(story.status === 200, `story: HTTP ${story.status} ${JSON.stringify(story.data)}`);
    log(`story: "${story.data.story.title}", ${story.data.story.paragraphs.length} paragraphs, made: ${story.data.made}`);
    await ctx.close();
    const base = `${AD}/after-dark/${encodeURIComponent(pair.a)}/${encodeURIComponent(pair.b)}`;
    for (const [opts, size] of SIZES) {
      const s = await open(browser, AD, opts);
      await s.page.goto(`${AD}/after-dark/account`, { waitUntil: "domcontentloaded" });
      await s.page.evaluate(() => sessionStorage.setItem("bz-threshold:after-dark", "1"));
      await s.page.reload({ waitUntil: "domcontentloaded" });
      const card = s.page.locator(".writing-style").first();
      await card.waitFor({ timeout: 20_000 });
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: join(OUT, `writing-styles-live-ad-picker-${size}.png`) });
      await s.page.goto(`${base}?view=reader&chapter=now`, { waitUntil: "domcontentloaded" });
      await s.page.locator(".ad-reader-narrated").first().waitFor({ timeout: 20_000 });
      await s.page.locator(".ad-reader").scrollIntoViewIfNeeded();
      await s.page.waitForTimeout(500);
      await s.page.screenshot({ path: join(OUT, `writing-styles-live-ad-reader-${size}.png`) });
      log("after dark shots", size, "narrated lines on the reader:", await s.page.locator(".ad-reader-narrated").count(), "story button:", await s.page.locator(".ad-story button").count());
      await s.ctx.close();
    }
    const back = await open(browser, AD, SIZES[0][0]);
    await back.page.goto(`${AD}/after-dark/account`, { waitUntil: "domcontentloaded" });
    log("after dark style back to script:", (await api(back.page, "POST", "/api/writing-style", { side: "adult", style: "script" })).status);
    await back.ctx.close();
  }
} catch (e) {
  failed = true;
  console.error("FAILED:", e instanceof Error ? e.message : e);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);

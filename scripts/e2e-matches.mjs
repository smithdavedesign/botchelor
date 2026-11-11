#!/usr/bin/env node
/**
 * npm run e2e:matches: /matches with matches that didn't work out, in a real browser against the production build
 * (David, 2026-11-11: new matches "didn't appear", and "Show N that didn't work out" didn't filter, it mixed them back
 * in with everyone):
 *
 *   Wren has four matches: Bo (a date both want), Cy (Cy passed), Di (Wren passed) and Ed (Ed passed, a match Wren's
 *   owner hasn't seen yet) → the open list shows Bo and Ed, never Cy or Di, with a tab bar "Open · 2 | Didn't work out · 2"
 *   → the second tab shows only Cy and Di, each saying who passed → back to Open → opening Ed's thread sees the match,
 *   and Ed moves under "Didn't work out" → desktop and phone, no sideways scroll.
 *
 * The answers go straight into the database with the app stopped (one process at a time on PGLite): a real pass needs
 * both sides to text first or two hours to go by (lib/text-chain-shared.ts decisionShown).
 *
 * Exits non-zero if any step fails. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build; SHOTS=1 writes the
 * screenshots to docs/screenshots/ (else .data/e2e-matches/).
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright-core";
import { appEnv, build, freePort, ipFor, persona, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const DATA_DIR = join(ROOT, ".data", "e2e-matches");
const DB_DIR = join(DATA_DIR, "db");
const SHOTS_DIR = process.env.SHOTS ? join(ROOT, "docs", "screenshots") : DATA_DIR;
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`  ✗ ${name}\n      ${err instanceof Error ? err.message : err}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const DESKTOP = { viewport: { width: 1280, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

const character = (name, bio) => ({
  name,
  age: 31,
  bio,
  traits: ["wry", "warm", "curious"],
  want: "Someone who laughs at the same wrong moments",
  dealbreaker: "Rudeness to waiters",
  attest: true,
  open_to_dates: true,
  extras: { hobbies: ["Night walks"], prompts: [{ id: "simple_pleasures", answer: "The first coffee, before anyone else is up." }] },
});

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(SHOTS_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const env = appEnv(showrunner.address().port, DB_DIR);
  let app = await startApp(await freePort(), env);

  const create = async (who, body) => {
    const res = await fetch(`${app.base}/api/characters`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: who.cookie, origin: app.base, "x-forwarded-for": ipFor(who.id) },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`create ${body.name} → ${res.status} (${data.error ?? "?"})`);
    return data.id ?? data.character?.id;
  };
  const owner = persona();
  const wren = await create(owner, character("Wren Kestrel", "Fixes bicycles for free on Sundays and keeps a list of every bell she's heard."));
  const others = {};
  for (const [name, bio] of [
    ["Bo Quill", "Bakes bread at four in the morning and names every loaf."],
    ["Cy Marr", "Collects maps of places that never existed."],
    ["Di Vale", "Teaches swimming to adults who swore they never would."],
    ["Ed Fenn", "Restores pinball machines and loses at every one of them."],
  ]) {
    others[name.split(" ")[0]] = await create(persona(), character(name, bio));
  }
  await stopApp(app);

  // Matched three hours ago (past the talk-then-decide wait), with each side's answer about a date.
  const db = new PGlite(DB_DIR);
  const answers = { Bo: [true, true], Cy: [true, false], Di: [false, true], Ed: [true, false] }; // [Wren, them]
  for (const [name, [mine, theirs]] of Object.entries(answers)) {
    const [lo, hi] = [wren, others[name]].sort();
    const [yesLo, yesHi] = lo === wren ? [mine, theirs] : [theirs, mine];
    await db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi, matched_at) values ($1, $2, $3, $4, now() - interval '3 hours')`, [lo, hi, yesLo, yesHi]);
  }
  const [edLo, edHi] = [wren, others.Ed].sort();
  await db.query(`insert into notifications (id, user_id, kind, title, link) values ('e2e-ed', $1, 'matched', 'New match: Ed', $2)`, [owner.id, `/messages/${edLo}/${edHi}`]);
  await db.close();
  app = await startApp(await freePort(), env);
  const base = app.base;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const as = async (opts) => {
    const ctx = await browser.newContext(opts);
    await ctx.addCookies([
      { name: "bz_adult", value: "1", url: base },
      { name: "bz_uid", value: owner.id, url: base },
    ]);
    return ctx;
  };
  const names = (page) => page.locator(".matches-face-name, .matches-row-name").allInnerTexts();
  const noSideScroll = async (page) => {
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(sw <= cw, `the page scrolls sideways (${sw} > ${cw})`);
  };

  try {
    for (const [label, opts] of [
      ["desktop", DESKTOP],
      ["phone", PHONE],
    ]) {
      const ctx = await as(opts);
      const page = await ctx.newPage();
      await step(`${label}: the open list has Bo and the unseen Ed, never Cy or Di, under a two-tab filter`, async () => {
        await page.goto(`${base}/matches?character=${wren}`);
        const shown = (await names(page)).sort();
        assert(JSON.stringify(shown) === JSON.stringify(["Bo", "Ed"]), `open list shows ${JSON.stringify(shown)}`);
        const tabs = page.locator("nav.matches-filter a");
        assert((await tabs.allInnerTexts()).join(" | ") === "Open · 2 | Didn’t work out · 2" || (await tabs.allInnerTexts()).join(" | ") === "Open · 2 | Didn't work out · 2", `tabs: ${(await tabs.allInnerTexts()).join(" | ")}`);
        assert((await tabs.first().getAttribute("aria-current")) === "page", "Open isn't the current tab");
        assert((await page.locator('.matches-face[title="Ed passed"]').count()) === 1, "Ed's face doesn't say Ed passed");
        await noSideScroll(page);
        await page.screenshot({ path: join(SHOTS_DIR, `matches-open-${label}.png`), fullPage: true });
      });
      await step(`${label}: "Didn't work out" shows only Cy and Di, each saying who passed`, async () => {
        await page.locator("nav.matches-filter a").nth(1).click();
        await page.waitForURL(/show=over/);
        const shown = (await names(page)).sort();
        assert(JSON.stringify(shown) === JSON.stringify(["Cy", "Di"]), `over list shows ${JSON.stringify(shown)}`);
        const badges = await page.locator(".matches-row .badge").allInnerTexts();
        assert(badges.includes("Cy passed") && badges.includes("Wren passed"), `badges: ${JSON.stringify(badges)}`);
        assert((await page.locator("nav.matches-filter a").nth(1).getAttribute("aria-current")) === "page", "the tab isn't current");
        await noSideScroll(page);
        await page.screenshot({ path: join(SHOTS_DIR, `matches-over-${label}.png`), fullPage: true });
      });
      await step(`${label}: Open goes back to the open list`, async () => {
        await page.locator("nav.matches-filter a").first().click();
        await page.waitForURL((u) => !u.search.includes("show=over"));
        const shown = (await names(page)).sort();
        assert(shown.includes("Bo") && !shown.includes("Cy"), `back on open, it shows ${JSON.stringify(shown)}`);
      });
      await ctx.close();
    }

    const ctx = await as(DESKTOP);
    const page = await ctx.newPage();
    await step("opening Ed's thread sees the match, and Ed moves under Didn't work out", async () => {
      await page.goto(`${base}/matches?character=${wren}`);
      await page.locator('.matches-face[title="Ed passed"]').click();
      await page.waitForURL(/\/messages\//);
      await page.goto(`${base}/matches?character=${wren}`);
      const open = await names(page);
      assert(!open.includes("Ed"), `Ed is still in the open list: ${JSON.stringify(open)}`);
      await page.goto(`${base}/matches?character=${wren}&show=over`);
      const over = (await names(page)).sort();
      assert(JSON.stringify(over) === JSON.stringify(["Cy", "Di", "Ed"]), `over list shows ${JSON.stringify(over)}`);
      await page.screenshot({ path: join(SHOTS_DIR, "matches-over-after-seen-desktop.png"), fullPage: true });
    });
    await step("the old link (?all=1) opens the same list", async () => {
      await page.goto(`${base}/matches?character=${wren}&all=1`);
      const over = (await names(page)).sort();
      assert(JSON.stringify(over) === JSON.stringify(["Cy", "Di", "Ed"]), `?all=1 shows ${JSON.stringify(over)}`);
    });
    await ctx.close();
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
  }
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `\n${failed} of ${results.length} steps failed.` : `\nAll ${results.length} steps passed. Screenshots: ${SHOTS_DIR}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

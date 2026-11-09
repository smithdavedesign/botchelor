#!/usr/bin/env node
/**
 * npm run e2e:double-link: "bring a friend" double-date links (lib/double-links.ts) in a real browser, against the
 * production build with the harness's stand-in showrunner (no key, no network beyond localhost):
 *
 *   a creator makes a link for their character and a house date → a stranger opening it sees the couple, what a double
 *   date is, and a button to make a character that comes back to the link (desktop and phone, no sideways scroll, a
 *   preview that names the couple and isn't indexed) → its owner sees when it closes and the share button → a visitor
 *   with a character takes it: both tables book and they land on their own date, playing → the link is used: anyone
 *   opening it again is sent to the date, and a link that doesn't exist says it isn't open.
 *
 * Exits non-zero if any step fails. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build; SHOTS=1 writes the
 * screenshots to docs/screenshots/ (else .data/e2e-double-link/).
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { appEnv, build, CAST, client, freePort, persona, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const DATA_DIR = join(ROOT, ".data", "e2e-double-link");
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

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(SHOTS_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const app = await startApp(await freePort(), appEnv(showrunner.address().port, DATA_DIR));
  const base = app.base;
  const call = client(base);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  /** A browser as `who` (or a stranger), past the 18+ gate. */
  const as = async (who, opts) => {
    const ctx = await browser.newContext(opts);
    await ctx.addCookies([
      { name: "bz_adult", value: "1", url: base },
      ...(who ? [{ name: "bz_uid", value: who.id, url: base }] : []),
    ]);
    return ctx;
  };
  const shot = async (page, name) => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
  };
  const fits = async (page, what) => {
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(wide <= 391, `${what} should fit the phone (scrollWidth ${wide})`);
  };

  const owner = persona();
  const taker = persona();
  let code = "";
  let path = "";
  let names = [];

  try {
    await step("a creator makes a double-date link for their character and a house date", async () => {
      const { soul: _soul, ...mira } = CAST[0];
      const mine = await call("/api/characters", { ...mira, attest: true, keep_name: true }, owner);
      const made = await call("/api/double-links", { character_id: mine.id, partner_id: "house-rafe" }, owner);
      assert(/^[a-z0-9]{6,32}$/.test(made.code ?? ""), `a link's code (${JSON.stringify(made)})`);
      assert(made.url?.endsWith(`/double/${made.code}`), `its url (${made.url})`);
      const again = await call("/api/double-links", { character_id: mine.id, partner_id: "house-rafe" }, owner);
      assert(again.code === made.code, "asking again gives the same open link");
      code = made.code;
      path = `/double/${code}`;
      names = ["Mira", "Rafe"];
    });

    await step("a stranger sees the couple, what a double date is, and a button to make a character that comes back here", async () => {
      for (const [label, opts] of [
        ["desktop", DESKTOP],
        ["phone", PHONE],
      ]) {
        const ctx = await as(null, opts);
        try {
          const page = await ctx.newPage();
          await page.goto(`${base}${path}`);
          await page.getByRole("heading", { name: `${names[0]} and ${names[1]} want a double date` }).waitFor({ timeout: 15_000 });
          assert((await page.title()).startsWith(`${names[0]} and ${names[1]} want a double date`), `the preview's title (${await page.title()})`);
          const robots = await page.locator('meta[name="robots"]').evaluateAll((els) => els.map((e) => e.getAttribute("content") ?? ""));
          assert(robots.some((r) => r.includes("noindex")), "a link's page isn't indexed");
          const make = page.getByRole("link", { name: "Make your character for the double" });
          assert((await make.getAttribute("href")) === `/create?next=${encodeURIComponent(path)}`, `the button comes back here (${await make.getAttribute("href")})`);
          if (label === "phone") await fits(page, "the link's page");
          await shot(page, `double-link-stranger-${label}`);
        } finally {
          await ctx.close();
        }
      }
      // The builder knows where it came from: its last step leads back to the double date.
      const ctx = await as(persona(), DESKTOP);
      try {
        const page = await ctx.newPage();
        await page.goto(`${base}/create?next=${encodeURIComponent(path)}`);
        const html = await page.content();
        assert(html.includes(`Go on the double date with ${names[0]} and ${names[1]}`), "the builder should offer the way back to the double date");
      } finally {
        await ctx.close();
      }
    });

    await step("its owner sees when it closes and the share button", async () => {
      const ctx = await as(owner, PHONE);
      try {
        const page = await ctx.newPage();
        await page.goto(`${base}${path}`);
        await page.locator(".notice", { hasText: "link, open until" }).waitFor({ timeout: 15_000 });
        await page.getByRole("button", { name: "🔗 Share a double-date link" }).waitFor();
        assert((await page.getByRole("link", { name: "Make your character for the double" }).count()) === 0, "no builder button for its owner");
        await fits(page, "the owner's view");
        await shot(page, "double-link-owner-phone");
      } finally {
        await ctx.close();
      }
    });

    await step("a visitor with a character takes it: both tables book, and they land on their own date, playing", async () => {
      const { soul: _soul, ...otto } = CAST[1];
      await call("/api/characters", { ...otto, attest: true, keep_name: true }, taker);
      const ctx = await as(taker, PHONE);
      try {
        const page = await ctx.newPage();
        await page.goto(`${base}${path}`);
        const book = page.getByRole("button", { name: /^💞💞 Book the double as Otto/ });
        await book.waitFor({ timeout: 15_000 });
        const note = (await page.locator(".date-link-accept .muted").textContent()) ?? "";
        assert(/Otto's date is .+, from this season's cast\. It spends one of your dates \(\d+ left\)\./.test(note), `the note says who and what it costs (${note})`);
        await fits(page, "the take form");
        await shot(page, "double-link-take-phone");
        await book.tap();
        await page.waitForURL(/\/episodes\/[^/?]+\?play=1/, { timeout: 60_000 });
      } finally {
        await ctx.close();
      }
    });

    await step("the link is used: opening it again leads to the date, and a link that doesn't exist says it isn't open", async () => {
      const ctx = await as(null, DESKTOP);
      try {
        const page = await ctx.newPage();
        await page.goto(`${base}${path}`);
        await page.locator(".notice", { hasText: "This double date is booked." }).waitFor({ timeout: 15_000 });
        assert((await page.getByRole("link", { name: "Watch it" }).getAttribute("href"))?.startsWith("/episodes/"), "it links to the date");
        await page.goto(`${base}/double/nosuchlink1`);
        await page.getByRole("heading", { name: "This double-date link isn't open any more" }).waitFor({ timeout: 15_000 });
      } finally {
        await ctx.close();
      }
    });
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
  }
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `\n${failed} of ${results.length} steps failed.` : `\nAll ${results.length} steps passed. Screenshots in ${SHOTS_DIR}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

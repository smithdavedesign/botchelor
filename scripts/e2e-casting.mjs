#!/usr/bin/env node
/**
 * npm run e2e:casting: /casting's open places (app/casting/OpenSlots.tsx; David 2026-11-21: "click the plus sign and
 * choose one of the characters to submit for audition") in a real browser, signed in to a real password account,
 * against the production build and a local database:
 *
 *   signed out, a place links to sign in → an account with no characters gets "Make a character" → signed in with
 *   two characters, a place opens the sheet: the one with a portrait and three aired dates has Apply, the other says
 *   what's first in its way (a portrait) and links to its page; Escape closes it (phone) → Apply puts it up, the sheet says so, and the page
 *   turns into the voting board with it on. Desktop and phone, no sideways scroll.
 *
 * Exits non-zero if any step fails. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build; SHOTS=1 writes the
 * screenshots to docs/screenshots/ (else .data/e2e-casting/).
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright-core";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const DATA_DIR = join(ROOT, ".data", "e2e-casting");
const DB_DIR = join(DATA_DIR, "db");
const SHOTS_DIR = process.env.SHOTS ? join(ROOT, "docs", "screenshots") : DATA_DIR;
const DESKTOP = { viewport: { width: 1280, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
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
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(SHOTS_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const env = appEnv(showrunner.address().port, DB_DIR);
  let app = await startApp(await freePort(), env);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const stamp = Date.now() % 1e6;

  // A real account, signed in the way the account page does it, and two characters made through the API.
  const owner = await browser.newContext();
  const register = async (ctx, handle) => {
    const reg = await ctx.request.post(`${app.base}/api/auth/register`, { data: { handle, password: "a-long-e2e-password-1", attest: true }, headers: { origin: app.base } });
    assert(reg.ok(), `register ${handle}: HTTP ${reg.status()}`);
  };
  await register(owner, `caster${stamp}`);
  const make = async (body) => {
    const res = await owner.request.post(`${app.base}/api/characters`, { data: body, headers: { origin: app.base } });
    const data = await res.json().catch(() => ({}));
    assert(res.ok(), `create ${body.name}: HTTP ${res.status()} (${data.error ?? "?"})`);
    return data.id ?? data.character?.id;
  };
  const mara = await make(character("Mara Quill", "Restores lighthouse lenses and keeps a log of every ship that waved back."));
  const wren = await make(character("Wren Hale", "Repaints carousel horses and names each one after a weather front."));
  const ownState = await owner.storageState();
  await stopApp(app);

  // Mara is ready to audition: public, an approved PG portrait, three aired public dates. Wren has none of that yet.
  const db = new PGlite(DB_DIR);
  await db.query(`update characters set visibility = 'public', open_to_dates = true where id = any($1::text[])`, [[mara, wren]]);
  await db.query(
    `insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating)
     values ('e2e-mara-portrait', $1, 'portrait', 'generated', 'm', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'approved', 'pg')`,
    [mara],
  );
  const { rows } = await db.query(`select owner_id from characters where id = $1`, [mara]);
  for (let i = 0; i < 3; i++) {
    await db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, sides, transcript, visibility, revealed_at)
       values ($1, $2, $3, 'house-juniper', 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'friends', 'ready', '[]'::jsonb, '[]'::jsonb, 'public', now() - interval '2 days')`,
      [`e2e-mara-${i}`, rows[0].owner_id, mara],
    );
  }
  await db.close();
  app = await startApp(await freePort(), env);
  const base = app.base;
  const noSideScroll = async (page) => {
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(sw <= cw, `the page scrolls sideways (${sw} > ${cw})`);
  };
  const adult = async (opts, state) => {
    const ctx = await browser.newContext({ ...opts, ...(state ? { storageState: state } : {}) });
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: base }]);
    return ctx;
  };
  const sheet = (page) => page.locator("dialog.sheet-dialog[open]");

  try {
    await step("signed out: every open place links to sign in and back here", async () => {
      const ctx = await adult(DESKTOP);
      const page = await ctx.newPage();
      await page.goto(`${base}/casting`);
      const picks = page.locator(".casting-slot-pick");
      assert((await picks.count()) > 0, "no open places on the empty board");
      const hrefs = await picks.evaluateAll((els) => els.map((e) => `${e.tagName} ${e.getAttribute("href")}`));
      assert(hrefs.every((h) => h === "A /account?next=%2Fcasting"), `places: ${hrefs.join(", ")}`);
      await picks.first().click();
      await page.waitForURL(/\/account\?next=%2Fcasting/, { timeout: 15_000 });
      await ctx.close();
    });

    await step("signed in with no characters yet: a place's sheet sends you to make one", async () => {
      const ctx = await adult(PHONE);
      await register(ctx, `empty${stamp}`);
      const page = await ctx.newPage();
      await page.goto(`${base}/casting`);
      await page.locator("button.casting-slot-pick").first().click();
      await sheet(page).waitFor({ timeout: 10_000 });
      assert((await sheet(page).getByRole("link", { name: "Make a character" }).getAttribute("href")) === "/create", "no Make a character link");
      assert((await sheet(page).locator(".casting-pick").count()) === 0, "characters listed for an account with none");
      await page.screenshot({ path: join(SHOTS_DIR, "casting-pick-none-phone.png") });
      await ctx.close();
    });

    // The phone first: it only looks (and closes), so the desktop run can apply.
    for (const [label, opts] of [
      ["phone", PHONE],
      ["desktop", DESKTOP],
    ]) {
      const ctx = await adult(opts, ownState);
      const page = await ctx.newPage();
      await step(`${label}: a place opens the sheet of your characters: Mara can apply, Wren says what's first in her way`, async () => {
        await page.goto(`${base}/casting`);
        await page.locator("button.casting-slot-pick").first().click();
        await sheet(page).waitFor({ timeout: 10_000 });
        const rows = sheet(page).locator(".casting-pick");
        assert((await rows.count()) === 2, `${await rows.count()} characters in the sheet`);
        assert((await rows.nth(0).innerText()).includes("Wren Hale") && (await rows.nth(0).innerText()).includes("It needs a portrait first."), `Wren's row: ${await rows.nth(0).innerText()}`);
        assert((await rows.nth(0).getByRole("link", { name: "Open Wren" }).getAttribute("href")) === `/characters/${wren}`, "Wren's link isn't her page");
        assert(await rows.nth(1).getByRole("button", { name: "Apply Mara" }).isVisible(), "no Apply Mara");
        assert((await sheet(page).innerText()).includes("You can withdraw it any time."), "no consent text");
        await noSideScroll(page);
        await page.screenshot({ path: join(SHOTS_DIR, `casting-pick-sheet-${label}.png`) });
      });
      if (label === "phone") {
        await step("phone: Escape closes the sheet, nothing applied", async () => {
          await page.keyboard.press("Escape");
          await sheet(page).waitFor({ state: "detached", timeout: 5_000 });
          assert((await page.locator(".casting-empty").count()) === 1, "the board isn't empty any more");
        });
      } else {
        await step("desktop: Apply puts Mara up, the sheet says so, and the page becomes the voting board with her on it", async () => {
          await sheet(page).getByRole("button", { name: "Apply Mara" }).click();
          await sheet(page).getByRole("heading", { name: "Mara is in" }).waitFor({ timeout: 15_000 });
          await page.screenshot({ path: join(SHOTS_DIR, `casting-pick-applied-${label}.png`) });
          await sheet(page).getByRole("button", { name: "See the board" }).click();
          await page.locator(".casting-empty").waitFor({ state: "detached", timeout: 15_000 });
          await page.getByText("Mara Quill").first().waitFor({ timeout: 10_000 });
          await page.screenshot({ path: join(SHOTS_DIR, `casting-pick-board-${label}.png`), fullPage: true });
        });
      }
      await ctx.close();
    }

  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
  }
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `\n${failed} of ${results.length} steps failed.` : `\nAll ${results.length} steps passed.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

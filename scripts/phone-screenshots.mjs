#!/usr/bin/env node
/**
 * npm run screenshots:phone: proof of "the character's phone" (2026-11-15) in a real browser, on a phone (iPhone 13)
 * and a desktop. Builds the app (SKIP_BUILD=1 reuses a build) and starts the production build on a throwaway local
 * database with the harness's stand-in showrunner (no key), companions open as on prod.
 *
 * A sample creator makes Mira Quell in the browser's own session and sends her on a date with Rafe Calloway. Then:
 *  1. the home page opens on Mira's phone, never opted in: "Hear from Mira" is the one action;
 *  2. the tap opens her thread with the text about the date and its photo: the photo holds a 4:5 box, has alt text, is
 *     one link to the date, and nothing scrolls sideways;
 *  3. back home: her last texts, the chips into the thread, "Open Mira's texts";
 *  4. the date airs, and a stranger opens Rafe (a cast character): his opener is about that date, with the photo and
 *     "Watch the date", and no model was asked for it;
 *  5. the snapshot route itself: a 640x800 WebP, 404 for an unknown date.
 *
 * Screenshots go to docs/screenshots/phone-*.png. Sample data only; Chromium comes from CHROMIUM_PATH.
 */
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appEnv, build, CAST, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const require = createRequire(join(ROOT, "package.json"));
const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "phone-screenshots");

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

/** POST as the browser context (its cookies), JSON in and out. */
async function post(ctx, base, path, data, expected = [200, 201]) {
  const res = await ctx.request.post(base + path, { data, headers: { origin: base } });
  const body = await res.json().catch(() => ({}));
  assert(expected.includes(res.status()), `POST ${path} → ${res.status()} (${body.error ?? "?"}: ${body.message ?? ""})`);
  return body;
}

const noSidewaysScroll = async (page, what) => {
  const { sw, vw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
  assert(sw <= vw + 1, `${what}: the page is ${sw}px wide in a ${vw}px viewport`);
};

async function run(base, browser, devices, label, ctxOpts) {
  const host = new URL(base).hostname;
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addCookies([{ name: "bz_adult", value: "1", domain: host, path: "/" }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // The creator, in this browser's own session: a character and one date.
  const { soul: _soul, ...mira } = CAST[0];
  const character = await post(ctx, base, "/api/characters", { ...mira, attest: true, keep_name: true });
  const first = character.name.split(/\s+/)[0];
  const episode = await post(ctx, base, "/api/episodes", { character_id: character.id, partner_id: "house-rafe" });
  assert(episode.id, "the date wasn't made");

  // 1. Home: the phone, never opted in.
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  const phone = page.locator("#phone");
  await phone.waitFor();
  const top = await phone.boundingBox();
  const firstSection = await page.locator(".home > *").first().getAttribute("id");
  assert(firstSection === "phone", `${label}: the phone isn't the first thing on the owner's home (it is #${firstSection})`);
  assert(top && top.y < page.viewportSize().height, `${label}: the phone starts below the first screen (${top?.y})`);
  const hear = phone.getByRole("button", { name: `Hear from ${first}` });
  await hear.waitFor();
  assert((await phone.getByRole("link", { name: `Open ${first}'s texts` }).count()) === 0, `${label}: "Open texts" before any thread`);
  await noSidewaysScroll(page, `${label} home (never opted in)`);
  await page.screenshot({ path: join(OUT_DIR, `phone-home-hear-${label}.png`) });

  // 2. The tap: her thread, with the text and its photo.
  await Promise.all([page.waitForURL(/\/companion\/[^/]+$/, { timeout: 30_000 }), hear.click()]);
  const thread = new URL(page.url()).pathname;
  const photo = page.locator(".companion-thread .date-photo img");
  await photo.waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => {
    const img = document.querySelector(".companion-thread .date-photo img");
    return img && img.complete && img.naturalWidth > 0;
  }, null, { timeout: 30_000 });
  const natural = await photo.evaluate((img) => ({ w: img.naturalWidth, h: img.naturalHeight, alt: img.alt }));
  assert(natural.w === 640 && natural.h === 800, `${label}: the snapshot is ${natural.w}x${natural.h}`);
  assert(/^A photo from the date: /.test(natural.alt), `${label}: the photo's alt is "${natural.alt}"`);
  const box = await photo.boundingBox();
  assert(box && Math.abs(box.width / box.height - 4 / 5) < 0.02, `${label}: the photo's box is ${box?.width}x${box?.height}, not 4:5`);
  assert(box.width <= page.viewportSize().width, `${label}: the photo is wider than the screen`);
  const link = page.locator(".companion-thread .date-photo a");
  assert((await link.getAttribute("href")) === `/episodes/${episode.id}`, `${label}: the photo opens ${await link.getAttribute("href")}`);
  assert((await page.locator(".companion-thread .date-photo").count()) === 1, `${label}: more than one photo for one date`);
  // The chips of the text's question are still there, under its first bubble.
  await page.locator(".companion-offers .companion-offer").first().waitFor();
  await noSidewaysScroll(page, `${label} thread`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT_DIR, `phone-thread-photo-${label}.png`) });

  // 3. Home again: her texts, the chips, the thread as the action.
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await phone.getByRole("link", { name: `Open ${first}'s texts` }).first().waitFor();
  assert((await phone.locator(".char-phone-texts .chat-bubble").count()) === 3, `${label}: the phone doesn't show three texts`);
  const chips = phone.locator(".char-phone-chip");
  assert((await chips.count()) >= 2, `${label}: no chips on the phone`);
  for (const href of await chips.evaluateAll((els) => els.map((el) => el.getAttribute("href")))) assert(href === thread, `${label}: a chip leads to ${href}, not the thread`);
  assert((await phone.getByRole("button").count()) === 0, `${label}: the opted-in phone has a button (nothing is booked from home)`);
  // They just read the thread: no "New text" dot left behind.
  assert((await phone.locator(".char-phone-new").count()) === 0, `${label}: the "New text" dot is still there after the thread was opened`);
  await noSidewaysScroll(page, `${label} home (texts)`);
  await page.screenshot({ path: join(OUT_DIR, `phone-home-texts-${label}.png`) });

  // 4. The date airs; a stranger opens Rafe and hears about it from him.
  await post(ctx, base, `/api/episodes/${episode.id}/reveal`, {}, [200, 201, 204]);
  const other = await browser.newContext(ctxOpts);
  await other.addCookies([{ name: "bz_adult", value: "1", domain: host, path: "/" }]);
  const opened = await post(other, base, "/api/companion", { character_id: "house-rafe" });
  const visitor = await other.newPage();
  visitor.on("pageerror", (e) => errors.push(String(e)));
  await visitor.goto(`${base}/companion/${opened.thread_id}`, { waitUntil: "networkidle" });
  await visitor.locator(".companion-thread .chat-bubble", { hasText: `My last date was with ${first}` }).waitFor({ timeout: 15_000 });
  const watch = visitor.locator(".companion-thread").getByRole("link", { name: "▶ Watch the date" });
  await watch.waitFor();
  assert((await watch.getAttribute("href")) === `/episodes/${episode.id}`, `${label}: Watch the date leads to ${await watch.getAttribute("href")}`);
  await visitor.waitForFunction(() => {
    const img = document.querySelector(".companion-thread .date-photo img");
    return img && img.complete && img.naturalWidth > 0;
  }, null, { timeout: 30_000 });
  await noSidewaysScroll(visitor, `${label} cast opener`);
  await visitor.waitForTimeout(400);
  await visitor.screenshot({ path: join(OUT_DIR, `phone-cast-opener-${label}.png`) });
  // The stranger sees their own page at "/": no phone.
  await visitor.goto(`${base}/`, { waitUntil: "networkidle" });
  assert((await visitor.locator("#phone").count()) === 0, `${label}: a stranger got a phone block`);

  assert(errors.length === 0, `${label}: page errors: ${errors.join(" | ")}`);
  await other.close();
  await ctx.close();
  return episode;
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("set CHROMIUM_PATH to a Chrome/Chromium binary");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const port = await freePort();
  const app = await startApp(port, { ...appEnv(showrunner.address().port, DATA_DIR), SITE_URL: `http://127.0.0.1:${port}`, COMPANION_OPEN: "1" });
  const { chromium, devices } = require("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    let episode = null;
    for (const [label, ctxOpts] of [["mobile", devices["iPhone 13"]], ["desktop", { viewport: { width: 1280, height: 800 } }]]) {
      episode = await run(app.base, browser, devices, label, ctxOpts);
      console.log(`${label}: the phone on home, the photo in the thread, the chips and the cast's opener all hold`);
    }
    // 5. The snapshot itself, fetched the way the thread's <img> does.
    const snap = await fetch(`${app.base}/api/og/date-photo/${episode.id}`);
    const bytes = Buffer.from(await snap.arrayBuffer());
    assert(snap.status === 200 && snap.headers.get("content-type") === "image/webp", `the snapshot answered ${snap.status} ${snap.headers.get("content-type")}`);
    assert(/^public, max-age=86400/.test(snap.headers.get("cache-control") ?? ""), `the snapshot's cache is ${snap.headers.get("cache-control")}`);
    assert((await fetch(`${app.base}/api/og/date-photo/no-such-date`)).status === 404, "an unknown date's snapshot wasn't a 404");
    writeFileSync(join(OUT_DIR, "phone-date-photo.webp"), bytes);
    console.log(`the snapshot is a ${Math.round(bytes.length / 1024)} KB WebP; screenshots written to docs/screenshots/phone-*.png`);
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

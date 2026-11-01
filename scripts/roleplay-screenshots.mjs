#!/usr/bin/env node
/**
 * npm run screenshots:roleplays: real-browser screenshots of roleplays on show dates (docs/PRDs/roleplays.md), desktop
 * and phone, into docs/screenshots/. It builds the app and runs it on a throwaway local database with the stub
 * showrunner, so nothing leaves this machine and no real person's deck sees the two stand-in characters:
 *
 *   roleplay-house: "Date this character" with a roleplay picked for a house character (agreed as it's picked);
 *   roleplay-propose: two people's characters matched, one creator choosing a roleplay and who plays whom, with a note;
 *   roleplay-answer: the other creator's card: Agree, Suggest another, Not this time;
 *   roleplay-agreed: the counter agreed, with how they got there;
 *   roleplay-episode: their first date, playing it (the chip and the notice).
 *
 * On the phone it also checks no page scrolls sideways. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright-core";
import { appEnv, build, CAST, client, freePort, persona, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "roleplay-screenshots");
const DESKTOP = { width: 1280, height: 860 };
const PHONE = { width: 390, height: 844 };

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** No sideways scroll on the phone. */
async function checkPhone(page, name) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  assert(scroll <= width, `${name}: the page scrolls sideways (${scroll}px wide on a ${width}px screen)`);
  console.log(`  ✓ ${name}: no sideways scroll`);
}

async function shot(page, file) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT_DIR, file) });
  console.log(`  📸 docs/screenshots/${file}`);
}

/** Scrolls so `locator`'s top sits just under the sticky header. */
const frameTop = (page, locator) =>
  locator.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (document.querySelector(".site-header")?.getBoundingClientRect().height ?? 0) - 12));

/** The same view at both sizes: framed on `target` (a function of the page, so it's found again after a resize). */
async function both(page, name, label, target) {
  await page.setViewportSize(DESKTOP);
  if (target) await frameTop(page, target(page));
  await shot(page, `${name}-desktop.png`);
  await page.setViewportSize(PHONE);
  await checkPhone(page, label);
  if (target) await frameTop(page, target(page));
  await shot(page, `${name}-phone.png`);
  await page.setViewportSize(DESKTOP);
}

// A dating profile (lib/extras.ts profileMissing: two answered prompts, two interests), so the two can swipe on each other.
const PROFILES = [
  {
    hobbies: ["Old maps", "Night markets"],
    prompts: [
      { id: "simple_pleasures", answer: "A city map nobody has folded yet, and a street that isn't on it." },
      { id: "win_me_over", answer: "Get us properly lost, then let me find the way back." },
    ],
  },
  {
    hobbies: ["Opera", "Crosswords"],
    prompts: [
      { id: "simple_pleasures", answer: "The second before the curtain goes up, when the whole house holds its breath." },
      { id: "win_me_over", answer: "Let me finish the story, even the long version." },
    ],
  },
];
const sheet = (i) => {
  const { soul, ...rest } = CAST[i];
  return { ...rest, ...(soul ? { soul } : {}), extras: PROFILES[i], attest: true, keep_name: true, open_to_dates: true };
};

async function browserFor(browser, base, who) {
  const ctx = await browser.newContext();
  await ctx.addCookies([
    { name: "bz_uid", value: who.id, url: base },
    { name: "bz_adult", value: "1", url: base },
  ]);
  const page = await ctx.newPage();
  await page.setViewportSize(DESKTOP);
  return { ctx, page };
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const env = appEnv(showrunner.address().port, DATA_DIR);
  let app = await startApp(await freePort(), env);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    // Two creators, each with a character open to dates on this local show only.
    const ana = persona();
    const ben = persona();
    let call = client(app.base);
    const mira = await call("/api/characters", sheet(0), ana);
    const otto = await call("/api/characters", sheet(1), ben);
    const [lo, hi] = [mira.id, otto.id].sort();
    const couple = `/couples/${lo}/${hi}`;

    // 1. A house character: the roleplay is agreed as it's picked, on "Date this character".
    const A = await browserFor(browser, app.base, ana);
    await A.page.goto(`${app.base}/characters/house-nell`);
    await A.page.locator(".date-cta button.primary").click(); // the confirm sheet holds the roleplay (B5)
    const cta = A.page.locator("dialog.sheet-dialog[open] .date-cta-roleplay");
    await cta.locator("summary").click();
    await cta.locator(".rp-tag", { hasText: "Fantasy" }).click();
    await cta.locator(".rp-tile", { hasText: "The knight and the dragon" }).click();
    await cta.locator(".rp-role").nth(1).click(); // Mira is the dragon, Nell the knight
    await both(A.page, "roleplay-house", "a house character's date card", (p) => p.locator(".date-cta-roleplay"));

    // 2. Two people: their characters match (both swipe right), and the match page has the roleplay card.
    await call("/api/swipes", { character_id: mira.id, target_id: otto.id, like: true }, ana);
    const matched = await call("/api/swipes", { character_id: otto.id, target_id: mira.id, like: true }, ben);
    assert(matched.match, "the two characters should match");
    await A.page.goto(app.base + couple);
    const card = (p) => p.locator("#roleplay");
    await card(A.page).getByRole("button", { name: "Choose a roleplay" }).click();
    await card(A.page).locator(".rp-tag", { hasText: "Mystery" }).click();
    await card(A.page).locator(".rp-tile", { hasText: "Ghost hunters" }).click();
    await card(A.page).locator(".rp-role").nth(1).click(); // Mira is the sceptic
    await card(A.page).locator(".roleplay-note input").fill("Mira swears she's never been scared. Let's test that.");
    await both(A.page, "roleplay-propose", "choosing a roleplay for a match", card);
    await card(A.page).getByRole("button", { name: /^Suggest it to Otto/ }).click();
    await card(A.page).getByText("Sent to Otto's creator.").waitFor();

    // 3. Otto's creator answers: agree, suggest another, or not this time.
    const B = await browserFor(browser, app.base, ben);
    await B.page.goto(app.base + couple);
    await card(B.page).getByText(/Mira's creator suggests a roleplay/).waitFor();
    await both(B.page, "roleplay-answer", "a roleplay to answer", card);
    // They'd rather something else: the time traveller, with Otto as the traveller.
    await card(B.page).getByRole("button", { name: "Suggest another" }).click();
    await card(B.page).locator(".rp-tag", { hasText: "Sci-fi" }).click();
    await card(B.page).locator(".rp-tile", { hasText: "The time traveller" }).click();
    await card(B.page).locator(".rp-role").nth(0).click(); // Otto is the time traveller
    await card(B.page).locator(".roleplay-note input").fill("Otto has been practising his 1890s manners all week.");
    await card(B.page).getByRole("button", { name: "Suggest this instead" }).click();
    await card(B.page).getByText("Sent to Mira's creator instead.").waitFor();

    // 4. Mira's creator agrees to the counter.
    await A.page.goto(app.base + couple);
    await card(A.page).getByText(/Otto's creator suggests another roleplay/).waitFor();
    await card(A.page).getByRole("button", { name: "Agree" }).click();
    await card(A.page).getByText(/plays on their next date: both creators agreed/).waitFor();
    await card(A.page).locator("details summary").click(); // how they got here
    await both(A.page, "roleplay-agreed", "an agreed roleplay", card);

    // 5. Their first date plays it. A person's character answers a match on a seeded coin; here both said yes (written
    // while the app is stopped: the local database has one writer).
    await stopApp(app);
    const db = new PGlite(DATA_DIR);
    await db.query(`update matches set yes_lo = true, yes_hi = true where character_lo = $1 and character_hi = $2`, [lo, hi]);
    await db.close();
    app = await startApp(await freePort(), env);
    call = client(app.base);
    const episode = await call("/api/episodes", { character_id: mira.id, partner_id: otto.id }, ana);
    assert(episode.roleplay?.title === "The time traveller", `the date should play the agreed roleplay (got ${JSON.stringify(episode.roleplay)})`);
    // Cookies are the host's, not the port's: the same browser, on the restarted app.
    const ep = await A.ctx.newPage();
    await ep.setViewportSize(DESKTOP);
    await ep.goto(`${app.base}/episodes/${episode.id}`);
    await ep.locator(".episode-roleplay").waitFor();
    await both(ep, "roleplay-episode", "a date playing a roleplay", (p) => p.locator(".episode-roleplay"));
    await A.ctx.close();
    await B.ctx.close();
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`screenshots:roleplays failed: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});

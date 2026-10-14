#!/usr/bin/env node
/**
 * npm run e2e: a full end-to-end test. Builds the production app, starts it with the stub showrunner
 * and a sample Stripe Payment Link, then drives the whole product through a real browser (Chromium via
 * CHROMIUM_PATH, no download) and asserts it works:
 *
 *   build a custom character (soul, appearance, avatar colour) → send on a date → the three-act episode
 *   with avatars, box score, debrief, agendas and the producer → Sliding Doors → a spectator predicts
 *   and guesses the dealbreaker → the host airs the finale → the spectator is scored → the cast gallery
 *   and matchmaker → a shop purchase end to end.
 *
 * Exits non-zero if any step fails. No model key, no real payments, no network beyond localhost.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import {
  appEnv,
  build,
  freePort,
  ROOT,
  SAMPLE_PACK,
  SAMPLE_PAYMENT_LINK,
  SAMPLE_PRICE_LABEL,
  signedEvent,
  startApp,
  startShowrunner,
  stopApp,
} from "./harness.mjs";

const DATA_DIR = join(ROOT, ".data", "e2e");
const CHAR = {
  name: "Nova Pike",
  age: "29",
  bio: "A lighthouse electrician who rewires old signals to play lullabies to passing ships.",
  traits: ["inventive", "warm", "stubborn"],
  want: "Someone who waves back at boats",
  dealbreaker: "People who leave without saying goodbye",
  appearance: "copper-haired, always in a boiler suit with fairy lights",
};

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

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  build();
  const showrunner = await startShowrunner();
  const port = await freePort();
  const app = await startApp(port, appEnv(showrunner.address().port, DATA_DIR));
  const base = app.base;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  let episodeUrl = "";

  try {
    const creator = await browser.newContext();
    const page = await creator.newPage();

    await step("the conversion landing page loads: hero, CTA, features, cast, FAQ and the builder", async () => {
      await page.goto(base);
      await page.getByRole("heading", { level: 1 }).waitFor();
      assert((await page.getByText("Send your OC on a blind date").count()) > 0, "hero headline missing");
      assert((await page.getByText(/Free, no sign-up/).count()) > 0, "free/no-sign-up value prop missing");
      assert((await page.getByRole("link", { name: "Make your character" }).count()) > 0, "primary CTA missing");
      assert((await page.locator(".hero-art .avatar").count()) === 2, "hero product teaser missing");
      assert((await page.locator(".features .feature").count()) >= 3, "feature grid missing");
      assert((await page.locator(".faq details").count()) >= 3, "FAQ missing");
      assert((await page.locator("#start").count()) > 0, "builder (#start) missing");
    });

    await step("builds a custom character with a soul, appearance and avatar colour", async () => {
      const form = page.locator("#start");
      await form.locator('input[name="name"]').fill(CHAR.name);
      await form.locator('input[name="age"]').fill(CHAR.age);
      await form.locator('textarea[name="bio"]').fill(CHAR.bio);
      for (let i = 0; i < 3; i++) await form.locator(`input[name="trait${i + 1}"]`).fill(CHAR.traits[i]);
      await form.locator('input[name="want"]').fill(CHAR.want);
      await form.locator('input[name="dealbreaker"]').fill(CHAR.dealbreaker);
      await form.locator('input[name="appearance"]').fill(CHAR.appearance);
      // The live avatar preview should render.
      assert((await form.locator(".avatar").count()) > 0, "avatar preview missing");
      await form.getByRole("button", { name: "Violet" }).click();
      await form.getByText("Give them a private soul (optional)").click();
      await form.locator('input[name="soul_values"]').fill("Steady, inventive, allergic to goodbyes.");
      await form.locator('input[name="attest"]').check();
      await form.getByRole("button", { name: "Create character" }).click();
      await page.getByText(`Who should ${CHAR.name} meet?`).waitFor();
    });

    await step("sets date settings and sends the character on a date", async () => {
      await page.getByText("Date settings (optional)").click();
      await page.locator("select").first().selectOption("unpredictable");
      await page.getByRole("button", { name: /Send Nova Pike on a date with/ }).first().click();
      await page.waitForURL(/\/episodes\/[0-9a-f-]{36}$/);
      episodeUrl = page.url();
    });

    await step("the episode is a three-act story with avatars, box score, debrief, agendas and an ending", async () => {
      await page.getByRole("heading", { level: 1 }).waitFor();
      assert((await page.locator(".matchup .avatar").count()) === 2, "expected two matchup avatars");
      assert((await page.locator(".act").count()) === 3, "expected three acts");
      assert((await page.locator(".boxscore").count()) > 0, "box score missing for the creator");
      assert((await page.locator(".debrief").count()) > 0, "private debrief missing for the creator");
      assert((await page.getByText("Secret agendas & the producer").count()) > 0, "agendas/producer section missing");
      assert((await page.getByText(/Ending:/).count()) > 0, "ending not shown to the creator");
    });

    await step("Sliding Doors replays the date with one thing changed", async () => {
      await page.getByRole("heading", { name: "Sliding doors" }).scrollIntoViewIfNeeded();
      await page.getByRole("button", { name: "More unpredictable" }).click();
      await page.getByText(/this timeline ends in/i).waitFor({ timeout: 10_000 });
    });

    // A spectator, in a separate browser session.
    const spectator = await browser.newContext();
    const spage = await spectator.newPage();

    await step("a spectator sees a teaser, predicts the ending and guesses the dealbreaker", async () => {
      await spage.goto(episodeUrl);
      assert((await spage.locator(".boxscore").count()) === 0, "box score should be hidden before the finale airs");
      await spage.locator('input[name="pick"][value="friends"]').check();
      await spage.getByRole("button", { name: /Lock in my pick|Change my pick/ }).click();
      await spage.getByText(/Your pick:/).waitFor();
      // Guess the dealbreaker.
      await spage.locator(".quiz .choices button").first().click();
      await spage.getByText(/Locked in:/).waitFor();
    });

    await step("the host airs the finale", async () => {
      await page.bringToFront();
      await page.getByRole("button", { name: "Air the finale" }).click();
      await page.getByText("The finale has aired").waitFor({ timeout: 10_000 });
    });

    await step("the spectator now sees the box score and a scored result", async () => {
      await spage.reload();
      assert((await spage.locator(".boxscore").count()) > 0, "box score should show after the finale airs");
      assert((await spage.getByText(/points\./).count()) > 0, "no scored result shown to the spectator");
    });

    await step("the cast gallery lists characters and a matchmaker proposal can be made", async () => {
      await spage.goto(`${base}/cast`);
      await spage.getByRole("heading", { name: "The cast" }).waitFor();
      assert((await spage.locator(".gallery .avatar").count()) > 0, "cast gallery avatars missing");
      const selects = spage.locator("form .traits select");
      await selects.nth(0).selectOption({ index: 1 });
      await selects.nth(1).selectOption({ index: 2 });
      await spage.getByRole("button", { name: "Propose the match" }).click();
      await spage.getByText("Proposed.").waitFor({ timeout: 10_000 });
    });

    await step("each contestant has a shareable card", async () => {
      await spage.goto(`${base}/cast`);
      await spage.locator(".gallery .meta a").first().click();
      await spage.waitForURL(/\/characters\//);
      assert((await spage.locator(".contestant .avatar").count()) > 0, "contestant card avatar missing");
      assert((await spage.getByText("Share this contestant").count()) > 0, "share section missing on the card");
    });

    await step("the shop sells a pack end to end (checkout, Payment Link, signed webhook)", async () => {
      let linkUrl = null;
      await page.route(`${new URL(SAMPLE_PAYMENT_LINK).origin}/**`, (route) => {
        linkUrl = new URL(route.request().url());
        route.fulfill({ contentType: "text/html", body: "<title>Stripe (stub)</title><h1>Paid (stub)</h1>" });
      });
      await page.goto(`${base}/shop`);
      await page.locator('input[name="attest"]').check();
      await page.getByRole("button", { name: SAMPLE_PRICE_LABEL }).click();
      await page.waitForURL((url) => url.href.startsWith(SAMPLE_PAYMENT_LINK));
      const orderRef = linkUrl?.searchParams.get("client_reference_id");
      assert(orderRef, "no client_reference_id on the Payment Link");
      const { payload, signature } = signedEvent({
        id: `cs_test_${Date.now()}`,
        client_reference_id: orderRef,
        payment_link: "plink_botchelorStub",
        amount_total: SAMPLE_PACK.amount_cents,
      });
      const res = await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body: payload });
      assert(res.status === 200, `webhook → ${res.status}`);
      await page.goto(`${base}/shop?checkout=success`);
      await page.getByText(`plus ${SAMPLE_PACK.episodes} pack dates`).waitFor({ timeout: 10_000 });
    });
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} E2E steps passed${failed ? `, ${failed} FAILED` : ""}.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`e2e failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

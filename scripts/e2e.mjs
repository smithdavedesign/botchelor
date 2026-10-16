#!/usr/bin/env node
/**
 * npm run e2e: a full end-to-end test. Builds the production app, starts it with the stub showrunner
 * and a sample Stripe Payment Link, then drives the whole product through a real browser (Chromium via
 * CHROMIUM_PATH, no download) and asserts it works:
 *
 *   build a custom character (soul, appearance, avatar colour) → send on a date → the three-act episode
 *   with avatars, box score, debrief, agendas and the producer → Sliding Doors → a spectator predicts
 *   and guesses the dealbreaker → a live watch party (host premiere + a viewer who reacts, chats and
 *   predicts, plus an always-on template room joined from the lobby) → the host airs the finale → the
 *   spectator is scored → the cast gallery and matchmaker → a shop purchase end to end.
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
  seedTemplateRooms,
  signedEvent,
  solidPng,
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

/** A date opens in theater mode (unless this browser chose the standard view before): step out to the standard room. */
async function standardView(p) {
  await p.locator(".theater, .watch-grid").first().waitFor({ timeout: 10_000 });
  if (await p.locator(".theater").count()) {
    await p.getByRole("button", { name: "Exit" }).click();
    await p.locator(".watch-grid").waitFor({ timeout: 10_000 });
  }
}
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
  // Always-on template date rooms, so the /watch lobby has something to drop into.
  await seedTemplateRooms(base);
  let episodeUrl = "";
  let roomUrl = "";

  // A fresh browser context that has already passed the 18+ gate (so a step can get straight to the feature).
  const adultContext = async (opts) => {
    const ctx = await browser.newContext(opts);
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: base }]);
    return ctx;
  };

  try {
    await step("the 18+ gate blocks the site until you confirm you're an adult", async () => {
      const visitor = await browser.newContext(); // no cookie: must hit the gate
      const gatePage = await visitor.newPage();
      await gatePage.goto(`${base}/feed`); // any page redirects to the gate (goto follows it)
      assert(new URL(gatePage.url()).pathname === "/gate", `expected the gate, got ${gatePage.url()}`);
      assert((await gatePage.getByText("Are you 18 or older?").count()) > 0, "age gate did not show");
      assert((await gatePage.getByRole("heading", { name: "Now showing" }).count()) === 0, "page content leaked behind the gate");
      const back = gatePage.waitForURL((url) => url.pathname === "/feed");
      await gatePage.getByRole("button", { name: /I.m 18 or older/ }).click();
      await back; // confirming drops us back where we were headed, and remembers it
      assert((await gatePage.getByText("Are you 18 or older?").count()) === 0, "gate still blocking after confirming");
      assert((await visitor.cookies()).some((c) => c.name === "bz_adult" && c.value === "1"), "adult choice not remembered");
      await visitor.close();
    });

    const creator = await adultContext();
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
      await form.getByRole("button", { name: "Violet", exact: true }).click();
      await form.getByText("Give them a private soul (optional)").click();
      await form.locator('input[name="soul_values"]').fill("Steady, inventive, allergic to goodbyes.");
      await form.locator('input[name="attest"]').check();
      await form.getByRole("button", { name: "Create character" }).click();
      await page.getByText(`Who should ${CHAR.name} meet?`).waitFor();
    });

    await step("sets date settings (incl. a show format) and sends the character on a date", async () => {
      await page.getByText("Date settings (optional)").click();
      await page.getByLabel("Show format").selectOption("meet_the_parents");
      await page.getByLabel("Autonomy").selectOption("unpredictable");
      await page.getByRole("button", { name: /Send Nova Pike on a date with/ }).first().click();
      await page.waitForURL(/\/episodes\/[0-9a-f-]{36}$/);
      episodeUrl = page.url();
    });

    await step("the episode is a three-act story with avatars, a turn-by-turn transcript, box score, debrief, agendas and an ending", async () => {
      await page.getByRole("heading", { level: 1 }).waitFor();
      assert((await page.locator(".matchup .avatar").count()) === 2, "expected two matchup avatars");
      assert((await page.getByText("The date, line by line").count()) > 0, "turn-by-turn transcript heading missing");
      assert((await page.locator(".transcript .chat-bubble").count()) >= 4, "the two agents' turn-by-turn chat thread is missing");
      assert((await page.locator(".transcript .chat-row-a").count()) > 0 && (await page.locator(".transcript .chat-row-b").count()) > 0, "the chat thread should put one character on each side");
      assert((await page.locator(".boxscore").count()) > 0, "box score missing for the creator");
      assert((await page.locator(".debrief").count()) > 0, "private debrief missing for the creator");
      assert((await page.getByText("Secret agendas & the producer").count()) > 0, "agendas/producer section missing");
      assert((await page.getByText(/Ending:/).count()) > 0, "ending not shown to the creator");
      assert((await page.getByText("Meet the parents").count()) > 0, "the chosen show-format badge is missing");
      assert((await page.getByRole("heading", { name: "The afterglow" }).count()) > 0, "the afterglow section is missing for the creator");
    });

    await step("the creator opens the afterglow and reads the morning-after texts", async () => {
      await page.getByRole("button", { name: "Open the afterglow" }).scrollIntoViewIfNeeded();
      await page.getByRole("button", { name: "Open the afterglow" }).click();
      await page.locator(".afterglow .turn").first().waitFor({ timeout: 10_000 });
      assert((await page.locator(".afterglow .turn").count()) >= 1, "the afterglow thread did not open");
    });

    await step("the episode plays as an immersive theater (M13)", async () => {
      await page.getByRole("button", { name: "Watch in theater" }).scrollIntoViewIfNeeded();
      await page.getByRole("button", { name: "Watch in theater" }).click();
      await page.locator(".theater .scene").waitFor({ timeout: 10_000 });
      assert((await page.locator(".theater-hud").count()) > 0, "the theater HUD is missing");
      // The replay plays line by line into the conversation thread (not all at once).
      await page.locator(".theater-convo .chat-bubble").first().waitFor({ timeout: 10_000 });
      const early = await page.locator(".theater-convo .chat-bubble:not(.chat-typing)").count();
      await page.getByRole("button", { name: "Skip to the end" }).click();
      const all = await page.locator(".theater-convo .chat-bubble:not(.chat-typing)").count();
      assert(all > early, `the replay should reveal lines over time (had ${early}, skip showed ${all})`);
      await page.getByRole("button", { name: "Exit" }).click();
      await page.locator(".theater").waitFor({ state: "detached", timeout: 10_000 });
    });

    await step("Sliding Doors replays the date with one thing changed", async () => {
      await page.getByRole("heading", { name: "Sliding doors" }).scrollIntoViewIfNeeded();
      await page.getByRole("button", { name: "More unpredictable" }).click();
      await page.getByText(/this timeline ends in/i).waitFor({ timeout: 10_000 });
    });

    // A spectator, in a separate browser session.
    const spectator = await adultContext();
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

    await step("the host turns the date into a live watch party (a premiere room)", async () => {
      await page.bringToFront();
      await page.goto(episodeUrl);
      await page.getByRole("button", { name: "Start the premiere" }).click();
      await page.waitForURL(/\/watch\/[0-9a-f-]{36}$/);
      roomUrl = page.url();
      await page.locator(".theater").waitFor({ timeout: 10_000 }); // a date opens in theater mode
      await standardView(page);
      await page.getByRole("heading", { level: 1 }).waitFor();
      assert((await page.locator(".watch-live").count()) > 0, "live 'watching' indicator missing");
      assert((await page.locator(".watch-react").count()) >= 3, "the reactions bar is missing");
    });

    await step("a viewer joins the room and reacts, chats and predicts live", async () => {
      const fan = await adultContext();
      const fpage = await fan.newPage();
      try {
        await fpage.goto(roomUrl);
        await standardView(fpage);
        await fpage.locator(".watch-react").first().waitFor();
        // React: the first emoji's count should tick from 0 to 1 after the heartbeat syncs it back.
        await fpage.locator(".watch-react").first().click();
        await fpage.waitForFunction(
          () => /\b[1-9]\b/.test(document.querySelector(".watch-react")?.textContent || ""),
          { timeout: 10_000 },
        );
        // Chat: the message appears in the live feed.
        await fpage.locator('input[aria-label="Chat message"]').fill("he is absolutely LYING 😂");
        await fpage.getByRole("button", { name: "Send" }).click();
        await fpage.getByText("he is absolutely LYING").waitFor({ timeout: 10_000 });
        // Predict the ending from inside the room.
        await fpage.locator(".watch-predict button.poll-option").first().click();
        await fpage.getByText(/Locked in:/).waitFor({ timeout: 10_000 });
      } finally {
        await fan.close();
      }
    });

    await step("the watch room opens into theater mode (M13)", async () => {
      await page.bringToFront();
      await page.goto(roomUrl);
      // This browser stepped out of theater earlier, so the standard room remembers that; the button goes back in.
      await page.locator(".theater, .watch-grid").first().waitFor({ timeout: 10_000 });
      if (!(await page.locator(".theater").count())) await page.getByRole("button", { name: /Theater mode|Watch the replay/ }).click();
      await page.locator(".theater .scene").waitFor({ timeout: 10_000 });
      assert((await page.locator(".theater-hud").count()) > 0, "the theater HUD is missing");
      assert((await page.locator(".theater-convo .chat-thread").count()) > 0, "the conversation thread is missing in theater");
      // The live chat docks behind its own icon (open by default on a wide screen, one tap away otherwise).
      const chatIcon = page.getByRole("button", { name: "Live chat" });
      await page.waitForTimeout(300); // let the wide-screen default settle before reading the toggle
      if ((await chatIcon.getAttribute("aria-pressed")) !== "true") await chatIcon.click();
      await page.locator(".theater-panel .watch-chat-head h2").filter({ hasText: "Live chat" }).waitFor({ timeout: 10_000 });
      // The voting & questions panel opens from its own icon (keeping the scene itself clean).
      await page.getByRole("button", { name: "Voting and questions" }).click();
      await page.getByRole("heading", { name: "Voting & questions" }).waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: "Exit" }).click();
      await page.locator(".theater").waitFor({ state: "detached", timeout: 10_000 });
    });

    await step("an always-on template date can be joined from the lobby", async () => {
      const guest = await adultContext();
      const gpage = await guest.newPage();
      try {
        await gpage.goto(`${base}/watch`);
        await gpage.getByRole("heading", { name: "Watch parties" }).waitFor();
        assert((await gpage.locator(".watch-lobby-card").count()) > 0, "the lobby has no rooms");
        await gpage.locator(".watch-lobby-card").first().click();
        await gpage.waitForURL(/\/watch\/[0-9a-f-]{36}$/);
        await standardView(gpage);
        await gpage.getByRole("heading", { level: 1 }).waitFor();
        assert((await gpage.locator(".watch-stage .card").count()) > 0, "the room stage did not render");
        assert((await gpage.locator(".watch-react").count()) >= 3, "the room reactions bar is missing");
      } finally {
        await guest.close();
      }
    });

    await step("the host airs the finale", async () => {
      await page.bringToFront();
      await page.goto(episodeUrl);
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
      // Audience rating: a spectator (who doesn't own this contestant) toggles a rating chip on.
      await spage.locator(".ratings .rating-chip").first().click();
      await spage.locator(".rating-chip.on").first().waitFor({ timeout: 10_000 });
      assert((await spage.locator(".rating-chip.on").count()) >= 1, "the rating chip did not toggle on");
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

    await step("an image trains the character's look and traits, entirely in the browser", async () => {
      await page.goto(base);
      const form = page.locator("#start");
      await form.locator('input[name="name"]').fill("Teal Test");
      // A generated teal PNG — never saved to disk, never uploaded by the app.
      await form.locator('input[type="file"]').setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: solidPng(20, 120, 140) });
      await page.waitForFunction(
        () => (document.querySelector('input[name="appearance"]')?.value || "").includes("palette"),
        { timeout: 6000 },
      );
      assert((await form.locator('input[name="trait1"]').inputValue()).length > 0, "traits were not trained from the image");
      assert((await form.locator('input[name="appearance"]').inputValue()).includes("teal"), "appearance not trained from the image");
    });

    await step("a sample character fills the whole card for a fast start", async () => {
      await page.goto(base);
      await page.getByRole("button", { name: "Use a sample character" }).click();
      assert((await page.locator('#start input[name="name"]').inputValue()).length > 0, "sample did not fill the name");
      assert((await page.locator('#start input[name="dealbreaker"]').inputValue()).length > 0, "sample did not fill the dealbreaker");
    });

    // M16: accounts, ownership, BYOK, visibility. This browser's anonymous session already owns the
    // character and date made above, so an account adopts them.
    const handle = `mapmaker${Date.now() % 100000}`;
    const pw = ["e2e", "account", "pass", "99"].join("-"); // built from parts, never a literal secret
    await step("signs up for an optional account that adopts this browser's characters and dates", async () => {
      await page.goto(`${base}/account`);
      await page.locator('input[name="handle"]').fill(handle);
      await page.locator('input[name="password"]').fill(pw);
      await page.locator('input[name="attest"]').check();
      await page.getByRole("button", { name: "Create account" }).click();
      await page.getByText(`Signed in as ${handle}`).waitFor({ timeout: 10_000 });
      await page.getByRole("heading", { name: "Your characters" }).waitFor();
      assert((await page.locator(".account-links a").count()) > 0, "the account shows no characters it should own");
      assert((await page.locator(".account-dates li").count()) > 0, "the account shows no dates it should own");
    });

    await step("brings their own model key, shown only by its last four", async () => {
      const apiKey = ["AIza", "e2e", "0".repeat(28), "L4st"].join(""); // fake, built from parts
      await page.getByRole("heading", { name: "Your model key (optional)" }).waitFor();
      await page.locator('select[name="provider"]').selectOption("google");
      await page.locator('input[name="key"]').first().fill(apiKey); // the text-key form (an image-key form follows)
      await page.getByRole("button", { name: "Save key", exact: true }).click();
      await page.getByText("····L4st").waitFor({ timeout: 10_000 });
      const shown = await page.content();
      assert(!shown.includes(apiKey), "the full API key must never be shown back");
    });

    await step("changes who can see a date, and it persists", async () => {
      // This session's only date has a watch party (a public room), so it can't go private — unlisted is the
      // allowed change here; the private-with-a-party rule is covered by unit tests.
      const select = page.locator(".account-dates select").first();
      await select.selectOption("unlisted");
      await page.waitForTimeout(400);
      await page.reload();
      await page.locator(".account-dates select").first().waitFor();
      assert((await page.locator(".account-dates select").first().inputValue()) === "unlisted", "visibility did not persist");
    });

    await step("edits their own character on its card", async () => {
      await page.locator(".account-links a").first().click();
      await page.getByRole("button", { name: "Edit or delete" }).click();
      const newName = "Edited Contestant";
      await page.locator('.owner-controls input[name="name"]').fill(newName);
      await page.getByRole("button", { name: "Save changes" }).click();
      await page.getByRole("heading", { name: newName }).waitFor({ timeout: 10_000 });
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

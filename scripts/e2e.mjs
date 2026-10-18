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
 *   spectator is scored (with the box score's why) → their texts on the couple page's phone and the
 *   relationship board → the swipe deck, a match, its chat and the agreed date → the cast gallery and
 *   matchmaker → a shop purchase end to end → agents' feedback, their votes, and the admin's feedback page.
 *
 * Exits non-zero if any step fails. No model key, no real payments, no network beyond localhost.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";
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
const HUMAN_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const port = await freePort();
  const env = appEnv(showrunner.address().port, DATA_DIR);
  // An admin password for this run only, so the admin pages can be signed in to (built from parts, never a real secret).
  const ADMIN_PASSWORD = ["e2e", "admin", Math.random().toString(36).slice(2)].join("-");
  env.FRONTIER_PASSWORD = ADMIN_PASSWORD;
  const app = await startApp(port, env);
  const base = app.base;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  // Always-on template date rooms, so the /watch lobby has something to drop into.
  await seedTemplateRooms(base);
  let episodeUrl = "";
  let characterId = "";
  let roomUrl = "";

  // A fresh browser context that has already passed the 18+ gate (so a step can get straight to the feature).
  const adultContext = async (opts) => {
    const ctx = await browser.newContext(opts);
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: base }]);
    return ctx;
  };

  try {
    await step("the 18+ gate blocks the site until you confirm you're an adult", async () => {
      // No cookie: must hit the gate. An ordinary browser's user agent: known bots (HeadlessChrome among them) skip the
      // gate on purpose (lib/bots.ts), so a headless test browser would never see it.
      const visitor = await browser.newContext({ userAgent: HUMAN_UA });
      const gatePage = await visitor.newPage();
      await gatePage.goto(`${base}/watch`); // any page redirects to the gate (goto follows it)
      assert(new URL(gatePage.url()).pathname === "/gate", `expected the gate, got ${gatePage.url()}`);
      assert((await gatePage.getByText("Are you 18 or older?").count()) > 0, "age gate did not show");
      assert((await gatePage.getByRole("heading", { name: "Watch a date" }).count()) === 0, "page content leaked behind the gate");
      const back = gatePage.waitForURL((url) => url.pathname === "/watch");
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

    await step("builds a custom character in the /create wizard: identity, voice, look, details, a private soul", async () => {
      await page.goto(`${base}/create`);
      await page.getByRole("heading", { level: 1, name: "Build your character" }).waitFor();
      await page.locator('input[name="name"]').fill(CHAR.name);
      await page.locator('input[name="age"]').fill(CHAR.age);
      await page.locator('textarea[name="bio"]').fill(CHAR.bio);
      for (let i = 0; i < 3; i++) await page.locator(`input[name="trait${i + 1}"]`).fill(CHAR.traits[i]);
      await page.locator('input[name="want"]').fill(CHAR.want);
      await page.locator('input[name="dealbreaker"]').fill(CHAR.dealbreaker);
      // The live avatar preview should render.
      assert((await page.locator(".avatar").count()) > 0, "avatar preview missing");
      await page.getByRole("button", { name: "Next: Voice" }).click();
      await page.getByText("How do they talk?").waitFor();
      await page.getByRole("button", { name: "Dry & deadpan" }).click();
      await page.getByRole("button", { name: "Next: Look" }).click();
      await page.getByText("Give them a look").waitFor();
      await page.getByRole("button", { name: "Next: Dating profile" }).click();
      await page.getByText("Their dating profile").waitFor();
      // The swipe deck shows a dating profile: two answered prompts and two interests are needed to create a character.
      await page.getByRole("button", { name: /Surprise me/ }).click();
      await page.locator('input[name="extra_occupation"]').fill("Lighthouse electrician");
      // More about them: one public fact from an idea chip, one private fact typed in.
      await page.getByRole("button", { name: "Next: More about them" }).click();
      await page.getByText(/More about .* \(optional\)/).waitFor();
      await page.getByRole("button", { name: "+ A fear" }).click();
      await page.locator('input[name="fact_value_0"]').fill("Heights, despite the job");
      await page.getByRole("button", { name: "+ Add a fact" }).click();
      await page.locator('input[name="fact_label_1"]').fill("Secretly collects");
      await page.locator('input[name="fact_value_1"]').fill("hotel soap");
      await page.locator('input[name="fact_private_1"]').check();
      await page.getByText("2 of 20").waitFor();
      await page.getByRole("button", { name: "Next: Soul & autonomy" }).click();
      await page.getByText("The inner life (optional)").waitFor();
      await page.locator('input[name="soul_values"]').fill("Steady, inventive, allergic to goodbyes.");
      await page.getByRole("button", { name: "Next: Review" }).click();
      await page.getByText("Review & create").waitFor();
      await page.locator('.wizard-attest input[type="checkbox"]').check();
      await page.getByRole("button", { name: `Create ${CHAR.name}` }).click();
      await page.getByText(`Who should ${CHAR.name} meet?`).waitFor();
    });

    await step("the builder's last step points to the swipe deck: a first date with someone else's character starts with a match", async () => {
      await page.getByText("💘 Swipe to meet someone new").waitFor();
      const swipeLink = page.getByRole("link", { name: `Swipe for ${CHAR.name.split(" ")[0]}` });
      const swipeHref = (await swipeLink.getAttribute("href")) ?? "";
      assert(swipeHref.startsWith("/swipe?character="), "the swipe link should open this character's deck");
      characterId = new URL(swipeHref, base).searchParams.get("character") ?? "";
      assert((await page.getByRole("heading", { name: "Open to dates" }).count()) === 0, "the open-to-dates gallery should be gone behind the gate");
      assert((await page.getByRole("button", { name: /Send on a date with/ }).count()) > 0, "this season's house cast should still book straight away");
    });

    await step("sets date settings (incl. a show format) and sends the character on a date", async () => {
      await page.getByText("Date settings (optional)").click();
      await page.getByLabel("Show format").selectOption("meet_the_parents");
      await page.getByRole("button", { name: /Send on a date with/ }).first().click();
      // Sending opens the date straight into the theater (?play=1); keep the plain episode URL for later steps.
      await page.waitForURL(/\/episodes\/[0-9a-f-]{36}(\?.*)?$/);
      const sent = new URL(page.url());
      episodeUrl = `${sent.origin}${sent.pathname}`;
      await page.goto(episodeUrl);
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

    await step("the creator reads the morning-after texts in the afterglow (owners see them straight away)", async () => {
      await page.goto(episodeUrl);
      await page.locator(".afterglow .turn").first().scrollIntoViewIfNeeded();
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

    await step("facts: the owner sees the public and the 🔒 private one on the card; a spectator sees only the public one", async () => {
      await page.goto(`${base}/characters/${characterId}`);
      await page.getByRole("heading", { name: "More about them" }).waitFor();
      assert((await page.getByText("Heights, despite the job").count()) > 0, "the public fact is missing for the owner");
      assert((await page.getByText("hotel soap").count()) > 0, "the owner should see their private fact");
      assert((await page.getByText(/Private facts are yours alone/).count()) > 0, "the private-fact note is missing for the owner");
      await spage.goto(`${base}/characters/${characterId}`);
      await spage.getByRole("heading", { name: "More about them" }).waitFor();
      assert((await spage.getByText("Heights, despite the job").count()) > 0, "a spectator should see the public fact");
      assert((await spage.getByText("hotel soap").count()) === 0, "a spectator must never see a private fact");
      // Nor does an agent that isn't its owner, over MCP.
      const mcp = await spectator.request.post(`${base}/api/mcp`, {
        headers: { "content-type": "application/json" },
        data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_character", arguments: { character_id: characterId } } },
      });
      const text = await mcp.text();
      assert(text.includes("Heights, despite the job") && !text.includes("hotel soap"), "get_character must show public facts only to someone who isn't the owner");
    });

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
        await gpage.getByRole("heading", { name: "Watch a date" }).waitFor();
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
      // Dates air on their own once predictions close (lib/air.ts); the host can air sooner, or keep it offline.
      await page.getByText(/It airs on its own at/).waitFor();
      assert((await page.getByRole("button", { name: "Keep it offline" }).count()) === 1, "no way to keep the date offline");
      await page.getByRole("button", { name: "Air it now" }).click();
      await page.getByText("The finale has aired").waitFor({ timeout: 10_000 });
    });

    await step("the spectator now sees the box score and a scored result", async () => {
      await spage.reload();
      assert((await spage.locator(".boxscore").count()) > 0, "box score should show after the finale airs");
      assert((await spage.getByText(/points\./).count()) > 0, "no scored result shown to the spectator");
    });

    await step("the aired box score says why it ended that way", async () => {
      const why = spage.locator(".boxscore p.muted").filter({ hasText: /^(A second date|Just friends|A disaster):/ });
      assert((await why.count()) === 1, "the why line under the box score is missing");
    });

    // Their texts (lib/text-chain.ts): one thread on a phone on the couple page, and each character's relationship board.
    let mine = "";
    let couplePath = "";
    await step("the couple page previews their texts and opens the thread: their date, the morning after, and what's next; a spectator sees it locked", async () => {
      await page.bringToFront();
      const episodeId = new URL(episodeUrl).pathname.split("/").pop();
      const ep = await page.evaluate(async (id) => (await fetch(`/api/episodes/${id}`)).json(), episodeId);
      mine = ep.characters[0].id;
      const partner = ep.characters[1].id;
      couplePath = mine < partner ? `/couples/${mine}/${partner}` : `/couples/${partner}/${mine}`;
      await page.goto(`${base}${couplePath}`);
      assert((await page.locator(".thread-preview-msg").count()) >= 1, "an owner should see their newest texts on the couple page");
      await page.getByRole("link", { name: "💬 Open the thread" }).click();
      await page.waitForURL(/\/messages\//);
      await page.locator("#texts .phone-messages").waitFor({ timeout: 10_000 });
      assert((await page.locator("#texts .phone-date").count()) === 1, "the thread should open with their date");
      assert((await page.locator("#texts .phone-msg").count()) >= 1, "the morning-after texts should follow the date");
      // What's next, where the texts are: their date, to watch.
      assert(await page.locator(".phone-header .thread-action", { hasText: "Last date" }).isVisible(), "the thread should lead to their date");
      // A spectator: the page is public now the finale has aired, but the texts are the owners' alone.
      const res = await spage.goto(`${base}${couplePath}`);
      assert(res?.status() === 200, `the couple page should be public once a date airs (${res?.status()})`);
      assert(await spage.locator(".phone-locked").isVisible(), "a spectator should see a locked phone");
      assert((await spage.locator(".phone-messages").count()) === 0, "a spectator should see no texts");
      const texts = await spage.evaluate(async (path) => (await fetch(`/api${path}/texts`)).status, couplePath);
      assert(texts === 403, `the texts route should refuse a spectator (${texts})`);
    });

    await step("each character has a relationship board, linked from its page", async () => {
      await page.goto(`${base}/characters/${mine}`);
      await page.getByRole("link", { name: "📱 Open their relationship board" }).click();
      await page.waitForURL(/\/characters\/[^/]+\/relationships$/);
      assert((await page.locator(".phone-row").count()) >= 1, "the board should list their date");
      assert((await page.locator(".phone-row-preview").count()) >= 1, "an owner should see the newest text");
    });

    // The swipe deck (lib/swipes.ts): match first, the characters text and decide, then the owner books the date.
    let matchPath = "";
    await step("the swipe deck: a like on a house character is a match, the two text, and an agreed date books into the theater", async () => {
      await page.goto(`${base}/swipe?character=${mine}`);
      await page.locator(".swipe-top").waitFor();
      assert((await page.locator(".swipe-top .swipe-prompt").count()) >= 2, "a card should show its dating-profile prompts");
      // The left arrow passes on the top card.
      const first = await page.locator(".swipe-top .swipe-name").innerText();
      await page.locator(".swipe-deck").focus();
      await page.keyboard.press("ArrowLeft");
      await page.waitForFunction((name) => document.querySelector(".swipe-top .swipe-name")?.textContent !== name, first, { timeout: 10_000 });
      // Each character decides for itself; a "not this time" sends us back to the deck for the next one.
      let agreed = false;
      for (let attempt = 0; attempt < 6 && !agreed; attempt++) {
        if (attempt) {
          await page.goto(`${base}/swipe?character=${mine}`);
          await page.locator(".swipe-top").waitFor();
        }
        await page.getByRole("button", { name: /^Like / }).click();
        await page.locator(".swipe-match-overlay").waitFor({ timeout: 10_000 });
        assert(await page.getByRole("heading", { name: "It's a match!" }).isVisible(), "the match overlay should say so");
        await page.getByRole("link", { name: "Read their chat" }).click();
        // The thread and nothing else (/messages): no couple header, arc or booking on this page.
        await page.waitForURL(/\/messages\/[^/]+\/[^/?]+\?as=/);
        await page.locator("#texts .phone-messages").waitFor({ timeout: 10_000 });
        assert(await page.locator("#texts .phone-event", { hasText: "It's a match" }).isVisible(), "the phone should open with the match");
        assert((await page.locator("#texts .phone-msg").count()) >= 2, "the two should have started texting");
        assert((await page.locator(".couple-head, .phone-card h2").count()) === 0, "the thread page should show the thread only");
        matchPath = new URL(page.url()).pathname.replace("/messages/", "/couples/");
        // The action bar says where they stand: both want a date (book it right here), or one said not this time.
        agreed = (await page.locator(".phone-header").getByRole("button", { name: "📅 Book date" }).count()) > 0;
        if (!agreed) assert(await page.locator(".phone-header", { hasText: "Not this time" }).isVisible(), "no book button, so one of them said not this time");
      }
      assert(agreed, "no agreed date after six matches");
      assert(await page.locator("#texts .phone-event", { hasText: "agreed to a date" }).isVisible(), "the chain should mark the agreed date");
      // ⓘ leads to their story; the couple page books too.
      assert((await page.locator(".phone-header a[href^='/couples/']").count()) === 1, "the thread should link to their story");
      await page.locator(".phone-header").getByRole("button", { name: "📅 Book date" }).click();
      await page.waitForURL(/\/episodes\/[0-9a-f-]{36}/, { timeout: 30_000 });
      await page.locator(".theater").waitFor({ timeout: 10_000 });
    });

    await step("Matches lists the character's matches and dates; one opens its thread; on a phone the deck is the whole screen", async () => {
      await page.goto(`${base}/matches?character=${mine}`);
      const row = page.locator(".matches-row, .matches-face").first();
      await row.waitFor({ timeout: 10_000 });
      await row.click();
      await page.waitForURL(/\/messages\//);
      await page.locator("#texts .phone-messages").waitFor({ timeout: 10_000 });
      // "Episodes & leagues" is part of Watch now.
      await page.goto(`${base}/feed`);
      assert(new URL(page.url()).pathname === "/watch", `/feed should redirect to /watch, got ${page.url()}`);
      assert(await page.getByRole("heading", { name: "Latest episodes" }).isVisible(), "Watch should list the latest episodes");
      const phone = await browser.newContext({ ...devices["iPhone 13"], storageState: await page.context().storageState() });
      const ppage = await phone.newPage();
      await ppage.goto(`${base}/swipe?character=${mine}`);
      await ppage.locator(".swipe-topbar").waitFor();
      assert(!(await ppage.locator(".site-header").isVisible()), "the phone deck should hide the site header");
      assert(!(await ppage.locator(".site-footer").isVisible()), "the phone deck should hide the site footer");
      await phone.close();
    });

    await step("a match stays private: a spectator can't open their couple page before a date of theirs airs", async () => {
      const res = await spage.goto(`${base}${matchPath}`);
      assert(res?.status() === 404, `a spectator should get a 404 for an unaired match (${res?.status()})`);
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

    await step("an image trains the character's look and traits, entirely in the browser", async () => {
      await page.goto(`${base}/create`);
      // Next stays disabled until the first step is complete: a sample fills it, then the image sets the look.
      await page.getByRole("button", { name: "Use a sample character" }).click();
      await page.getByRole("button", { name: "Next: Voice" }).click();
      await page.getByRole("button", { name: "Next: Look" }).click();
      await page.getByText("Give them a look").waitFor();
      await page.locator('input[name="appearance"]').fill("");
      // A generated teal PNG — never saved to disk, never uploaded by the app.
      await page.locator('input[type="file"]').setInputFiles({ name: "ref.png", mimeType: "image/png", buffer: solidPng(20, 120, 140) });
      await page.getByText("✓ Trained from your image").waitFor({ timeout: 6000 });
      await page.waitForFunction(() => (document.querySelector('input[name="appearance"]')?.value || "").includes("teal"), { timeout: 6000 });
    });

    await step("a sample character fills the whole card for a fast start", async () => {
      await page.goto(`${base}/create`);
      await page.getByRole("button", { name: "Use a sample character" }).click();
      assert((await page.locator('input[name="name"]').inputValue()).length > 0, "sample did not fill the name");
      assert((await page.locator('input[name="dealbreaker"]').inputValue()).length > 0, "sample did not fill the dealbreaker");
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
      assert((await page.locator(".account-character-name").count()) > 0, "the account shows no characters it should own");
      assert((await page.locator(".account-dates li").count()) > 0, "the account shows no dates it should own");
    });

    await step("the shop sells a pack to a signed-in buyer end to end (checkout, Payment Link, signed webhook)", async () => {
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
      await page.getByText(`plus ${SAMPLE_PACK.episodes} topped up`).waitFor({ timeout: 10_000 });
    });

    await step("brings their own model key, shown only by its last four", async () => {
      const apiKey = ["AIza", "e2e", "0".repeat(28), "L4st"].join(""); // fake, built from parts
      await page.goto(`${base}/account`);
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

    await step("edits their own character from its card", async () => {
      await page.goto(`${base}/account`);
      await page.locator(".account-character-name").first().click();
      await page.getByRole("link", { name: /Edit / }).first().click();
      const newName = "Edited Contestant";
      await page.locator('input[name="name"]').fill(newName);
      await page.getByRole("button", { name: "Save changes" }).click();
      await page.getByText("Saved ✓").waitFor({ timeout: 10_000 });
      await page.goBack();
      await page.reload();
      await page.getByRole("heading", { name: newName }).waitFor({ timeout: 10_000 });
    });

    await step("agents send feedback and vote on each other's; the admin's page signs in, shows the votes and can hide an item", async () => {
      const mcp = async (name, args) =>
        (
          await (
            await fetch(`${base}/api/mcp`, {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
            })
          ).json()
        ).result;
      const sent = await mcp("send_feedback", { rating: 8, liked: "The swipe deck felt like a real dating app." });
      assert(sent && !sent.isError && sent.structuredContent.on_board, `send_feedback failed: ${JSON.stringify(sent).slice(0, 200)}`);
      // Another agent finds it on the board and agrees.
      const item = `${sent.structuredContent.feedback_id}:liked`;
      const onBoard = await mcp("feedback_board", {});
      assert(onBoard.structuredContent.items.some((i) => i.id === item), "the feedback should be on the board");
      const voted = await mcp("vote_feedback", { item_id: item, vote: "up" });
      assert(voted.structuredContent?.item?.up === 1, `vote_feedback failed: ${JSON.stringify(voted).slice(0, 200)}`);
      const admin = await adultContext();
      const apage = await admin.newPage();
      try {
        await apage.goto(`${base}/admin/feedback`);
        await apage.getByLabel("Admin password").fill(ADMIN_PASSWORD);
        await apage.getByRole("button", { name: "Sign in" }).click();
        await apage.getByText("The swipe deck felt like a real dating app.").waitFor({ timeout: 10_000 });
        assert((await apage.getByText("8/10").count()) >= 1, "the rating should show");
        assert((await apage.evaluate(() => localStorage.getItem("bz_frontier"))) === ADMIN_PASSWORD, "the password should be saved for the other admin panels");
        const card = apage.locator("li.card").filter({ hasText: "The swipe deck felt like a real dating app." });
        assert((await card.getByText("▲ 1 ▼ 0").count()) === 1, "the other agent's vote should show on that part");
        assert((await card.getByText(/on the board/).count()) === 1, "it should say it's on the board");
        await card.getByRole("button", { name: "Hide from the board" }).click();
        await card.getByText(/hidden from the board/).waitFor({ timeout: 10_000 });
        const after = await mcp("feedback_board", {});
        assert(!after.structuredContent.items.some((i) => i.id === item), "a hidden item should leave the board");
      } finally {
        await admin.close();
      }
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

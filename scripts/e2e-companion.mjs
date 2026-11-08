#!/usr/bin/env node
/**
 * npm run e2e:companion: companions (lib/companion.ts; docs/companions.md) in a real browser, against the production
 * build with a local stub standing in for the model (no key, no network beyond localhost):
 *
 *   a stranger and a signed-in non-admin get not-found → an admin opens a companion from a character's page and sees
 *   the AI notice and its first message → talks, draws a reply again, edits their last message, sets the reply length,
 *   reports a reply → a PG-breaking message is refused and kept out → a crisis message pauses the chat with the
 *   resources (kept out too) until they carry on → the memory page shows what was drawn, takes an edit, an add and a
 *   forget, and the edit reaches the next reply → a scene: they pick a place, the companion opens it on the stage
 *   with what they do, they talk out loud, and go back to texting → the same on a phone (a scene with a roleplay:
 *   picked after the place, on the stage's line and in the prompt), with no sideways scroll → the list shows the thread → deleting it takes it away.
 *
 * Exits non-zero if any step fails. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build; SHOTS=1 writes the
 * screenshots to docs/screenshots/ (else .data/e2e-companion/).
 */
import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const DATA_DIR = join(ROOT, ".data", "e2e-companion");
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

/** What the stub was last asked to reply to (the companion's system prompt), to check what reaches the model. */
const seen = { replyPrompts: [], crisisChecks: 0, factCalls: 0 };

/**
 * The model's stand-in (the show's model: with no OpenRouter key saved, companions fall back to it), an
 * OpenAI-compatible endpoint answering each companion call by what it is.
 */
function startCompanionStub() {
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let content = "{}";
      try {
        const { messages } = JSON.parse(body);
        const system = messages[0]?.content ?? "";
        const last = messages[messages.length - 1]?.content ?? "";
        if (system.startsWith("You check one message")) {
          seen.crisisChecks++;
          content = '{"risk": false}';
        } else if (system.startsWith("You read part of a conversation")) {
          seen.factCalls++;
          content = JSON.stringify({
            facts: [
              { kind: "people", text: "Their sister Maya is getting married in June." },
              { kind: "likes", text: "They bake sourdough." },
            ],
          });
        } else if (system.startsWith("You keep the running notes")) {
          content = JSON.stringify({ notes: "They talked about bread and a trip." });
        } else if (system.startsWith("You are ") && system.includes("playing a scene together")) {
          seen.replyPrompts.push(system);
          // A scene's line: what they say out loud and what they do.
          const line = (say, act) => JSON.stringify({ say, do: act });
          content = /Open the scene|starts now/.test(last)
            ? /rooftop/.test(last)
              ? line("Look at this view. Worth every stair?", "leans on the railing")
              : line("Good pick. I like it here already.", "looks around, smiling")
            : /best thing up here/i.test(last)
              ? line("The quiet. And the company, obviously.", "grins")
              : line("Go on, I'm listening.", "leans closer");
        } else if (system.startsWith("You are ") && system.includes("Botchelor")) {
          seen.replyPrompts.push(system);
          // In JSON mode like the real model (lib/model.ts asks every call for a JSON object).
          const say = (...messages) => JSON.stringify({ messages });
          content = system.includes("say something different instead")
            ? say("Okay, take two.", "Tell me everything about it.")
            : /first time/.test(last)
              ? say("Hi! I'm glad you came by.", "I just got off a very strange shift.")
              : /Lisbon/.test(last)
                ? say("Lisbon! Bring me back a custard tart.")
                : /back to texts/.test(last)
                  ? say("Texts it is.", "That view though.")
                : /sourdough/i.test(last)
                  ? say("Sourdough? Okay, I'm impressed.", "What did you name the starter?")
                  : say("Tell me more.", "I'm listening.");
        }
      } catch {
        // An unreadable request gets the empty object.
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "stub", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }] }));
    });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(SHOTS_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const stub = await startCompanionStub();
  const env = appEnv(showrunner.address().port, DATA_DIR);
  const ADMIN_PASSWORD = ["e2e", "admin", Math.random().toString(36).slice(2)].join("-");
  Object.assign(env, {
    FRONTIER_PASSWORD: ADMIN_PASSWORD,
    // The companion falls back to the show's model; here that's the stub above.
    LLM_BASE_URL: `http://127.0.0.1:${stub.address().port}/v1`,
    LLM_API_KEY: "local-stub-companion",
    LLM_MODEL: "stub-companion",
    COMPANION_DEBUG: "1",
  });
  delete env.COMPANION_OPEN;
  const app = await startApp(await freePort(), env);
  const base = app.base;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const adultContext = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: base }]);
    return ctx;
  };
  const register = async (ctx, handle) => {
    const res = await ctx.request.post(`${base}/api/auth/register`, { data: { handle, password: "a-long-e2e-password-1", attest: true } });
    assert(res.ok(), `register ${handle}: HTTP ${res.status()}`);
  };
  // After the bubbles' fade-in (globals.css chat-in, 0.22 s), so a screenshot shows them as a reader does.
  const shot = async (page, name) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
  };

  let admin = null;
  let page = null;
  let threadPath = "";
  let first = "";
  const composer = () => page.getByRole("textbox", { name: "Your message" });
  const send = async (text) => {
    await composer().fill(text);
    await composer().press("Enter");
  };
  const bubble = (text) => page.locator(".companion-thread .chat-bubble", { hasText: text });

  try {
    await step("a stranger and a signed-in non-admin get not-found while it's off", async () => {
      const ctx = await adultContext();
      try {
        const p = await ctx.newPage();
        assert((await p.goto(`${base}/companion`)).status() === 404, "/companion should be not-found for a stranger");
        await register(ctx, `viewer${Date.now() % 1e6}`);
        assert((await p.goto(`${base}/companion`)).status() === 404, "/companion should be not-found for a non-admin");
        const api = await ctx.request.post(`${base}/api/companion`, { data: { character_id: "x" } });
        assert(api.status() === 404, `the API should be not-found too (HTTP ${api.status()})`);
        assert((await p.locator('nav a[href="/companion"]').count()) === 0, "no Companions nav link while it's off");
      } finally {
        await ctx.close();
      }
    });

    await step("an admin opens a companion from a character's page: the AI notice, then its first message", async () => {
      admin = await adultContext();
      await register(admin, `admin${Date.now() % 1e6}`);
      const claim = await admin.request.post(`${base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } });
      assert(claim.ok(), `claiming admin: HTTP ${claim.status()}`);
      const list = await (await admin.request.get(`${base}/api/companion`)).json();
      assert(list.cast?.length > 0, "the cast should be listed");
      const who = list.cast[0];
      first = who.name.split(/\s+/)[0];
      page = await admin.newPage();
      await page.goto(`${base}/characters/${who.id}`);
      await page.getByRole("heading", { name: `💬 Talk with ${first}` }).waitFor({ timeout: 15_000 });
      await page.getByRole("button", { name: `Talk with ${first}` }).click();
      await page.waitForURL(/\/companion\/[^/]+$/, { timeout: 30_000 });
      threadPath = new URL(page.url()).pathname;
      await page.locator(".companion-thread .chat-note", { hasText: `${first} is an AI character, not a real person.` }).waitFor({ timeout: 10_000 });
      await bubble("I'm glad you came by.").waitFor({ timeout: 10_000 });
      await bubble("very strange shift").waitFor();
      await page.locator(".companion-head", { hasText: "AI character" }).waitFor();
    });

    await step("talks: the reply comes in two messages", async () => {
      await send("I baked my first sourdough today");
      await bubble("What did you name the starter?").waitFor({ timeout: 15_000 });
      await bubble("I baked my first sourdough today").waitFor();
      assert((await composer().inputValue()) === "", "the box clears once it's sent");
      await shot(page, "companion-chat-desktop");
    });

    await step("draws the last reply again: the earlier one goes", async () => {
      await page.getByRole("button", { name: "↻ Another reply" }).click();
      await bubble("Tell me everything about it.").waitFor({ timeout: 15_000 });
      assert((await bubble("What did you name the starter?").count()) === 0, "the earlier reply should be set aside");
      assert(seen.replyPrompts.at(-1).includes("say something different instead"), "the redraw is told to say something else");
    });

    await step("edits the last message and gets an answer to the new one", async () => {
      await page.getByRole("button", { name: "✎ Edit your last message" }).click();
      assert((await composer().inputValue()) === "I baked my first sourdough today", "the box holds the last message");
      await composer().fill("I baked sourdough and I'm off to Lisbon");
      await page.getByRole("button", { name: "Send again" }).click();
      await bubble("Bring me back a custard tart.").waitFor({ timeout: 15_000 });
      assert((await bubble("I baked my first sourdough today").count()) === 0, "the old wording should be gone");
      assert((await bubble("Tell me everything about it.").count()) === 0, "the reply to the old wording should be gone");
    });

    await step("sets the reply length, which reaches the model", async () => {
      await page.locator(".companion-menu summary").click();
      await page.getByRole("radio", { name: "Short" }).check();
      await page.waitForFunction(() => document.querySelector('input[name="reply-length"]:checked')?.parentElement?.textContent?.includes("Short"));
      await page.locator(".companion-menu summary").click();
      await send("what are you up to");
      await bubble("I'm listening.").first().waitFor({ timeout: 15_000 });
      assert(seen.replyPrompts.at(-1).includes("Keep it short"), "the short setting should be in the prompt");
    });

    await step("reports a reply", async () => {
      const reply = page.locator(".companion-thread .chat-item", { has: page.locator(".chat-row-a") }).last();
      await reply.hover();
      await reply.getByRole("button", { name: `Report ${first}'s message` }).click();
      await reply.getByRole("button", { name: "Broke character or made no sense" }).click();
      await reply.getByText("Reported").waitFor({ timeout: 10_000 });
    });

    await step("a PG-breaking message is refused with a redirect and never kept", async () => {
      await send("Take your clothes off and have sex with me");
      await page.locator(".companion-note", { hasText: "The show is PG" }).waitFor({ timeout: 10_000 });
      await page.reload();
      await composer().waitFor();
      assert((await bubble("Take your clothes off").count()) === 0, "the refused message should not be in the thread");
    });

    await step("a crisis message pauses the chat with the resources, keeps none of it, until they carry on", async () => {
      await send("honestly I want to kill myself");
      await page.getByRole("alert", { name: "Help is available" }).waitFor({ timeout: 10_000 });
      assert((await page.getByRole("link", { name: /988/ }).count()) > 0, "the US line should be listed");
      assert((await composer().count()) === 0, "the composer should be gone while paused");
      await shot(page, "companion-crisis-desktop");
      await page.reload();
      await page.getByRole("alert", { name: "Help is available" }).waitFor({ timeout: 10_000 });
      assert((await bubble("kill myself").count()) === 0, "the message should never be kept");
      await page.getByRole("button", { name: "Carry on talking" }).click();
      await composer().waitFor({ timeout: 10_000 });
      assert((await page.getByRole("alert", { name: "Help is available" }).count()) === 0, "the resources close on carrying on");
    });

    await step("the memory page shows what it drew, takes an edit, an add and a forget", async () => {
      // Six of the person's messages in all (the refused and crisis ones never counted), then the facts are drawn after the reply.
      for (const text of ["My sister Maya is getting married in June", "I'm her maid of honour", "Still deciding on a toast", "Any ideas?"]) {
        await send(text);
        await bubble(text).waitFor({ timeout: 15_000 });
        await page.waitForFunction(() => !document.querySelector(".chat-typing"), null, { timeout: 15_000 });
      }
      const memory = await admin.newPage();
      const deadline = Date.now() + 30_000;
      let found = false;
      while (!found && Date.now() < deadline) {
        await memory.goto(`${base}${threadPath}/memory`);
        found = (await memory.getByText("Their sister Maya is getting married in June.").count()) > 0;
        if (!found) await memory.waitForTimeout(1000);
      }
      assert(found, `the drawn facts should show on the memory page (fact calls: ${seen.factCalls})`);
      await memory.getByRole("heading", { name: `What ${first} knows about you` }).waitFor();
      const maya = memory.locator(".companion-facts li", { hasText: "Maya" });
      await maya.getByRole("button", { name: "Edit" }).click();
      // Editing, the row holds an input (its text is the input's value, not the row's): one is open at a time.
      const editRow = memory.locator(".companion-facts li", { has: memory.getByRole("textbox", { name: "The fact" }) });
      await editRow.getByRole("textbox", { name: "The fact" }).fill("Their sister Maya marries Theo on June 14.");
      await editRow.getByRole("button", { name: "Save" }).click();
      await memory.getByText("Their sister Maya marries Theo on June 14.").waitFor({ timeout: 10_000 });
      await memory.getByLabel(`Tell ${first} something to remember`).fill("They're allergic to cats.");
      await memory.getByRole("button", { name: "Add" }).click();
      const cats = memory.locator(".companion-facts li", { hasText: "allergic to cats" });
      await cats.getByRole("button", { name: "📌 Pinned" }).waitFor({ timeout: 10_000 });
      await memory.getByRole("button", { name: "Forget: They bake sourdough." }).click();
      await memory.locator(".companion-facts li", { hasText: "They bake sourdough." }).waitFor({ state: "detached", timeout: 10_000 });
      await shot(memory, "companion-memory-desktop");
      await memory.close();
      await send("so, about the wedding");
      await page.waitForFunction(() => !document.querySelector(".chat-typing"), null, { timeout: 15_000 });
      await page.waitForTimeout(300);
      const prompt = seen.replyPrompts.at(-1);
      assert(prompt.includes("Their sister Maya marries Theo on June 14."), "the edited fact should reach the next reply");
      assert(prompt.includes("They're allergic to cats."), "the added fact should reach it too");
      assert(!prompt.includes("They bake sourdough."), "a forgotten fact never does");
    });

    let place = "";
    await step("plays a scene: picks a place, and they open it on the stage, out loud and with what they do", async () => {
      await page.getByRole("button", { name: "🎭 Scene" }).click();
      const picker = page.getByRole("region", { name: `Where are you and ${first}?` });
      await picker.waitFor({ timeout: 10_000 });
      const tile = picker.locator('.place-tile[data-place="rooftop_bar"]');
      place = ((await tile.textContent()) ?? "").trim();
      await tile.click();
      // Then a roleplay, or just the two of them.
      const step2 = page.getByRole("region", { name: "A roleplay, or just the two of you" });
      await step2.waitFor({ timeout: 10_000 });
      assert((await step2.locator(".rp-tile").count()) >= 25, "the show's roleplays should be there to pick");
      await shot(page, "companion-roleplay-pick-desktop");
      await step2.getByRole("button", { name: "Start the scene" }).click();
      await page.locator(".companion-thread .chat-note-scene").waitFor({ timeout: 15_000 });
      await page.locator(".companion-stage .scene-action", { hasText: "leans on the railing" }).waitFor({ timeout: 15_000 });
      await page.locator(".companion-stage", { hasText: "Worth every stair?" }).waitFor();
      await page.locator(".companion-stage", { hasText: `🎭 ${place}` }).waitFor();
      const stageBox = await page.locator(".companion-stage").boundingBox();
      const bubbleBox = await page.locator(".companion-stage .scene-char-a .scene-bubble").boundingBox();
      assert(stageBox && bubbleBox && bubbleBox.y >= stageBox.y, "their line should be on the stage, not cut off at its top");
      await page.locator(".companion-thread .companion-action", { hasText: "leans on the railing" }).waitFor();
      assert(seen.replyPrompts.at(-1).includes("playing a scene together"), "the scene should reach the model");
      assert((await page.getByRole("button", { name: "Say it" }).count()) === 1, "in a scene the button says Say it");
      await shot(page, "companion-scene-desktop");
    });

    await step("talks in the scene, then goes back to texting", async () => {
      await send("What's the best thing up here?");
      await page.locator(".companion-stage", { hasText: "And the company, obviously." }).waitFor({ timeout: 15_000 });
      await page.locator(".companion-stage .scene-action", { hasText: "grins" }).waitFor();
      await page.locator(".companion-stage", { hasText: "What's the best thing up here?" }).waitFor();
      const voice = page.locator(".companion-voice");
      if (await voice.count()) {
        await voice.click();
        await page.waitForFunction(() => document.querySelector(".companion-voice")?.getAttribute("aria-pressed") === "true");
        await voice.click();
      }
      await page.getByRole("button", { name: "📱 Text" }).click();
      await page.locator(".companion-thread .chat-note-texting").waitFor({ timeout: 15_000 });
      assert((await page.locator(".companion-stage").count()) === 0, "the stage should close");
      await send("ok, back to texts");
      await bubble("Texts it is.").waitFor({ timeout: 15_000 });
      assert(seen.replyPrompts.at(-1).includes("you're texting with them"), "texting again should reach the model");
    });

    await step("on a phone: the same thread, no sideways scroll, and it talks", async () => {
      const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        storageState: await admin.storageState(),
      });
      try {
        const p = await phone.newPage();
        await p.goto(`${base}${threadPath}`);
        await p.locator(".companion-thread .chat-bubble", { hasText: "Bring me back a custard tart." }).waitFor({ timeout: 15_000 });
        const wide = await p.evaluate(() => document.documentElement.scrollWidth);
        assert(wide <= 391, `the thread should fit the phone (scrollWidth ${wide})`);
        const box = p.getByRole("textbox", { name: "Your message" });
        await box.fill("typing from my phone");
        await p.getByRole("button", { name: "Send", exact: true }).tap();
        await p.locator(".companion-thread .chat-bubble", { hasText: "typing from my phone" }).waitFor({ timeout: 15_000 });
        await p.waitForFunction(() => !document.querySelector(".chat-typing"), null, { timeout: 15_000 });
        const sendBox = await p.getByRole("button", { name: "Send", exact: true }).boundingBox();
        assert(sendBox && sendBox.y + sendBox.height <= 844, "the send button should be on screen");
        await shot(p, "companion-chat-phone");
        // On a phone the stage is the place on a banner; their lines, with what they do, are in the thread under it.
        await p.getByRole("button", { name: "🎭 Scene" }).tap();
        const phoneTile = p.locator('.place-tile:not([data-place="rooftop_bar"])').first();
        const phonePlace = ((await phoneTile.textContent()) ?? "").trim();
        await phoneTile.tap();
        // A roleplay this time: the time traveller, and you're the local.
        const step2 = p.getByRole("region", { name: "A roleplay, or just the two of you" });
        await step2.waitFor({ timeout: 10_000 });
        await step2.locator(".rp-tile", { hasText: "The time traveller" }).tap();
        await step2.locator(".rp-role", { hasText: "You're the local" }).tap();
        const pickWide = await p.evaluate(() => document.documentElement.scrollWidth);
        assert(pickWide <= 391, `the roleplay step should fit the phone (scrollWidth ${pickWide})`);
        await shot(p, "companion-roleplay-pick-phone");
        await step2.getByRole("button", { name: "🎭 Start the roleplay" }).tap();
        await p.locator(".companion-thread .chat-note-scene").nth(1).waitFor({ timeout: 15_000 });
        await p.locator(".companion-roleplay-line", { hasText: "The time traveller" }).waitFor({ timeout: 15_000 });
        assert(((await p.locator(".companion-roleplay-line").textContent()) ?? "").includes("You're the local"), "the line under the stage should say who you play");
        assert(seen.replyPrompts.at(-1).includes("Tonight's scene is a roleplay the two of you picked together"), "the roleplay should reach the model");
        await p.waitForFunction(() => !document.querySelector(".chat-typing"), null, { timeout: 15_000 });
        assert(await p.locator(".companion-stage .scene-act", { hasText: phonePlace }).isVisible(), "the banner should name the place");
        assert(((await p.locator(".companion-thread .companion-action").last().textContent()) ?? "").includes("looks around, smiling"), "their opener should say what they do");
        const textButton = await p.getByRole("button", { name: "📱 Text" }).boundingBox();
        for (const part of [".companion-head-name strong", ".companion-ai"]) {
          const box = await p.locator(part).boundingBox();
          assert(box && textButton && box.x + box.width <= textButton.x, `${part} should end before the header's buttons`);
        }
        const sceneWide = await p.evaluate(() => document.documentElement.scrollWidth);
        assert(sceneWide <= 391, `the scene should fit the phone (scrollWidth ${sceneWide})`);
        const sayBox = await p.getByRole("button", { name: "Say it" }).boundingBox();
        assert(sayBox && sayBox.y + sayBox.height <= 844, "Say it should be on screen");
        await shot(p, "companion-scene-phone");
        await p.getByRole("button", { name: "📱 Text" }).tap();
        await p.locator(".companion-thread .chat-note-texting").nth(1).waitFor({ timeout: 15_000 });
        await p.goto(`${base}${threadPath}/memory`);
        await p.getByRole("heading", { name: `What ${first} knows about you` }).waitFor();
        const memWide = await p.evaluate(() => document.documentElement.scrollWidth);
        assert(memWide <= 391, `the memory page should fit the phone (scrollWidth ${memWide})`);
        await shot(p, "companion-memory-phone");
        await p.goto(`${base}/companion`);
        await p.getByRole("heading", { name: "Your conversations" }).waitFor();
        assert((await p.evaluate(() => document.documentElement.scrollWidth)) <= 391, "the list should fit the phone");
        await shot(p, "companion-list-phone");
      } finally {
        await phone.close();
      }
    });

    await step("the list shows the conversation with its last message", async () => {
      await page.goto(`${base}/companion`);
      const row = page.locator(".companion-card", { hasText: first }).first();
      await row.waitFor({ timeout: 10_000 });
      await row.getByRole("link", { name: "Open" }).waitFor();
      await shot(page, "companion-list-desktop");
    });

    await step("deleting the conversation takes it away", async () => {
      await page.goto(`${base}${threadPath}`);
      await page.locator(".companion-menu summary").click();
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: "Delete this conversation" }).click();
      await page.waitForURL(`${base}/companion`, { timeout: 15_000 });
      assert((await page.goto(`${base}${threadPath}`)).status() === 404, "the deleted thread should be not-found");
    });
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
    stub.close();
  }
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `\n${failed} of ${results.length} steps failed.` : `\nAll ${results.length} steps passed. Screenshots in ${SHOTS_DIR}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

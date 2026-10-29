#!/usr/bin/env node
/**
 * npm run e2e:after-dark-scene: setting the scene and a roleplay, the night's first 10 lines, and whether the picture's
 * prompt matches them, in a real browser (David, 2026-10-25: "create some playwright tests just for setting a scene and a
 * role play and the first 10 lines and the image generated context matches"). Against the production build with
 * ADULT_MODE=1, a throwaway local database, and a local stub for After Dark's model that records every prompt it's sent.
 * No key and no network beyond localhost; nothing is drawn (the picture's prompt comes from the admin preview, which
 * draws nothing).
 *
 * The case is Lexi × Juniper's on prod: Lexi (she/her, After Dark outfit: lingerie) and Juniper, a house character, sent
 * to "An awkward double date" as a Blind date. The stub always claims they're in a downtown bar and writes a long action,
 * the two things that went wrong.
 *
 *   the night waits on its start card → Scene & roleplay: the double date, Blind date → Start, then Next to 10 lines →
 *   the writer was told the situation (the smug couple), the roleplay, and that they're there → they're still at the
 *   double date (not the bar) → the picture's prompt: the smug couple, dressed to go out (never lingerie), no "his" for
 *   two women, what they just did whole → screenshots.
 *
 * Exits non-zero if any step fails. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build.
 */
import { createServer } from "node:http";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright-core";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "e2e-after-dark-scene");
const DB_DIR = join(DATA_DIR, "pglite");
const LEXI = "lexi-e2e";
const JUNIPER = "house-juniper";
const LOOKS = { gender: "woman", ethnicity: "caucasian", hair_style: "straight", hair_color: "blonde", eyes: "blue", body: "curvy", outfit: "casual", after_dark: { outfit: "lingerie" } };

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

/**
 * Six PG lines a step, three different steps (a repeat is dropped, as it should be), the first with a long action; it
 * always claims a downtown bar, whatever it was told. No numbers that could read as an age ("make it fifteen" is held).
 */
const STEPS = [
  [
    ["Lexi pushes the heavy restaurant door open, letting in a slice of cold night air and the hum of traffic from the street outside", "So. They've ordered for the table already."],
    ["Juniper slides into the booth across from the other couple, coat still on", "Of course they have. They finish each other's menus."],
    ["Lexi leans in so only Juniper can hear", "Give it a while and I'm faking a phone call."],
    ["Juniper hides a smile behind her water glass", "Sooner than that. I'll back you up."],
    ["Lexi watches the couple trade a forkful of dessert", "Is that what we're supposed to be doing?"],
    ["Juniper slides the dessert menu over to Lexi", "We can do better than shared tiramisu."],
  ],
  [
    ["Lexi catches the smug husband mid-anecdote and nods politely", "Fascinating. Truly. Tell us about the kayak again."],
    ["Juniper kicks Lexi's ankle under the table", "Don't encourage him. He has slides."],
    ["Lexi turns her laugh into a cough", "Slides. On a date. I love it here."],
    ["Juniper steals the last breadstick", "Mine. Consider it hazard pay."],
    ["Lexi rests her chin on her hand and studies Juniper", "You're much better company than the kayak."],
    ["Juniper meets her eyes and holds them", "Low bar, but I'll take it."],
  ],
  [
    ["Lexi glances at the couple feeding each other sorbet", "Should we be worried that's contagious?"],
    ["Juniper shakes her head slowly", "I'd quarantine us right now if you asked."],
    ["Lexi taps the table twice, their signal", "I'm asking. Quietly. With my eyes."],
    ["Juniper gathers her coat with great ceremony", "Then I'll invent an emergency involving gulls."],
    ["Lexi bites her lip to stay straight-faced", "The gulls always need you at the worst times."],
    ["Juniper offers her arm across the booth", "They do. Coming?"],
  ],
];
/** The "doing" the stub marks, by step and line: the label follows it. */
const DOING = [{ 0: "sizing up the smug couple" }, { 0: "surviving the kayak story" }, { 0: "plotting an escape", 3: "making a run for it" }];

function startAdultStub(seen) {
  let n = 0;
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { messages = [] } = JSON.parse(body || "{}");
      const text = messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
      let reply;
      if (/running recap|factual memory|what a private night left behind|asides|dry or technical/.test(messages[0]?.content ?? "")) reply = {};
      else {
        seen.push(text);
        // The pair is stored lower id first: house-juniper is "a", lexi-e2e is "b". Each line is its own speaker's.
        // What they're doing (lib/adult/doing.ts): said on a step's first line, and where it changes.
        // Each line's face (lib/adult/presence.ts): Lexi smiles, Juniper's are left neutral.
        const lines = STEPS[n % STEPS.length].map(([action, said], i) => ({
          who: action.startsWith("Lexi") ? "b" : "a",
          text: `*${action}* ${said}`,
          why: "the double date",
          memory: null,
          ...(DOING[n % STEPS.length][i] ? { doing: DOING[n % STEPS.length][i] } : {}),
          ...(action.startsWith("Lexi") ? { face: "smile" } : {}),
        }));
        n++;
        reply = { lines, place: "a noisy, dimly lit downtown bar", set: "bar", stage: 0, explicit: false, picture: null, suggestions: { mild: "They split the bill", flirty: "Lexi kicks Juniper's ankle under the table", spicy: "They slip out together" } };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "stub", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(reply) } }] }));
    });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function main() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const seen = [];
  const showrunner = await startShowrunner();
  const adult = await startAdultStub(seen);
  const env = appEnv(showrunner.address().port, DB_DIR);
  const ADMIN_PASSWORD = ["e2e", "admin", Math.random().toString(36).slice(2)].join("-");
  Object.assign(env, {
    FRONTIER_PASSWORD: ADMIN_PASSWORD,
    ADULT_MODE: "1",
    ADULT_LLM_BASE_URL: `http://127.0.0.1:${adult.address().port}/v1`,
    ADULT_LLM_API_KEY: "local-stub",
    ADULT_LLM_MODEL: "stub-adult",
  });
  const port = await freePort();
  let app = await startApp(port, env);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    assert((await ctx.request.post(`${app.base}/api/auth/register`, { data: { handle: `e2escene${Date.now() % 1e6}`, password: "a-long-e2e-password-1", attest: true } })).ok(), "register");
    assert((await ctx.request.post(`${app.base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } })).ok(), "claiming admin");

    // Lexi: the admin's own character, with an everyday outfit and After Dark's lingerie, switched on.
    await stopApp(app);
    const db = new PGlite(DB_DIR);
    const owner = (await db.query("select user_id from admins limit 1")).rows[0].user_id;
    await db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, pronouns, extras)
       values ($1, $2, false, 'Lexi', 24, 'Works the night shift at a pie factory and narrates her own life like a nature documentary.', '["blunt","warm"]'::jsonb,
               'someone who laughs at the right moment', 'people who are rude to waiters', 'she/her', $3::jsonb)`,
      [LEXI, owner, JSON.stringify({ looks: LOOKS })],
    );
    await db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [owner, LEXI]);
    // Her pictures so far: a baseline drawn but never picked as her face, and a body reference already set
    // (lib/adult/readiness.ts: a face picked is what's missing). A PG portrait of the repo's own stands in for both.
    const portrait = readFileSync(join(ROOT, "public", "cast", "house-imogen-v3.webp"));
    await db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('lexi-base', $1, $2, 'baseline', 'p', 'image/webp', $3)`, [owner, LEXI, portrait]);
    await db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('lexi-body', $1, $2, 'scene', 'p', 'image/webp', $3)`, [owner, LEXI, portrait]);
    await db.query(`insert into adult_identity (owner_id, character_id, body_image_id) values ($1, $2, 'lexi-body')`, [owner, LEXI]);
    await db.close();
    app = await startApp(port, env);

    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const scenePath = `/after-dark/${LEXI}/${JUNIPER}`;
    const theater = page.locator(".theater");
    const card = page.locator(".ad-start-card");
    const sceneNow = async () => (await (await ctx.request.get(`${app.base}/api/admin/after-dark?a=${LEXI}&b=${JUNIPER}`)).json()).scene;
    const shot = async (file) => {
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT_DIR, `e2e-after-dark-scene-${file}.png`) });
      console.log(`  📸 docs/screenshots/e2e-after-dark-scene-${file}.png`);
    };

    await step("a new night waits on its start card", async () => {
      await page.goto(`${app.base}${scenePath}`);
      await card.waitFor({ timeout: 30_000 });
      assert((await sceneNow()).lines.length === 0, "lines were written before Start");
    });

    await step("Lexi isn't set up for pictures: the card says what's missing, and the Studio sets it in one tap", async () => {
      const text = await card.innerText();
      assert(/Lexi\s+○ face · ✓ body/.test(text), `the start card doesn't say Lexi's face is missing: ${text}`);
      assert(/nothing is guessed/.test(text), "the start card doesn't say pictures wait");
      await card.getByRole("link", { name: "Set up in the Studio →" }).click();
      const ready = page.locator(".ad-ready-card");
      await ready.waitFor({ timeout: 30_000 });
      assert(/Before After Dark can picture Lexi/.test(await ready.innerText()), "the Studio doesn't open on what's missing");
      await shot("studio-not-ready");
      await ready.getByRole("button", { name: "Use the one shown below" }).click();
      await page.waitForFunction(() => /✓ Lexi is ready for After Dark's pictures/.test(document.querySelector(".ad-ready-card")?.textContent ?? ""), null, { timeout: 15_000 });
      await shot("studio-ready");
      await page.goto(`${app.base}${scenePath}`);
      await card.waitFor({ timeout: 30_000 });
      assert(!/○ face/.test(await card.innerText()), "the start card still says Lexi isn't set up");
    });

    await step("Scene & roleplay: the double date, as a Blind date", async () => {
      await card.getByRole("button", { name: "📍 Scene & roleplay" }).click();
      const picker = page.getByRole("dialog", { name: "Scene and roleplay" });
      await picker.waitFor();
      await picker.getByRole("searchbox", { name: "Search the scenes" }).fill("double date");
      await picker.locator(".ad-scene-card", { hasText: "An awkward double date" }).getByRole("button", { name: "Go here →" }).click();
      await picker.getByRole("radio", { name: /Blind date/ }).click();
      await picker.getByRole("button", { name: /^Go/ }).click();
      await picker.waitFor({ state: "hidden" });
      await page.waitForFunction(() => /An awkward double date/.test(document.querySelector(".ad-start-card")?.textContent ?? "") && /Blind date/.test(document.querySelector(".ad-start-card")?.textContent ?? ""), null, { timeout: 10_000 });
      const s = await sceneNow();
      assert(s.set_place === "An awkward double date", `set to ${s.set_place}`);
      assert(s.roleplay?.id === "blind-date", `roleplay ${JSON.stringify(s.roleplay)}`);
      assert(s.lines.length === 0, "setting the scene started the night");
      await shot("set");
    });

    await step("Start, then Next to the first 10 lines", async () => {
      await card.getByRole("button", { name: "▶ Start the night" }).click();
      await card.waitFor({ state: "detached", timeout: 30_000 });
      for (let i = 0; i < 4 && (await sceneNow()).lines.length < 10; i++) {
        await page.waitForFunction(() => !document.querySelector(".theater .primary[disabled]"), null, { timeout: 30_000 }).catch(() => {});
        await theater.getByRole("button", { name: "Next", exact: true }).click();
        await page.waitForTimeout(1_500);
      }
      const n = (await sceneNow()).lines.length;
      assert(n >= 10, `only ${n} lines`);
      await theater.getByRole("button", { name: "Catch up" }).click({ timeout: 5_000 }).catch(() => {});
      await page.waitForFunction(() => document.querySelectorAll(".theater-convo .chat-item").length >= 10, null, { timeout: 30_000 }).catch(() => {});
    });

    await step("the writer was told the situation, the roleplay, and that they're there", async () => {
      const first = seen[0] ?? "";
      assert(/Tonight's situation: an awkward double date with a smug couple who finish each other's sentences/.test(first), "no situation in the first prompt");
      assert(/Only the two of them speak: (?:Lexi and Juniper Vale|Juniper Vale and Lexi)\./.test(first), "the two-of-them rule still bans the couple");
      assert(/This chapter's roleplay, chosen by the viewer: Blind date\. A friend set (?:Lexi and Juniper|Juniper and Lexi) up/.test(first), "no roleplay in the first prompt");
      assert(/just cut to An awkward double date/.test(first), "the first lines weren't told they're arriving there");
      assert(seen.slice(1).every((p) => /Tonight's situation: an awkward double date/.test(p)), "a later step lost the situation");
      assert(/"doing" says what they're doing now in 2 to 6 plain words, in the roleplay's own terms/.test(first), "the writer wasn't asked what they're doing");
      assert(/- This chapter is the roleplay the viewer chose: Blind date\. Every line plays it/.test(first), "the roleplay doesn't lead the rules");
      assert(/each "why" also says how the line plays it/.test(first), "the why doesn't cite the roleplay");
    });

    await step("they're still at the double date, though the model said a bar", async () => {
      const s = await sceneNow();
      assert(s.set_place === "An awkward double date", `moved to ${s.set_place}`);
      // The label is what they're doing at the latest line, in the writer's words, the roleplay in front (never the heat).
      const label = await theater.innerText();
      const latest = s.lines.at(-1)?.doing;
      assert(latest && latest !== s.lines[0].doing, `what they're doing never changed: ${s.lines.map((l) => l.doing).join(" / ")}`);
      assert(label.includes(`🙈 Blind date · ${latest}`), `the label doesn't say what they're doing now (${latest})`);
      assert(!/talking and flirting/.test(label), "the label still says the heat");
    });

    await step("Picture this shows what it'll be drawn from, field by field, and takes the owner's corrections", async () => {
      await theater.getByRole("button", { name: "Pictures and clips" }).click();
      await page.getByRole("menuitem", { name: /Picture this moment/ }).click();
      const panel = page.getByRole("dialog", { name: "Create a picture of this moment" });
      await panel.waitFor();
      await page.waitForFunction(() => (document.querySelector(".ad-picture-context textarea")?.value ?? "").length > 0, null, { timeout: 15_000 });
      const field = (name) => panel.getByLabel(name);
      const happening = await field(/What's happening/).inputValue();
      const lastAction = ((await sceneNow()).lines.at(-1)?.text ?? "").match(/^\*([^*]+)\*/)?.[1] ?? "";
      assert(lastAction && happening.includes(lastAction.trim()), `"What's happening" isn't the last lines: ${happening}`);
      // What they wear, from their own looks (PR 3): Lexi's everyday outfit at a restaurant.
      const wearing = await field(/What they're wearing/).inputValue();
      assert(/in a fitted white t-shirt and blue jeans/.test(wearing), `what they're wearing isn't from her looks: ${wearing}`);
      assert(/smug couple/.test(await field(/Where/).inputValue()), "the place lost the double date's situation");
      const mood = await field(/Mood/).inputValue();
      assert(/^Blind date · /.test(mood), `the mood isn't the roleplay and what they're doing: ${mood}`);
      // The owner puts right what they wear, and sees it in what will be sent.
      await field(/What they're wearing/).fill("her in a red dress, him in a white shirt");
      await panel.getByText("🔎 What will be sent").click();
      await panel.getByRole("button", { name: "Update with my changes" }).click();
      await page.waitForFunction(() => /not their clothes: her in a red dress, him in a white shirt/.test(document.querySelector(".ad-pc-prompt p")?.textContent ?? ""), null, { timeout: 15_000 });
      assert(/yours/.test(await panel.innerText()), "the changed field isn't marked as the owner's");
      await shot("picture-context");
      await panel.getByRole("button", { name: "Cancel" }).click();
    });

    await step("the picture's prompt matches the scene", async () => {
      const res = await ctx.request.get(`${app.base}/api/admin/after-dark/picture-prompt?a=${LEXI}&b=${JUNIPER}`);
      assert(res.ok(), `preview: HTTP ${res.status()}`);
      const { prompt } = await res.json();
      console.log(`      ${prompt}`);
      // One context for every picture (PR 3): drawn from their two faces, never guessed from words.
      assert(/Make one photograph of the .+ from Picture 1 and the .+ from Picture 2 together/.test(prompt), "not drawn from their faces");
      assert(/The place: an awkward double date with a smug couple who finish each other's sentences\./.test(prompt), "no double date in the place");
      assert(/in a fitted white t-shirt and blue jeans/.test(prompt), "Lexi isn't in her own everyday outfit");
      assert(/both fully clothed/.test(prompt), "not fully clothed at a restaurant");
      assert(!/lingerie|underwear|\bnude\b/i.test(prompt), "dressed for After Dark at a restaurant");
      assert(!/\bhis\b/i.test(prompt), "a 'his' with two women");
      const now = prompt.match(/What is happening: (.+?)\. /)?.[1] ?? "";
      assert(now.length > 0, "no 'What is happening'");
      assert(!/\b(?:a|an|the|of|to|in|with|letting)(?:;|$)/.test(now), `an action cut off mid-phrase: ${now}`);
      await shot("played");
    });

    await step("their living faces: Lexi's loop on the stage while she listens, and ✨ says Juniper needs a face first", async () => {
      assert((await sceneNow()).lines.some((l) => l.who === "b" && l.face === "smile"), "the writer's faces didn't reach the page");
      // Lexi's presence, as "✨ Bring them to life" would leave it, on the face she keeps (the Studio set it above).
      await stopApp(app);
      const pdb = new PGlite(DB_DIR);
      const face = (await pdb.query(`select image_id from adult_face_refs where owner_id = $1 and character_id = $2`, [owner, LEXI])).rows[0]?.image_id;
      assert(face, "Lexi keeps no face");
      for (const e of ["smile", "laugh", "flirty", "intense", "tender", "surprised", "annoyed"]) {
        await pdb.query(`insert into adult_presence (id, owner_id, character_id, face_id, part, expression, status, mime, data) values ($1, $2, $3, $4, 'expression', $5, 'ready', 'image/webp', $6)`, [`lexi-${e}`, owner, LEXI, face, e, portrait]);
      }
      await pdb.query(`insert into adult_presence (id, owner_id, character_id, face_id, part, status, mime, data) values ('lexi-portrait', $1, $2, $3, 'portrait', 'ready', 'image/webp', $4)`, [owner, LEXI, face, portrait]);
      await pdb.query(`insert into adult_presence (id, owner_id, character_id, face_id, part, status, mime, data) values ('lexi-loop', $1, $2, $3, 'loop', 'ready', 'video/mp4', $4)`, [owner, LEXI, face, Buffer.from([0, 0, 0, 24])]);
      await pdb.close();
      app = await startApp(port, env);
      await page.goto(`${app.base}${scenePath}`);
      const lexi = page.locator(".scene-char-b .ad-living-face");
      await lexi.waitFor({ timeout: 30_000 });
      await theater.getByRole("button", { name: "Catch up" }).click({ timeout: 5_000 }).catch(() => {});
      const last = (await sceneNow()).lines.at(-1);
      const want = last.who === "b" ? "/presence/lexi-smile" : "/presence/lexi-loop";
      // Her portrait is the still under it, not the kept face.
      await page.waitForFunction(() => document.querySelector(".scene-char-b .ad-living-still")?.getAttribute("src")?.includes("/presence/lexi-"), null, { timeout: 15_000 });
      await page.waitForFunction((w) => [...document.querySelectorAll(".scene-char-b .ad-living-face img, .scene-char-b .ad-living-face video")].some((el) => el.getAttribute("src")?.includes(w)), want, { timeout: 15_000 });
      assert((await page.locator(".scene-char-a .ad-living-face").count()) === 0, "Juniper has a living face she was never given");
      await shot("living");
      await page.getByRole("button", { name: "More tools" }).click();
      await page.getByRole("button", { name: "✨ Bring them to life" }).click();
      await page.waitForFunction(() => /no face yet/.test(document.querySelector(".ad-theater-note")?.textContent ?? ""), null, { timeout: 15_000 });
    });
    await ctx.close();
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
    adult.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `\n${failed} of ${results.length} failed` : `\nall ${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`e2e:after-dark-scene failed: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});

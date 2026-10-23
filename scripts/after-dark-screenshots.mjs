#!/usr/bin/env node
/**
 * npm run screenshots:after-dark: real-browser screenshots of After Dark's scene page (lib/adult, the director's tools),
 * desktop and phone, into docs/screenshots/. It builds the app and runs it with ADULT_MODE=1 on a throwaway local
 * database, with a local stub for After Dark's model that writes PG placeholder lines (tea, rain, a rooftop): never
 * anything explicit, no key, no network beyond localhost. The portraits are the repo's own.
 *
 *   the steer bar with the last step's suggested next moves, a whisper running, and Rewind/Redo → after a rewind →
 *   the theater with the suggestions over its steer.
 *
 * On the phone it also checks the page never scrolls sideways and the sticky steer bar keeps under half the screen.
 * Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build.
 */
import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "after-dark-screenshots");
const PREFIX = process.env.SHOTS_PREFIX || "after-dark-director";

/** PG placeholder lines: two people on a rooftop with a kettle, talking. Distinct, so no guard reads a repeat. */
const LINES = [
  ["smiles", "You kept me waiting by the railing. I counted every boat in the harbour."],
  ["laughs", "Seven boats? I'll make it up to you with my famously terrible tea."],
  ["", "Terrible how? Like, a little weak, or a crime against leaves?"],
  ["pours two cups", "A crime. But a warm one, and the rain's coming in off the water."],
  ["wraps both hands round the cup", "Then I'm staying for the crime. Tell me what you see out there."],
  ["points past the cranes", "That green light is the ferry. I used to time my whole day by it."],
  ["", "And now you time it by the woman who keeps you on rooftops in the rain?"],
  ["grins", "Now I time it by the kettle. You're a close second, though."],
  ["nudges his shoulder", "Second to a kettle. I've had worse reviews, honestly."],
  ["", "Give it an hour. The kettle has been losing ground all evening."],
  ["sets the cup down", "Ask me something real, then. Not the weather, not the boats."],
  ["thinks about it", "What did you want to be, before all this? Before the harbour?"],
  ["", "A lighthouse keeper. Alone, a big lamp, nobody asking for tea."],
  ["laughs quietly", "And here you are, making tea for a stranger on a roof."],
  ["", "You stopped being a stranger around boat number four."],
  ["looks at her for a long moment", "Boat four was a good boat. I'll remember boat four."],
  ["tucks a strand of wet hair back", "The rain's picking up. We could go in, or we could not."],
  ["", "Not. Definitely not. I like the sound it makes on the awning."],
  ["shifts a little closer", "Then we'd better share the blanket, for practical reasons."],
  ["holds the blanket open", "Purely practical. I'm a very practical person, everyone says so."],
  ["", "Everyone is wrong about you, I think. In a good way."],
  ["", "Say that again when the tea's gone cold and I'm still talking."],
  ["leans her head on his shoulder", "I'll say it twice. Once for the tea, once for you."],
  ["", "Deal. The ferry's coming in. Watch, it turns at the last buoy."],
];
const SUGGESTIONS = [
  { mild: "He tells her about the night he nearly kept a lighthouse", flirty: "She dares him to name every boat in the harbour", spicy: "Her hand finds his under the blanket" },
  { mild: "They count the ferry lights together", flirty: "He teases her about her terrible tea", spicy: "They finally kiss, rain on the awning" },
  { mild: "She asks what he'd keep if the roof flooded", flirty: "He bets her a cup of tea she'll blink first", spicy: "One of them suggests they head inside, somewhere warmer" },
];

/** After Dark's model, stubbed: a scene step gets six fresh PG lines and three suggestions; a recap, facts or note their own. */
function startAdultStub() {
  let at = 0;
  let step = 0;
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { messages = [] } = JSON.parse(body || "{}");
      const system = messages[0]?.content ?? "";
      let reply;
      if (/running recap/.test(system)) reply = { recap: "They watched the harbour from the rooftop, shared terrible tea and a blanket, and stayed out in the rain." };
      else if (/factual memory/.test(system)) reply = { a: [{ kind: "joke", fact: "He ranks himself second to his kettle", quote: null }], b: [{ kind: "like", fact: "She times her day by the green ferry light", quote: null }] };
      else if (/what a private night left behind/.test(system)) reply = { a: "You and him stayed out on the rooftop in the rain; you're closer now.", b: "You and her stayed out on the rooftop in the rain; you're closer now." };
      else {
        const lines = Array.from({ length: 6 }, (_, i) => {
          const [action, text] = LINES[(at + i) % LINES.length];
          return { who: i % 2 ? "b" : "a", action, text, why: "the rooftop, and what was just said", memory: null };
        });
        at += 6;
        reply = { lines, place: "the rooftop", set: "the rooftop", stage: 1, explicit: false, picture: null, suggestions: SUGGESTIONS[step++ % SUGGESTIONS.length] };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "stub", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(reply) } }] }));
    });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** No sideways scroll, and the sticky steer bar keeps under half the screen (it sits over the lines). */
async function checkPhone(page, name) {
  const { scroll, width, bar } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
    bar: document.querySelector(".after-dark-form")?.getBoundingClientRect().height ?? 0,
  }));
  assert(scroll <= width, `${name}: the page scrolls sideways (${scroll}px wide on a ${width}px screen)`);
  assert(bar < 844 / 2, `${name}: the steer bar is ${Math.round(bar)}px tall, over half the phone's screen`);
  console.log(`  ✓ ${name}: no sideways scroll, steer bar ${Math.round(bar)}px`);
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const adult = await startAdultStub();
  const env = appEnv(showrunner.address().port, DATA_DIR);
  const ADMIN_PASSWORD = ["shots", "admin", Math.random().toString(36).slice(2)].join("-");
  Object.assign(env, {
    FRONTIER_PASSWORD: ADMIN_PASSWORD,
    ADULT_MODE: "1",
    ADULT_LLM_BASE_URL: `http://127.0.0.1:${adult.address().port}/v1`,
    ADULT_LLM_API_KEY: "local-stub",
    ADULT_LLM_MODEL: "stub-adult",
    BOTCHELOR_SEASON_CAST_SIZE: "4",
  });
  const app = await startApp(await freePort(), env);
  const base = app.base;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const shot = async (page, file) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT_DIR, `${PREFIX}-${file}.png`) });
    console.log(`  📸 docs/screenshots/${PREFIX}-${file}.png`);
  };
  try {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: base }]);
    const reg = await ctx.request.post(`${base}/api/auth/register`, { data: { handle: `shots${Date.now() % 1e6}`, password: "a-long-shots-password-1", attest: true } });
    assert(reg.ok(), `register: HTTP ${reg.status()}`);
    assert((await ctx.request.post(`${base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } })).ok(), "claiming admin");
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${base}/after-dark`);
    const link = page.locator(".after-dark li.card a").first();
    const scenePath = (await link.getAttribute("href")) ?? "";
    assert(scenePath.startsWith("/after-dark/"), "a pair to open");
    await page.goto(`${base}${scenePath}`);
    const form = page.locator(".after-dark-form");
    // Two steps: the first unsteered, the second with a whisper to the second of them.
    await form.locator("button[type=submit]").click();
    await page.locator(".ad-suggestion").first().waitFor({ timeout: 30_000 });
    const radios = form.getByRole("radio");
    await radios.nth(3).check();
    await page.locator("#after-dark-direction").fill("She's been hoping you'd ask her to stay");
    await form.locator("button[type=submit]").click();
    await page.locator(".ad-whisper-chip").waitFor({ timeout: 30_000 });
    await radios.nth(0).check();
    // The last lines and the steer bar under them, in their own place (not stuck to the foot of the screen).
    const frame = () =>
      page.evaluate(() => {
        // The form is sticky, so scroll to where it sits under the lines: the end marker just before it, plus its height.
        const form = document.querySelector(".after-dark-form");
        const end = form?.previousElementSibling;
        if (!form || !end) return;
        window.scrollTo(0, end.getBoundingClientRect().top + window.scrollY + form.getBoundingClientRect().height - window.innerHeight + 24);
      });
    await frame();
    await shot(page, "steer-desktop");

    await page.setViewportSize({ width: 390, height: 844 });
    await frame();
    await checkPhone(page, "the scene page");
    await shot(page, "steer-phone");

    // Rewind: the whispered step goes, and so does its whisper.
    await form.getByRole("button", { name: "↺ Rewind" }).click();
    await page.getByText(/Rewound: 6 lines taken back/).waitFor({ timeout: 15_000 });
    assert((await page.locator(".ad-whisper-chip").count()) === 0, "the rewound step's whisper should be gone");
    await frame();
    await checkPhone(page, "after a rewind");
    await shot(page, "rewound-phone");
    await page.setViewportSize({ width: 1280, height: 800 });
    await frame();
    await shot(page, "rewound-desktop");

    // The theater, with the suggestions over its steer.
    await page.goto(`${base}${scenePath}?play=1`);
    await page.locator(".theater .ad-suggestion").first().waitFor({ timeout: 15_000 });
    await page.locator(".theater").getByRole("button", { name: "⏭" }).click().catch(() => {});
    await shot(page, "theater-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert(!sideways, "the theater scrolls sideways on a phone");
    await shot(page, "theater-phone");
    await ctx.close();
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
    adult.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`screenshots:after-dark failed: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});

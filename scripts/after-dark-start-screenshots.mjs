#!/usr/bin/env node
/**
 * npm run screenshots:after-dark-start: real-browser proof of how an After Dark night starts (David, 2026-10-25: "we
 * shouldn't get the date started until the user hits play or sets the scene"; "if the bots have decided on the date from
 * texting then let's lock it"), desktop and phone, into docs/screenshots/:
 *
 *   start: a new night waits on its start card, and ticking Autoplay doesn't begin it;
 *   planned: the two agreed a place by text, so the card says so and the picker's Where is locked; a roleplay is picked;
 *   played: ▶ Start the night, and they're at the place they agreed (whatever the model names), the roleplay in the label.
 *
 * It builds the app and runs it with ADULT_MODE=1 on a throwaway local database, with a local stub for After Dark's model
 * that writes PG lines and claims they're on a rooftop. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build.
 */
import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright-core";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "after-dark-start-screenshots");
const DB_DIR = join(DATA_DIR, "pglite");

const LINES = [
  ["looks round the long tables", "So this is where they make the cream pies. It smells like a birthday."],
  ["grins", "Every day is a birthday here. Mind the conveyor, it has opinions."],
  ["steps over it", "Opinions about what? Pastry?"],
  ["hands her a paper hat", "About people who don't wear the hat. Put it on."],
  ["puts the hat on", "There. Now I look like I belong to the pie."],
  ["laughs", "You look like the best thing that's happened on this floor all week."],
];

/** After Dark's model, stubbed: PG lines that claim a rooftop (the bug was taking the model's place over the chosen one). */
function startAdultStub() {
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { messages = [] } = JSON.parse(body || "{}");
      const system = messages[0]?.content ?? "";
      let reply;
      if (/running recap|factual memory|what a private night left behind/.test(system)) reply = {};
      else {
        const lines = LINES.map(([action, text], i) => ({ who: i % 2 ? "b" : "a", action, text, why: "the factory floor", memory: null }));
        reply = { lines, place: "a rooftop at night", set: "the rooftop", stage: 0, explicit: false, picture: null, suggestions: { mild: "They split a pie", flirty: "He teases her about the hat", spicy: "She steals the last bite from his fork" } };
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

async function main() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const adult = await startAdultStub();
  const env = appEnv(showrunner.address().port, DB_DIR);
  const ADMIN_PASSWORD = ["shots", "admin", Math.random().toString(36).slice(2)].join("-");
  Object.assign(env, {
    FRONTIER_PASSWORD: ADMIN_PASSWORD,
    ADULT_MODE: "1",
    ADULT_LLM_BASE_URL: `http://127.0.0.1:${adult.address().port}/v1`,
    ADULT_LLM_API_KEY: "local-stub",
    ADULT_LLM_MODEL: "stub-adult",
    BOTCHELOR_SEASON_CAST_SIZE: "4",
  });
  const port = await freePort();
  let app = await startApp(port, env);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const reg = await ctx.request.post(`${app.base}/api/auth/register`, { data: { handle: `shotsstart${Date.now() % 1e6}`, password: "a-long-shots-password-1", attest: true } });
    assert(reg.ok(), `register: HTTP ${reg.status()}`);
    assert((await ctx.request.post(`${app.base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } })).ok(), "claiming admin");
    const page = await ctx.newPage();
    const shot = async (file) => {
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT_DIR, `after-dark-${file}.png`) });
      console.log(`  📸 docs/screenshots/after-dark-${file}.png`);
    };
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${app.base}/after-dark`);
    const scenePath = (await page.locator("[data-first-scene]").getAttribute("data-first-scene")) ?? "";
    assert(scenePath.startsWith("/after-dark/"), "a pair to open");
    const [, , x, y] = scenePath.split("/");
    const card = page.locator(".ad-start-card");

    // A new night waits for Start, Autoplay ticked or not.
    await page.goto(`${app.base}${scenePath}`);
    await card.waitFor({ timeout: 30_000 });
    await page.locator(".theater").getByLabel("Autoplay").check();
    await page.waitForTimeout(2_500);
    assert(await card.isVisible(), "ticking Autoplay started the night");
    assert((await page.locator(".theater-convo .chat-item").count()) === 0, "lines were written before Start");
    await page.locator(".theater").getByLabel("Autoplay").uncheck();
    console.log("  ✓ a new night waits on its start card, and Autoplay doesn't begin it");
    await shot("start-desktop");

    // They agree a place by text (the pie factory: Lexi × Juniper's, 2026-10-25).
    await stopApp(app);
    const db = new PGlite(DB_DIR);
    const [lo, hi] = [x, y].sort();
    for (const [seq, who, text] of [
      [1, "hi", "Are you carrying a cream pie in that big coat?"],
      [2, "lo", "No, but I work at a pie factory. Want to go get two cream pies together?"],
      [3, "hi", "A pie factory sounds dangerously unguarded. Let's do it."],
    ]) {
      await db.query(`insert into couple_texts (character_lo, character_hi, day, seq, who, text) values ($1, $2, current_date, $3, $4, $5)`, [lo, hi, seq, who, text]);
    }
    await db.close();
    app = await startApp(port, env);

    for (const [w, h, size] of [
      [1280, 800, "desktop"],
      [390, 844, "phone"],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${app.base}${scenePath}`);
      await card.waitFor({ timeout: 30_000 });
      assert(/the pie factory/.test(await card.innerText()), "the start card doesn't say where they agreed by text");
      assert(/decided on the pie factory by text/.test(await card.innerText()), "the start card doesn't say they decided it by text");
      await shot(`start-planned-${size}`);
    }
    console.log("  ✓ a place agreed by text is where the night starts, and the card says so");

    // The picker opens on the roleplays, Where locked; pick one.
    await page.setViewportSize({ width: 1280, height: 800 });
    await card.getByRole("button", { name: "🎭 Pick a roleplay" }).click();
    const picker = page.getByRole("dialog", { name: "Scene and roleplay" });
    await picker.waitFor();
    assert(await picker.getByRole("button", { name: /1\. Where 🔒/ }).isDisabled(), "Where isn't locked");
    assert(/decided on the pie factory by text/.test(await picker.innerText()), "the picker doesn't say why Where is locked");
    await picker.getByRole("radio", { name: /Blind date/ }).click();
    await shot("start-planned-roleplay-desktop");
    await picker.getByRole("button", { name: "Start the roleplay" }).click();
    await picker.waitFor({ state: "hidden" });
    await page.waitForFunction(() => /Blind date/.test(document.querySelector(".ad-start-card")?.textContent ?? ""), null, { timeout: 10_000 });
    assert(await card.isVisible(), "picking a roleplay started the night");
    console.log("  ✓ Where is locked; a roleplay is picked, and the night still waits");

    // Start: they're at the pie factory, however the model names it, the roleplay in the label.
    await card.getByRole("button", { name: "▶ Start the night" }).click();
    await card.waitFor({ state: "detached", timeout: 30_000 });
    await page.locator(".theater").getByRole("button", { name: "Catch up" }).click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    const theater = await page.locator(".theater").innerText();
    assert(/Blind date/.test(theater) && !/talking and flirting/.test(theater), "the label doesn't carry the roleplay, or still says the heat");
    const stored = await (await ctx.request.get(`${app.base}/api/admin/after-dark?a=${x}&b=${y}`)).json();
    assert(stored.scene.set_place === "the pie factory", `they ended up at ${stored.scene.set_place}, not the pie factory`);
    console.log("  ✓ started: at the pie factory (the model said a rooftop), Blind date in the label");
    await shot("start-played-desktop");
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
  console.error(`screenshots:after-dark-start failed: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * npm run screenshots:create: real-browser screenshots of the PG Studio (lib/studio/pg.ts) and the Create library
 * (lib/studio/library.ts), desktop and phone, into docs/screenshots/: the PG Studio's Shoot tab with one of your own
 * venues and prompts, its gallery, its Create tab; After Dark's Studio Create tab (roleplays); your venue and roleplay
 * under ✨ Yours in a night's Scene & roleplay; and Your prompts on /prompts.
 *
 * It builds the app and runs it with ADULT_MODE=1 on a throwaway local database. No provider is called and nothing is
 * drawn: the PG Studio's pictures are seeded from the repo's own PG portraits (public/cast) with ffmpeg. On the phone it
 * checks the page never scrolls sideways. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build.
 */
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { PGlite } from "@electric-sql/pglite";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "create-screenshots");
const DB_DIR = join(DATA_DIR, "pglite");
const HER = "house-juniper";
const HIM = "house-dex";

function startAdultStub() {
  const srv = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "stub", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "{}" } }] }));
    });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Four PG stand-ins of her, made from her portrait with ffmpeg. */
function placeholders() {
  const dir = join(DATA_DIR, "media");
  mkdirSync(dir, { recursive: true });
  const looks = ["", ",colorbalance=rs=0.22:gs=0.08:bs=-0.18", ",eq=brightness=0.06:contrast=0.9", ",colorbalance=bs=0.2:rs=-0.05"];
  return looks.map((f, i) => {
    const out = join(dir, `pg-${i}.png`);
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", join(ROOT, "public", "cast", `${HER}-v3.webp`), "-vf", `scale=384:512${f}`, "-frames:v", "1", out], { stdio: ["ignore", "ignore", "inherit"] });
    if (r.status !== 0) throw new Error("ffmpeg failed");
    return readFileSync(out);
  });
}

async function seed(owner, mine) {
  const db = new PGlite(DB_DIR);
  try {
    const pics = placeholders();
    await db.query(`insert into studio_pg_shoots (id, owner_id, character_id, choices, model, tokens, free, asked, made, status) values ('pg-shoot-1', $1, $2, '{}'::jsonb, 'qwen-image-2-1-turbo-edit', 0, true, 4, 4, 'ready')`, [owner, HER]);
    // Their own character's Studio pictures too, for Choose their picture on the Look step.
    await db.query(`insert into studio_pg_shoots (id, owner_id, character_id, choices, model, tokens, free, asked, made, status) values ('pg-shoot-2', $1, $2, '{}'::jsonb, 'qwen-image-2-1-turbo-edit', 0, true, 4, 3, 'partial')`, [owner, mine]);
    for (const [i, data] of pics.slice(0, 3).entries()) {
      await db.query(
        `insert into studio_pg_pictures (id, owner_id, character_id, shoot_id, prompt, mime, data, content_rating, clothing) values ($1, $2, $3, 'pg-shoot-2', 'PG placeholder', 'image/png', $4, $5, 'CLOTHED')`,
        [`pg-mine-${i}`, owner, mine, data, i === 2 ? "suggestive" : "pg"],
      );
    }
    for (const [i, data] of pics.entries()) {
      await db.query(
        `insert into studio_pg_pictures (id, owner_id, character_id, shoot_id, prompt, mime, data, content_rating, clothing, created_at)
         values ($1, $2, $3, 'pg-shoot-1', 'PG placeholder', 'image/png', $4, $5, 'CLOTHED', now() - ($6 || ' minutes')::interval)`,
        [`pg-pic-${i}`, owner, HER, data, i === 3 ? "suggestive" : "pg", String(10 - i)],
      );
    }
  } finally {
    await db.close();
  }
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const adult = await startAdultStub();
  const env = appEnv(showrunner.address().port, DB_DIR);
  const ADMIN_PASSWORD = ["shots", "admin", Math.random().toString(36).slice(2)].join("-");
  Object.assign(env, { FRONTIER_PASSWORD: ADMIN_PASSWORD, ADULT_MODE: "1", ADULT_LLM_BASE_URL: `http://127.0.0.1:${adult.address().port}/v1`, ADULT_LLM_API_KEY: "local-stub", ADULT_LLM_MODEL: "stub-adult" });
  const port = await freePort();
  let app = await startApp(port, env);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, timeout: 30_000 });
  const shot = async (page, file) => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT_DIR, `${file}.png`) });
    console.log(`  📸 docs/screenshots/${file}.png`);
  };
  const noSideways = async (page, name) => {
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    const width = page.viewportSize()?.width ?? 0;
    assert(scroll <= width, `${name}: the page scrolls sideways on a phone (${scroll}px on ${width}px)`);
    console.log(`  ✓ ${name}: no sideways scroll on a phone`);
  };
  try {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const req = ctx.request;
    assert((await req.post(`${app.base}/api/auth/register`, { data: { handle: `maker${Date.now() % 1e6}`, password: "a-long-shots-password-1", attest: true } })).ok(), "register");
    assert((await req.post(`${app.base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } })).ok(), "claiming admin");
    await req.post(`${app.base}/api/admin/after-dark/privacy`, { data: { blur: false } });
    assert((await req.post(`${app.base}/api/admin/after-dark/settings`, { data: { venice_key: "placeholder-venice-create-0001", hive_key: "placeholder-hive-create-0001", enabled: true } })).ok(), "placeholder keys");
    // Their library: two venues, two prompts, a roleplay.
    const save = async (data) => assert((await req.post(`${app.base}/api/library`, { data })).ok(), `saving ${JSON.stringify(data)}`);
    await save({ action: "save_place", name: "The lighthouse lantern room", description: "the top of an old lighthouse, the lamp turning slowly, wind rattling the glass", mode: "safe" });
    await save({ action: "save_place", name: "A rooftop greenhouse", description: "a glass greenhouse on a city roof at night, warm and green", mode: "safe" });
    await save({ action: "save_prompt", text: "Golden-hour portrait on a rooftop, wind in their hair, the city behind them", title: "Rooftop golden hour", mode: "safe" });
    await save({ action: "save_prompt", text: "Reading in a café window seat, rain on the glass", title: "Rainy café", mode: "safe" });
    const made = await req.post(`${app.base}/api/characters`, { data: { name: "Wren Halloway", age: 31, bio: "A ferry pilot who knows every lighthouse on the coast by its blink.", traits: ["steady", "dry", "kind"], want: "Someone who likes the quiet hours", dealbreaker: "Being late for the tide", attest: true, keep_name: true } });
    assert(made.ok(), `making a character: HTTP ${made.status()}`);
    const mine = (await made.json()).id;
    await save({ action: "save_roleplay", title: "Rival food trucks", premise: "{a} and {b} run food trucks parked side by side; tonight one of them admits the rivalry was flirting all along.", roles: ["the taco truck owner", "the ramen truck owner"], category: "romance" });
    await stopApp(app);
    const owner = await (async () => {
      const db = new PGlite(DB_DIR);
      try {
        return (await db.query("select user_id from accounts order by created_at limit 1")).rows[0].user_id;
      } finally {
        await db.close();
      }
    })();
    await seed(owner, mine);
    app = await startApp(port, env);
    const page = await ctx.newPage();
    page.setDefaultTimeout(20_000);
    for (const [w, h, size] of [
      [1280, 860, "desktop"],
      [390, 844, "phone"],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      // The PG Studio: Shoot with a pick, your venue in Where and your prompts under the words.
      await page.goto(`${app.base}/characters/${HER}/studio`);
      await page.getByRole("button", { name: /^Shot/ }).waitFor();
      await page.locator(".pg-chips").getByRole("button", { name: "Candid", exact: true }).click();
      await page.getByRole("button", { name: /^Where/ }).click();
      await page.locator(".pg-chips").getByRole("button", { name: "✨ The lighthouse lantern room" }).click();
      await page.locator(".pg-my-prompts").getByRole("button", { name: "Rooftop golden hour" }).click();
      assert((await page.locator("#pg-custom").inputValue()).startsWith("Golden-hour portrait"), "a prompt of theirs fills the words");
      await page.locator(".pg-groups").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90));
      if (size === "phone") await noSideways(page, "the PG Studio's shoot");
      await shot(page, `studio-pg-shoot-${size}`);
      await page.getByRole("tab", { name: /Gallery/ }).click();
      await page.locator(".pg-pictures img").first().waitFor();
      await page.locator(".pg-pictures").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 140));
      await shot(page, `studio-pg-gallery-${size}`);
      await page.getByRole("tab", { name: "✨ Create" }).click();
      await page.locator(".create-library .create-form").waitFor();
      await page.locator(".create-library").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 140));
      if (size === "phone") await noSideways(page, "the PG Studio's Create tab");
      await shot(page, `studio-pg-create-${size}`);
    }
    // After Dark's Studio, Create: roleplays (desktop).
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(`${app.base}/after-dark/studio/${HER}?tab=create`);
    await page.locator(".create-library").waitFor();
    await page.getByRole("tab", { name: /Roleplays/ }).click();
    await page.locator(".create-list li").first().waitFor();
    await page.locator(".create-library").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120));
    await shot(page, "create-roleplays-desktop");
    // A night's Scene & roleplay: your venue and roleplay under ✨ Yours.
    await page.goto(`${app.base}/after-dark/${HIM}/${HER}`);
    await page.locator(".theater .ad-set-scene").click();
    const picker = page.getByRole("dialog", { name: "Scene and roleplay" });
    await picker.getByRole("radio", { name: /Yours/ }).first().click();
    await picker.locator(".ad-scene-card").first().waitFor();
    assert((await picker.locator(".ad-scene-card").count()) === 2, "both of their venues under Yours");
    await shot(page, "create-picker-venues-desktop");
    await picker.locator(".ad-scene-card").first().getByRole("button", { name: /Go here/ }).click();
    await picker.getByRole("radio", { name: /Yours/ }).first().click();
    await picker.getByRole("radio", { name: /Rival food trucks/ }).click();
    await shot(page, "create-picker-roleplay-desktop");
    // Their own character's Look step: Choose their picture (lib/studio/picture-choice.ts).
    const edit = await page.goto(`${app.base}/characters/${mine}/edit`);
    if (!edit?.ok()) throw new Error(`the edit page answered ${edit?.status()} for ${mine}`);
    // The rail's dots are the buttons; each step's name sits beside its dot.
    await page.locator(".wizard-rail-step", { hasText: "Look" }).locator("button").click();
    await page.locator(".choose-picture-grid img").first().waitFor();
    await page.locator(".choose-picture").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 160));
    await shot(page, "choose-picture-desktop");
    // /prompts: Your prompts above the library.
    await page.goto(`${app.base}/prompts`);
    await page.locator(".my-prompts .prompt-item").first().waitFor();
    await page.locator(".my-prompts").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90));
    await shot(page, "prompts-mine-desktop");
    await ctx.close();
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
    adult.close();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

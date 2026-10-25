#!/usr/bin/env node
/**
 * npm run screenshots:after-dark-storyboard: real-browser screenshots of the reel storyboard
 * (docs/PRDs/reel-storyboard.md), desktop and phone, into docs/screenshots/. It builds the app and runs it with
 * ADULT_MODE=1 on a throwaway local database and a local stub for After Dark's model that writes PG placeholder lines.
 * No provider is called: the shot pictures are the repo's own PG portraits (public/cast), seeded straight into the local
 * database, and the plan/draw/film responses are served from them so nothing is drawn or spent. Never anything explicit.
 *
 * Two screens: the storyboard just planned (shots picked, not drawn), and after drawing (each shot's picture kept, ready
 * to film). On the phone it checks the page never scrolls sideways. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build.
 */
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { PGlite } from "@electric-sql/pglite";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "after-dark-storyboard-screenshots");
const DB_DIR = join(DATA_DIR, "pglite");

/** PG placeholder lines on a rooftop with a kettle: distinct, so no guard reads a repeat. */
const LINES = [
  ["smiles", "You kept me waiting by the railing. I counted every boat in the harbour."],
  ["laughs", "Seven boats? I'll make it up to you with my famously terrible tea."],
  ["", "Terrible how? Like, a little weak, or a crime against leaves?"],
  ["pours two cups", "A crime. But a warm one, and the rain's coming in off the water."],
  ["wraps both hands round the cup", "Then I'm staying for the crime. Tell me what you see out there."],
  ["points past the cranes", "That green light is the ferry. I used to time my whole day by it."],
  ["", "And now you time it by the woman who keeps you on rooftops in the rain?"],
  ["grins", "Now I time it by the kettle. You're a close second, though."],
];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** After Dark's model, stubbed: six fresh PG lines a step; a recap, facts or a note their own. */
function startAdultStub() {
  let at = 0;
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { messages = [] } = JSON.parse(body || "{}");
      const system = messages[0]?.content ?? "";
      let reply;
      if (/running recap/.test(system)) reply = { recap: "They watched the harbour from the rooftop and shared terrible tea." };
      else if (/factual memory/.test(system)) reply = { a: [], b: [] };
      else if (/what a private night left behind/.test(system)) reply = { a: "You stayed out on the rooftop with him.", b: "You stayed out on the rooftop with her." };
      else {
        const lines = Array.from({ length: 6 }, (_, i) => {
          const [action, text] = LINES[(at + i) % LINES.length];
          return { who: i % 2 ? "b" : "a", action, text, why: "the rooftop, and what was just said", memory: null };
        });
        at += 6;
        reply = { lines, place: "the rooftop", set: "the rooftop", stage: 2, explicit: false, picture: null, suggestions: { mild: "They count the ferry lights", flirty: "He teases her tea", spicy: "They kiss in the rain" } };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "stub", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(reply) } }] }));
    });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

/** A PG still of the two of them (their two portraits side by side), made with ffmpeg. */
function stillOf(a, b) {
  const dir = join(DATA_DIR, "media");
  mkdirSync(dir, { recursive: true });
  const still = join(dir, "still.png");
  const cast = (id) => join(ROOT, "public", "cast", `${id}-v3.webp`);
  // A 9:16 two-shot: the two portraits side by side on a dark band, centred on a portrait canvas, so it fills a shot tile.
  const filter = "[0:v]scale=288:384[l];[1:v]scale=288:384[r];[l][r]hstack=inputs=2[both];[both]pad=576:1024:0:320:color=0x140a1c[out]";
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", cast(a), "-i", cast(b), "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", still], { stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) throw new Error("ffmpeg failed");
  return readFileSync(still);
}

/**
 * Seed three PG keyframe ('frame') pictures and a real draft storyboard that references them (status 'draft'), with the
 * app stopped (one process at a time on PGlite). The draft is what lets the media route serve the keyframes to the owner
 * before any video (lib/adult/media.ts ownDraftFrame); the routed plan/draw responses below drive the panel.
 */
async function seedDraft(a, b, shots) {
  const db = new PGlite(DB_DIR);
  try {
    const owner = (await db.query("select user_id from admins limit 1")).rows[0].user_id;
    const still = stillOf(a, b);
    for (const n of [1, 2, 3]) {
      await db.query("insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status) values ($1, $2, $3, $4, 'frame', 'PG placeholder', 'image/png', $5, 'ready')", [`sb-frame-${n}`, owner, a, b, still]);
    }
    await db.query("insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots) values ('sb-demo', $1, $2, $3, 'draft', 0, $4::jsonb)", [owner, a, b, JSON.stringify(shots)]);
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
  const shot = async (page, file) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT_DIR, `${file}.png`) });
    console.log(`  📸 docs/screenshots/${file}.png`);
  };
  const noSideways = async (page, name) => {
    const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
    assert(scroll <= width + 1, `${name}: scrolls sideways (${scroll}px on ${width}px)`);
    console.log(`  ✓ ${name}: no sideways scroll on a phone`);
  };
  try {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const reg = await ctx.request.post(`${app.base}/api/auth/register`, { data: { handle: `shots${Date.now() % 1e6}`, password: "a-long-shots-password-1", attest: true } });
    assert(reg.ok(), `register: HTTP ${reg.status()}`);
    assert((await ctx.request.post(`${app.base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } })).ok(), "claiming admin");
    // Discreet mode blurs every picture by default; off here so the shot pictures are clear (lib/adult/privacy.ts).
    await ctx.request.post(`${app.base}/api/admin/after-dark/privacy`, { data: { blur: false } });
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${app.base}/after-dark`);
    const scenePath = (await page.locator("[data-first-scene]").getAttribute("data-first-scene")) ?? "";
    assert(scenePath.startsWith("/after-dark/"), "a pair to open");
    const [, , a, b] = scenePath.split("/");
    await page.goto(`${app.base}${scenePath}`);
    // Two steps of PG lines, so the night has enough to make a video.
    for (let k = 0; k < 2; k++) {
      const before = await page.locator(".after-dark-lines li").count();
      await page.locator(".after-dark-form button[type=submit]").click();
      await page.waitForFunction((n) => document.querySelectorAll(".after-dark-lines li").length > n, before, { timeout: 30_000 });
    }
    // The storyboard's shots: picked (planned), then with each picture drawn and kept (frame_ready).
    const base = { id: "sb-demo", status: "draft", tokens: 0, a, b, created_at: new Date().toISOString() };
    const planned = {
      ...base,
      shots: [
        { line: 2, who: "a", status: "planned", text: "Ask me something real, then. Not the weather, not the boats.", motion: "She sets her cup down and turns to face him." },
        { line: 4, who: "b", status: "planned", text: "What did you want to be, before all this?", motion: "He looks out at the ferry lights, thinking." },
        { line: 6, who: "a", status: "planned", text: "A lighthouse keeper. A big lamp, nobody asking for tea.", motion: "They laugh, close together at the rail." },
      ],
    };
    const drawn = { ...base, shots: planned.shots.map((s, i) => ({ ...s, status: "frame_ready", media_id: `sb-frame-${i + 1}`, frame_id: `sb-frame-${i + 1}` })) };

    await stopApp(app);
    await seedDraft(a, b, drawn.shots);
    app = await startApp(port, env);

    await page.route("**/api/admin/after-dark/reel", async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.continue();
      const body = JSON.parse(req.postData() || "{}");
      if (body.action === "plan") return route.fulfill({ json: { reel: planned } });
      if (body.action === "draw") return route.fulfill({ json: { reel: drawn } });
      if (body.action === "film") return route.fulfill({ json: { reel: { ...drawn, status: "making", shots: drawn.shots.map((s) => ({ ...s, status: "queued" })) } } });
      return route.continue();
    });

    for (const [w, h, size] of [[1280, 900, "desktop"], [390, 844, "phone"]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${app.base}${scenePath}?play=1`);
      // On a phone the tools fold into "⋯"; open it first.
      if (size === "phone") await page.getByRole("button", { name: "More tools" }).click();
      // Open the video control in the theater and choose the storyboard.
      await page.getByRole("button", { name: /Storyboard/ }).first().click();
      await page.locator(".ad-storyboard").waitFor({ timeout: 20_000 });
      if (size === "phone") await noSideways(page, "the storyboard, planned");
      await shot(page, `after-dark-storyboard-planned-${size}`);
      // Draw the pictures: each shot's keyframe, kept and ready to film.
      await page.getByRole("button", { name: /Draw the pictures/ }).click();
      await page.locator(".ad-shot-pic img").first().waitFor({ timeout: 20_000 });
      if (size === "phone") await noSideways(page, "the storyboard, drawn");
      await shot(page, `after-dark-storyboard-${size}`);
    }
    console.log("✓ storyboard screenshots done");
  } finally {
    await browser.close();
    await stopApp(app);
    adult.close();
    showrunner.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

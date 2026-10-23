#!/usr/bin/env node
/**
 * npm run screenshots:after-dark-media: real-browser screenshots of After Dark's media on a pair's page (clips on demand,
 * lib/adult/clips.ts), its prices in the settings, and the media UI (the clip and picture menu, Listen on the lines and in
 * the theater), desktop and phone, into docs/screenshots/ (SHOTS=clips,prices,ui). It builds the app and runs it with ADULT_MODE=1 on a
 * throwaway local database and a local stub for After Dark's model that writes PG placeholder lines. No provider is
 * called: the clips are seeded straight into the local database, their pictures and videos made here from the repo's
 * own PG portraits (public/cast) with ffmpeg, and deleted with the database afterwards. Never anything explicit.
 *
 * On the phone it checks the page never scrolls sideways. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build.
 */
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { PGlite } from "@electric-sql/pglite";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "after-dark-media-screenshots");
const DB_DIR = join(DATA_DIR, "pglite");
/** Which screenshots: clips (the videos list), prices (the settings' price fields); all by default. */
const SHOTS = new Set((process.env.SHOTS || "clips,prices,ui").split(",").map((s) => s.trim()));

/** PG placeholder lines: two people on a rooftop with a kettle, talking. */
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
];

/** After Dark's model, stubbed: six fresh PG lines a step, and three suggestions; a recap, facts or a note their own. */
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
        reply = {
          lines,
          place: "the rooftop",
          set: "the rooftop",
          stage: 2,
          explicit: false,
          picture: null,
          suggestions: { mild: "They count the ferry lights together", flirty: "He teases her about her terrible tea", spicy: "They kiss in the rain" },
        };
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

/** A PG still of the two of them (their two portraits side by side) and a 2-second clip of it, made with ffmpeg. */
function placeholders(a, b) {
  const dir = join(DATA_DIR, "media");
  mkdirSync(dir, { recursive: true });
  const still = join(dir, "still.png");
  const clip = join(dir, "clip.mp4");
  const cast = (id) => join(ROOT, "public", "cast", `${id}-v3.webp`);
  const run = (args) => {
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "inherit"] });
    if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
  };
  run(["-i", cast(a), "-i", cast(b), "-filter_complex", "[0:v]scale=384:512[l];[1:v]scale=384:512[r];[l][r]hstack=inputs=2", "-frames:v", "1", still]);
  run(["-loop", "1", "-i", still, "-t", "2", "-vf", "scale=768:512,format=yuv420p", "-c:v", "libx264", "-r", "16", clip]);
  // A line's "voice": a second of a soft tone, for Listen to play.
  const tone = join(dir, "tone.wav");
  run(["-f", "lavfi", "-i", "sine=frequency=330:duration=1.2", "-af", "volume=0.2", tone]);
  return { still: readFileSync(still), clip: readFileSync(clip), tone: readFileSync(tone), portrait: (id) => readFileSync(cast(id)) };
}

/** Clips straight into the local database: a slow kiss kept going once, and a slow dance. */
async function seed(scenePath) {
  const [, , a, b] = scenePath.split("/");
  const db = new PGlite(DB_DIR);
  try {
    const owner = (await db.query("select user_id from admins limit 1")).rows[0].user_id;
    const media = placeholders(a, b);
    const put = (id, character, other, kind, mime, data) =>
      db.query("insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status) values ($1, $2, $3, $4, $5, 'PG placeholder', $6, $7, 'ready')", [
        id,
        owner,
        character,
        other,
        kind,
        mime,
        data,
      ]);
    await put("shots-base-a", a, null, "baseline", "image/webp", media.portrait(a));
    await put("shots-base-b", b, null, "baseline", "image/webp", media.portrait(b));
    for (const n of [1, 2, 3]) await put(`shots-frame-${n}`, a, b, "frame", "image/png", media.still);
    for (const n of [1, 2]) await put(`shots-video-${n}`, a, b, "video", "video/mp4", media.clip);
    await put("shots-voice", a, b, "audio", "audio/wav", media.tone);
    // The night at kissing (the stub's lines alone leave it at the first touches: a stage lasts 12 lines unsteered).
    await db.query("update adult_scenes set stage = 2 where owner_id = $1", [owner]);
    const shot = (n, motion, status = "ready") => ({
      line: 11,
      who: "a",
      text: "",
      frame: "PG placeholder",
      motion,
      status,
      ...(status === "ready" ? { media_id: `shots-video-${n}`, frame_id: `shots-frame-${n}` } : { media_id: `shots-frame-${n}`, frame_id: `shots-frame-${n}` }),
    });
    const reel = (id, minutes, status, shots, clip) =>
      db.query(
        "insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots, kind, clip, created_at) values ($1, $2, $3, $4, $5, 0, $6::jsonb, 'clip', $7::jsonb, now() - ($8 || ' minutes')::interval)",
        [id, owner, a, b, status, JSON.stringify(shots), JSON.stringify(clip), String(minutes)],
      );
    const kiss = { act: "kiss", swap: false, stage: 2, place: "the rooftop", label: "A slow kiss" };
    await reel("shots-clip-1", 30, "ready", [shot(1, "They kiss slowly and deeply.")], { ...kiss, from: null });
    await reel("shots-clip-2", 20, "ready", [shot(2, "They part for a breath, then kiss again.")], { ...kiss, from: "shots-clip-1" });
    await put("shots-video-3", a, b, "video", "video/mp4", media.clip);
    await reel("shots-clip-3", 5, "ready", [shot(3, "They sway together, turning slowly.")], { act: "dance", swap: false, stage: 0, place: "the rooftop", label: "A slow dance", from: null });
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
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT_DIR, `${file}.png`) });
    console.log(`  📸 docs/screenshots/${file}.png`);
  };
  const noSideways = async (page, name) => {
    const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
    assert(scroll <= width, `${name}: the page scrolls sideways on a phone (${scroll}px wide on a ${width}px screen)`);
    console.log(`  ✓ ${name}: no sideways scroll on a phone`);
  };
  /** Scrolls so `selector` sits just under the sticky header. */
  const under = (page, selector) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (document.querySelector("header")?.getBoundingClientRect().height ?? 0) - 16);
    }, selector);
  try {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const reg = await ctx.request.post(`${app.base}/api/auth/register`, { data: { handle: `shots${Date.now() % 1e6}`, password: "a-long-shots-password-1", attest: true } });
    assert(reg.ok(), `register: HTTP ${reg.status()}`);
    assert((await ctx.request.post(`${app.base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } })).ok(), "claiming admin");
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${app.base}/after-dark`);
    const scenePath = (await page.locator(".after-dark li.card a").first().getAttribute("href")) ?? "";
    assert(scenePath.startsWith("/after-dark/"), "a pair to open");
    await page.goto(`${app.base}${scenePath}`);
    // Two steps of PG lines, so the scene has a night to clip from.
    for (let k = 0; k < 2; k++) {
      const before = await page.locator(".after-dark-lines li").count();
      await page.locator(".after-dark-form button[type=submit]").click();
      await page.waitForFunction((n) => document.querySelectorAll(".after-dark-lines li").length > n, before, { timeout: 30_000 });
    }
    // The clips go straight into the database, with the app stopped (one process at a time on PGlite).
    await stopApp(app);
    await seed(scenePath);
    app = await startApp(port, env);

    if (SHOTS.has("clips")) {
      // The videos list: clips apart, each chain as one film with Keep going.
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${app.base}${scenePath}`);
      await page.locator(".ad-clips").waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: /Keep going/ }).first().waitFor({ timeout: 15_000 });
      await under(page, ".ad-clips");
      await page.evaluate(() => window.scrollBy(0, -60));
      await shot(page, "after-dark-clips-list-desktop");
      await page.setViewportSize({ width: 390, height: 844 });
      await under(page, ".ad-clips");
      await page.evaluate(() => window.scrollBy(0, -60));
      await noSideways(page, "the videos list");
      await shot(page, "after-dark-clips-list-phone");
    }
    if (SHOTS.has("ui")) {
      // The voice route answers the seeded tone for every line (no Kokoro here).
      await page.route("**/api/admin/after-dark/voice", async (route) => {
        const { lines = [] } = JSON.parse(route.request().postData() || "{}");
        await route.fulfill({ json: { voices: lines.map((l) => ({ i: l.i, id: "shots-voice" })) } });
      });
      for (const [w, h, size] of [[1280, 800, "desktop"], [390, 844, "phone"]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`${app.base}${scenePath}`);
        // The clip or picture panel, opened on a clip: a slow kiss picked, who's who shown.
        const panel = page.locator("details.ad-media");
        await panel.locator("summary").click();
        await panel.getByRole("button", { name: /Clip from here/ }).waitFor({ timeout: 20_000 });
        await panel.getByRole("button", { name: "A slow kiss" }).click();
        await under(page, "details.ad-media");
        if (size === "phone") await noSideways(page, "the clip menu");
        await shot(page, `after-dark-media-clip-${size}`);
        // A picture: cuddling, casual, wide.
        await panel.getByRole("tab", { name: /A picture/ }).click();
        await panel.getByRole("button", { name: "Cuddling" }).click();
        await panel.getByRole("button", { name: "Casual" }).click();
        await panel.getByRole("radio", { name: /Wide/ }).click();
        await under(page, "details.ad-media");
        if (size === "phone") await noSideways(page, "the picture menu");
        await shot(page, `after-dark-media-picture-${size}`);
        // Listen on the lines, from the top: the line being said marked.
        await page.getByRole("button", { name: "⏮ From the top" }).click();
        await page.getByText(/line \d+ of \d+/).first().waitFor({ timeout: 15_000 });
        await under(page, ".ad-listen");
        if (size === "phone") await noSideways(page, "Listen on the lines");
        await shot(page, `after-dark-listen-lines-${size}`);
        await page.getByRole("button", { name: "🔊 Listening" }).click();
        // The theater: 🔈 Listen and 🎞 Clip this in its tools, Listen on.
        await page.goto(`${app.base}${scenePath}?play=1`);
        await page.locator(".theater").getByRole("button", { name: /Listen: each line/ }).click();
        await page.waitForTimeout(1500);
        if (size === "phone") await noSideways(page, "the theater");
        await shot(page, `after-dark-listen-theater-${size}`);
      }
    }
    if (SHOTS.has("prices")) {
      // The settings: a clip's price and a menu picture's, under the video of the night's.
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${app.base}/admin/after-dark/settings`);
      await page.locator("#ad-clip-tokens").waitFor({ timeout: 30_000 });
      await under(page, "label[for=ad-reel-tokens]");
      await shot(page, "after-dark-prices-settings-desktop");
      await page.setViewportSize({ width: 390, height: 844 });
      await under(page, "label[for=ad-reel-tokens]");
      await noSideways(page, "the settings");
      await shot(page, "after-dark-prices-settings-phone");
    }
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
  console.error(`screenshots:after-dark-media failed: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * npm run screenshots:after-dark-steering: real-browser screenshots of After Dark learning from its viewer
 * (lib/adult/steering.ts) and the Archive (lib/adult/reels.ts archiveShot), desktop and phone, into docs/screenshots/:
 * their faces and three to pick from, 👍/👎 with what's off in the gallery and under a video, a shot taken out of its
 * video into the Archive and put back, and the looks builder's finer details on /create.
 *
 * It builds the app and runs it with ADULT_MODE=1 on a throwaway local database and a local stub for After Dark's model
 * that writes PG placeholder lines. No provider is called: the pictures and videos are seeded straight into the local
 * database, made here from the repo's own PG portraits (public/cast) with ffmpeg, and "Draw three" is answered with
 * three of them. Never anything explicit. On the phone it checks the page never scrolls sideways.
 *
 * Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build.
 */
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { PGlite } from "@electric-sql/pglite";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "after-dark-steering-screenshots");
const DB_DIR = join(DATA_DIR, "pglite");

/** PG placeholder lines: two people on a rooftop with a kettle, talking. */
const LINES = [
  ["smiles", "You kept me waiting by the railing. I counted every boat in the harbour."],
  ["laughs", "Seven boats? I'll make it up to you with my famously terrible tea."],
  ["", "Terrible how? Like, a little weak, or a crime against leaves?"],
  ["pours two cups", "A crime. But a warm one, and the rain's coming in off the water."],
  ["wraps both hands round the cup", "Then I'm staying for the crime. Tell me what you see out there."],
  ["points past the cranes", "That green light is the ferry. I used to time my whole day by it."],
];

/** After Dark's model, stubbed: six PG lines a step and three suggestions; a recap, facts or a note their own. */
function startAdultStub() {
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
        reply = {
          lines: LINES.map(([action, text], i) => ({ who: i % 2 ? "b" : "a", action, text, why: "the rooftop", memory: null })),
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

/** PG stand-ins made with ffmpeg: each one's portrait in three lights, the two side by side, and 2-second clips of it. */
function placeholders(a, b) {
  const dir = join(DATA_DIR, "media");
  mkdirSync(dir, { recursive: true });
  const cast = (id) => join(ROOT, "public", "cast", `${id}-v3.webp`);
  const run = (args) => {
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "inherit"] });
    if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
  };
  const out = (name) => join(dir, name);
  // The three lights "Draw three" offers, for each of them: natural, warm and moody, soft studio.
  const LIGHTS = { natural: "", warm: ",colorbalance=rs=0.25:gs=0.05:bs=-0.2,eq=brightness=-0.06:contrast=1.15", studio: ",eq=brightness=0.06:contrast=0.9:saturation=0.85" };
  for (const id of [a, b]) for (const [light, filter] of Object.entries(LIGHTS)) run(["-i", cast(id), "-vf", `scale=384:512${filter}`, "-frames:v", "1", out(`${id}-${light}.png`)]);
  run(["-i", cast(a), "-i", cast(b), "-filter_complex", "[0:v]scale=384:512[l];[1:v]scale=384:512[r];[l][r]hstack=inputs=2", "-frames:v", "1", out("still.png")]);
  const clip = (name, filter) => run(["-loop", "1", "-i", out("still.png"), "-t", "2", "-vf", `scale=768:512,${filter}format=yuv420p`, "-c:v", "libx264", "-r", "16", out(name)]);
  clip("clip1.mp4", "");
  clip("clip2.mp4", "hue=s=0.6,");
  clip("clip3.mp4", "colorbalance=bs=0.3,");
  const read = (name) => readFileSync(out(name));
  return { portrait: (id) => readFileSync(cast(id)), lit: (id, light) => read(`${id}-${light}.png`), still: read("still.png"), clips: [read("clip1.mp4"), read("clip2.mp4"), read("clip3.mp4")] };
}

/**
 * Straight into the local database: each one's baseline, three of each in three lights (what "Draw three" answers), a
 * scene picture of one with a 👎 on it, a picture of the two, a chain of clips (the last one in the Archive), a slow
 * dance, and a video of the night with one shot in the Archive.
 */
async function seed(scenePath) {
  const [, , a, b] = scenePath.split("/");
  const db = new PGlite(DB_DIR);
  try {
    const owner = (await db.query("select user_id from admins limit 1")).rows[0].user_id;
    const media = placeholders(a, b);
    const put = (id, character, other, kind, mime, data, minutes, preset = null) =>
      db.query(
        "insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, preset, created_at) values ($1, $2, $3, $4, $5, 'PG placeholder', $6, $7, 'ready', $8, now() - ($9 || ' minutes')::interval)",
        [id, owner, character, other, kind, mime, data, preset, String(minutes)],
      );
    await put("steer-base-a", a, null, "baseline", "image/webp", media.portrait(a), 90, "natural");
    await put("steer-base-b", b, null, "baseline", "image/webp", media.portrait(b), 90, "natural");
    for (const id of [a, b]) for (const light of ["natural", "warm", "studio"]) await put(`steer-pick-${light}-${id}`, id, null, "baseline", "image/png", media.lit(id, light), 80, light);
    await put("steer-scene-a", a, null, "scene", "image/png", media.lit(a, "warm"), 40, "warm");
    // One of them wears something (a casual outfit), so the faces panel shows the face of their intimate scenes too: a
    // nude baseline, here a PG stand-in marked nude (lib/adult/attire.ts).
    await db.query(
      `update characters set extras = coalesce(extras, '{}'::jsonb) || jsonb_build_object('looks', jsonb_build_object('gender', case when pronouns like 'she%' then 'woman' else 'man' end, 'outfit', 'casual')) where id = $1`,
      [a],
    );
    await put("steer-nude-a", a, null, "baseline", "image/png", media.lit(a, "studio"), 70, "studio");
    await db.query("update adult_images set attire = 'nude' where id = 'steer-nude-a'");
    await put("steer-scene-ab", a, b, "scene", "image/png", media.still, 35);
    // A 👎 on her scene picture: what was off, open.
    await db.query("insert into adult_media_thumbs (owner_id, media_id, rating, tags) values ($1, 'steer-scene-a', -1, '[\"face\", \"blurry\"]'::jsonb)", [owner]);
    for (const n of [1, 2, 3, 4, 5, 6, 7]) await put(`steer-frame-${n}`, a, b, "frame", "image/png", media.still, 30);
    for (const n of [1, 2, 3, 4, 5, 6, 7]) await put(`steer-video-${n}`, a, b, "video", "video/mp4", media.clips[(n - 1) % 3], 30);
    // Each video made from its keyframe, so the keyframe can be shown (a poster in the Archive: lib/adult/media.ts FRAME_SHOWN).
    await db.query("update adult_images set source_image = replace(id, 'steer-video-', 'steer-frame-') where id like 'steer-video-%'");
    await db.query("update adult_scenes set stage = 2 where owner_id = $1", [owner]);
    const shot = (n, line, motion, text = "", archived = false) => ({
      line,
      who: line % 2 ? "b" : "a",
      text,
      frame: "PG placeholder",
      motion,
      status: "ready",
      media_id: `steer-video-${n}`,
      frame_id: `steer-frame-${n}`,
      ...(archived ? { archived_at: new Date(Date.now() - 10 * 60_000).toISOString() } : {}),
    });
    const reel = (id, minutes, kind, shots, clip) =>
      db.query(
        "insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots, kind, clip, created_at) values ($1, $2, $3, $4, 'ready', 0, $5::jsonb, $6, $7::jsonb, now() - ($8 || ' minutes')::interval)",
        [id, owner, a, b, JSON.stringify(shots), kind, clip ? JSON.stringify(clip) : null, String(minutes)],
      );
    const kiss = { act: "kiss", swap: false, stage: 2, place: "the rooftop", label: "A slow kiss" };
    await reel("steer-clip-1", 30, "clip", [shot(1, 5, "They kiss slowly and deeply.")], { ...kiss, from: null });
    await reel("steer-clip-2", 25, "clip", [shot(2, 5, "They part for a breath, then kiss again.")], { ...kiss, from: "steer-clip-1" });
    // It came out wrong: taken out, into the Archive. Keep going carries on from the clip before.
    await reel("steer-clip-3", 20, "clip", [shot(3, 5, "Her face slides as they turn.", "", true)], { ...kiss, from: "steer-clip-2" });
    await reel("steer-clip-4", 12, "clip", [shot(4, 5, "They sway together, turning slowly.")], { act: "dance", swap: false, stage: 0, place: "the rooftop", label: "A slow dance", from: null });
    await reel("steer-night", 60, "night", [
      shot(5, 0, "She leans on the railing.", LINES[0][1].slice(0, 60)),
      shot(6, 1, "He laughs, holding up the kettle.", LINES[1][1].slice(0, 60), true),
      shot(7, 3, "He pours two cups.", LINES[3][1].slice(0, 60)),
    ]);
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
    const { scroll } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth }));
    const width = page.viewportSize()?.width ?? 0;
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
    const reg = await ctx.request.post(`${app.base}/api/auth/register`, { data: { handle: `steer${Date.now() % 1e6}`, password: "a-long-shots-password-1", attest: true } });
    assert(reg.ok(), `register: HTTP ${reg.status()}`);
    assert((await ctx.request.post(`${app.base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } })).ok(), "claiming admin");
    // Discreet mode's blur off, so the PG stand-ins show (lib/adult/privacy.ts; it's on by default).
    assert((await ctx.request.post(`${app.base}/api/admin/after-dark/privacy`, { data: { blur: false } })).ok(), "turning the blur off");
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${app.base}/after-dark`);
    const scenePath = (await page.locator(".after-dark li.card a").first().getAttribute("href")) ?? "";
    assert(scenePath.startsWith("/after-dark/"), "a pair to open");
    await page.goto(`${app.base}${scenePath}`);
    const before = await page.locator(".after-dark-lines li").count();
    await page.locator(".after-dark-form button[type=submit]").click();
    await page.waitForFunction((n) => document.querySelectorAll(".after-dark-lines li").length > n, before, { timeout: 30_000 });
    // The pictures and videos go straight into the database, with the app stopped (one process at a time on PGlite).
    await stopApp(app);
    await seed(scenePath);
    app = await startApp(port, env);
    // "Draw three to pick from" answered with the three seeded pictures of whoever was asked for (no provider here).
    await page.route("**/api/admin/after-dark/baselines", async (route) => {
      const { character_id } = JSON.parse(route.request().postData() || "{}");
      const pictures = ["natural", "warm", "studio"].map((p) => ({ id: `steer-pick-${p}-${character_id}`, character_id, character_b: null, kind: "baseline", status: "ready", created_at: new Date().toISOString(), mime: "image/png", preset: p, rating: null, tags: [], face: false }));
      await route.fulfill({ json: { pictures, failed: 0 } });
    });

    for (const [w, h, size] of [
      [1280, 800, "desktop"],
      [390, 844, "phone"],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${app.base}${scenePath}`);
      // Their faces: three to pick from, then one picked.
      const faces = page.locator(".ad-faces");
      await faces.waitFor({ timeout: 30_000 });
      await faces.getByRole("button", { name: "Draw three to pick from" }).first().click();
      await faces.locator(".ad-face-choices img").nth(2).waitFor({ timeout: 15_000 });
      await page.waitForFunction(() => [...document.querySelectorAll(".ad-face-choices img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15_000 });
      await under(page, ".ad-faces");
      if (size === "phone") await noSideways(page, "the faces panel");
      await shot(page, `after-dark-faces-pick-${size}`);
      // One that isn't their face yet (a face picked before is a 👍, so it stays the default once let go).
      await faces.locator(".ad-face-choices").getByRole("button", { name: "Use this face" }).first().click();
      await faces.getByText("You picked this face.").waitFor({ timeout: 15_000 });
      if (size === "desktop") {
        await under(page, ".ad-faces");
        await shot(page, "after-dark-faces-picked-desktop");
      }
      // The one who wears something has the face of their intimate scenes, with its own Draw three.
      await faces.locator(".ad-face-nude").getByRole("button", { name: "Draw three, undressed" }).waitFor({ timeout: 15_000 });
      await under(page, ".ad-face-nude");
      if (size === "phone") await noSideways(page, "the intimate-scenes face");
      await shot(page, `after-dark-faces-nude-${size}`);
      // The gallery: 👍/👎 on each, what's off open on the 👎, Use this face on a picture of one of them alone.
      await page.locator(".after-dark-gallery .ad-rate-tags").first().waitFor({ timeout: 15_000 });
      await under(page, ".after-dark-gallery li:has(.ad-rate-tags)");
      if (size === "phone") await noSideways(page, "the gallery");
      await shot(page, `after-dark-gallery-rate-${size}`);
      // Under a video: the shot on screen, 👍/👎 and Remove this shot; the Archive below, open.
      const archive = page.locator("details.ad-archive");
      await archive.waitFor({ timeout: 15_000 });
      await archive.locator("summary").click();
      const archived = async () => archive.locator(".ad-archive-list li").count();
      assert((await archived()) === 2, `the Archive should start with 2 shots, not ${await archived()}`);
      const dance = page.locator(".ad-clip-chain", { hasText: "A slow dance" });
      await dance.locator(".ad-shot-bar").waitFor({ timeout: 30_000 });
      // Said already on the first size: it shows as it was left.
      if (!(await dance.locator(".ad-rate-tags .chip-on").count())) {
        await dance.locator(".ad-shot-bar").getByRole("button", { name: "Not right", exact: true }).click();
        await dance.locator(".ad-rate-tags").getByRole("button", { name: "Jerky or morphing", exact: true }).click();
      }
      await dance.locator(".ad-rate-tags .chip-on").waitFor({ timeout: 10_000 });
      await under(page, ".ad-clips");
      if (size === "phone") await noSideways(page, "the videos and a shot's rating");
      await shot(page, `after-dark-shot-rate-${size}`);
      // Remove this shot: the dance goes to the Archive (its chain leaves the list), then Put it back.
      await dance.getByRole("button", { name: "Remove this shot" }).click();
      await page.waitForFunction(() => document.querySelectorAll(".ad-archive-list li").length === 3, null, { timeout: 15_000 });
      assert((await page.locator(".ad-clip-chain", { hasText: "A slow dance" }).count()) === 0, "the dance stayed in the list after it was taken out");
      await under(page, "details.ad-archive");
      if (size === "phone") await noSideways(page, "the Archive");
      await shot(page, `after-dark-archive-${size}`);
      await archive.locator(".ad-archived-shot", { hasText: "A slow dance" }).getByRole("button", { name: "Put it back" }).click();
      await page.waitForFunction(() => document.querySelectorAll(".ad-archive-list li").length === 2, null, { timeout: 15_000 });
      await page.locator(".ad-clip-chain", { hasText: "A slow dance" }).waitFor({ timeout: 15_000 });
      console.log(`  ✓ ${size}: a shot taken out went to the Archive and came back`);
      // The rating stuck: the page again, the 👎 and its tag still on.
      await page.reload();
      const again = page.locator(".ad-clip-chain", { hasText: "A slow dance" });
      await again.locator(".ad-rate-tags .chip-on", { hasText: "Jerky or morphing" }).waitFor({ timeout: 30_000 });
      // Put the face back to the default for the next size.
      await page.locator(".ad-faces").getByRole("button", { name: "Let it pick for me" }).first().click();
      await page.locator(".ad-faces").getByText("You picked this face.").waitFor({ state: "detached", timeout: 15_000 });
      if (size === "phone") {
        // Start fresh: what the ratings steered is set aside (nothing deleted), and stays so after a reload.
        // The first card: the 👎 on its scene picture, and the one on the pair's video, both count for it.
        const card = () => page.locator(".ad-faces .ad-face").first();
        await card().getByRole("button", { name: "Start fresh" }).click();
        await card().getByText("Nothing for your ratings to steer yet.").waitFor({ timeout: 15_000 });
        await page.reload();
        await page.locator(".ad-faces").waitFor({ timeout: 30_000 });
        assert((await card().getByText("Nothing for your ratings to steer yet.").count()) === 1, "Start fresh didn't hold after a reload");
        console.log("  ✓ phone: Start fresh set the steering aside, and it held after a reload");
      }
    }

    // The looks builder's finer details on /create: chips on the look's summary. A fresh visitor each time (no draft).
    for (const [w, h, size] of [
      [1280, 800, "desktop"],
      [390, 844, "phone"],
    ]) {
      const fresh = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await fresh.newPage();
      await page.goto(`${app.base}/create`);
      await page.getByRole("button", { name: "Use a sample character" }).click();
      await page.getByRole("button", { name: "Next: Voice" }).click();
      await page.getByRole("button", { name: "Next: Look" }).click();
      await page.getByRole("button", { name: "Woman", exact: true }).click();
      await page.getByRole("button", { name: "Realistic" }).click();
      await page.getByRole("button", { name: /Latina/ }).click();
      await page.getByText("How old do they look?").waitFor();
      await page.getByRole("button", { name: "Your look" }).click();
      const details = page.locator(".looks-details");
      await details.waitFor({ timeout: 15_000 });
      await details.getByRole("radiogroup", { name: "Freckles or a beauty mark" }).getByRole("radio", { name: "Freckles", exact: true }).click();
      await details.getByRole("radiogroup", { name: "Glasses" }).getByRole("radio", { name: "Wire frames", exact: true }).click();
      await details.getByRole("radiogroup", { name: "Tattoos" }).getByRole("radio", { name: "One small", exact: true }).click();
      await page.getByText(/a light dusting of freckles/).first().waitFor({ timeout: 10_000 });
      await under(page, ".looks-summary");
      if (size === "phone") await noSideways(page, "the looks builder's details");
      await shot(page, `looks-details-${size}`);
      await fresh.close();
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
  console.error(`screenshots:after-dark-steering failed: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * npm run screenshots:after-dark-shorts: real-browser screenshots of After Dark's show features (lib/adult/shorts.ts),
 * desktop and phone, into docs/screenshots/. It builds the app and runs it with ADULT_MODE=1 on a throwaway local
 * database. No model or provider is called: a two-chapter night of PG placeholder lines (tea on a rooftop, then a
 * sofa downstairs), a cover and a video of it are seeded straight into the local database, the pictures and clips made here from
 * the repo's own PG portraits (public/cast) with ffmpeg, and all of it deleted with the database afterwards.
 *
 *   shorts: the admin's 📺 Shorts panel on the pair's page, publishing the night; the Shorts list and one Short for a
 *     subscriber (before ▶ Play, the theater, then the night in chapters with its video); the blurred teaser for
 *     someone After Dark isn't open to.
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
const DATA_DIR = join(ROOT, ".data", "after-dark-shorts-screenshots");
const DB_DIR = join(DATA_DIR, "pglite");
const PASSWORD = ["a", "long", "shots", "password", "1"].join("-");
/** A person's browser: headless Chrome says "HeadlessChrome", which lib/bots.ts counts as a bot (and bots get no Shorts). */
const PERSON = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" };

/** The night, PG: who speaks, their words, how far it had gone (0 talking, 1 first touches, 2 kissing), where they went. */
const CHAPTER_1 = [
  ["a", "*smiles* You kept me waiting by the railing. I counted every boat in the harbour.", 0],
  ["b", "Seven boats? I'll make it up to you with my famously terrible tea.", 0],
  ["a", "Terrible how? Like, a little weak, or a crime against leaves?", 0],
  ["b", "*pours two cups* A crime. But a warm one, and the rain's coming in off the water.", 0],
  ["a", "Then I'm staying for the crime. Tell me what you see out there.", 0],
  ["b", "*points past the cranes* That green light is the ferry. I used to time my whole day by it.", 0],
  ["a", "*reaches for a hand under the blanket* And now you time it by whoever's on the roof?", 1],
  ["b", "Now I time it by the kettle. You're a close second, though.", 1],
  ["a", "The rain's picking up. My flat is two floors down, and my kettle's better.", 1],
  ["b", "Yours, then. Lead the way before the tea goes cold.", 1, "the flat downstairs"],
];
const CHAPTER_2 = [
  ["a", "*shakes off the rain* Welcome to the smallest flat in the harbour.", 1],
  ["b", "It's perfect. You have three kettles. Of course you have three kettles.", 1],
  ["a", "*laughs as they land on the sofa together* Pick one. It's a test.", 1],
  ["b", "The chipped one. It's seen things. *a slow kiss*", 2],
  ["a", "Correct answer. *kisses back* You can stay for the second cup.", 2],
  ["b", "I'll stay for the third. The ferry can wait till morning.", 2],
];
const HISTORY = [
  { place: "the rooftop", set: "the rooftop", home: null, chapter: 1 },
  { place: "the flat downstairs", set: "the flat downstairs", home: "a", chapter: 1 },
];

/** No model is called on these pages; a stand-in answers anything that does with PG filler. */
function startAdultStub() {
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
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

/** What a reel shot says of its line (lib/adult/reels.ts spoken): its words, without the leading *action*. */
const spoken = (text) => {
  const m = text.match(/^\*([^*]+)\*\s*([\s\S]*)$/);
  return (m ? m[2] : text).trim().split(/\s+/).filter(Boolean).slice(0, 24).join(" ");
};

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
  return { still: readFileSync(still), clip: readFileSync(clip) };
}

/** The night, its cover and its video straight into the local database, and the subscriber's entitlement. */
async function seed(pair, subscriberHandle) {
  const [a, b] = pair;
  const db = new PGlite(DB_DIR);
  try {
    const owner = (await db.query("select user_id from admins limit 1")).rows[0].user_id;
    const sub = (await db.query("select user_id from accounts where handle = $1", [subscriberHandle])).rows[0].user_id;
    await db.query("insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())", [sub]);
    const asLines = (rows) => rows.map(([who, text, stage, moved]) => ({ who, text, stage, why: "private note", memory: null, ...(moved ? { moved_to: moved } : {}) }));
    const night = (id, chapter, rows, ago) =>
      db.query(
        `insert into adult_nights (id, owner_id, character_a, character_b, lines, place, stage, chapter, place_history, set_place, date_setting, created_at)
         values ($1, $2, $3, $4, $5::jsonb, 'the flat downstairs', $6, $7, $8::jsonb, 'the flat downstairs', 'the rooftop', now() - ($9 || ' minutes')::interval)`,
        [id, owner, a, b, JSON.stringify(asLines(rows)), Math.max(...rows.map((r) => r[2])), chapter, JSON.stringify(HISTORY), String(ago)],
      );
    await night("shots-night-1", 1, CHAPTER_1, 50);
    await night("shots-night-2", 2, CHAPTER_2, 40);
    // Start over ended the night: the scene is back on chapter 1.
    await db.query("insert into adult_scenes (id, owner_id, character_a, character_b, chapter) values ('shots-scene', $1, $2, $3, 1) on conflict do nothing", [owner, a, b]);
    const media = placeholders(a, b);
    const put = (id, kind, mime, data, ago) =>
      db.query(
        "insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, created_at) values ($1, $2, $3, $4, $5, 'PG placeholder', $6, $7, 'ready', now() - ($8 || ' minutes')::interval)",
        [id, owner, a, b, kind, mime, data, String(ago)],
      );
    await put("shots-cover", "scene", "image/png", media.still, 49);
    const shots = [];
    for (const [n, i] of [[1, 1], [2, 5], [3, 8]]) {
      await put(`shots-frame-${n}`, "frame", "image/png", media.still, 45);
      await put(`shots-video-${n}`, "video", "video/mp4", media.clip, 45);
      const [who, text] = CHAPTER_1[i];
      shots.push({ line: i, who, text: spoken(text), frame: "PG placeholder", motion: "PG placeholder", status: "ready", media_id: `shots-video-${n}`, frame_id: `shots-frame-${n}` });
    }
    await db.query("insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots, kind, created_at) values ('shots-reel', $1, $2, $3, 'ready', 0, $4::jsonb, 'night', now() - interval '44 minutes')", [
      owner,
      a,
      b,
      JSON.stringify(shots),
    ]);
  } finally {
    await db.close();
  }
}

async function register(ctx, base, handle) {
  await ctx.addCookies([{ name: "bz_adult", value: "1", url: base }]);
  const reg = await ctx.request.post(`${base}/api/auth/register`, { data: { handle, password: PASSWORD, attest: true } });
  assert(reg.ok(), `register ${handle}: HTTP ${reg.status()}`);
}

/** No sideways scroll on a phone. */
async function checkPhone(page, name) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  assert(scroll <= width, `${name}: the page scrolls sideways on a phone (${scroll}px wide on a ${width}px screen)`);
  console.log(`  ✓ ${name}: no sideways scroll`);
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
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT_DIR, `after-dark-${file}.png`) });
    console.log(`  📸 docs/screenshots/after-dark-${file}.png`);
  };
  const desktop = (page) => page.setViewportSize({ width: 1280, height: 800 });
  const phone = (page) => page.setViewportSize({ width: 390, height: 844 });
  const top = (page, sel, by = 90) => page.evaluate(([s, y]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + window.scrollY - y), [sel, by]);
  try {
    // An admin and a subscriber, made on the app; then the night goes straight into its database.
    const adminCtx = await browser.newContext(PERSON);
    await register(adminCtx, app.base, `shotsad${Date.now() % 1e6}`);
    assert((await adminCtx.request.post(`${app.base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } })).ok(), "claiming admin");
    const subHandle = `shotssub${Date.now() % 1e6}`;
    const subCtx = await browser.newContext(PERSON);
    await register(subCtx, app.base, subHandle);
    const admin = await adminCtx.newPage();
    await desktop(admin);
    await admin.goto(`${app.base}/after-dark`);
    const scenePath = (await admin.locator(".after-dark li.card a").first().getAttribute("href")) ?? "";
    assert(scenePath.startsWith("/after-dark/"), "a pair to open");
    const pair = scenePath.split("/").slice(2, 4);
    await stopApp(app);
    await seed(pair, subHandle);
    app = await startApp(port, env);

    // The admin publishes the night from the pair's page.
    await admin.goto(`${app.base}${scenePath}`);
    const panel = admin.locator(".ad-shorts");
    await panel.locator("summary").click();
    await panel.getByText("Publish as a Short").waitFor({ timeout: 30_000 });
    await panel.locator('input[type="text"]').first().fill("Rooftop tea, then downstairs");
    await top(admin, ".ad-shorts");
    await shot(admin, "shorts-publish-desktop");
    await phone(admin);
    await top(admin, ".ad-shorts", 70);
    await checkPhone(admin, "the Shorts panel");
    await shot(admin, "shorts-publish-phone");
    await desktop(admin);
    await panel.getByRole("button", { name: "Publish as a Short" }).click();
    await panel.getByText("📺 Published").waitFor({ timeout: 30_000 });
    const shortPath = (await panel.getByRole("link", { name: "Open it" }).getAttribute("href")) ?? "";
    assert(shortPath.startsWith("/after-dark/shorts/"), "the Short's address");

    // A subscriber: the list, the Short before ▶ Play, the theater, then the night with its video.
    const sub = await subCtx.newPage();
    await desktop(sub);
    await sub.goto(`${app.base}/after-dark/shorts`);
    await sub.getByText("Rooftop tea, then downstairs").first().waitFor({ timeout: 30_000 });
    await shot(sub, "shorts-list-desktop");
    await phone(sub);
    await checkPhone(sub, "the Shorts list");
    await shot(sub, "shorts-list-phone");
    await desktop(sub);
    await sub.goto(`${app.base}${shortPath}`);
    await sub.getByRole("button", { name: "▶ Play" }).waitFor({ timeout: 30_000 });
    await shot(sub, "shorts-short-desktop");
    await phone(sub);
    await checkPhone(sub, "a Short before play");
    await shot(sub, "shorts-short-phone");
    await desktop(sub);
    await sub.getByRole("button", { name: "▶ Play" }).click();
    await sub.locator(".theater").waitFor({ timeout: 30_000 });
    await sub.waitForTimeout(6000);
    await shot(sub, "shorts-theater-desktop");
    await sub.getByRole("button", { name: "Exit" }).click();
    await sub.getByText("Chapter 2").first().waitFor({ timeout: 15_000 });
    await top(sub, ".after-dark-reel", 120);
    await shot(sub, "shorts-night-desktop");
    await phone(sub);
    await top(sub, ".after-dark-reel", 80);
    await checkPhone(sub, "a Short's night");
    await shot(sub, "shorts-night-phone");

    // Someone After Dark isn't open to: the teaser.
    const anon = await browser.newContext(PERSON);
    await anon.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const tease = await anon.newPage();
    await desktop(tease);
    await tease.goto(`${app.base}/after-dark/shorts`);
    await tease.getByText("Subscribe to unlock").first().waitFor({ timeout: 30_000 });
    const html = await tease.content();
    assert(!html.includes("I counted every boat") && !html.includes("/media/"), "the teaser has none of the night");
    await shot(tease, "shorts-teaser-desktop");
    await phone(tease);
    await checkPhone(tease, "the teaser");
    await shot(tease, "shorts-teaser-phone");
    await Promise.all([adminCtx.close(), subCtx.close(), anon.close()]);
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
    adult.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`screenshots:after-dark-shorts failed: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});

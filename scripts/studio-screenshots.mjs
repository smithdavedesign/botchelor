#!/usr/bin/env node
/**
 * npm run screenshots:studio: real-browser screenshots of the After Dark Studio (lib/adult/studio.ts, docs/PRDs/studio.md),
 * desktop and phone, into docs/screenshots/: a shoot's menus with choices picked, a shoot together with a partner's
 * menu, the gallery with a picture's share and animate panels open (and a clip), the saved setups, and the hub's
 * "Shared with you" as the person it was shared with sees it.
 *
 * It builds the app and runs it with ADULT_MODE=1 on a throwaway local database. No provider is called and nothing is
 * drawn: the pictures and the clip are seeded straight into the database, made here from the repo's own PG portraits
 * (public/cast) with ffmpeg. Never anything explicit. On the phone it checks the page never scrolls sideways.
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
const DATA_DIR = join(ROOT, ".data", "studio-screenshots");
const DB_DIR = join(DATA_DIR, "pglite");
/** The Studio's character, and who she's shot together with: two of the house cast (an admin's Studio has them). */
const HER = "house-juniper";
const HIM = "house-dex";

/** After Dark's model, stubbed: the Studio never asks it anything, but After Dark needs one to be on. */
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

/** PG stand-ins made with ffmpeg: her portrait in four looks, the two side by side, and a 2-second clip of her. */
function placeholders() {
  const dir = join(DATA_DIR, "media");
  mkdirSync(dir, { recursive: true });
  const cast = (id) => join(ROOT, "public", "cast", `${id}-v3.webp`);
  const run = (args) => {
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "inherit"] });
    if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
  };
  const out = (name) => join(dir, name);
  const LOOKS = {
    natural: "",
    golden: ",colorbalance=rs=0.22:gs=0.08:bs=-0.18,eq=brightness=0.02:saturation=1.15",
    moody: ",colorbalance=rs=0.25:gs=0.05:bs=-0.2,eq=brightness=-0.08:contrast=1.2",
    studio: ",eq=brightness=0.06:contrast=0.9:saturation=0.85",
    cool: ",colorbalance=bs=0.2:rs=-0.05,eq=contrast=1.05",
  };
  for (const [look, filter] of Object.entries(LOOKS)) run(["-i", cast(HER), "-vf", `scale=384:512${filter}`, "-frames:v", "1", out(`her-${look}.png`)]);
  run(["-i", cast(HER), "-i", cast(HIM), "-filter_complex", "[0:v]scale=384:512[l];[1:v]scale=384:512[r];[l][r]hstack=inputs=2,scale=384:256,pad=384:512:0:128", "-frames:v", "1", out("both.png")]);
  run(["-i", cast(HER), "-i", cast(HIM), "-filter_complex", "[0:v]scale=384:512,colorbalance=rs=0.2:bs=-0.15[l];[1:v]scale=384:512,colorbalance=rs=0.2:bs=-0.15[r];[l][r]hstack=inputs=2,scale=384:256,pad=384:512:0:128", "-frames:v", "1", out("both-golden.png")]);
  run(["-loop", "1", "-i", out("her-golden.png"), "-t", "2", "-vf", "scale=384:512,zoompan=z='min(zoom+0.002,1.08)':d=32:s=384x512,format=yuv420p", "-c:v", "libx264", "-r", "16", out("clip.mp4")]);
  const read = (name) => readFileSync(out(name));
  return { her: (look) => read(`her-${look}.png`), both: read("both.png"), bothGolden: read("both-golden.png"), clip: read("clip.mp4") };
}

/**
 * Straight into the local database: her face, a dressed shoot of four (one shared in After Dark and accepted, one sent
 * as a photo), a body reference, a clip animated from one, a shoot of the two of them, two saved setups, and the
 * recipient's character with a date of theirs with her.
 */
async function seed(owner, recipient) {
  const db = new PGlite(DB_DIR);
  try {
    const media = placeholders();
    const put = (id, character, other, kind, mime, data, minutes, extra = {}) =>
      db.query(
        `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, preset, shoot_id, nsfw_score, model, source_image, created_at)
         values ($1, $2, $3, $4, $5, 'PG placeholder', $6, $7, 'ready', $8, $9, $10, $11, $12, now() - ($13 || ' minutes')::interval)`,
        [id, owner, character, other, kind, mime, data, extra.preset ?? null, extra.shoot ?? null, extra.nsfw ?? null, extra.model ?? null, extra.source ?? null, String(minutes)],
      );
    const shoot = (id, kind, choices, pictures, minutes, extra = {}) =>
      db.query(
        `insert into adult_studio_shoots (id, owner_id, character_id, partner_id, kind, choices, model, provider, tokens, asked, made, status, pictures, created_at)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, 'venice', 0, $8, $8, 'ready', $9::jsonb, now() - ($10 || ' minutes')::interval)`,
        [id, owner, HER, extra.partner ?? null, kind, JSON.stringify(choices), extra.model ?? "qwen-edit-uncensored", pictures.length, JSON.stringify(pictures), String(minutes)],
      );
    await put("studio-face", HER, null, "baseline", "image/png", media.her("natural"), 120, { preset: "natural" });
    await db.query(`insert into adult_face_refs (owner_id, character_id, image_id) values ($1, $2, 'studio-face')`, [owner, HER]);
    // A dressed shoot of four: evening wear in a hotel suite, golden hour.
    const four = ["golden", "moody", "studio", "cool"].map((look, i) => ({ id: `studio-shot-${i + 1}`, look }));
    await shoot("shoot-1", "shoot", { pose: "shoulder", wardrobe: "evening", place: "hotel", light: "golden", level: 0 }, four.map((p) => p.id), 60);
    for (const [i, p] of four.entries()) await put(p.id, HER, null, "scene", "image/png", media.her(p.look), 60 - i, { shoot: "shoot-1", nsfw: 0.03, model: "qwen-edit-uncensored", preset: i === 0 ? "warm" : null });
    await put("studio-body", HER, null, "scene", "image/png", media.her("studio"), 90, { model: "qwen-edit-uncensored" });
    await db.query(`insert into adult_identity (owner_id, character_id, body_image_id, strength) values ($1, $2, 'studio-body', 'balanced')`, [owner, HER]);
    // A clip animated from the first.
    await shoot("shoot-anim", "animate", { source: "studio-shot-1", motion: "turn", seconds: 5, queue_id: "q-1", level: 0 }, ["studio-clip"], 20, { model: "wan-3-0-image-to-video" });
    await put("studio-clip", HER, null, "video", "video/mp4", media.clip, 20, { shoot: "shoot-anim", model: "wan-3-0-image-to-video", source: "studio-shot-1" });
    // A shoot of the two of them (kept under the pair's order).
    await shoot("shoot-pair", "pair", { partner: HIM, act: "dance", outfit: "dressed_up", framing: "wide", place: "rooftop", light: "golden", stage: 0 }, ["studio-pair-1", "studio-pair-2"], 40, { partner: HIM });
    await put("studio-pair-1", HIM, HER, "scene", "image/png", media.both, 40, { shoot: "shoot-pair", model: "qwen-edit-uncensored" });
    await put("studio-pair-2", HIM, HER, "scene", "image/png", media.bothGolden, 39, { shoot: "shoot-pair", model: "qwen-edit-uncensored" });
    // Saved setups.
    await db.query(
      `insert into adult_studio_setups (id, owner_id, name, kind, choices, model) values
         ('setup-1', $1, 'Golden hour, hotel', 'shoot', '{"pose":"shoulder","wardrobe":"evening","place":"hotel","light":"golden"}'::jsonb, 'qwen-edit-uncensored'),
         ('setup-2', $1, 'Slow dance on the roof', 'pair', '{"act":"dance","outfit":"dressed_up","framing":"wide","place":"rooftop","light":"golden"}'::jsonb, null),
         ('setup-3', $1, 'Morning, window light', 'shoot', '{"pose":"stretch","wardrobe":"shirt","light":"natural"}'::jsonb, 'qwen-image-2-1-turbo-edit')`,
      [owner],
    );
    // The recipient: an account, a character of theirs, and a date with her (who her pictures can go to).
    await db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, pronouns)
       values ('juno-park', $1, false, 'Juno Park', 31, 'A lighthouse keeper''s daughter who restores old boats.', '["wry","patient"]'::jsonb, 'someone who stays for the whole tide', 'cruelty to waiters', 'she/her')`,
      [recipient],
    );
    await db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, transcript, status, visibility)
       values ('ep-juno', $1, $2, 'juno-park', 'the lighthouse', '{}'::jsonb, '[]'::jsonb, '', '', 'second_date', now(), '[]'::jsonb, 'ready', 'public')`,
      [recipient, HER],
    );
    // One shared in After Dark and accepted, one asked and waiting, one sent as a photo in their texts.
    const share = (id, item, kind, status, minutes) =>
      db.query(
        `insert into adult_shares (id, item_id, owner_id, from_character, recipient_id, to_character, kind, status, created_at) values ($1, $2, $3, $4, $5, 'juno-park', $6, $7, now() - ($8 || ' minutes')::interval)`,
        [id, item, owner, HER, recipient, kind, status, String(minutes)],
      );
    await share("share-1", "studio-shot-1", "after_dark", "accepted", 30);
    await share("share-2", "studio-shot-2", "after_dark", "pending", 10);
    await share("share-3", "studio-shot-3", "photo", "sent", 25);
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
  });
  const port = await freePort();
  let app = await startApp(port, env);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const shot = async (page, file) => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT_DIR, `${file}.png`) });
    console.log(`  📸 docs/screenshots/${file}.png`);
  };
  const noSideways = async (page, name) => {
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    const width = page.viewportSize()?.width ?? 0;
    // What sticks out, when something does: the widest elements past the screen's right edge.
    const past = await page.evaluate((w) => {
      const out = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right > w + 1) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} (${Math.round(r.right)}px)`);
      }
      return out.slice(0, 8);
    }, width);
    assert(scroll <= width, `${name}: the page scrolls sideways on a phone (${scroll}px wide on a ${width}px screen): ${past.join(", ")}`);
    console.log(`  ✓ ${name}: no sideways scroll on a phone`);
  };
  /** Scrolls so `selector` sits just under the sticky header. */
  const under = (page, selector) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (document.querySelector("header")?.getBoundingClientRect().height ?? 0) - 16);
    }, selector);
  /** A signed-in admin with After Dark's blur off, in a browser context of their own. */
  const admin = async (handle) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const reg = await ctx.request.post(`${app.base}/api/auth/register`, { data: { handle, password: "a-long-shots-password-1", attest: true } });
    assert(reg.ok(), `register: HTTP ${reg.status()}`);
    assert((await ctx.request.post(`${app.base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } })).ok(), "claiming admin");
    assert((await ctx.request.post(`${app.base}/api/admin/after-dark/privacy`, { data: { blur: false } })).ok(), "turning the blur off");
    return { ctx };
  };
  try {
    const owner = await admin(`studio${Date.now() % 1e6}`);
    const recipient = await admin(`juno${Date.now() % 1e6}`);
    // Placeholder keys, so the models read as set up (nothing is ever called with them here).
    const keys = await owner.ctx.request.post(`${app.base}/api/admin/after-dark/settings`, { data: { venice_key: "placeholder-venice-studio-0001", hive_key: "placeholder-hive-studio-0001", enabled: true } });
    assert(keys.ok(), `saving placeholder keys: HTTP ${keys.status()}`);
    // Who they are, from the database (the session cookie doesn't say).
    await stopApp(app);
    const ids = await (async () => {
      const db = new PGlite(DB_DIR);
      try {
        return (await db.query("select user_id from accounts order by created_at")).rows.map((r) => r.user_id);
      } finally {
        await db.close();
      }
    })();
    assert(ids.length >= 2, "two accounts");
    await seed(ids[0], ids[1]);
    app = await startApp(port, env);
    const page = await owner.ctx.newPage();
    const studio = `${app.base}/after-dark/studio/${HER}`;
    const tab = (name) => page.getByRole("tab", { name }).click();
    for (const [w, h, size] of [
      [1280, 800, "desktop"],
      [390, 844, "phone"],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      // Shoot: the menus, with a dressed look picked.
      await page.goto(studio);
      await page.locator(".ad-studio-group").first().waitFor({ timeout: 30_000 });
      for (const [group, option] of [
        ["Pose", "Over the shoulder"],
        ["Framing", "Medium"],
        ["Wardrobe", "Evening"],
        ["Accessories", "Pearls"],
        ["Place", "A hotel suite"],
        ["Light", "Golden hour"],
      ]) {
        await page.locator("fieldset.ad-studio-group", { has: page.locator("legend", { hasText: group }) }).getByRole("button", { name: option, exact: true }).first().click();
      }
      await under(page, ".ad-studio-group:nth-of-type(5)");
      if (size === "phone") await noSideways(page, "the shoot's menus");
      await shot(page, `studio-shoot-${size}`);
      // Together: him picked, a slow dance on the rooftop.
      await tab("Together");
      await page.locator("select").filter({ has: page.locator("option", { hasText: "Pick someone" }) }).selectOption(HIM);
      await page.locator("fieldset.ad-studio-group", { has: page.locator("legend", { hasText: "What they're doing" }) }).waitFor({ timeout: 15_000 });
      const group = (legend) => page.locator("fieldset.ad-studio-group", { has: page.locator("legend", { hasText: legend }) });
      await group("What they're doing").getByRole("button", { name: "A slow dance", exact: true }).click();
      await group("What they wear").getByRole("button", { name: "Dressed up", exact: true }).click();
      await group("Framing").getByRole("button", { name: /^Wide/ }).click();
      await group("Place").getByRole("button", { name: "A rooftop at night (public)", exact: true }).click();
      await group("Light").getByRole("button", { name: "Golden hour", exact: true }).click();
      await under(page, ".ad-studio-panel");
      if (size === "phone") await noSideways(page, "a shoot together");
      await shot(page, `studio-together-${size}`);
      // The gallery: a picture's share panel open, where the others went, and the clip.
      await tab("Gallery");
      const first = page.locator(".ad-studio-item").filter({ has: page.locator('img[src*="studio-shot-2"]') });
      await first.getByRole("button", { name: "Share…" }).click();
      await first.locator(".ad-studio-share").waitFor({ timeout: 10_000 });
      // The open panel, and where the picture already went, in view.
      await page.evaluate(() => document.querySelector('.ad-studio-item:has(img[src*="studio-shot-2"]) .ad-studio-share')?.scrollIntoView({ block: "center" }));
      if (size === "phone") await noSideways(page, "the gallery's share panel");
      await shot(page, `studio-gallery-share-${size}`);
      await first.getByRole("button", { name: "Share…" }).click();
      const third = page.locator(".ad-studio-item").filter({ has: page.locator('img[src*="studio-shot-4"]') });
      await third.getByRole("button", { name: "Animate…" }).click();
      await third.locator(".ad-studio-share").waitFor({ timeout: 10_000 });
      await third.getByRole("button", { name: "Walk toward you", exact: true }).click();
      await page.evaluate(() => document.querySelector('.ad-studio-item:has(img[src*="studio-shot-4"])')?.scrollIntoView({ block: "center" }));
      if (size === "phone") await noSideways(page, "the animate panel");
      await shot(page, `studio-gallery-animate-${size}`);
      // Saved setups.
      await tab("Setups");
      await page.getByText("Golden hour, hotel").waitFor({ timeout: 10_000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      if (size === "phone") await noSideways(page, "the setups");
      await shot(page, `studio-setups-${size}`);
    }
    // The recipient: "Shared with you" on their After Dark, one accepted, one waiting for them.
    const theirs = await recipient.ctx.newPage();
    for (const [w, h, size] of [
      [1280, 800, "desktop"],
      [390, 844, "phone"],
    ]) {
      await theirs.setViewportSize({ width: w, height: h });
      await theirs.goto(`${app.base}/after-dark#shared`);
      await theirs.locator("#shared").waitFor({ timeout: 30_000 });
      await theirs.waitForFunction(() => [...document.querySelectorAll("#shared img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15_000 });
      await under(theirs, "#shared");
      if (size === "phone") await noSideways(theirs, "Shared with you");
      await shot(theirs, `studio-shared-with-you-${size}`);
    }
    // Connections: the After Dark pictures job, for someone After Dark is open to.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${app.base}/account/keys`);
    const card = page.locator("section.connection-card", { has: page.getByRole("heading", { name: "After Dark pictures" }) });
    await card.waitFor({ timeout: 15_000 });
    await card.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -80));
    await shot(page, "studio-connections-desktop");
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
    adult.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`screenshots:studio failed: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});

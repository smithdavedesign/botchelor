#!/usr/bin/env node
/**
 * node scripts/keep-going-screenshots.mjs: ▶▶ Keep going with the owner's own words (2026-11-09), in a real browser,
 * desktop and phone, into docs/screenshots/. Two places use it:
 *  - A Studio animation (lib/adult/studio-keep-going.ts, app/after-dark/studio/[id]/AnimationChain.tsx): the panel
 *    filled in, the next link landing in the gallery, and the chain played as one film. On the phone the next link is
 *    the third in a row, so its faces are drawn fresh, and the panel says so first.
 *  - A clip's chain on a pair's page (lib/adult/clips.ts): the words beside Keep going, and the clip they make.
 * Each Keep going runs for real: the end frame is cut by the moments route (the real ffmpeg), checked, and the next
 * link is queued, collected and checked. Words that cross a line are refused with the reason, before a frame is cut
 * or anything is spent.
 *
 * Nothing leaves the machine. The app's own process loads scripts/e2e-provider-redirect.mjs, which sends Venice and
 * Hive to a local stub here, and After Dark's text model is a local stub too, the director writing a PG motion. The
 * pictures and clips are PG placeholders made with ffmpeg from the repo's own cast portraits. Never anything explicit.
 * It builds the app and runs it with ADULT_MODE=1 on a throwaway local database. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses
 * the last build.
 */
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { PGlite } from "@electric-sql/pglite";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "keep-going-screenshots");
const DB_DIR = join(DATA_DIR, "pglite");
/** Her Studio, and the pair whose clips keep going (stored lower id first). */
const HER = "house-juniper";
const HIM = "house-dex";
const [A, B] = [HER, HIM].sort();
/** What the owner asks for next, in the Studio and on the clip: PG. */
const STUDIO_WORDS = ["she walks to the window and looks back over her shoulder", "she laughs and pulls the curtain open to the morning"];
const CLIP_WORDS = "she pulls him closer by his collar";
/** What the director writes from the clip's words (the text model's stub). */
const CLIP_MOTION = "She pulls him closer by his collar and kisses him softly, both of them smiling.";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** PG placeholders made with ffmpeg: her portrait, the two of them side by side, and a 2-second clip of each. */
function placeholders() {
  const dir = join(DATA_DIR, "media");
  mkdirSync(dir, { recursive: true });
  const cast = (id) => join(ROOT, "public", "cast", `${id}-v3.webp`);
  const run = (args) => {
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
  };
  const out = (name) => join(dir, name);
  run(["-i", cast(HER), "-vf", "scale=384:512", "-frames:v", "1", out("her.png")]);
  run([
    "-i",
    cast(HER),
    "-vf",
    "scale=384:512,colorbalance=rs=0.22:gs=0.08:bs=-0.18,eq=brightness=0.02:saturation=1.15",
    "-frames:v",
    "1",
    out("her-golden.png"),
  ]);
  run([
    "-i",
    cast(A),
    "-i",
    cast(B),
    "-filter_complex",
    "[0:v]scale=384:512[l];[1:v]scale=384:512[r];[l][r]hstack=inputs=2",
    "-frames:v",
    "1",
    out("both.png"),
  ]);
  const clip = (still, size, name) =>
    run([
      "-loop",
      "1",
      "-i",
      out(still),
      "-t",
      "2",
      "-vf",
      `scale=${size},zoompan=z='min(zoom+0.002,1.08)':d=32:s=${size.replace(":", "x")},format=yuv420p`,
      "-c:v",
      "libx264",
      "-r",
      "16",
      out(name),
    ]);
  clip("her-golden.png", "384:512", "her.mp4");
  clip("both.png", "768:512", "both.mp4");
  const read = (name) => readFileSync(out(name));
  return {
    her: read("her.png"),
    herGolden: read("her-golden.png"),
    both: read("both.png"),
    herClip: read("her.mp4"),
    bothClip: read("both.mp4"),
    portrait: (id) => readFileSync(cast(id)),
  };
}

/**
 * Venice and Hive, stubbed in the shapes the app reads (the unit tests' fakes): a face drawn fresh is her portrait, a
 * video queued is ready when it's next asked for (her clip, or the two of them for a clip of the pair), and every check
 * passes (clean, ADULTS). Anything else is a 404, and it's logged.
 */
function startProviderStub(media) {
  const calls = [];
  const queued = new Map();
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const host = String(req.headers["x-original-host"] ?? "");
      const path = (req.url ?? "").split("?")[0];
      calls.push(`${host}${path}`);
      const body = (() => {
        try {
          return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        } catch {
          return {};
        }
      })();
      const json = (o, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(o));
      };
      const bytes = (b, type) => {
        res.writeHead(200, { "content-type": type });
        res.end(b);
      };
      if (host === "api.thehive.ai" && path.includes("visual-moderation"))
        return json({
          output: [
            {
              classes: [
                { class: "yes_child_present", value: 0.01 },
                { class: "no_child_present", value: 0.99 },
                { class: "general_nsfw", value: 0.05 },
              ],
            },
          ],
        });
      if (host === "api.thehive.ai")
        return json({
          choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }],
        });
      if (host === "api.venice.ai") {
        if (path.endsWith("/image/multi-edit") || path.endsWith("/image/edit"))
          return bytes(/Picture 3/.test(String(body.prompt)) ? media.both : media.her, "image/png");
        if (path.endsWith("/video/queue")) {
          const id = `q-${calls.length}`;
          queued.set(id, /the two of them|two people|both of them/i.test(String(body.prompt)) ? media.bothClip : media.herClip);
          return json({ queue_id: id });
        }
        if (path.endsWith("/video/retrieve")) {
          if (body.delete_media_on_completion) return json({ ok: true });
          const clip = queued.get(String(body.queue_id));
          return clip ? bytes(clip, "video/mp4") : json({ status: "PROCESSING" });
        }
        if (path.endsWith("/chat/completions")) {
          // Venice's vision checks: the one for anyone else in a public frame (lib/adult/moderation.ts aloneInPicture),
          // the PG check's two questions, and the age question (lib/adult/moderation.ts): one person, adults, clothed.
          const asked = JSON.stringify(body.messages ?? "");
          const answer = /Count every person/.test(asked)
            ? { answer: "ONE" }
            : /"clothing"/.test(asked)
              ? { clothing: "CLOTHED", age: "ADULTS" }
              : { answer: "ADULTS" };
          return json({
            choices: [
              {
                message: { role: "assistant", content: JSON.stringify(answer) },
              },
            ],
          });
        }
      }
      console.log(`      (stub: nothing for ${req.method} ${host}${path})`);
      json({ error: "not stubbed" }, 404);
    });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({ srv, calls })));
}

/** After Dark's text model, stubbed: the director's next five seconds from the owner's words; "{}" for anything else. */
function startAdultStub() {
  const asked = [];
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const directing = body.includes("What the viewer wants to happen next");
      if (directing) asked.push(body);
      const content = directing ? JSON.stringify({ motion: CLIP_MOTION }) : "{}";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "stub",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content },
            },
          ],
        }),
      );
    });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({ srv, asked })));
}

/**
 * Straight into the local database. The Studio: her face, a dressed picture, an animation of it and one link kept going
 * from it (straight on, in her owner's words). The pair: a night at kissing in her bedroom, and a slow kiss kept going
 * once, both with their faces.
 */
async function seed(owner, media) {
  const db = new PGlite(DB_DIR);
  try {
    const put = (id, character, other, kind, mime, data, minutes, extra = {}) =>
      db.query(
        `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, shoot_id, nsfw_score, model, source_image, moment_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'ready', $9, 0.03, $10, $11, $12, now() - ($13 || ' minutes')::interval)`,
        [
          id,
          owner,
          character,
          other,
          kind,
          extra.prompt ?? "PG placeholder",
          mime,
          data,
          extra.shoot ?? null,
          extra.model ?? null,
          extra.source ?? null,
          extra.at ?? null,
          String(minutes),
        ],
      );
    const shoot = (id, kind, choices, pictures, minutes) =>
      db.query(
        `insert into adult_studio_shoots (id, owner_id, character_id, kind, choices, model, provider, tokens, asked, made, status, pictures, created_at)
         values ($1, $2, $3, $4, $5::jsonb, $6, 'venice', 0, $7, $7, 'ready', $8::jsonb, now() - ($9 || ' minutes')::interval)`,
        [
          id,
          owner,
          HER,
          kind,
          JSON.stringify(choices),
          kind === "animate" ? "wan-3-0-image-to-video" : "qwen-edit-uncensored",
          pictures.length,
          JSON.stringify(pictures),
          String(minutes),
        ],
      );
    // The Studio.
    await put("kg-face", HER, null, "baseline", "image/png", media.her, 240);
    await db.query(`insert into adult_face_refs (owner_id, character_id, image_id) values ($1, $2, 'kg-face')`, [owner, HER]);
    await shoot("kg-shoot", "shoot", { pose: "shoulder", wardrobe: "evening", light: "golden", level: 0 }, ["kg-shot-1"], 120);
    await put("kg-shot-1", HER, null, "scene", "image/png", media.herGolden, 120, { shoot: "kg-shoot", model: "qwen-edit-uncensored" });
    await shoot(
      "kg-anim-1",
      "animate",
      {
        source: "kg-shot-1",
        motion: "turn",
        seconds: 5,
        queue_id: "q-seed-1",
        level: 0,
      },
      ["kg-clip-1"],
      60,
    );
    await put("kg-clip-1", HER, null, "video", "video/mp4", media.herClip, 60, {
      shoot: "kg-anim-1",
      model: "wan-3-0-image-to-video",
      source: "kg-shot-1",
      prompt: "Studio clip: turn",
    });
    await put("kg-frame-1", HER, null, "frame", "image/png", media.herGolden, 50, {
      source: "kg-clip-1",
      at: 1.9,
      prompt: "Kept going from an animation, 1.9 s in",
      model: "moment",
    });
    await shoot(
      "kg-anim-2",
      "animate",
      {
        source: "kg-frame-1",
        motion: null,
        seconds: 5,
        queue_id: "q-seed-2",
        level: 0,
        from: "kg-anim-1",
        cut: {
          video: "kg-clip-1",
          frame: "kg-frame-1",
          at: 1.9,
          seamless: true,
        },
        facts: { people: [HER, null], place: null, aspect: null, pov: null },
        guide: "she turns to the window and smiles",
      },
      ["kg-clip-2"],
      45,
    );
    await put("kg-clip-2", HER, null, "video", "video/mp4", media.herClip, 45, {
      shoot: "kg-anim-2",
      model: "wan-3-0-image-to-video",
      source: "kg-frame-1",
      prompt: "Studio clip: kept going",
    });

    // The pair: their faces, the night at kissing in her bedroom, and a slow kiss kept going once.
    await put("kg-base-a", A, null, "baseline", "image/webp", media.portrait(A), 240);
    await put("kg-base-b", B, null, "baseline", "image/webp", media.portrait(B), 240);
    const lines = [
      ["a", "You kept the candles going. I thought you'd fall asleep before I got back."],
      ["b", "*smiles* I was holding out for the tea you promised. Where is it?"],
      ["a", "*sets two cups down* Terrible, as advertised. Sit with me?"],
      ["b", "*sits close, knees touching* Only if you tell me what you were thinking about."],
      ["a", "You. The rooftop. How you laughed at the ferry horn."],
      ["b", "*leans in* Then stop talking about it, and come here."],
      ["a", "*kisses her slowly* Like that?"],
      ["b", "*smiles against his lips* Exactly like that. Again."],
    ].map(([who, text]) => ({ who, text, stage: 2 }));
    const scene = await db.query(
      `update adult_scenes set lines = $2::jsonb, stage = 2, place = 'her bedroom', set_place = 'her bedroom' where owner_id = $1 returning id`,
      [owner, JSON.stringify(lines)],
    );
    assert(scene.rows.length === 1, "the pair's scene wasn't made");
    for (const n of [1, 2]) {
      await put(`kg-pair-frame-${n}`, A, B, "frame", "image/png", media.both, 40 - n * 5);
      await put(`kg-pair-video-${n}`, A, B, "video", "video/mp4", media.bothClip, 40 - n * 5);
    }
    const shot = (n, motion) => ({
      line: 7,
      who: "a",
      text: "",
      frame: "PG placeholder",
      motion,
      status: "ready",
      media_id: `kg-pair-video-${n}`,
      frame_id: `kg-pair-frame-${n}`,
    });
    const reel = (id, minutes, shots, clip) =>
      db.query(
        "insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots, kind, clip, created_at) values ($1, $2, $3, $4, 'ready', 0, $5::jsonb, 'clip', $6::jsonb, now() - ($7 || ' minutes')::interval)",
        [id, owner, A, B, JSON.stringify(shots), JSON.stringify(clip), String(minutes)],
      );
    const kiss = {
      act: "kiss",
      swap: false,
      stage: 2,
      place: "her bedroom",
      label: "A slow kiss",
    };
    await reel("kg-clip-chain-1", 35, [shot(1, "They kiss slowly and deeply.")], { ...kiss, from: null });
    await reel("kg-clip-chain-2", 30, [shot(2, "They part for a breath, then kiss again.")], { ...kiss, from: "kg-clip-chain-1" });
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
  const media = placeholders();
  const showrunner = await startShowrunner();
  const adult = await startAdultStub();
  const providers = await startProviderStub(media);
  const env = appEnv(showrunner.address().port, DB_DIR);
  const ADMIN_PASSWORD = ["shots", "keep", Math.random().toString(36).slice(2)].join("-");
  Object.assign(env, {
    FRONTIER_PASSWORD: ADMIN_PASSWORD,
    ADULT_MODE: "1",
    ADULT_LLM_BASE_URL: `http://127.0.0.1:${adult.srv.address().port}/v1`,
    ADULT_LLM_API_KEY: "local-stub",
    ADULT_LLM_MODEL: "stub-adult",
    E2E_PROVIDER_STUB: `http://127.0.0.1:${providers.srv.address().port}`,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(join(ROOT, "scripts", "e2e-provider-redirect.mjs")).href}`.trim(),
  });
  const port = await freePort();
  let app = await startApp(port, env);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
  });
  const errors = [];
  const shot = async (page, file) => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT_DIR, `${file}.png`) });
    console.log(`  📸 docs/screenshots/${file}.png`);
  };
  const noSideways = async (page, name) => {
    // On a phone the Studio is its own full-screen scroller (globals.css): it mustn't scroll sideways either.
    const scroll = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.querySelector(".ad-studio-main")?.scrollWidth ?? 0));
    const width = page.viewportSize()?.width ?? 0;
    assert(scroll <= width, `${name}: the page scrolls sideways on a phone (${scroll}px wide on a ${width}px screen)`);
    console.log(`  ✓ ${name}: no sideways scroll on a phone`);
  };
  /** Scrolls an element to the middle of whichever box scrolls it (the Studio's own on a phone, else the page). */
  const centre = (locator) => locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  /** Scrolls an element's top to just under the site's header, in whichever box scrolls it. */
  const top = (locator) =>
    locator.evaluate((el) => {
      el.scrollIntoView({ block: "start" });
      let box = el.parentElement;
      while (box && !(box.scrollHeight > box.clientHeight && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
      (box ?? window).scrollBy(0, -96);
    });
  /**
   * On a desktop the Keep going panel, in a gallery card a third of the Studio wide, runs taller than the screen: this
   * shoots the gallery from the card's top to the panel's foot, on a screen made tall enough for it (then put back).
   */
  const shotOfCard = async (page, file, card, foot) => {
    const screen = page.viewportSize();
    const tall = await card.evaluate((el, f) => f.getBoundingClientRect().bottom - el.getBoundingClientRect().top, await foot.elementHandle());
    await page.setViewportSize({
      width: screen.width,
      height: Math.max(screen.height, Math.ceil(tall) + 160),
    });
    await top(card);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(600);
    const box = await card.evaluate(
      (el, f) => {
        const t = el.getBoundingClientRect();
        const g = (el.closest("ul") ?? el).getBoundingClientRect();
        const end = f.getBoundingClientRect();
        return {
          x: Math.max(0, g.left - 16),
          y: Math.max(0, t.top - 16),
          width: g.width + 32,
          height: end.bottom - t.top + 32,
        };
      },
      await foot.elementHandle(),
    );
    await page.screenshot({ path: join(OUT_DIR, `${file}.png`), clip: box });
    console.log(`  📸 docs/screenshots/${file}.png (${Math.round(box.width)}×${Math.round(box.height)})`);
    await page.setViewportSize(screen);
  };
  try {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const reg = await ctx.request.post(`${app.base}/api/auth/register`, {
      data: {
        handle: `keep${Date.now() % 1e6}`,
        password: "a-long-shots-password-1",
        attest: true,
      },
    });
    assert(reg.ok(), `register: HTTP ${reg.status()}`);
    assert(
      (
        await ctx.request.post(`${app.base}/api/admin/claim`, {
          headers: { "x-frontier-key": ADMIN_PASSWORD },
        })
      ).ok(),
      "claiming admin",
    );
    assert(
      (
        await ctx.request.post(`${app.base}/api/admin/after-dark/privacy`, {
          data: { blur: false },
        })
      ).ok(),
      "turning the blur off",
    );
    // Placeholder keys, so the models read as set up: every call they'd make goes to the local stub.
    const keys = await ctx.request.post(`${app.base}/api/admin/after-dark/settings`, {
      data: {
        venice_key: "placeholder-venice-keep-0001",
        hive_key: "placeholder-hive-keep-0001",
        enabled: true,
      },
    });
    assert(keys.ok(), `saving placeholder keys: HTTP ${keys.status()}`);
    // The pair's scene, made by opening it; then the app stops while the seed goes in (one process at a time on PGlite).
    assert((await ctx.request.get(`${app.base}/api/admin/after-dark?a=${A}&b=${B}`)).ok(), "opening the pair's scene");
    await stopApp(app);
    const owner = await (async () => {
      const db = new PGlite(DB_DIR);
      try {
        return (await db.query("select user_id from admins limit 1")).rows[0].user_id;
      } finally {
        await db.close();
      }
    })();
    await seed(owner, media);
    app = await startApp(port, env);

    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    // What the page asks of After Dark's routes, for the log: each POST and how it was answered.
    // Frames cut on the moments route: a link refused when it's asked first never gets one.
    let cuts = 0;
    // What Keep going asked, in order: asked first (no frame), the frame cut, the link itself.
    const posted = [];
    page.on("response", (r) => {
      if (r.request().method() !== "POST" || !r.url().includes("/api/admin/after-dark/")) return;
      const path = new URL(r.url()).pathname;
      const body = r.request().postData() ?? "";
      if (path.endsWith("/moments")) cuts++;
      const check = (path.endsWith("/studio") && /"keep_going"/.test(body) && !/"frame_id"/.test(body)) || (path.endsWith("/clips") && /"check":true/.test(body));
      posted.push(path.endsWith("/moments") ? "cut" : `${path.split("/").pop()}${check ? " check" : ""}`);
      console.log(`  · POST ${path}${check ? " (asked first, no frame)" : ""} → ${r.status()}`);
    });
    page.on(
      "requestfailed",
      (r) => r.url().includes("/api/") && console.log(`  · ${r.method()} ${new URL(r.url()).pathname} failed: ${r.failure()?.errorText}`),
    );
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text()}`));
    const studio = `${app.base}/after-dark/studio/${HER}`;
    const gallery = async () => {
      await page.goto(studio);
      await page.getByRole("tab", { name: "Gallery", exact: true }).click();
      await page.locator(".ad-studio-item video").first().waitFor({ timeout: 30_000 });
    };
    /** The gallery card of the newest link of the chain, n shots long. */
    const linkCard = (n) =>
      page.locator(".ad-studio-item", {
        hasText: `Kept going · shot ${n} of ${n}`,
      });

    // KG_ONLY=pair runs just the clip's chain on the pair's page (a quick rerun on the same build).
    const onlyPair = process.env.KG_ONLY === "pair";
    for (const [w, h, size, n] of onlyPair
      ? []
      : [
          [1280, 900, "desktop", 2],
          [390, 844, "phone", 3],
        ]) {
      console.log(`\n${size}`);
      await page.setViewportSize({ width: w, height: h });
      await page.goto(studio);
      await page.evaluate(() =>
        Object.keys(localStorage)
          .filter((k) => k.startsWith("bz-studio:"))
          .forEach((k) => localStorage.removeItem(k)),
      );
      await gallery();

      // The Studio: the chain's newest link, its panel open and filled in.
      const card = linkCard(n);
      await card.waitFor({ timeout: 15_000 });
      assert(await card.getByRole("button", { name: `▶ Play all ${n}` }).isVisible(), `no ▶ Play all ${n} on the chain's newest link`);
      await card.getByRole("button", { name: "▶▶ Keep going…" }).click();
      const panel = card.locator(".ad-anim-keep");
      await panel.waitFor({ timeout: 10_000 });
      // The third link in a row starts from fresh faces, and the panel says so before anything is spent.
      const freshNote = panel.getByText(/every third link does, so they keep looking like themselves/);
      assert((await freshNote.count()) === (n === 3 ? 1 : 0), `the fresh-faces note ${n === 3 ? "is missing" : "shows"} on link ${n + 1}`);
      await panel.getByRole("textbox", { name: "What happens next (optional)" }).fill(STUDIO_WORDS[n - 2]);
      await panel.getByRole("textbox", { name: "Dialog (optional)" }).fill(n === 2 ? "Stay a little longer." : "Look at that light.");
      await panel.getByRole("radio", { name: "Push in" }).click();
      if (size === "phone") {
        await top(panel);
        await noSideways(page, "the Keep going panel");
        await shot(page, `studio-keep-going-${size}`);
      } else await shotOfCard(page, `studio-keep-going-${size}`, card, panel);

      // Keep going, for real: the end frame cut and checked, the next link queued, then collected into the gallery.
      const send = panel.getByRole("button", { name: /^▶▶ Keep going · / });
      const cut = page.waitForResponse((r) => r.url().endsWith("/api/admin/after-dark/moments") && r.request().method() === "POST", { timeout: 60_000 });
      // The link itself, sent with the frame (the page asks first without one: lib/adult/studio-keep-going.ts keepAnimatingCheck).
      const answered = page.waitForResponse(
        (r) => r.url().endsWith("/api/admin/after-dark/studio") && r.request().method() === "POST" && /"frame_id"/.test(r.request().postData() ?? ""),
        { timeout: 120_000 },
      );
      // Either may be left unawaited when the other fails first: handled here, so the run says why it stopped.
      cut.catch(() => {});
      answered.catch(() => {});
      const sentFrom = posted.length;
      await send.click();
      const cutRes = await cut.catch(async (err) => {
        const said = await card.locator(".ad-anim-chain [role=alert]").allInnerTexts();
        throw new Error(`no answer from the moments route (${err.message.split("\n")[0]}); the card says: ${JSON.stringify(said)}`);
      });
      assert(cutRes.status() === 200, `the end frame wasn't cut: HTTP ${cutRes.status()} ${await cutRes.text()}`);
      console.log(`  ✓ the end frame cut on the moments route`);
      const res = await answered;
      assert(res.status() === 200, `keep going: HTTP ${res.status()} ${await res.text()}`);
      // Asked first without a frame, then the frame cut, then the link itself.
      assert(posted.slice(sentFrom, sentFrom + 3).join(", ") === "studio check, cut, studio", `Keep going asked in this order: ${posted.slice(sentFrom).join(", ")}`);
      const said = card.locator(".ad-anim-chain").getByRole("status");
      await said.waitFor({ timeout: 10_000 });
      const note = await said.innerText();
      assert(/^Keeping it going from where it ended/.test(note), `the note says "${note}"`);
      assert(n === 3 ? /faces drawn fresh \(every third link is/.test(note) : !/fresh/.test(note), `link ${n + 1}'s note: "${note}"`);
      console.log(`  ✓ link ${n + 1} sent: "${note}"`);
      // The page looks again while it's being made; a reload collects it at once (the stub has it ready).
      await gallery();
      const next = linkCard(n + 1);
      await next.waitFor({ timeout: 30_000 });
      assert((await next.innerText()).includes(`“${STUDIO_WORDS[n - 2]}”`), "the new link doesn't say what was asked");
      await centre(next);
      if (size === "phone") await noSideways(page, "the chain's new link");
      await shot(page, `studio-keep-going-chain-${size}`);

      // The whole chain, as one film.
      await next.getByRole("button", { name: `▶ Play all ${n + 1}` }).click();
      const film = page.locator(".ad-chain-film");
      await film.waitFor({ timeout: 10_000 });
      assert((await film.getByText(`Shot 1 of ${n + 1}`).count()) === 1, "the film doesn't start on its first shot");
      const playing = await page
        .waitForFunction(() => (document.querySelector(".ad-chain-film video:not(.ad-chain-film-waiting)")?.currentTime ?? 0) > 0.3, null, { timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      console.log(playing ? "  ✓ the film plays" : "  (this browser can't play the H.264 placeholders: the film's shown, not played)");
      if (playing) {
        // On to the second shot when the first ends (a 2-second clip).
        await film.getByText(`Shot 2 of ${n + 1}`).waitFor({ timeout: 10_000 });
        console.log("  ✓ the film moves on to the next shot");
      }
      if (size === "phone") await noSideways(page, "the film");
      await shot(page, `studio-keep-going-film-${size}`);
      await page.keyboard.press("Escape");
      await film.waitFor({ state: "detached", timeout: 5_000 });
    }

    // Words that cross a line: refused with the reason, nothing spent (the phone's chain is still four long).
    if (!onlyPair) {
      await gallery();
      const last = linkCard(4);
      await last.getByRole("button", { name: "▶▶ Keep going…" }).click();
      await last.getByRole("textbox", { name: "What happens next (optional)" }).fill("she looks like a teenager");
      const cutsBefore = cuts;
      await last.getByRole("button", { name: /^▶▶ Keep going · / }).click();
      const refused = last.locator(".ad-anim-chain").getByRole("alert");
      await refused.waitFor({ timeout: 30_000 });
      assert(
        (await refused.innerText()).includes("Those words cross one of the lines After Dark never crosses."),
        `the refusal says "${await refused.innerText()}"`,
      );
      assert(!(await page.getByText("Kept going · shot 5 of 5").count()), "a refused link was made");
      assert(cuts === cutsBefore, "a frame was cut for words that were refused");
      console.log("  ✓ words that cross a line are refused at once, with the reason, and no frame is cut");
    }

    // A clip's chain on the pair's page: the words beside Keep going, and the clip they make.
    for (const [w, h, size] of [
      [1280, 900, "desktop"],
      [390, 844, "phone"],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${app.base}/after-dark/${A}/${B}`);
      // The page opens on the theater (#845): Exit leaves it for the videos below.
      // isVisible() doesn't wait, and the theater opens once the page has loaded the night: wait for its Exit.
      const exit = page.locator(".theater").getByRole("button", { name: "Exit", exact: true });
      if (await exit.waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false)) {
        await exit.click();
        await page.locator(".theater").waitFor({ state: "hidden", timeout: 10_000 });
      }
      // The pair's videos are a tab of their own, beside the pictures.
      const videos = page.getByRole("tab", { name: /^Videos \(\d+\)$/ });
      await videos.waitFor({ timeout: 30_000 });
      await videos.click();
      const chain = page.locator(".ad-clip-chain").first();
      await chain.waitFor({ timeout: 30_000 });
      // Keep going at the chain's end (the shot's own moments have one too, from the second it's paused on).
      const end = chain.locator(".ad-keep-going");
      // One words box for the whole chain (2026-11-10): the shot's own "Keep going from here" reads the chain's box.
      // (Checked at desktop size, before this run keeps it going: the phone's pass sees the new shot still being made.)
      if (size === "desktop") await chain.getByRole("button", { name: /^▶▶ Keep going from here/ }).first().waitFor({ timeout: 30_000 });
      const boxes = await chain.getByRole("textbox", { name: "What happens next (optional)" }).count();
      assert(boxes === 1, `a clip's chain shows ${boxes} "What happens next" boxes, not one`);
      await end.getByRole("textbox", { name: "What happens next (optional)" }).fill(CLIP_WORDS);
      await centre(end);
      if (size === "phone") await noSideways(page, "a clip's Keep going");
      await shot(page, `after-dark-keep-going-words-${size}`);
      if (size === "desktop") {
        const from = posted.length;
        await end.getByRole("button", { name: /^▶▶ Keep going/ }).click();
        // The director wrote the shot from the words, and the clip comes through as the chain's third shot.
        await chain.getByText("3 shots, kept going 2 times").waitFor({ timeout: 60_000 });
        assert(
          adult.asked.some((b) => b.includes(`in their own words: \\"She pulls him closer by his collar\\"`)),
          "the director wasn't asked with the words",
        );
        // The words were asked about before the frame was cut for them.
        const asked = posted.slice(from);
        assert(asked.join(", ") === "clips check, cut, clips", `Keep going asked in this order: ${asked.join(", ")}`);
        console.log("  ✓ a clip kept going in the owner's words: asked about first, the director wrote it, and it came through");
      }
    }

    assert(errors.length === 0, `page errors: ${errors.slice(0, 5).join(" | ")}`);
    console.log(`\nprovider calls the stub answered: ${[...new Set(providers.calls)].join(", ") || "none"}`);
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
    adult.srv.close();
    providers.srv.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`keep-going screenshots failed: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});

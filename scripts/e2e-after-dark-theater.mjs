/**
 * npm run e2e:after-dark-theater: After Dark's theater and everything it makes, in a real browser (David, 2026-10-29:
 * "write playwright tests for all the nsfw features"). Against the production build with ADULT_MODE=1 on a throwaway
 * database. Nothing leaves the machine: Venice, Hive, Replicate, fal, Sightengine and OpenRouter are a local stub
 * (scripts/e2e-provider-redirect.mjs sends them there), which draws a PG placeholder (the repo's own cast portraits),
 * says a second of tone for a voice or a place, and passes every check, so the app's own checks still run. Never
 * anything explicit.
 *
 *   nobody else gets in (a stranger, a signed-in non-subscriber: the page and every media route are not found) →
 *   the theater plays a night → 📸 Picture this: the form reads the scene (the brief: the costume, the place), the prompt
 *   has no names, the picture is drawn and goes on the stage → Next: a moment is offered ("Picture this?"), Not now →
 *   ⚡ Draw ahead: the next moment is drawn without asking → ✨ Bring them to life: portraits, expressions, loops →
 *   🗣 Hear it from them: a talking moment plays → 🔈 Listen: their voices, and the place's sound → ↻ Redraw from the
 *   gallery → 🎬 Video of the night: the storyboard → a subscriber: Draw ahead's price, and no tokens says so → the phone.
 *
 * The rest of After Dark has its own: e2e:after-dark (the gate, writing, autoplay, rewind, start over), e2e:after-dark-
 * scene (Scene & roleplay, the first lines, the picture's context) and e2e:studio (every Studio tab). e2e:after-dark-all
 * runs the four.
 *
 * Exits non-zero if any step fails. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build; HEADED=1 shows the browser.
 */
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { PGlite } from "@electric-sql/pglite";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const DATA_DIR = join(ROOT, ".data", "e2e-after-dark-theater");
const DB_DIR = join(DATA_DIR, "pglite");
const OUT_DIR = join(ROOT, "docs", "screenshots");
// The pair is stored lower id first: Dex (he) is "a", Juniper (she) is "b".
const HIM = "house-dex";
const HER = "house-juniper";
const PAGE = `/after-dark/${HIM}/${HER}`;
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`  ✗ ${name}\n      ${(err instanceof Error ? err.message : String(err)).split("\n")[0]}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
/** `fn()` until it's truthy (its value), or a throw with `what` after `ms`. */
async function until(what, fn, ms = 30_000, every = 500) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, every));
  }
}

/** A PG placeholder picture (her portrait), a 2-second clip of it, a second of tone as a voice (mp3), made with ffmpeg. */
function placeholders() {
  const dir = join(DATA_DIR, "media");
  mkdirSync(dir, { recursive: true });
  const run = (args) => {
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "inherit"] });
    if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
  };
  const cast = join(ROOT, "public", "cast", `${HER}-v3.webp`);
  run(["-i", cast, "-vf", "scale=384:512", "-frames:v", "1", join(dir, "her.png")]);
  run(["-loop", "1", "-i", join(dir, "her.png"), "-t", "2", "-vf", "scale=384:512,format=yuv420p", "-c:v", "libx264", "-r", "16", join(dir, "clip.mp4")]);
  run(["-f", "lavfi", "-i", "sine=frequency=220:duration=1", "-q:a", "9", join(dir, "tone.mp3")]);
  return { png: readFileSync(join(dir, "her.png")), clip: readFileSync(join(dir, "clip.mp4")), mp3: readFileSync(join(dir, "tone.mp3")) };
}

/** What the scene's writer says, step by step: each step one moment the lines name, the rest PG. Never explicit. */
const STEPS = [
  [
    ["b", "*settles on top of him on the sofa, cape pooling around them*", "Found you, sidekick."],
    ["a", "*laughs, hands resting at her waist*", "You always do, hero."],
    ["b", "*taps the gold mask on her nose*", "The mask stays. House rules."],
    ["a", "*traces the edge of her cape*", "Wouldn't dream of breaking them."],
    ["b", "*leans down until their foreheads touch*", "Good. Saving the city is tiring work."],
    ["a", "*grins up at her*", "Then rest a while. The city can wait."],
  ],
  [
    ["b", "*slides into his lap, arms around his neck*", "Better view from here."],
    ["a", "*pulls the blue cape around them both*", "Two capes, one sofa."],
    ["b", "*hums against his shoulder*", "A very small headquarters."],
    ["a", "*brushes a curl from her mask*", "The best kind."],
    ["b", "*smiles slowly*", "Don't tell the villains about it."],
    ["a", "*whispers*", "Our secret, always."],
  ],
  [
    ["b", "*climbs on top of him with a grin*", "Round two, caped crusader."],
    ["a", "*catches her hands in his*", "You never give up, do you."],
    ["b", "*tilts her head*", "Not when I'm winning."],
    ["a", "*squeezes her fingers*", "Fair point, well made."],
    ["b", "*settles against him*", "Admit it. You missed me."],
    ["a", "*smiles at the ceiling*", "Every single minute."],
  ],
];
/** The scene picture's brief (lib/adult/picture-brief.ts): what the photographer's told, with the costume. */
const BRIEF = {
  place: "her living room, a green velvet sofa under a reading lamp",
  wearing: "Juniper in a red superhero cape and a gold mask; Dex in a matching blue cape",
  kept_on: "",
  happening: "Juniper sits close against Dex on the sofa, her hand on his chest, both of them smiling",
  mood: "playful, a costume game",
  act: "close",
};

/**
 * The providers and checks, stubbed, in the shapes the app reads: Venice's image edits, its video and audio queues
 * (a clip and a tone, ready at once) and its voices; Hive's moderation and age question (clean, ADULTS); Replicate;
 * Sightengine; and OpenRouter (After Dark's text: the scene's steps, the brief, the side checks). Anything else is a
 * 404, and it's logged.
 */
function startProviderStub(media, seen) {
  let steps = 0;
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const host = String(req.headers["x-original-host"] ?? "");
      const path = (req.url ?? "").split("?")[0];
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = (() => {
        try {
          return JSON.parse(raw || "{}");
        } catch {
          return {};
        }
      })();
      seen.calls.push(`${host}${path}`);
      const json = (o, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(o));
      };
      const bytes = (b, type) => {
        res.writeHead(200, { "content-type": type });
        res.end(b);
      };
      const chat = (o) => json({ id: "stub", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(o) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
      if (host === "api.thehive.ai" && path.includes("visual-moderation"))
        return json({ output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.05 }] }] });
      if (host === "api.thehive.ai") return json({ choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] });
      if (host === "api.sightengine.com") return json({ status: "success", nudity: { none: 0.95 }, offensive: { prob: 0.01 }, minor: { prob: 0.01 } });
      if (host === "openrouter.ai" && path.endsWith("/chat/completions")) {
        const messages = body.messages ?? [];
        const system = String(messages[0]?.content ?? "");
        const all = messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
        if (/photographer/.test(system)) {
          seen.briefs.push(all);
          return chat(BRIEF);
        }
        if (/dry or technical asides/.test(all)) return chat({ asides: [], rewrites: {} });
        if (/running recap|factual memory|what a private night left behind/.test(system)) return chat({});
        const lines = STEPS[steps % STEPS.length].map(([who, action, said]) => ({ who, text: `${action} ${said}`, why: "the costume game", memory: null }));
        steps++;
        // No stage claim: the night stays where it is (a claim counts from 1, so 4 would be a step back).
        return chat({ lines, place: "her living room", set: null, explicit: false, picture: null, suggestions: { mild: "They trade capes", flirty: "She fixes his mask", spicy: "They stay in" } });
      }
      if (host === "api.venice.ai") {
        if (path.endsWith("/image/multi-edit") || path.endsWith("/image/edit")) return bytes(media.png, "image/png");
        if (path.endsWith("/image/generate")) return json({ images: [media.png.toString("base64")] });
        if (path.endsWith("/video/queue")) return json({ queue_id: `vq-${seen.calls.length}` });
        if (path.endsWith("/video/retrieve")) return body.delete_media_on_completion ? json({ success: true }) : bytes(media.clip, "video/mp4");
        if (path.endsWith("/audio/speech")) return bytes(media.mp3, "audio/mpeg");
        if (path.endsWith("/audio/queue")) return json({ queue_id: `aq-${seen.calls.length}` });
        if (path.endsWith("/audio/retrieve")) return body.delete_media_on_completion ? json({ success: true }) : bytes(media.mp3, "audio/mpeg");
        if (path.endsWith("/chat/completions")) return json({ choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] });
      }
      if (host === "api.replicate.com" && req.method === "POST") return json({ id: `pred-${seen.calls.length}`, status: "succeeded", output: [`http://${req.headers.host}/media/her.png`] });
      if (path === "/media/her.png") return bytes(media.png, "image/png");
      console.log(`      (stub: nothing for ${req.method} ${host}${path})`);
      json({ error: "not stubbed" }, 404);
    });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

/** A night of twelve PG lines at the stage they've reached, in her living room, in costume. */
const NIGHT = [
  ["a", "*holds the door open, blue cape over one shoulder*", "Your headquarters, my lady."],
  ["b", "*sweeps in, red cape trailing*", "About time you visited."],
  ["a", "*looks around the lamplit room*", "It's smaller than the comics said."],
  ["b", "*straightens her gold mask*", "The comics lie about everything."],
  ["a", "*sits on the green sofa*", "Not about the capes."],
  ["b", "*laughs and sits beside him*", "No, the capes are canon."],
  ["a", "*takes her hand*", "So is this, I hope."],
  ["b", "*laces her fingers through his*", "Very canon."],
  ["a", "*leans in*", "Then the sequel starts now."],
  ["b", "*kisses him, slow and sure*", "Sequels are usually worse."],
  ["a", "*smiles against her lips*", "Not this one."],
  ["b", "*pulls him closer*", "Prove it."],
].map(([who, action, said]) => ({ who, text: `${action} ${said}`, stage: 4 }));

/** A signed place (lib/place.ts): where a request says it comes from, off Vercel. US/CA is open. */
function placeCookie(secret) {
  const payload = `US.CA.${Math.floor(Date.now() / 1000) + 3600}`;
  return `place.v1.${payload}.${createHmac("sha256", secret).update(`place:${payload}:`).digest("base64url")}`;
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const media = placeholders();
  const seen = { calls: [], briefs: [] };
  const showrunner = await startShowrunner();
  const providers = await startProviderStub(media, seen);
  const env = appEnv(showrunner.address().port, DB_DIR);
  const ADMIN_PASSWORD = ["e2e", "theater", Math.random().toString(36).slice(2)].join("-");
  Object.assign(env, {
    FRONTIER_PASSWORD: ADMIN_PASSWORD,
    ADULT_MODE: "1",
    E2E_PROVIDER_STUB: `http://127.0.0.1:${providers.address().port}`,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(join(ROOT, "scripts", "e2e-provider-redirect.mjs")).href}`.trim(),
  });
  const port = await freePort();
  let app = await startApp(port, env);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: !process.env.HEADED });
  const errors = [];
  const watch = (page) => {
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  };
  /** Someone signed in, After Dark's blur off; an admin when `admin`. */
  const account = async (handle, { admin = false, place = false } = {}) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }, ...(place ? [{ name: "bz_place", value: placeCookie(env.SESSION_SECRET), url: app.base }] : [])]);
    const reg = await ctx.request.post(`${app.base}/api/auth/register`, { data: { handle, password: "a-long-e2e-theater-password-1", attest: true } });
    assert(reg.ok(), `register: HTTP ${reg.status()}`);
    if (admin) {
      assert((await ctx.request.post(`${app.base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } })).ok(), "claiming admin");
      assert((await ctx.request.post(`${app.base}/api/admin/after-dark/privacy`, { data: { blur: false } })).ok(), "turning the blur off");
    }
    return ctx;
  };
  try {
    const tag = Date.now() % 1e6;
    const owner = await account(`theater${tag}`, { admin: true });
    const sub = await account(`subscriber${tag}`, { place: true });
    const outsider = await account(`outsider${tag}`);
    const saved = await owner.request.post(`${app.base}/api/admin/after-dark/settings`, {
      data: { enabled: true, venice_key: "placeholder-venice-e2e-0001", hive_key: "placeholder-hive-e2e-0001", openrouter_key: "placeholder-text-e2e-0001", auto_scene_pictures: false },
    });
    assert(saved.ok(), `saving placeholder keys: HTTP ${saved.status()}`);
    // The two accounts' scenes, then the night seeded into them with the app stopped (one writer at a time).
    assert((await owner.request.get(`${app.base}/api/admin/after-dark?a=${HIM}&b=${HER}`)).ok(), "the owner's scene");
    await stopApp(app);
    const db = new PGlite(DB_DIR);
    let ids;
    try {
      ids = (await db.query("select user_id, handle from accounts order by created_at")).rows;
      const [ownerId, subId] = ids.map((r) => r.user_id);
      await db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [subId]);
      for (const who of [ownerId, subId]) {
        for (const c of [HIM, HER]) {
          const id = `face-${c}-${who.slice(0, 8)}`;
          await db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, preset) values ($1, $2, $3, 'baseline', 'PG placeholder', 'image/png', $4, 'ready', 'natural')`, [id, who, c, media.png]);
          await db.query(`insert into adult_face_refs (owner_id, character_id, image_id) values ($1, $2, $3)`, [who, c, id]);
        }
      }
      await db.query(`update adult_scenes set stage = 4, stage_from = 0, place = 'her living room', set_place = 'her living room', lines = $2::jsonb where owner_id = $1`, [ownerId, JSON.stringify(NIGHT)]);
    } finally {
      await db.close();
    }
    app = await startApp(port, env);
    // The subscriber's scene, made now that they're entitled, then seeded the same.
    assert((await sub.request.get(`${app.base}/api/admin/after-dark?a=${HIM}&b=${HER}`)).ok(), "the subscriber's scene");
    await stopApp(app);
    const db2 = new PGlite(DB_DIR);
    try {
      await db2.query(`update adult_scenes set stage = 4, stage_from = 0, place = 'her living room', set_place = 'her living room', lines = $2::jsonb where owner_id = $1`, [ids[1].user_id, JSON.stringify(NIGHT)]);
    } finally {
      await db2.close();
    }
    app = await startApp(port, env);
    const api = (ctx, path) => ctx.request.get(`${app.base}${path}`);
    const q = `a=${HIM}&b=${HER}`;

    await step("nobody else gets in: a stranger and a signed-in non-subscriber get not-found, the page and every media route", async () => {
      // Past the 18+ door, so the not-found is After Dark's own.
      const stranger = await browser.newContext();
      await stranger.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
      for (const ctx of [stranger, outsider]) {
        assert((await api(ctx, PAGE)).status() === 404, "the theater's page");
        for (const path of [`/api/admin/after-dark?${q}`, `/api/admin/after-dark/moment-pictures?${q}`, `/api/admin/after-dark/draw-ahead?${q}`, `/api/admin/after-dark/presence?ids=${HIM},${HER}`, `/api/admin/after-dark/talk?${q}`, "/api/admin/after-dark/place-sound?venue=bar"]) {
          const s = (await api(ctx, path)).status();
          assert(s === 404, `${path}: HTTP ${s}`);
        }
      }
      await stranger.close();
    });

    const page = await owner.newPage();
    await page.setViewportSize({ width: 1280, height: 860 });
    watch(page);
    const tools = async () => {
      if (!(await page.locator(".ad-tools-more.open").count())) await page.click(".ad-tools-toggle");
      return page.locator(".ad-tools-steps");
    };
    const closeTools = async () => {
      if (await page.locator(".ad-tools-more.open").count()) await page.click(".ad-tools-toggle");
    };
    const momentsOf = async () => (await (await api(owner, `/api/admin/after-dark/moment-pictures?${q}`)).json()).moments ?? [];

    await step("the theater opens on the night, its lines playing", async () => {
      await page.goto(`${app.base}${PAGE}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".theater-after-dark", { timeout: 30_000 });
      await until("a line on stage", async () => (await page.locator(".theater-after-dark").innerText()).includes("canon"));
    });

    let firstPicture = null;
    await step("📸 Picture this: the form reads the scene (the costume, the place), the prompt has no names, it's drawn and goes on the stage", async () => {
      await page.click('button[aria-label="Pictures and clips"]');
      await page.click("text=Picture this moment");
      const form = page.locator('[aria-label="Create a picture of this moment"]');
      await form.waitFor({ timeout: 20_000 });
      const wearing = form.locator("textarea").nth(1);
      await until("the brief in the form", async () => (await wearing.inputValue()).includes("red superhero cape"));
      assert((await form.locator("textarea").nth(2).inputValue()).includes("green velvet sofa"), "the place is the brief's");
      await form.locator("summary", { hasText: "What will be sent" }).click();
      const prompt = await until("the prompt", async () => {
        const t = await form.locator(".ad-pc-prompt p").innerText();
        return t.length > 40 ? t : null;
      });
      assert(prompt.includes("green velvet sofa"), "the prompt has the brief's place");
      assert(!/\bJuniper\b|\bDex\b/.test(prompt), "no names in the prompt");
      assert(seen.briefs.length >= 1 && /red superhero cape|cape pooling|gold mask/.test(seen.briefs[0]), "the brief read the chapter");
      await form.locator("button", { hasText: "Create picture" }).click();
      const drawn = await until("the picture drawn", async () => (await momentsOf()).find((m) => m.status === "drawn"), 60_000, 1000);
      firstPicture = drawn.picture_id;
      await until("it on the stage", async () => (await page.locator(`img.ad-scene-backdrop[src*="${firstPicture}"]`).count()) > 0, 30_000);
      await page.screenshot({ path: join(OUT_DIR, "e2e-after-dark-theater-picture.png") });
    });

    await step("Next: a moment worth a picture is offered (Picture this?), and Not now leaves it", async () => {
      await page.click(".ad-theater-bar button[type=submit]");
      const offer = page.locator('[aria-label="Picture this moment?"]');
      await offer.waitFor({ timeout: 90_000 }).catch(async (err) => {
        const sc = (await (await api(owner, `/api/admin/after-dark?${q}`)).json()).scene ?? {};
        const last = (sc.lines ?? []).slice(-8).map((l) => `${l.stage}:${l.text.slice(0, 30)}`).concat([`scene stage ${sc.stage} from ${sc.stage_from} intensity ${sc.intensity} place ${sc.place}`]);
        const bar = await page.locator(".theater-after-dark").innerText();
        throw new Error(`${err.message.split("\n")[0]} | lines ${sc.lines?.length} beats ${JSON.stringify(sc.beats)} note ${sc.picture_note} | last ${JSON.stringify(last)} | page ${bar.slice(-300).replace(/\s+/g, " ")}`);
      });
      assert((await offer.innerText()).includes("on top"), "the moment is the one the lines named");
      await offer.locator("button", { hasText: "Not now" }).click();
      await until("the offer gone", async () => (await offer.count()) === 0);
    });

    await step("⚡ Draw ahead: turned on in ⋯, the next moment is drawn as it's written, without asking", async () => {
      const menu = await tools();
      await menu.locator("button", { hasText: "Draw ahead" }).click();
      await until("its note", async () => (await page.locator(".theater-after-dark").innerText()).includes("Drawing ahead"));
      assert((await (await tools()).locator("button", { hasText: "Drawing ahead ✓" }).count()) === 1, "it says it's on");
      await closeTools();
      // The step's lines start after the 18 there are (turning it on may also draw a moment still waiting before them).
      const from = (((await (await api(owner, `/api/admin/after-dark?${q}`)).json()).scene ?? {}).lines ?? []).length;
      await page.click(".ad-theater-bar button[type=submit]");
      const lap = await until("the next step's moment drawn ahead", async () => (await momentsOf()).find((m) => m.status === "drawn" && m.line >= from), 120_000, 1000);
      // It was never offered: no "Picture this?" for it.
      await page.waitForTimeout(4000);
      assert((await page.locator('[aria-label="Picture this moment?"]').count()) === 0, "nothing asked");
      assert(lap.picture_id, "its picture");
    });

    await step("✨ Bring them to life: a portrait, seven expressions and a living loop each, shown in the theater", async () => {
      const menu = await tools();
      await menu.locator("button", { hasText: "Bring them to life" }).click();
      const ready = await until(
        "both brought to life",
        async () => {
          const p = (await (await api(owner, `/api/admin/after-dark/presence?ids=${HIM},${HER}`)).json()).presence ?? {};
          return [HIM, HER].every((c) => p[c]?.portrait && p[c]?.loop && Object.keys(p[c]?.expressions ?? {}).length >= 7) ? p : null;
        },
        120_000,
        2000,
      );
      assert(ready, "presence");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".theater-after-dark", { timeout: 30_000 });
      await until("a living face", async () => (await page.locator(".ad-living-face img").count()) > 0, 30_000);
    });

    await step("🗣 Hear it from them: the line on stage, said by its speaker, plays over the stage", async () => {
      const menu = await tools();
      const hear = menu.locator("button", { hasText: "Hear it from" });
      await until("Hear it enabled", async () => !(await hear.isDisabled()), 20_000);
      await hear.click();
      await page.locator(".ad-talk-player video").waitFor({ timeout: 90_000 });
      assert(seen.calls.some((c) => c.endsWith("/audio/speech")), "its voice was made");
      await page.screenshot({ path: join(OUT_DIR, "e2e-after-dark-theater-talk.png") });
      await page.click(".ad-talk-close");
    });

    await step("🔈 Listen: each line in their own voice, and the place's own sound under them", async () => {
      const speeches = seen.calls.filter((c) => c.endsWith("/audio/speech")).length;
      await page.click('button[aria-label="Listen: each line in their own voice"]');
      await until("voices asked for", async () => seen.calls.filter((c) => c.endsWith("/audio/speech")).length > speeches, 30_000);
      const sound = await until("the place's sound", async () => {
        const r = await (await api(owner, `/api/admin/after-dark/place-sound?venue=${encodeURIComponent("elsewhere@her living room")}`)).json();
        return r.status === "ready" ? r : null;
      }, 60_000, 2000);
      const file = await api(owner, `/api/admin/after-dark/place-sound/${sound.id}`);
      assert(file.ok() && (file.headers()["content-type"] ?? "").startsWith("audio/"), "it plays as audio");
      await page.click('button[aria-label="Stop listening"]');
    });

    await step("↻ Redraw from the gallery: the picture's context, then a new one of the same moment", async () => {
      const before = (await (await api(owner, `/api/admin/after-dark?${q}`)).json()).gallery?.filter((m) => m.kind === "scene").length ?? 0;
      await page.locator(".theater-after-dark button", { hasText: "Exit" }).click();
      const tile = page.locator(".ad-tile-more", { has: page.locator("button", { hasText: "↻ Redraw" }) }).first();
      await tile.waitFor({ timeout: 20_000 });
      await tile.locator("summary").click();
      await tile.locator("button", { hasText: "↻ Redraw" }).click();
      await tile.locator("button", { hasText: "↻ Redraw it" }).click({ timeout: 20_000 });
      await until(
        "a new scene picture",
        async () => ((await (await api(owner, `/api/admin/after-dark?${q}`)).json()).gallery?.filter((m) => m.kind === "scene" && m.status !== "failed").length ?? 0) > before,
        60_000,
        1500,
      );
    });

    await step("🎬 Video of the night: the storyboard plans its shots, each from a picture", async () => {
      await page.goto(`${app.base}${PAGE}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".theater-after-dark", { timeout: 30_000 });
      await page.locator("button", { hasText: "Video of the night" }).first().click();
      const board = page.locator('[aria-label="Storyboard"]');
      await board.waitFor({ timeout: 60_000 });
      await until("its shots", async () => (await board.locator(".ad-storyboard-grid li").count()) >= 3, 60_000);
      await page.screenshot({ path: join(OUT_DIR, "e2e-after-dark-theater-storyboard.png") });
    });

    await step("a subscriber: Draw ahead says its price, and turned on with no tokens says what it takes", async () => {
      const subPage = await sub.newPage();
      watch(subPage);
      await subPage.goto(`${app.base}${PAGE}`, { waitUntil: "domcontentloaded" });
      await subPage.waitForSelector(".theater-after-dark", { timeout: 30_000 });
      await subPage.click(".ad-tools-toggle");
      const item = subPage.locator(".ad-tools-steps button", { hasText: "Draw ahead" });
      assert((await item.innerText()).includes("1 token a chapter"), "its price");
      // A moment waiting, then turned on: the chapter's price can't be taken.
      await subPage.click(".ad-tools-toggle");
      await subPage.click(".ad-theater-bar button[type=submit]");
      await subPage.locator('[aria-label="Picture this moment?"]').waitFor({ timeout: 90_000 });
      await subPage.locator('[aria-label="Picture this moment?"] button', { hasText: "Not now" }).click();
      const r = await sub.request.post(`${app.base}/api/admin/after-dark/draw-ahead`, { data: { a: HIM, b: HER, on: true, at: 0 } });
      assert(r.status() === 402, `HTTP ${r.status()}`);
      assert(((await r.json()).message ?? "").includes("1 token a chapter"), "says what it takes");
      const view = (await (await api(sub, `/api/admin/after-dark/draw-ahead?${q}`)).json()).draw_ahead;
      assert(view.on === false && view.price === 1, "left off");
      await subPage.close();
    });

    // #1053 (the 2026-10-30 ad visitor: "I clicked the DeepSeek button. No picker appeared"): a subscriber, discreet mode on.
    await step("a subscriber: ✍️ opens the writers over the stage, a pick sticks, and Next says Writing… while it writes", async () => {
      const subPage = await sub.newPage();
      await subPage.setViewportSize({ width: 1280, height: 860 });
      watch(subPage);
      await subPage.goto(`${app.base}${PAGE}`, { waitUntil: "domcontentloaded" });
      await subPage.waitForSelector(".theater-after-dark", { timeout: 30_000 });
      await subPage.click(".ad-writer-logo-button");
      const quick = subPage.locator('.ad-writer-menu [role="menuitemradio"]', { hasText: "Quick (DeepSeek V3.1)" });
      await quick.waitFor({ timeout: 10_000 });
      assert((await subPage.locator(".ad-writer-menu").innerText()).includes("Richer, slower (GLM-4.6)"), "the same words as the hub's settings");
      // Nothing of the stage's over it: the item itself is what's under its middle.
      const onTop = await quick.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return Boolean(hit && el.contains(hit));
      });
      assert(onTop, "something on the stage covers the writers' list");
      await quick.click({ timeout: 5_000 });
      await until("the chip to say DeepSeek", async () => (await subPage.locator(".ad-writer-logo-button").innerText()).includes("DeepSeek"), 10_000);
      const mine = (await (await api(sub, "/api/admin/after-dark/writer")).json());
      assert(mine.chosen === "deepseek/deepseek-chat-v3.1:nitro" && mine.picked, "the pick was saved");
      // A step held for a moment: Next stays on screen and says Writing… until the lines come.
      await subPage.route("**/api/admin/after-dark", async (route) => {
        if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 2_500));
        await route.continue();
      });
      const next = subPage.locator(".ad-theater-bar button[type=submit]");
      await next.click();
      await until("Writing… on Next", async () => (await next.isVisible()) && (await next.innerText()).includes("Writing…"), 2_000, 100);
      await until("Next back", async () => (await next.isVisible()) && !(await next.innerText()).includes("Writing…"), 90_000);
      await subPage.close();
    });

    await step("the phone: the theater and its ⋯ menu fit, nothing broken", async () => {
      const phone = await owner.newPage();
      await phone.setViewportSize({ width: 390, height: 844 });
      watch(phone);
      await phone.goto(`${app.base}${PAGE}`, { waitUntil: "domcontentloaded" });
      await phone.waitForSelector(".theater-after-dark", { timeout: 30_000 });
      await phone.click(".ad-tools-toggle");
      await phone.locator(".ad-tools-steps button", { hasText: "Drawing ahead" }).waitFor({ timeout: 10_000 });
      const wide = await phone.evaluate(() => document.documentElement.scrollWidth);
      assert(wide <= 392, `no sideways scroll (${wide}px)`);
      await phone.screenshot({ path: join(OUT_DIR, "e2e-after-dark-theater-phone.png") });
      await phone.close();
    });

    await step("no page errors along the way", async () => {
      assert(errors.length === 0, errors.slice(0, 3).join(" | "));
    });
  } finally {
    await browser.close();
    await stopApp(app);
    providers.close();
    showrunner.close();
  }
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

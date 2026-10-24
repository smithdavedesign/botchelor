#!/usr/bin/env node
/**
 * npm run e2e:studio: the After Dark Studio (lib/adult/studio.ts, app/after-dark/studio) in a real browser, every tab and
 * every button, at desktop and phone sizes, against the production build with ADULT_MODE=1 on a throwaway database.
 *
 * Nothing leaves the machine. The image providers and the picture checks are a local stub: the app's own process loads
 * scripts/e2e-provider-redirect.mjs, which sends Venice, Hive, Replicate, fal and Sightengine calls to it. The stub
 * draws a PG placeholder (the repo's own cast portraits, through ffmpeg) and passes every check, so the app's own checks
 * still run, on a real picture. Never anything explicit.
 *
 * Exits non-zero if any step fails. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build; HEADED=1 shows the browser.
 */
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { PGlite } from "@electric-sql/pglite";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const DATA_DIR = join(ROOT, ".data", "e2e-studio");
const DB_DIR = join(DATA_DIR, "pglite");
const HER = "house-juniper";
const HIM = "house-dex";
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

/** A PG placeholder picture (her portrait), and a 2-second clip of it, made with ffmpeg. */
function placeholders() {
  const dir = join(DATA_DIR, "media");
  mkdirSync(dir, { recursive: true });
  const run = (args) => {
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "inherit"] });
    if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
  };
  const cast = join(ROOT, "public", "cast", `${HER}-v3.webp`);
  run(["-i", cast, "-vf", "scale=384:512", "-frames:v", "1", join(dir, "her.png")]);
  run(["-i", cast, "-vf", "scale=768:1024", "-frames:v", "1", join(dir, "her-big.png")]);
  run(["-loop", "1", "-i", join(dir, "her.png"), "-t", "2", "-vf", "scale=384:512,format=yuv420p", "-c:v", "libx264", "-r", "16", join(dir, "clip.mp4")]);
  return { png: readFileSync(join(dir, "her.png")), big: readFileSync(join(dir, "her-big.png")), clip: readFileSync(join(dir, "clip.mp4")) };
}

/**
 * The providers and checks, stubbed, in the shapes the app reads (the same as its unit tests' fakes): Venice's
 * multi-edit, upscale and image generation, its video queue; Hive's moderation and its age question (clean, ADULTS);
 * Replicate predictions; Venice and Sightengine as checks. Anything else is a 404, and it's logged.
 */
function startProviderStub(media) {
  const calls = [];
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const host = String(req.headers["x-original-host"] ?? "");
      const path = (req.url ?? "").split("?")[0];
      calls.push(`${host}${path}`);
      const json = (o, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(o));
      };
      const bytes = (b, type) => {
        res.writeHead(200, { "content-type": type });
        res.end(b);
      };
      if (host === "api.thehive.ai" && path.includes("visual-moderation"))
        return json({ output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.05 }] }] });
      if (host === "api.thehive.ai") return json({ choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] });
      if (host === "api.sightengine.com") return json({ status: "success", nudity: { none: 0.95 }, offensive: { prob: 0.01 }, minor: { prob: 0.01 } });
      if (host === "api.venice.ai") {
        if (path.endsWith("/image/multi-edit") || path.endsWith("/image/edit")) return bytes(media.png, "image/png");
        if (path.endsWith("/image/upscale")) return bytes(media.big, "image/png");
        if (path.endsWith("/image/generate")) return json({ images: [media.png.toString("base64")] });
        if (path.endsWith("/video/queue")) return json({ queue_id: `q-${calls.length}` });
        if (path.endsWith("/video/retrieve")) return json({ status: "PROCESSING" });
        if (path.endsWith("/chat/completions")) return json({ choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] });
      }
      if (host === "api.replicate.com" && req.method === "POST") return json({ id: `pred-${calls.length}`, status: "succeeded", output: [`http://${req.headers.host}/media/her.png`] });
      if (path === "/media/her.png") return bytes(media.png, "image/png");
      console.log(`      (stub: nothing for ${req.method} ${host}${path})`);
      json({ error: "not stubbed" }, 404);
    });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({ srv, calls })));
}

/** After Dark's text model, stubbed: the Studio never asks it, but After Dark needs one to be on. */
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

/** Her face, a shoot of two in the gallery, and the recipient's character with a date with her (who a picture can go to). */
async function seed(owner, recipient, media) {
  const db = new PGlite(DB_DIR);
  try {
    const put = (id, character, kind, minutes, extra = {}) =>
      db.query(
        `insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, preset, shoot_id, nsfw_score, model, created_at)
         values ($1, $2, $3, $4, 'PG placeholder', 'image/png', $5, 'ready', $6, $7, 0.03, 'qwen-edit-uncensored', now() - ($8 || ' minutes')::interval)`,
        [id, owner, character, kind, media.png, extra.preset ?? null, extra.shoot ?? null, String(minutes)],
      );
    await put("e2e-face", HER, "baseline", 120, { preset: "natural" });
    await db.query(`insert into adult_face_refs (owner_id, character_id, image_id) values ($1, $2, 'e2e-face')`, [owner, HER]);
    // His face too, so a shoot together has both to start from (else it draws a first one of him).
    await put("e2e-face-him", HIM, "baseline", 120, { preset: "natural" });
    await db.query(`insert into adult_face_refs (owner_id, character_id, image_id) values ($1, $2, 'e2e-face-him')`, [owner, HIM]);
    await db.query(
      `insert into adult_studio_shoots (id, owner_id, character_id, kind, choices, model, provider, tokens, asked, made, status, pictures, created_at)
       values ('e2e-shoot', $1, $2, 'shoot', '{"pose":"shoulder"}'::jsonb, 'qwen-edit-uncensored', 'venice', 0, 2, 2, 'ready', '["e2e-shot-1","e2e-shot-2"]'::jsonb, now() - interval '60 minutes')`,
      [owner, HER],
    );
    await put("e2e-shot-1", HER, "scene", 60, { shoot: "e2e-shoot" });
    await put("e2e-shot-2", HER, "scene", 59, { shoot: "e2e-shoot" });
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
  } finally {
    await db.close();
  }
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const media = placeholders();
  const showrunner = await startShowrunner();
  const adult = await startAdultStub();
  const providers = await startProviderStub(media);
  const env = appEnv(showrunner.address().port, DB_DIR);
  const ADMIN_PASSWORD = ["e2e", "studio", Math.random().toString(36).slice(2)].join("-");
  Object.assign(env, {
    FRONTIER_PASSWORD: ADMIN_PASSWORD,
    ADULT_MODE: "1",
    ADULT_LLM_BASE_URL: `http://127.0.0.1:${adult.address().port}/v1`,
    ADULT_LLM_API_KEY: "local-stub",
    ADULT_LLM_MODEL: "stub-adult",
    E2E_PROVIDER_STUB: `http://127.0.0.1:${providers.srv.address().port}`,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(join(ROOT, "scripts", "e2e-provider-redirect.mjs")).href}`.trim(),
  });
  const port = await freePort();
  let app = await startApp(port, env);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: !process.env.HEADED });
  const errors = [];
  /** A signed-in admin with After Dark's blur off, in a browser context of their own. */
  const admin = async (handle) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const reg = await ctx.request.post(`${app.base}/api/auth/register`, { data: { handle, password: "a-long-e2e-studio-password-1", attest: true } });
    assert(reg.ok(), `register: HTTP ${reg.status()}`);
    assert((await ctx.request.post(`${app.base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } })).ok(), "claiming admin");
    assert((await ctx.request.post(`${app.base}/api/admin/after-dark/privacy`, { data: { blur: false } })).ok(), "turning the blur off");
    return ctx;
  };
  try {
    const owner = await admin(`studio${Date.now() % 1e6}`);
    const recipient = await admin(`juno${Date.now() % 1e6}`);
    const keys = await owner.request.post(`${app.base}/api/admin/after-dark/settings`, { data: { venice_key: "placeholder-venice-e2e-0001", hive_key: "placeholder-hive-e2e-0001", enabled: true } });
    assert(keys.ok(), `saving placeholder keys: HTTP ${keys.status()}`);
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
    await seed(ids[0], ids[1], media);
    app = await startApp(port, env);

    const page = await owner.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text()}`));
    const studio = `${app.base}/after-dark/studio/${HER}`;
    const tab = (name) => page.getByRole("tab", { name, exact: true }).click();
    const group = (legend) => page.locator("fieldset.ad-studio-group", { has: page.locator("legend", { hasText: legend }) });
    const note = () => page.locator(".ad-studio-main > [role=status], .ad-studio-main > [role=alert]").first();
    const noteText = async () => ((await note().count()) ? (await note().innerText()).trim() : "");
    /**
     * Clicks something that sends a Studio action, waits for the server's answer and for the page to show it, and
     * returns the note the Studio left (or the HTTP status when it left none).
     */
    const act = async (target) => {
      const label = (await target.innerText().catch(() => "?")).trim();
      const answered = page.waitForResponse((r) => /\/api\/admin\/after-dark\/(studio|face)/.test(r.url()) && r.request().method() === "POST", { timeout: 60_000 });
      await target.click();
      const res = await answered.catch(async () => {
        throw new Error(`"${label}" sent nothing to the server in a minute; the page says "${await noteText()}"`);
      });
      await page.waitForFunction(() => !document.querySelector(".ad-studio-main button[disabled][aria-busy=true]"), null, { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(250);
      return { status: res.status(), note: await noteText() };
    };
    const shotOf = (file) => page.screenshot({ path: join(process.env.E2E_SHOTS ?? DATA_DIR, `${file}.png`), fullPage: false });
    const noSideways = async (name) => {
      const width = page.viewportSize()?.width ?? 0;
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
      assert(scroll <= width, `${name}: scrolls sideways on a phone (${scroll}px on ${width}px)`);
    };

    for (const [w, h, size] of [
      [1280, 900, "desktop"],
      [390, 844, "phone"],
    ]) {
      console.log(`\n${size}`);
      await page.setViewportSize({ width: w, height: h });
      await page.goto(studio);
      await page.locator(".ad-studio-group").first().waitFor({ timeout: 30_000 });

      await step(`${size}: Shoot: picking a chip turns it on, and again turns it off`, async () => {
        const chip = group("Pose").getByRole("button").first();
        await chip.click();
        assert((await chip.getAttribute("aria-pressed")) === "true", "the chip didn't turn on");
        await chip.click();
        assert((await chip.getAttribute("aria-pressed")) === "false", "the chip didn't turn off");
        await chip.click();
      });

      await step(`${size}: Shoot: the Shoot button is enabled with a model that's ready`, async () => {
        const shoot = page.getByRole("button", { name: /^Shoot \d+ ·/ });
        assert(await shoot.isEnabled(), `disabled: "${await shoot.innerText()}"`);
      });

      await step(`${size}: Shoot: "Save as a setup" asks for a name when there's none, and saves once named`, async () => {
        const name = page.getByRole("textbox", { name: "Setup name" });
        const save = page.getByRole("button", { name: "Save as a setup" });
        // Clickable before a name (a greyed-out Save read as broken): it asks for one and puts the cursor there.
        assert(await save.isEnabled(), "Save as a setup is disabled before a name");
        await save.click();
        assert(/Give the setup a name first/.test(await noteText()), `without a name: "${await noteText()}"`);
        assert(await name.evaluate((el) => el === document.activeElement), "the name box didn't get the cursor");
        // As a person would: click into the box (it fails if anything covers it) and type.
        await name.scrollIntoViewIfNeeded();
        await name.click();
        await page.keyboard.type(`Shoot setup ${size}`);
        await shotOf(`shoot-setup-${size}`);
        const box = await name.boundingBox();
        assert(box && box.width >= 120, `the name box is ${box?.width ?? 0}px wide`);
        assert((await name.inputValue()) === `Shoot setup ${size}`, `typed "${await name.inputValue()}"`);
        assert(await save.isEnabled(), "still disabled after typing a name");
        const { status, note: said } = await act(save);
        assert(status === 200 && /Saved "Shoot setup/.test(said), `after saving: HTTP ${status}, "${said}"`);
        assert((await name.inputValue()) === "", "the name wasn't cleared");
      });

      await step(`${size}: Shoot: a shoot comes back with new pictures`, async () => {
        const { note: said } = await act(page.getByRole("button", { name: /^Shoot \d+ ·/ }));
        assert(/new picture/.test(said), `after shooting: "${said}"`);
      });
      if (size === "phone") await step("phone: Shoot: no sideways scroll", () => noSideways("the Shoot tab"));

      await step(`${size}: Setups: the saved one is listed, Use loads it onto Shoot, and Delete removes it`, async () => {
        await tab("Setups");
        const row = page.locator("li, .ad-studio-setup").filter({ hasText: `Shoot setup ${size}` }).first();
        await row.waitFor({ timeout: 10_000 });
        await row.getByRole("button", { name: "Use", exact: true }).click();
        assert((await page.getByRole("tab", { name: "Shoot", exact: true }).getAttribute("aria-selected")) === "true", "Use didn't open Shoot");
        assert((await group("Pose").locator('button[aria-pressed="true"]').count()) === 1, "the setup's pose isn't picked");
        await tab("Setups");
        const del = row.getByRole("button", { name: /^delete$/i });
        assert((await del.count()) > 0, "no Delete on a setup");
        const { status } = await act(del.first());
        assert(status === 200, `delete: HTTP ${status}`);
        assert((await page.locator("li, .ad-studio-setup").filter({ hasText: `Shoot setup ${size}` }).count()) === 0, "still listed after Delete");
      });
      if (size === "phone") await step("phone: Setups: no sideways scroll", () => noSideways("the Setups tab"));

      await step(`${size}: Together: picking a partner opens their menu; Shoot together enables once every pick is made, saves as a setup, and comes back`, async () => {
        await tab("Together");
        await page.locator("select").filter({ has: page.locator("option", { hasText: "Pick someone" }) }).selectOption(HIM);
        await group("What they're doing").waitFor({ timeout: 15_000 });
        const go = page.getByRole("button", { name: /together ·/ });
        for (const legend of ["What they're doing", "What they wear", "Framing", "Place"]) {
          const g = group(legend);
          if ((await g.locator('button[aria-pressed="true"]').count()) === 0) await g.locator("button:not([disabled])").first().click();
        }
        assert(await go.isEnabled(), `still disabled: "${await go.innerText()}"`);
        const name = page.getByRole("textbox", { name: "Setup name" });
        await name.click();
        await page.keyboard.type(`Together ${size}`);
        const save = page.getByRole("button", { name: "Save as a setup" });
        assert(await save.isEnabled(), "Save as a setup stayed disabled on Together");
        const saved = await act(save);
        assert(saved.status === 200 && /Saved "Together/.test(saved.note), `Together's setup: HTTP ${saved.status}, "${saved.note}"`);
        const shot = await act(go);
        assert(shot.status === 200 && /new picture/.test(shot.note), `after shooting together: HTTP ${shot.status}, "${shot.note}"`);
      });
      if (size === "phone") await step("phone: Together: no sideways scroll", () => noSideways("the Together tab"));

      await step(`${size}: Identity: strength changes, a restyle and "Save to their look" work`, async () => {
        await tab("Identity");
        await shotOf(`identity-${size}`);
        const strict = page.getByRole("button", { name: "Strict", exact: true });
        const s1 = await act(strict);
        assert(s1.status === 200 && (await strict.getAttribute("aria-pressed")) === "true", `Strict: HTTP ${s1.status}, "${s1.note}"`);
        await act(page.getByRole("button", { name: "Balanced", exact: true }));
        const restyle = page.getByRole("button", { name: /^Restyle ·/ });
        // "Save to their look" is only for one's own characters: a house character's look isn't theirs to change.
        const keep = page.getByRole("button", { name: "Save to their look", exact: true });
        const ownLook = (await keep.count()) > 0;
        assert(await restyle.isDisabled(), "Restyle enabled with no change picked");
        if (ownLook) assert(await keep.isDisabled(), "Save to their look enabled with no change picked");
        // A restyle change: the chips under the Restyle heading (the ones above it set the face's strictness).
        await page.locator('h2:text-is("Restyle") ~ fieldset button.ad-chip:not([disabled])').first().click();
        assert(await restyle.isEnabled(), "Restyle stayed disabled after a change");
        if (ownLook) assert(await keep.isEnabled(), "Save to their look stayed disabled after a change");
        const r = await act(restyle);
        assert(r.status === 200 && /picture/.test(r.note), `restyle: HTTP ${r.status}, "${r.note}"`);
        if (ownLook) {
          const k = await act(keep);
          assert(k.status === 200, `save to their look: HTTP ${k.status}, "${k.note}"`);
        }
      });

      await step(`${size}: Identity: a new face and a body reference come back`, async () => {
        const draw = page.getByRole("button", { name: /^Draw \d+ ·/ });
        assert(await draw.isEnabled(), `Draw disabled: "${await draw.innerText()}"`);
        const d = await act(draw);
        assert(d.status === 200 && /picture/.test(d.note), `new faces: HTTP ${d.status}, "${d.note}"`);
        const make = page.getByRole("button", { name: /^Make \d+ ·/ });
        assert(await make.isEnabled(), `Make (body) disabled: "${await make.innerText()}"`);
        const m = await act(make);
        assert(m.status === 200 && /picture/.test(m.note), `body references: HTTP ${m.status}, "${m.note}"`);
      });
      if (size === "phone") await step("phone: Identity: no sideways scroll", () => noSideways("the Identity tab"));

      const galleryItem = (id) => page.locator(".ad-studio-item").filter({ has: page.locator(`img[src*="${id}"]`) }).last();
      await step(`${size}: Gallery: Use this face, Use as body, More like this and Upscale work`, async () => {
        await tab("Gallery");
        const item = galleryItem("e2e-shot-1");
        await item.waitFor({ timeout: 10_000 });
        // Already her face after the first pass: then it says so instead of offering it.
        const useFace = item.getByRole("button", { name: "Use this face", exact: true });
        if (await useFace.count()) {
          const face = await act(useFace.first());
          assert(face.status === 200, `use this face: HTTP ${face.status}, "${face.note}"`);
        } else assert((await item.getByText("The face", { exact: true }).count()) > 0, "neither Use this face nor The face");
        const body = item.getByRole("button", { name: "Use as body", exact: true });
        if (await body.count()) {
          const b = await act(body.first());
          assert(b.status === 200, `use as body: HTTP ${b.status}, "${b.note}"`);
        }
        const more = await act(item.locator("button", { hasText: /^(More like this|Drawing…)$/ }).first());
        assert(more.status === 200 && /picture/.test(more.note), `more like this: HTTP ${more.status}, "${more.note}"`);
        const up = item.getByRole("button", { name: /^Upscale/ }).first();
        if (await up.isEnabled()) {
          const u = await act(up);
          assert(u.status === 200, `upscale: HTTP ${u.status}, "${u.note}"`);
        }
      });

      await step(`${size}: Gallery: Share sends a picture to someone she's dated, and Take back undoes it`, async () => {
        const item = galleryItem("e2e-shot-2");
        await item.getByRole("button", { name: "Share…" }).click();
        const panel = item.locator(".ad-studio-share");
        await panel.waitFor({ timeout: 10_000 });
        const send = panel.getByRole("button", { name: /^Share|^Send/ }).last();
        assert(await send.isEnabled(), "the share's send button is disabled");
        const sent = await act(send);
        assert(sent.status === 200, `share: HTTP ${sent.status}, "${sent.note}"`);
        const back = item.getByRole("button", { name: "Take back" });
        await back.first().waitFor({ timeout: 10_000 });
        const undone = await act(back.first());
        assert(undone.status === 200 && /Taken back/.test(undone.note), `take back: HTTP ${undone.status}, "${undone.note}"`);
      });

      await step(`${size}: Gallery: Animate starts a clip (one at a time)`, async () => {
        const item = galleryItem("e2e-shot-1");
        const anim = item.getByRole("button", { name: "Animate…" });
        if (await anim.isDisabled()) return; // already one being made, from the desktop pass
        await anim.click();
        const panel = item.locator(".ad-studio-share");
        await panel.waitFor({ timeout: 10_000 });
        await panel.locator("button.ad-chip:not([disabled])").first().click();
        const a = await act(panel.getByRole("button", { name: /^Animate/ }).last());
        assert(a.status === 200, `animate: HTTP ${a.status}, "${a.note}"`);
        await page.getByText(/Animating, started/).waitFor({ timeout: 10_000 });
      });
      await step(`${size}: Gallery and Identity: every picture loads and decodes (the AI mark doesn't break one)`, async () => {
        for (const t of ["Gallery", "Identity"]) {
          await tab(t);
          await page.evaluate(async () => {
            for (const img of document.querySelectorAll(".ad-studio-main img")) {
              img.loading = "eager";
              img.scrollIntoView();
              await new Promise((r) => setTimeout(r, 30));
            }
          });
          const broken = await page
            .waitForFunction(() => [...document.querySelectorAll(".ad-studio-main img")].every((i) => i.complete), null, { timeout: 20_000 })
            .then(() => page.evaluate(() => [...document.querySelectorAll(".ad-studio-main img")].filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src"))));
          assert(broken.length === 0, `${t}: pictures that didn't load: ${broken.slice(0, 4).join(", ")}`);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
      });
      if (size === "phone") await step("phone: Gallery: no sideways scroll", () => noSideways("the Gallery tab"));
    }

    console.log("\nAfter Dark around the Studio");
    await page.setViewportSize({ width: 1280, height: 900 });
    await step("the character page offers the Studio (an admin, a house character)", async () => {
      await page.goto(`${app.base}/characters/${HER}`);
      const card = page.locator("section.character-studio");
      await card.waitFor({ timeout: 15_000 });
      const open = card.getByRole("link", { name: "Open the Studio" });
      assert((await open.getAttribute("href"))?.endsWith(`/after-dark/studio/${HER}`), `the link goes to ${await open.getAttribute("href")}`);
      await open.click();
      await page.locator(".ad-studio-group").first().waitFor({ timeout: 30_000 });
    });

    await step("the pair picker: faces, then who with, then a way in; Start over brings every face back", async () => {
      await page.goto(`${app.base}/after-dark`);
      const picker = page.locator(".ad-pair-picker");
      await picker.waitFor({ timeout: 15_000 });
      assert((await picker.locator("li.card").count()) === 0 || (await picker.getByRole("heading", { name: "Continue" }).count()) > 0, "a list of new pairs is still shown");
      const faces = picker.locator(".ad-cast-chips button.ad-cast-chip");
      const all = await faces.count();
      assert(all >= 2, `faces: ${all}`);
      await faces.first().click();
      assert((await picker.locator(".ad-pair-picked button.ad-cast-chip.on").count()) === 1, "the first pick isn't shown as picked");
      const partners = await faces.count();
      assert(partners >= 1 && partners < all, `after one pick, ${partners} of ${all} faces show`);
      await picker.getByRole("button", { name: "Start over" }).click();
      assert((await faces.count()) === all, "Start over didn't bring every face back");
      await faces.first().click();
      await faces.first().click();
      const go = picker.locator(".ad-pair-go a");
      await go.waitFor({ timeout: 5_000 });
      assert(/^(Start|Continue) /.test((await go.innerText()).trim()), `the way in says "${await go.innerText()}"`);
      await picker.getByRole("button", { name: "Start over" }).click();
      assert((await go.count()) === 0 && (await faces.count()) === all, "Start over after both picks didn't reset");
    });

    await step("the scene's gallery: sections, and a 👎 moves a picture to Not liked (and back)", async () => {
      const [a, b] = [HER, HIM].sort();
      await page.goto(`${app.base}/after-dark/${a}/${b}`);
      const gallery = page.locator("section", { has: page.getByRole("heading", { name: "Gallery", exact: true }) }).last();
      await gallery.getByRole("heading", { name: "Pictures", exact: true }).waitFor({ timeout: 20_000 });
      const pictures = gallery.locator(".ad-gallery-section", { has: page.getByRole("heading", { name: "Pictures", exact: true }) });
      const before = await pictures.locator("li").count();
      await pictures.locator("li").first().getByRole("button", { name: "Not right", exact: true }).first().click();
      const notLiked = gallery.locator(".ad-gallery-disliked");
      await notLiked.waitFor({ timeout: 10_000 });
      assert((await notLiked.locator("li").count()) === 1, "the 👎 didn't move to Not liked");
      assert((await pictures.locator("li").count()) === before - 1, "it's still under Pictures");
      await notLiked.locator("li").first().getByRole("button", { name: "Not right", exact: true }).first().click();
      await page.waitForTimeout(800);
      assert((await gallery.locator(".ad-gallery-disliked").count()) === 0, "taking the 👎 back didn't move it back");
    });

    await step("no page errors or console errors", async () => {
      assert(errors.length === 0, errors.slice(0, 5).join(" | "));
    });
    console.log(`\nprovider calls the stub answered: ${[...new Set(providers.calls)].join(", ") || "none"}`);
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
    adult.close();
    providers.srv.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(`e2e:studio failed: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});

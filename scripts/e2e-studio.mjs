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
 * Exits non-zero if any step fails. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build; HEADED=1 shows the browser;
 * SHOTS=1 writes the README's screenshots (the Fix sheet's, fix-*.png) to docs/screenshots.
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
    const lines = (err instanceof Error ? err.message : String(err)).split("\n").map((l) => l.trim()).filter(Boolean);
    // Playwright's call log ("- waiting for …") says what a timeout was waiting for.
    const waited = lines.filter((l) => l.startsWith("- ")).slice(-2);
    console.log(`  ✗ ${name}\n      ${[lines[0], ...waited].join("\n      ")}`);
  }
}
/** A Studio tab by its word: the tabs carry an emoji first and the Gallery a count ("🖼 Gallery (6)"). */
const tabName = (word) => new RegExp(`^(\\S+ )?${word}( \\(\\d+\\))?$`, "u");

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
    const tab = (name) => page.getByRole("tab", { name: tabName(name) }).click();
    // The legend's own name, not any legend that mentions it ("Filthy: one act, in place of a pose" isn't Pose).
    const group = (legend) => page.locator("fieldset.ad-studio-group", { has: page.locator("legend", { hasText: new RegExp(`^\\s*${legend}`) }) });
    // The Shoot tab's sections fold to one row each, their pick on the right (the 2026-11-11 Studio review): open one first.
    const foldHead = (title) => page.locator("button.ad-studio-fold-head", { has: page.locator("strong", { hasText: new RegExp(`^\\s*${title}`) }) });
    const fold = async (title) => {
      const head = foldHead(title);
      if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
      return group(title);
    };
    // A gallery tile's ⋯: everything but ⭐, 👍/👎 and 🩹 Fix lives in it (the same review).
    const openMore = async (item) => {
      const more = item.locator("details.ad-tile-more").first();
      if (!(await more.evaluate((d) => d.open))) await more.locator("summary").click();
    };
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
    // The README's (`readme`) go to docs/screenshots with SHOTS=1; the rest stay with the run (or E2E_SHOTS).
    const shotOf = (file, readme = false) =>
      page.screenshot({ path: join(readme && process.env.SHOTS ? join(ROOT, "docs", "screenshots") : (process.env.E2E_SHOTS ?? DATA_DIR), `${file}.png`), fullPage: false });
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
      // The Studio opens where they left off (the tab and the picks, remembered in this browser): each size starts fresh.
      await page.goto(studio);
      await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("bz-studio:")).forEach((k) => localStorage.removeItem(k)));
      await page.goto(studio);
      await page.locator(".ad-studio-group").first().waitFor({ timeout: 30_000 });
      await page.getByRole("tab", { name: "Shoot" }).click();

      await step(`${size}: Shoot: picking a chip turns it on, and again turns it off`, async () => {
        assert((await page.locator("fieldset.ad-studio-fold-body").count()) === 0, "a Shoot section is open before any was tapped");
        const chip = (await fold("Pose")).getByRole("button").first();
        const label = (await chip.innerText()).trim();
        await chip.click();
        assert((await chip.getAttribute("aria-pressed")) === "true", "the chip didn't turn on");
        // The folded row says what's picked.
        const summary = (await foldHead("Pose").locator(".muted").innerText()).trim();
        assert(summary.includes(label), `the Pose row says "${summary}", not "${label}"`);
        await chip.click();
        assert((await chip.getAttribute("aria-pressed")) === "false", "the chip didn't turn off");
        await chip.click();
      });

      await step(`${size}: Shoot: the Shoot button is enabled with a model that's ready`, async () => {
        const shoot = page.getByRole("button", { name: /^Shoot \d+ ·/ });
        assert(await shoot.isEnabled(), `disabled: "${await shoot.innerText()}"`);
      });

      // The 2026-11-11 review: the shape and how many ride in the stuck Shoot bar, one line that opens their chips there.
      await step(`${size}: Shoot: the bar says the shape and how many, and opens their chips`, async () => {
        const toggle = page.locator(".ad-studio-go.is-main .ad-studio-shape-toggle");
        assert(/3:4 · 4/.test(await toggle.innerText()), `the bar says "${await toggle.innerText()}"`);
        assert(!(await page.locator("#ad-shoot-shape").isVisible()), "the chips start folded");
        await toggle.click();
        await page.locator("#ad-shoot-shape .studio-format", { hasText: "Square" }).click();
        await page.waitForFunction(() => /1:1 · 4/.test(document.querySelector(".ad-studio-go.is-main .ad-studio-shape-toggle")?.textContent ?? ""), null, { timeout: 5_000 });
        await page.locator("#ad-shoot-shape .studio-format", { hasText: "Portrait" }).click();
        await toggle.click();
        assert(!(await page.locator("#ad-shoot-shape").isVisible()), "the chips fold again");
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
      if (size === "phone")
        await step("phone: every Studio tab is on screen (they wrap, none hide off the side)", async () => {
          const off = await page.locator("nav.ad-studio-tabs[aria-label=Studio] [role=tab]").evaluateAll((tabs) =>
            tabs.filter((b) => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > window.innerWidth + 1; }).map((b) => b.textContent),
          );
          assert(off.length === 0, `tabs off screen: ${off.join(", ")}`);
        });

      await step(`${size}: Setups: the saved one is listed, Use loads it onto Shoot, and Delete removes it`, async () => {
        await tab("Setups");
        const row = page.locator("li, .ad-studio-setup").filter({ hasText: `Shoot setup ${size}` }).first();
        await row.waitFor({ timeout: 10_000 });
        await row.getByRole("button", { name: "Use", exact: true }).click();
        assert((await page.getByRole("tab", { name: tabName("Shoot") }).getAttribute("aria-selected")) === "true", "Use didn't open Shoot");
        assert((await (await fold("Pose")).locator('button[aria-pressed="true"]').count()) === 1, "the setup's pose isn't picked");
        // Shoot lists it too, to load in one tap.
        assert((await page.locator(".ad-studio-setups-quick").getByRole("button", { name: `Shoot setup ${size}`, exact: true }).count()) === 1, "Shoot doesn't list the saved setup");
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
        await openMore(item);
        // Already her face after the first pass: then it says so instead of offering it.
        const useFace = item.getByRole("button", { name: "Use this face", exact: true });
        if (await useFace.count()) {
          const face = await act(useFace.first());
          assert(face.status === 200, `use this face: HTTP ${face.status}, "${face.note}"`);
        } else assert((await item.getByText("The face", { exact: true }).count()) > 0, "neither Use this face nor The face");
        await openMore(item);
        const body = item.getByRole("button", { name: "Use as body", exact: true });
        if (await body.count()) {
          const b = await act(body.first());
          assert(b.status === 200, `use as body: HTTP ${b.status}, "${b.note}"`);
        }
        await openMore(item);
        const more = await act(item.locator("button", { hasText: /^(More like this|Drawing…)$/ }).first());
        assert(more.status === 200 && /picture/.test(more.note), `more like this: HTTP ${more.status}, "${more.note}"`);
        await openMore(item);
        const up = item.getByRole("button", { name: /^Upscale/ }).first();
        if (await up.isEnabled()) {
          const u = await act(up);
          assert(u.status === 200, `upscale: HTTP ${u.status}, "${u.note}"`);
        }
      });

      await step(`${size}: Gallery: Share sends a picture to someone she's dated, and Take back undoes it`, async () => {
        const item = galleryItem("e2e-shot-2");
        await openMore(item);
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
        await openMore(item);
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
      // 🩹 Fix (lib/adult/fix.ts, app/after-dark/FixSheet.tsx): two fixes a size, of the five one picture can have.
      await step(`${size}: Gallery: 🩹 Fix repairs a marked spot, makes a change from that, keeps one, and goes back to the original`, async () => {
        try {
          await fixFlow();
        } catch (err) {
          // What the sheet looked like when it stopped (E2E_SHOTS, else the run's folder).
          await page.screenshot({ path: join(process.env.E2E_SHOTS ?? DATA_DIR, `fix-failed-${size}.png`) }).catch(() => {});
          const sheets = await page.locator(".ad-fixsheet").count();
          const text = sheets ? (await page.locator(".ad-fixsheet").first().innerText()).replace(/\s+/g, " ").slice(0, 500) : "";
          console.log(`      (${sheets} sheet${sheets === 1 ? "" : "s"} open: ${text})`);
          throw err;
        } finally {
          // Stopped part way: the original back in the gallery, the sheet closed, for the steps after this one.
          if (await page.locator(".ad-fixsheet").count()) await page.keyboard.press("Escape");
          await page.request.post(`${app.base}/api/admin/after-dark/fix`, { data: { action: "keep", media_id: "e2e-shot-2" } }).catch(() => {});
        }
      });
      async function fixFlow() {
        await tab("Gallery");
        const item = galleryItem("e2e-shot-2");
        await item.waitFor({ timeout: 10_000 });
        await item.getByRole("button", { name: "🩹 Fix", exact: true }).click();
        const sheet = page.locator(".ad-fixsheet");
        await sheet.locator(".ad-fixsheet-body").waitFor({ timeout: 15_000 });
        // Every picture in the sheet drawn (a new version takes a moment to load), but a lazy one out of sight.
        const drawn = () =>
          page
            .waitForFunction(
              () => [...document.querySelectorAll(".ad-fixsheet img")].filter((i) => i.loading !== "lazy" || i.getBoundingClientRect().top < window.innerHeight).every((i) => i.complete && i.naturalWidth > 0),
              null,
              { timeout: 15_000 },
            )
            .catch(() => {});
        await drawn();
        const fixed = async (button, says) => {
          const answered = page.waitForResponse((r) => r.url().includes("/api/admin/after-dark/fix") && r.request().method() === "POST", { timeout: 90_000 });
          await button.click();
          const res = await answered;
          const body = await res.json().catch(() => ({}));
          assert(res.status() === 200, `${says}: HTTP ${res.status()}, "${body.message ?? ""}"`);
          await sheet.getByRole("status").filter({ hasText: says }).waitFor({ timeout: 10_000 });
          return body;
        };
        // Repair: a chip, and a spot dragged across the picture.
        assert((await sheet.getByRole("radio", { name: "🩹 Repair" }).getAttribute("aria-checked")) === "true", "the sheet doesn't open on Repair");
        await sheet.getByRole("group", { name: "What's broken" }).getByRole("button", { name: "Hands", exact: true }).click();
        await sheet.getByRole("button", { name: "▭ Mark the spot" }).click();
        assert((await sheet.getByRole("button", { name: "▭ Mark the spot" }).getAttribute("aria-pressed")) === "true", "Mark the spot didn't turn on");
        // The sheet brings the picture back into view to mark (on a phone the chips below it scroll it away).
        await page.waitForTimeout(200);
        const box = await sheet.locator(".ad-fixsheet-pic").boundingBox();
        const viewport = page.viewportSize();
        assert(box && box.y >= -2 && box.y + box.height * 0.8 <= viewport.height, `the picture to mark isn't in view: top ${Math.round(box?.y ?? 0)}, ${Math.round(box?.height ?? 0)} tall on ${viewport.height}`);
        assert(box && box.width > 100 && box.height > 100, `the picture to mark is ${box?.width ?? 0}×${box?.height ?? 0}px`);
        await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.74, { steps: 8 });
        await page.mouse.up();
        const hit = await page.evaluate(([x, y]) => {
          const el = document.elementFromPoint(x, y);
          return el ? `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}` : "nothing";
        }, [box.x + box.width * 0.4, box.y + box.height * 0.6]);
        assert((await sheet.locator(".ad-fixsheet-spot").count()) === 1, `no spot marked after the drag (the drag's middle is on ${hit}; the picture ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)})`);
        await drawn();
        await shotOf(`fix-spot-${size}`, true);
        const one = await fixed(sheet.getByRole("button", { name: "Fix it · free" }), "Here it is");
        assert(one.picture?.id && one.state?.versions?.length >= 2, `the fix came back without its versions: ${JSON.stringify(one).slice(0, 160)}`);
        assert(one.state.versions.at(-1).spot, "the fix kept no spot");
        assert((await sheet.getByRole("button", { name: "Before and after" }).getAttribute("aria-pressed")) === "true", "it doesn't open on before and after");
        // Before and after at the picture's own shape: the frame no wider than the picture in it.
        await drawn();
        const frame = await sheet.locator(".ad-compare-frame").boundingBox();
        const after = await sheet.locator(".ad-compare-frame img").first().boundingBox();
        assert(frame && after && Math.abs(frame.width - after.width) <= 2 && Math.abs(frame.height - after.height) <= 2, `before and after is cropped: frame ${frame?.width}×${frame?.height}, picture ${after?.width}×${after?.height}`);
        await drawn();
        await sheet.locator(".ad-compare").scrollIntoViewIfNeeded();
        await shotOf(`fix-compare-${size}`, true);
        // Keep the first fix: the original leaves the gallery once it next refreshes.
        await sheet.getByRole("button", { name: "Before and after" }).click();
        const keepFirst = sheet.getByRole("button", { name: "✓ Keep this one" });
        if (!(await keepFirst.count())) {
          const buttons = await sheet.getByRole("button").allInnerTexts();
          throw new Error(`no "✓ Keep this one" after Before and after; the sheet's buttons: ${buttons.map((b) => b.trim()).join(" | ")}`);
        }
        await fixed(keepFirst, "Kept:");
        // A change, made from the fix on screen. The gallery refreshes behind the sheet as it lands, without the
        // original's tile now: the sheet stays (it lives on the page's FixHost, not in the tile).
        await sheet.getByRole("radio", { name: "✏️ Change" }).click();
        await sheet.locator(".ad-fixsheet-words textarea").fill("the lamp light a little warmer");
        const two = await fixed(sheet.getByRole("button", { name: "Make the change · free" }), "Here it is");
        assert(two.state.versions.at(-1).from === one.picture.id, "the change wasn't made from the first fix");
        await page.waitForTimeout(1_500);
        assert((await galleryItem("e2e-shot-2").count()) === 0, "the gallery didn't refresh behind the sheet (the original's tile is still there)");
        assert(await sheet.isVisible(), "the sheet closed when the gallery refreshed behind it");
        // Keep the change instead: the versions strip says which.
        await sheet.getByRole("button", { name: "Before and after" }).click();
        await fixed(sheet.getByRole("button", { name: "✓ Keep this one" }), "Kept:");
        const badges = sheet.locator(".ad-fixsheet-version", { has: page.locator(".badge", { hasText: "Kept" }) });
        assert((await badges.count()) === 1 && (await badges.innerText()).includes("Change"), "the change isn't the version marked Kept");
        // The version on screen is in view in the strip, even where the strip runs past a phone's edge.
        const strip = await sheet.locator(".ad-fixsheet-versions").boundingBox();
        const on = await sheet.locator(".ad-fixsheet-version.is-on").boundingBox();
        assert(strip && on && on.x >= strip.x - 1 && on.x + on.width <= strip.x + strip.width + 1, "the version on screen is out of sight in the strip");
        await page.evaluate(() => document.querySelector(".ad-storyboard-backdrop")?.scrollTo(0, 0));
        await drawn();
        await shotOf(`fix-versions-${size}`, true);
        // Back to the original: picked in the strip, kept again; closing tells the gallery.
        await sheet.locator(".ad-fixsheet-version", { hasText: "Original" }).click();
        await fixed(sheet.getByRole("button", { name: "↩ Back to the original" }), "Back to the original");
        if (size === "phone") await noSideways("the Fix sheet");
        await sheet.getByRole("button", { name: "Close", exact: true }).click();
        await sheet.waitFor({ state: "detached", timeout: 5_000 });
        await page.waitForTimeout(1_000);
        assert((await galleryItem("e2e-shot-2").count()) > 0, "the original left the gallery after going back to it");
        assert((await galleryItem(two.picture.id).count()) === 0, "a fix not kept is still in the gallery");
      }
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
      const card = page.locator("section.character-studio-after-dark");
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
      // The page opens on the theater (#845): Exit leaves it for the gallery below.
      await page.locator(".theater").getByRole("button", { name: "Exit", exact: true }).click();
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

    await step("the scene's gallery: ⋯ then 🩹 Fix opens the sheet on that picture", async () => {
      const gallery = page.locator("section", { has: page.getByRole("heading", { name: "Gallery", exact: true }) }).last();
      const tile = gallery.locator(".ad-gallery-section", { has: page.getByRole("heading", { name: "Pictures", exact: true }) }).locator("li").first();
      await tile.locator("details.ad-tile-more > summary").click();
      const looked = page.waitForResponse((r) => r.url().includes("/api/admin/after-dark/fix?media_id=") && r.request().method() === "GET", { timeout: 15_000 });
      await tile.getByRole("button", { name: "🩹 Fix", exact: true }).click();
      const state = (await (await looked).json()).state;
      assert(state?.versions?.length >= 1, "the sheet's state didn't load");
      const sheet = page.locator(".ad-fixsheet");
      await sheet.locator(".ad-fixsheet-body").waitFor({ timeout: 15_000 });
      for (const mode of ["🩹 Repair", "🙂 Faces", "✏️ Change", "Undressed"]) assert((await sheet.getByRole("radio", { name: mode }).count()) === 1, `no ${mode}`);
      // Faces and Undressed can be for one or both, when it shows the two of them.
      await sheet.getByRole("radio", { name: "🙂 Faces" }).click();
      const shown = state.people.filter((p) => p.shown).length;
      const who = await sheet.getByRole("radiogroup", { name: "Who" }).getByRole("radio").count();
      assert(who === (shown > 1 ? shown + 1 : 0), `${shown} shown, ${who} Who chips`);
      await page.keyboard.press("Escape");
      await sheet.waitFor({ state: "detached", timeout: 5_000 });
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

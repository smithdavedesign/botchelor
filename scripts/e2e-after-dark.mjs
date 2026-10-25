#!/usr/bin/env node
/**
 * npm run e2e:after-dark: After Dark (lib/adult) in a real browser, against the production build with ADULT_MODE=1
 * and a local stub standing in for the adult model (no key, no network beyond localhost):
 *
 *   a stranger and a signed-in non-subscriber get not-found → the /create looks builder shows After Dark locked →
 *   an admin opens After Dark, writes a scene, sees a line that crosses a line dropped, lets autoplay run, rewinds a
 *   step (the suggested next moves showing), starts over → nothing of the scene reaches the show.
 *
 * Exits non-zero if any step fails. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build.
 */
import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const DATA_DIR = join(ROOT, ".data", "e2e-after-dark");
const SAFE = ["Your place or mine?", "Mine. It's closer."];
const CROSSES = "She was fifteen when she first did this.";
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`  ✗ ${name}\n      ${err instanceof Error ? err.message : err}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** The adult model's stand-in: an OpenAI-compatible endpoint that always writes the same three lines. */
function startAdultStub() {
  const reply = JSON.stringify({ lines: [{ who: "a", text: SAFE[0] }, { who: "b", text: SAFE[1] }, { who: "a", text: CROSSES }] });
  const srv = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "stub", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: reply } }] }));
    });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const adult = await startAdultStub();
  const env = appEnv(showrunner.address().port, DATA_DIR);
  const ADMIN_PASSWORD = ["e2e", "admin", Math.random().toString(36).slice(2)].join("-");
  Object.assign(env, {
    FRONTIER_PASSWORD: ADMIN_PASSWORD,
    ADULT_MODE: "1",
    ADULT_LLM_BASE_URL: `http://127.0.0.1:${adult.address().port}/v1`,
    ADULT_LLM_API_KEY: "local-stub",
    ADULT_LLM_MODEL: "stub-adult",
    BOTCHELOR_SEASON_CAST_SIZE: "4",
  });
  const app = await startApp(await freePort(), env);
  const base = app.base;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const adultContext = async () => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: base }]);
    return ctx;
  };
  const register = async (ctx, handle) => {
    const res = await ctx.request.post(`${base}/api/auth/register`, { data: { handle, password: "a-long-e2e-password-1", attest: true } });
    assert(res.ok(), `register ${handle}: HTTP ${res.status()}`);
  };
  let scenePath = "";

  try {
    await step("a stranger gets not-found for After Dark and its scenes", async () => {
      const ctx = await adultContext();
      try {
        const page = await ctx.newPage();
        assert((await page.goto(`${base}/after-dark`)).status() === 404, "/after-dark should be not-found");
        const api = await ctx.request.post(`${base}/api/admin/after-dark`, { data: { a: "x", b: "y" } });
        assert(api.status() >= 400, `the scene API should refuse a stranger (HTTP ${api.status()})`);
      } finally {
        await ctx.close();
      }
    });

    await step("a signed-in viewer with no subscription still gets not-found, and sees After Dark locked on /create", async () => {
      const ctx = await adultContext();
      try {
        await register(ctx, `viewer${Date.now() % 1e6}`);
        const page = await ctx.newPage();
        assert((await page.goto(`${base}/after-dark`)).status() === 404, "/after-dark should be not-found without a subscription");
        await page.goto(`${base}/create`);
        // The looks builder is the wizard's third step: a sample character, then on through Voice to Look.
        await page.getByRole("button", { name: "Use a sample character" }).click();
        await page.getByRole("button", { name: "Next: Voice" }).click();
        await page.getByRole("button", { name: "Next: Look" }).click();
        const tab = page.getByRole("tab", { name: /After Dark/ });
        await tab.waitFor({ timeout: 10_000 });
        assert((await tab.locator(".looks-lock").count()) === 1, "the After Dark looks tab should show its lock");
        await tab.click();
        await page.locator(".looks-stage.locked").waitFor({ timeout: 10_000 });
      } finally {
        await ctx.close();
      }
    });

    await step("an admin opens After Dark, writes a scene, and the line that crosses a line is dropped", async () => {
      const ctx = await adultContext();
      try {
        await register(ctx, `admin${Date.now() % 1e6}`);
        const claim = await ctx.request.post(`${base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } });
        assert(claim.ok(), `claiming admin: HTTP ${claim.status()}`);
        const page = await ctx.newPage();
        assert((await page.goto(`${base}/after-dark`)).ok(), "/after-dark should open for an admin");
        await page.getByRole("heading", { name: "Scenes" }).waitFor({ timeout: 10_000 });
        // The pair picker (app/after-dark/PairPicker.tsx): a face, then who they're with, then Start; Start over clears it.
        const faces = page.locator(".ad-pair-picker .ad-cast-chips button.ad-cast-chip");
        await faces.first().click();
        await page.locator(".ad-pair-picked").getByRole("button", { name: "Start over" }).click();
        assert((await faces.count()) >= 2, "Start over should bring every face back");
        await faces.first().click();
        await page.locator(".ad-pair-picker .ad-cast-chips button.ad-cast-chip").first().click();
        const start = page.locator(".ad-pair-go a");
        scenePath = (await start.getAttribute("href")) ?? "";
        assert(scenePath.startsWith("/after-dark/"), `picking two should show the way in (got ${scenePath || "none"})`);
        await start.click();
        // The page opens on the theater, the only place the scene is watched and written (2026-10-25).
        const bar = page.locator(".ad-theater-bar");
        await bar.getByRole("textbox", { name: "Steer it (optional)" }).fill("they share a cab home");
        await bar.getByRole("button", { name: "Next" }).click();
        await page.locator(".theater .chat-thread").getByText(SAFE[1]).waitFor({ state: "attached", timeout: 30_000 });
        assert((await page.locator(".after-dark-lines, .after-dark-form").count()) === 0, "the page's own lines and form are gone");
        const text = await page.locator(".theater .chat-thread").textContent();
        assert(text.includes(SAFE[0]), "the first line should show");
        assert(!text.includes("fifteen"), "the line about a minor must be dropped");
      } finally {
        await ctx.close();
      }
    });

    await step("in the theater, the admin steers with Direct, and the steer goes as direct (desktop and phone)", async () => {
      const ctx = await adultContext();
      try {
        await register(ctx, `admin3${Date.now() % 1e6}`);
        await ctx.request.post(`${base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } });
        for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
          const page = await ctx.newPage();
          await page.setViewportSize(viewport);
          await page.goto(`${base}${scenePath}?play=1`);
          const bar = page.locator(".ad-theater-bar");
          // 📖 the chapter in the top bar; 📍 Set the scene opens the picker, which filters by category.
          await page.locator(".theater .ad-chapter-chip").getByText("Chapter").waitFor({ timeout: 10_000 });
          await page.locator(".theater .ad-set-scene").click();
          const picker = page.getByRole("dialog", { name: "Set the scene" });
          assert((await picker.locator(".ad-scene-card").count()) > 40, "the scene picker should show every place");
          await picker.getByRole("radio", { name: /Fantasy/ }).click();
          const fantasy = await picker.locator(".ad-scene-card").count();
          assert(fantasy > 0 && fantasy < 15, `the Fantasy category should narrow the cards (${fantasy})`);
          if (process.env.SHOTS_DIR) await page.screenshot({ path: join(process.env.SHOTS_DIR, `after-dark-set-scene-${viewport.width}.png`) });
          await picker.getByRole("button", { name: "Close" }).click();
          await bar.getByRole("radio", { name: "Direct" }).check();
          await bar.getByRole("textbox", { name: "Steer it (optional)" }).fill("they kiss in the doorway");
          // Catch up is with the player's controls, bottom right.
          await page.locator(".theater .ad-player").getByRole("button", { name: "Catch up" }).click();
          const sent = page.waitForRequest((r) => r.url().endsWith("/api/admin/after-dark") && r.method() === "POST");
          await bar.getByRole("button", { name: "Next" }).click();
          const body = JSON.parse((await sent).postData() ?? "{}");
          assert(body.steer_mode === "direct" && body.direction === "they kiss in the doorway", `the theater's steer should go as direct (sent ${JSON.stringify(body)})`);
          if (process.env.SHOTS_DIR) await page.screenshot({ path: join(process.env.SHOTS_DIR, `after-dark-theater-steer-${viewport.width}.png`) });
          await page.close();
        }
      } finally {
        await ctx.close();
      }
    });

    // The stub writes the same lines every time, so the second step brings nothing new and autoplay stops by itself.
    await step("autoplay writes the scene with no button pressed in the theater, and stops by itself", async () => {
      for (const theater of [true]) {
        const ctx = await adultContext();
        try {
          await register(ctx, `auto${theater ? "t" : "p"}${Date.now() % 1e6}`);
          await ctx.request.post(`${base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } });
          const page = await ctx.newPage();
          let posts = 0;
          page.on("request", (r) => {
            if (r.url().endsWith("/api/admin/after-dark") && r.method() === "POST") posts++;
          });
          await page.goto(`${base}${scenePath}`);
          const bar = ".ad-theater-bar";
          await page.locator(bar).getByRole("checkbox", { name: "Autoplay" }).check();
          await page.locator(".theater .chat-thread").getByText(SAFE[1]).first().waitFor({ state: "attached", timeout: 30_000 });
          await page.waitForFunction((sel) => !document.querySelector(sel)?.checked, `${bar} input[type=checkbox]`, { timeout: 30_000 });
          const stopped = posts;
          await page.waitForTimeout(6_000);
          assert(stopped >= 2 && posts === stopped, `autoplay should write, then stop once nothing new comes (${stopped} steps, then ${posts - stopped} more)`);
          if (process.env.SHOTS_DIR) await page.screenshot({ path: join(process.env.SHOTS_DIR, `after-dark-autoplay-${theater ? "theater" : "page"}.png`) });
        } finally {
          await ctx.close();
        }
      }
    });

    await step("nothing of the scene reaches the show: the feed, the cast pages and the home page", async () => {
      for (const path of ["/", "/watch", "/characters", "/api/feed"]) {
        const body = await (await fetch(`${base}${path}`, { headers: { cookie: "bz_adult=1" } })).text();
        assert(!body.includes(SAFE[0]), `${path} leaks a scene line`);
      }
    });

    await step("the admin rewinds the last step: its lines go, and a suggested next move is there to tap", async () => {
      const ctx = await adultContext();
      try {
        await register(ctx, `admin4${Date.now() % 1e6}`);
        await ctx.request.post(`${base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } });
        const page = await ctx.newPage();
        await page.goto(`${base}${scenePath}`);
        await page.locator(".ad-theater-bar").getByRole("button", { name: "Next" }).click();
        await page.locator(".theater .chat-thread").getByText(SAFE[1]).waitFor({ state: "attached", timeout: 30_000 });
        assert((await page.locator(".ad-theater-bar .ad-suggestion").count()) === 3, "three suggested next moves should show in the theater");
        // Rewind is in the theater's ⋯.
        await page.locator(".theater").getByRole("button", { name: "More tools" }).click();
        await page.locator(".theater").getByRole("button", { name: "↺ Rewind" }).click();
        await page.locator(".theater").getByText("Press Next to begin.").waitFor({ timeout: 15_000 });
      } finally {
        await ctx.close();
      }
    });

    await step("the admin starts the scene over and it's empty again", async () => {
      const ctx = await adultContext();
      try {
        await register(ctx, `admin2${Date.now() % 1e6}`);
        await ctx.request.post(`${base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } });
        const page = await ctx.newPage();
        await page.goto(`${base}${scenePath}`);
        const bar = page.locator(".ad-theater-bar");
        await bar.getByRole("textbox", { name: "Steer it (optional)" }).fill("they go back to hers");
        await bar.getByRole("button", { name: "Next" }).click();
        await page.locator(".theater .chat-thread").getByText(SAFE[1]).waitFor({ state: "attached", timeout: 30_000 });
        await page.locator(".theater").getByRole("button", { name: "More tools" }).click();
        await page.locator(".theater").getByRole("button", { name: "Start over" }).click();
        await page.locator(".theater").getByText("Press Next to begin.").waitFor({ timeout: 15_000 });
        // The night that ran is a saved chapter now: 📖 plays it again over the theater.
        await page.locator(".theater .ad-chapter-chip").click();
        await page.locator(".ad-chapter-menu button.ad-chapter-item").first().click();
        assert((await page.locator(".theater").count()) === 2, "a saved chapter should play over the theater");
      } finally {
        await ctx.close();
      }
    });
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
    adult.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} After Dark E2E steps passed${failed ? `, ${failed} FAILED` : ""}.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`e2e:after-dark failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

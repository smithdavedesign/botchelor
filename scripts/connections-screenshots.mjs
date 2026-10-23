#!/usr/bin/env node
/**
 * npm run screenshots:connections: real-browser screenshots of Connections (/account/keys, docs/PRDs/connections.md),
 * desktop and phone, into docs/screenshots/. It builds the app and runs it on a throwaway local database, with every
 * model provider stubbed on loopback (BYOK_STUB_ORIGIN, which the app honours only on 127.0.0.1 and never on Vercel): the
 * keys are fake, built from parts, and nothing leaves this machine.
 *
 *   connections-empty: a new account's three job cards (the free model, portraits and clips not set up);
 *   connections-flow: connecting OpenRouter for Dates & texts: provider, key, Test (passed);
 *   connections-models, connections-feel (M2): its models, tagged and priced, and the feel (Wild, Advanced open);
 *   connections-connected: OpenRouter running dates, OpenAI making portraits, and the key list;
 *   connections-cap (M3): the monthly cap step;
 *   connections-error: OpenRouter out of credit after a Check, in plain words with "Top up", the free model standing in;
 *   connections-caps (M3): dates at 81% of the cap (the meter amber), portraits over theirs;
 *   connections-after-dark: an admin's read-only After Dark card; admin-providers: the providers view, Hive paused.
 *
 * On the phone it also checks no page scrolls sideways. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright-core";
import { appEnv, build, freePort, ROOT, startApp, startProviderStub, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "connections-screenshots");
/** Fake keys, built from parts: obviously not real, and never sent anywhere but the local stub. Each ends its own way. */
const fake = (tag, last4) => ["shots", "key", "not", "real", tag, last4].join("-");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** No sideways scroll on the phone. */
async function checkPhone(page, name) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  assert(scroll <= width, `${name}: the page scrolls sideways (${scroll}px wide on a ${width}px screen)`);
  console.log(`  ✓ ${name}: no sideways scroll`);
}

async function shot(page, file, opts = {}) {
  await page.mouse.move(0, 0);
  // A full-page capture stitches the page together, so the sticky header would land in the middle of it: let it scroll.
  const unstick = opts.full ? await page.addStyleTag({ content: ".site-header { position: static !important; }" }) : null;
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT_DIR, file), fullPage: Boolean(opts.full) });
  await unstick?.evaluate((el) => el.remove());
  console.log(`  📸 docs/screenshots/${file}`);
}

/** Scrolls so `locator`'s top sits just under the sticky header. */
const frameTop = (page, locator) =>
  locator.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (document.querySelector(".site-header")?.getBoundingClientRect().height ?? 0) - 12));

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const state = { dry: false };
  const stub = await startProviderStub(state);
  const env = appEnv(showrunner.address().port, DATA_DIR);
  const ADMIN_PASSWORD = ["shots", "admin", Math.random().toString(36).slice(2)].join("-");
  Object.assign(env, { BYOK_STUB_ORIGIN: `http://127.0.0.1:${stub.address().port}`, FRONTIER_PASSWORD: ADMIN_PASSWORD });
  let app = await startApp(await freePort(), env);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    // A player, signed in.
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const handle = `keys${Date.now() % 1e6}`;
    const reg = await ctx.request.post(`${app.base}/api/auth/register`, { data: { handle, password: ["a", "long", "shots", "phrase"].join("-"), attest: true } });
    assert(reg.ok(), `register: HTTP ${reg.status()}`);
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 860 });

    // 1. A new account: three job cards.
    await page.goto(`${app.base}/account/keys`);
    await page.getByRole("heading", { name: "Connections", level: 1 }).waitFor();
    await shot(page, "connections-empty-desktop.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await checkPhone(page, "Connections, no keys");
    await shot(page, "connections-empty-phone.png");

    // 2. The connect flow: OpenRouter for Dates & texts, its key tested live (the stub), then the model.
    await page.setViewportSize({ width: 1280, height: 860 });
    const dates = page.locator("#dates");
    await dates.getByRole("button", { name: "Connect", exact: true }).click();
    await dates.locator(".connect-provider", { hasText: "OpenRouter" }).click();
    await dates.locator('input[type="password"]').fill(fake("openrouter", "9f2c"));
    await dates.getByRole("button", { name: "Test" }).click();
    await dates.getByText("OpenRouter accepted it").waitFor({ timeout: 15_000 });
    await frameTop(page, dates.locator(".connect-flow"));
    await shot(page, "connections-flow-desktop.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await checkPhone(page, "the connect flow");
    await frameTop(page, dates.locator(".connect-step").nth(1));
    await shot(page, "connections-flow-phone.png");

    // M2: the model step lists the key's models (OpenRouter's live list), tagged and priced; then the feel.
    await page.setViewportSize({ width: 1280, height: 860 });
    const row = (id) => dates.locator(".model-row").filter({ has: page.locator(".model-id", { hasText: new RegExp(`^${id.replace(/[./]/g, "\\$&")}$`) }) });
    await row("deepseek/deepseek-chat-v3.1").waitFor();
    await row("deepseek/deepseek-chat-v3.1").click();
    // The list scrolls inside itself to the picked row; start it from the top, where Recommended is.
    const listTop = () => dates.locator(".model-list").evaluate((el) => (el.scrollTop = 0));
    await listTop();
    await frameTop(page, dates.locator(".model-picker"));
    await shot(page, "connections-models-desktop.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await checkPhone(page, "the model step");
    await listTop();
    await frameTop(page, dates.locator(".model-picker"));
    await shot(page, "connections-models-phone.png");
    await page.setViewportSize({ width: 1280, height: 860 });
    await dates.locator(".feel-preset", { hasText: "Wild" }).click();
    await dates.locator(".feel-advanced > summary").click();
    await dates.getByLabel("Temperature").fill("1.1");
    await frameTop(page, dates.locator(".feel-picker"));
    await shot(page, "connections-feel-desktop.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await checkPhone(page, "the feel step");
    await frameTop(page, dates.locator(".feel-picker"));
    await shot(page, "connections-feel-phone.png");
    // M3: a monthly cap, and the free model standing in at it.
    await page.setViewportSize({ width: 1280, height: 860 });
    await dates.locator(".connect-cap input").fill("10");
    await frameTop(page, dates.locator(".connect-cap"));
    await shot(page, "connections-cap-desktop.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await checkPhone(page, "the cap step");
    await frameTop(page, dates.locator(".connect-cap"));
    await shot(page, "connections-cap-phone.png");
    await page.setViewportSize({ width: 1280, height: 860 });
    await dates.getByRole("button", { name: "Save" }).click();
    await page.getByText("Your OpenRouter key ✓ · deepseek/deepseek-chat-v3.1 · Custom (1.1)").waitFor({ timeout: 15_000 });

    // 3. OpenAI for portraits too (the same flow, through the API), then the cards and the key list.
    const put = await ctx.request.put(`${app.base}/api/me/connections`, { data: { job: "image", provider: "openai", key: fake("openai", "4b1e"), cap_usd: 1 } });
    assert(put.ok(), `connect OpenAI: HTTP ${put.status()}`);
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.reload();
    await page.getByText("Your OpenAI key ✓ · gpt-image-2").waitFor();
    const html = await page.content();
    assert(!html.includes(fake("openrouter", "9f2c")) && !html.includes(fake("openai", "4b1e")), "a key must never be shown back");
    await shot(page, "connections-connected-desktop.png", { full: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await checkPhone(page, "Connections, connected");
    await shot(page, "connections-connected-phone.png", { full: true });

    // 4. OpenRouter runs dry: Check says so in plain words, with the fix.
    state.dry = true;
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.locator("#dates").getByRole("button", { name: "Check" }).click();
    await page.locator("#dates").getByText("OpenRouter: out of credit.").waitFor({ timeout: 15_000 });
    await page.locator("#dates").getByText(/failed just now/).waitFor({ timeout: 15_000 }); // the card, refreshed from the server
    await page.locator("#dates .connection-pill", { hasText: "On the free model" }).waitFor();
    await frameTop(page, page.locator("#dates"));
    await shot(page, "connections-error-desktop.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.locator("#dates").getByText("OpenRouter: out of credit.").waitFor();
    await frameTop(page, page.locator("#dates"));
    await checkPhone(page, "a key that needs attention");
    await shot(page, "connections-error-phone.png");
    state.dry = false;

    // 5. The admin: After Dark's house keys saved (fake), then Hive's daily-limit pause and Venice out of credit, as the
    // cooldowns table holds them, and (M3) a month's spend: $8.10 of the $10 on dates, portraits over their $1 (written while
    // the app is stopped: the local database has one writer).
    assert((await ctx.request.post(`${app.base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } })).ok(), "claiming admin");
    const settings = await ctx.request.post(`${app.base}/api/admin/after-dark/settings`, {
      data: { openrouter_key: fake("house", "or11"), venice_key: fake("house", "ve22"), hive_key: fake("house", "hv33"), fal_key: fake("house", "fa44"), media_provider: "venice", image_provider: "venice" },
    });
    assert(settings.ok(), `After Dark settings: HTTP ${settings.status()}`);
    await stopApp(app);
    const db = new PGlite(DATA_DIR);
    await db.query(
      `insert into adult_media_cooldowns (provider, until, status, reason) values
         ('hive', now() + interval '2 hours', 429, 'the check: 429'), ('venice', now() + interval '25 minutes', 402, 'out of credit')
       on conflict (provider) do update set until = excluded.until, status = excluded.status, reason = excluded.reason`,
    );
    const userId = (await db.query(`select user_id from accounts where handle = $1`, [handle])).rows[0]?.user_id;
    assert(userId, "the screenshot account");
    const month = new Date().toISOString().slice(0, 7);
    await db.query(
      `insert into user_connection_usage (user_id, job, month, cost_usd, calls, estimated_calls) values ($1, 'text', $2, 8.1, 412, 0), ($1, 'image', $2, 1.02, 6, 6)`,
      [userId, month],
    );
    await db.close();
    app = await startApp(await freePort(), env);
    // Cookies are the host's, not the port's: the same signed-in browser, on the restarted app.
    const admin = await ctx.newPage();
    await admin.setViewportSize({ width: 1280, height: 860 });
    await admin.goto(`${app.base}/account/keys`);
    // M3: OpenRouter checks out again (topped up), so the dates card shows its spend: 81% of the cap; portraits are capped.
    await admin.locator("#dates").getByRole("button", { name: "Check" }).click();
    await admin.locator("#dates").getByText("80% of cap").waitFor({ timeout: 15_000 });
    await admin.locator("#portraits .connection-pill", { hasText: "Cap reached" }).waitFor();
    await frameTop(admin, admin.locator("#dates"));
    await shot(admin, "connections-caps-desktop.png");
    await admin.setViewportSize({ width: 390, height: 844 });
    await checkPhone(admin, "caps and meters");
    await frameTop(admin, admin.locator("#dates"));
    await shot(admin, "connections-caps-phone.png");
    await admin.setViewportSize({ width: 1280, height: 860 });
    await admin.locator("#after-dark").waitFor();
    await frameTop(admin, admin.locator("#after-dark"));
    await shot(admin, "connections-after-dark-desktop.png");
    await admin.goto(`${app.base}/admin/after-dark/providers`);
    await admin.getByText("Daily limit reached").waitFor();
    await shot(admin, "admin-providers-desktop.png", { full: true });
    await admin.setViewportSize({ width: 390, height: 844 });
    await checkPhone(admin, "the providers view");
    await shot(admin, "admin-providers-phone.png", { full: true });
    await ctx.close();
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
    stub.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`screenshots:connections failed: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});

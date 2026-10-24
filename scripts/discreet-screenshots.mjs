#!/usr/bin/env node
/**
 * node scripts/discreet-screenshots.mjs: the installable app and After Dark's discreet mode in a real browser, against
 * the production build (Chromium via CHROMIUM_PATH, no download), with local data only. It checks as it goes and exits
 * non-zero if a step fails; with SHOTS_DIR set it saves the screenshots there (docs/screenshots for the PR):
 *
 *   the manifest and the iPhone tags are served, Chrome finds the app installable, and the service worker registers;
 *   the "Install the app" hint shows once on a phone, never on a desktop or on After Dark;
 *   a device without the PIN gets the PIN prompt (neutral tab title), and the scene API and the media route refuse it;
 *   the PIN opens it; pictures are blurred until tapped, and blurred again after leaving the page.
 *
 * The gallery's pictures are PG placeholders drawn here (a gradient and the words "PG placeholder"), written straight
 * into the local database: never a real After Dark picture. SKIP_BUILD=1 reuses the last build.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright-core";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const DATA_DIR = join(ROOT, ".data", "discreet-shots");
const SHOTS = process.env.SHOTS_DIR || null;
const PIN = "2468";
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
const shot = async (page, name, opts = {}) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, name), ...opts });
};

const IPHONE = {
  viewport: { width: 390, height: 844 },
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
};
const DESKTOP = {
  viewport: { width: 1280, height: 860 },
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
};

/** A PG placeholder "picture" for the gallery: a soft gradient card saying what it is, drawn in the browser. */
async function placeholderPng(browser, label, hue) {
  const page = await browser.newPage({ viewport: { width: 480, height: 600 } });
  await page.setContent(
    `<body style="margin:0"><div style="width:480px;height:600px;display:grid;place-items:center;font:600 34px system-ui;color:#fff;` +
      `background:linear-gradient(160deg,hsl(${hue} 70% 60%),hsl(${(hue + 60) % 360} 60% 35%))"><div style="text-align:center">` +
      `<div style="font-size:90px">♡</div>PG placeholder<div style="font:400 22px system-ui;opacity:.85">${label} · local test data</div></div></div></body>`,
  );
  const png = await page.screenshot();
  await page.close();
  return png;
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const env = appEnv(showrunner.address().port, DATA_DIR);
  const ADMIN_PASSWORD = ["shots", "admin", Math.random().toString(36).slice(2)].join("-");
  Object.assign(env, { FRONTIER_PASSWORD: ADMIN_PASSWORD, ADULT_MODE: "1", BOTCHELOR_SEASON_CAST_SIZE: "4" });
  const port = await freePort();
  let app = await startApp(port, env);
  const base = app.base;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const context = async (device = DESKTOP) => {
    const ctx = await browser.newContext(device);
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: base }]);
    return ctx;
  };

  try {
    await step("the manifest, the icons and the iPhone tags are served", async () => {
      const res = await fetch(`${base}/manifest.webmanifest`);
      assert(res.status === 200, `manifest: HTTP ${res.status}`);
      assert(/application\/manifest\+json/.test(res.headers.get("content-type") ?? ""), `manifest content-type ${res.headers.get("content-type")}`);
      const m = await res.json();
      assert(m.name === "Botchelor" && m.display === "standalone" && m.start_url === "/", `manifest: ${JSON.stringify(m).slice(0, 200)}`);
      for (const icon of [...m.icons.map((i) => i.src), "/icons/apple-touch-icon.png", "/icons/badge-96.png"]) {
        const r = await fetch(`${base}${icon}`);
        assert(r.status === 200 && /image\/png/.test(r.headers.get("content-type") ?? ""), `${icon}: HTTP ${r.status}`);
      }
      const html = await (await fetch(`${base}/`, { headers: { cookie: "bz_adult=1" } })).text();
      // Each tag by its attributes, in any order.
      const tags = [...html.matchAll(/<(?:link|meta)\b[^>]*>/g)].map((m) => m[0]);
      const has = (attrs) => tags.some((tag) => Object.entries(attrs).every(([k, v]) => tag.includes(`${k}="${v}"`)));
      for (const attrs of [
        { rel: "manifest", href: "/manifest.webmanifest" },
        { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png", sizes: "180x180" },
        { name: "mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-title", content: "Botchelor" },
        { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#fdf6f4" },
        { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#130a16" },
      ]) {
        assert(has(attrs), `the home page has no <link|meta ${JSON.stringify(attrs)}>`);
      }
    });

    await step("Chrome finds it installable, and the service worker registers for the whole site", async () => {
      // A real profile: Chrome reports every throwaway (incognito-like) context as not installable.
      const profile = join(DATA_DIR, "chrome-profile");
      const ctx = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROMIUM_PATH, ...DESKTOP });
      try {
        await ctx.addCookies([{ name: "bz_adult", value: "1", url: base }]);
        const page = await ctx.newPage();
        await page.goto(`${base}/notifications`);
        const cdp = await ctx.newCDPSession(page);
        const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
        assert(!installabilityErrors.length, `installability: ${JSON.stringify(installabilityErrors)}`);
        const { errors } = await cdp.send("Page.getAppManifest");
        assert(!errors.length, `manifest errors: ${JSON.stringify(errors)}`);
        // What PushToggle does when notifications are turned on (app/notifications/PushToggle.tsx).
        const scope = await page.evaluate(async () => {
          const reg = await navigator.serviceWorker.register("/sw.js");
          await navigator.serviceWorker.ready;
          return reg.scope;
        });
        assert(scope === `${base}/`, `service worker scope ${scope}`);
      } finally {
        await ctx.close();
      }
    });

    await step("on a phone the install hint shows once, explains itself, and stays away once closed", async () => {
      const ctx = await context(IPHONE);
      try {
        const page = await ctx.newPage();
        await page.goto(`${base}/`);
        const hint = page.locator(".install-hint");
        await hint.waitFor({ timeout: 10_000 });
        await page.waitForTimeout(400);
        await shot(page, "pwa-install-hint-phone.png");
        await hint.getByRole("button", { name: "How" }).click();
        await hint.getByText("Add to Home Screen").waitFor();
        await shot(page, "pwa-install-hint-how-phone.png");
        await hint.getByRole("button", { name: "Not now" }).click();
        assert((await page.evaluate(() => localStorage.getItem("bz_install_hint"))) === "dismissed", "the choice should be saved");
        await page.goto(`${base}/watch`);
        await page.waitForTimeout(3500);
        assert((await hint.count()) === 0, "the hint came back after it was closed");
      } finally {
        await ctx.close();
      }
      const desktop = await context();
      try {
        const page = await desktop.newPage();
        await page.goto(`${base}/`);
        await page.waitForTimeout(3500);
        assert((await page.locator(".install-hint").count()) === 0, "the hint showed on a desktop");
      } finally {
        await desktop.close();
      }
    });

    // An admin (After Dark is open to them) with a PIN, and a pair with two PG placeholder pictures.
    const admin = await context();
    const reg = await admin.request.post(`${base}/api/auth/register`, { data: { handle: `shots${Date.now() % 1e6}`, password: ["shots", "account", "pass"].join("-"), attest: true } });
    assert(reg.ok(), `register: HTTP ${reg.status()}`);
    assert((await admin.request.post(`${base}/api/admin/claim`, { headers: { "x-frontier-key": ADMIN_PASSWORD } })).ok(), "claiming admin");
    const session = (await admin.cookies(base)).find((c) => c.name === "bz_sess");
    assert(session, "a signed session");
    const adminId = JSON.parse(Buffer.from(session.value.split(".")[1], "base64url").toString()).u;
    let scenePath = "";
    await step("an admin's After Dark lists a pair, before any PIN", async () => {
      const page = await admin.newPage();
      await page.goto(`${base}/after-dark`);
      scenePath = (await page.locator("[data-first-scene]").getAttribute("data-first-scene")) ?? "";
      assert(scenePath.startsWith("/after-dark/"), `a scene link (got ${scenePath || "none"})`);
      assert((await page.title()) === "Botchelor", `the neutral title is on by default (got "${await page.title()}")`);
      await page.close();
    });
    const set = await admin.request.post(`${base}/api/admin/after-dark/privacy`, { data: { set_pin: PIN } });
    assert(set.ok(), `setting the PIN: HTTP ${set.status()}`);

    // The pictures go straight into the local database, with the app stopped (PGlite has one writer).
    await stopApp(app);
    const [a, b] = scenePath.split("/").slice(2);
    const pg = new PGlite(DATA_DIR);
    for (const [i, hue] of [[1, 330], [2, 270], [3, 20]]) {
      await pg.query(
        `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status) values ($1, $2, $3, $4, 'scene', $5, 'image/png', $6, 'ready')`,
        [`shots-${i}`, adminId, a, b, `PG placeholder ${i}`, await placeholderPng(browser, `picture ${i}`, hue)],
      );
    }
    await pg.close();
    app = await startApp(port, env);

    await step("a device without the PIN gets the PIN prompt, a neutral title, and nothing from the APIs or media", async () => {
      for (const [device, name] of [[DESKTOP, "desktop"], [IPHONE, "phone"]]) {
        const ctx = await context(device);
        try {
          await ctx.addCookies([{ name: "bz_sess", value: session.value, url: base }]);
          const page = await ctx.newPage();
          await page.goto(`${base}${scenePath}`);
          await page.getByRole("heading", { name: "Enter your PIN" }).waitFor({ timeout: 10_000 });
          assert((await page.title()) === "Botchelor", `title "${await page.title()}"`);
          const text = await page.locator("main").innerText();
          assert(!/after dark|gallery|scene/i.test(text), "the prompt says what's behind it");
          await shot(page, `after-dark-pin-${name}.png`);
          const api = await ctx.request.get(`${base}/api/admin/after-dark?a=${a}&b=${b}`);
          assert(api.status() === 404, `the scene API answered a locked device: HTTP ${api.status()}`);
          const media = await ctx.request.get(`${base}/api/admin/after-dark/media/shots-1`);
          assert(media.status() === 404, `the media route answered a locked device: HTTP ${media.status()}`);
        } finally {
          await ctx.close();
        }
      }
    });

    await step("the PIN opens it; pictures are blurred until tapped, and blurred again after leaving the page", async () => {
      for (const [device, name] of [[DESKTOP, "desktop"], [IPHONE, "phone"]]) {
        const ctx = await context(device);
        try {
          await ctx.addCookies([{ name: "bz_sess", value: session.value, url: base }]);
          const page = await ctx.newPage();
          await page.goto(`${base}${scenePath}`);
          const pin = page.locator('input[name="pin"]');
          await pin.fill("1357");
          await page.getByRole("button", { name: "Unlock" }).click();
          await page.getByText(/That's not the PIN\. 4 tries left\./).waitFor({ timeout: 10_000 });
          await pin.fill(PIN);
          await page.getByRole("button", { name: "Unlock" }).click();
          const gallery = page.locator(".after-dark-gallery");
          await gallery.waitFor({ timeout: 15_000 });
          const pictures = gallery.locator("img");
          await pictures.first().waitFor();
          const blurred = async (i) => (await pictures.nth(i).evaluate((el) => getComputedStyle(el).filter)).includes("blur");
          assert(await blurred(0), "the gallery's first picture isn't blurred");
          // Right after the unlock the refreshed page's metadata is still streaming in: the tab settles on the neutral title.
          await page.waitForFunction(() => document.title === "Botchelor", null, { timeout: 15_000 }).catch(() => {});
          assert((await page.title()) === "Botchelor", `title "${await page.title()}"`);
          // The Gallery heading just under the sticky header, so the shot shows what these are.
          await page.getByRole("heading", { name: "Gallery" }).evaluate((h) => window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 150));
          await page.waitForTimeout(300);
          await shot(page, `after-dark-blur-${name}.png`);
          await pictures.nth(0).click();
          await page.waitForTimeout(300);
          assert(!(await blurred(0)), "a tap didn't show the picture");
          assert(await blurred(1), "a tap showed a picture it wasn't on");
          await shot(page, `after-dark-tapped-${name}.png`);
          // Leaving the page and coming back: blurred again.
          await page.locator(".after-dark .kicker a").first().click();
          await page.waitForURL(`${base}/after-dark`);
          await page.goBack();
          await gallery.locator("img").first().waitFor();
          assert(await blurred(0), "the picture stayed shown after leaving the page");
          if (name === "desktop") {
            await page.goto(`${base}/after-dark`);
            const privacy = page.locator("details.ad-privacy");
            await privacy.locator("summary").click();
            await privacy.scrollIntoViewIfNeeded();
            await page.waitForTimeout(200);
            await shot(page, "after-dark-privacy-desktop.png");
          }
        } finally {
          await ctx.close();
        }
      }
    });

    await step("the install hint never shows on After Dark, even on a phone", async () => {
      const ctx = await context(IPHONE);
      try {
        await ctx.addCookies([{ name: "bz_sess", value: session.value, url: base }]);
        const page = await ctx.newPage();
        await page.goto(`${base}/after-dark`);
        await page.waitForTimeout(3500);
        assert((await page.locator(".install-hint").count()) === 0, "the install hint showed on an After Dark page");
      } finally {
        await ctx.close();
      }
    });
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} steps passed${failed ? `, ${failed} FAILED` : ""}.${SHOTS ? ` Screenshots in ${SHOTS}.` : ""}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`discreet-screenshots failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

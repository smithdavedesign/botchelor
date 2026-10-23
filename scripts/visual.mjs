#!/usr/bin/env node
/**
 * npm run e2e:visual: a visual-regression audit of every page. Builds the production app, seeds the full demo
 * season (scripts/harness.mjs), then opens every route in a real browser (Chromium via CHROMIUM_PATH, no
 * download) at desktop and phone size, in light and dark, as a spectator, as a character's owner and signed
 * in. Each page is screenshotted and checked in the page itself against the form and atom rules in
 * docs/brand.md ("Forms"):
 *
 *   control-unstyled     a text field or select with browser-default chrome (inset border, square corners, no padding)
 *   control-short        a single-line field under 40px tall, or a textarea under 64px
 *   control-light-dark   a light field on the dark theme (an input the theme never reached)
 *   control-ios-zoom     a field under 16px text on a phone, which makes iOS zoom the page on focus
 *   control-inconsistent fields on one page that disagree on height, corner radius or border width
 *   label-inline         a stacked field whose label and input share a line (the input squeezed beside its label)
 *   tap-target           a button, field or toggle under 24×24px (WCAG 2.2, 2.5.8)
 *   check-unstyled       a checkbox or radio left at the browser's default colour or under 16px
 *   h-overflow           the page scrolls sideways
 *   offscreen            a control hanging past the edge of the viewport
 *   clipped-text         text cut off by its box with no ellipsis
 *   broken-image         an image that failed to load
 *   console-error        a page error or console error
 *
 * Writes .data/visual/report.json, report.md and index.html (a contact sheet of every screenshot with its
 * findings). Exits non-zero on any error-level finding, so a regression fails CI.
 *
 *   SKIP_BUILD=1 npm run e2e:visual   reuse the last build
 *   ONLY=account,create               audit only routes whose name contains one of these words
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { appEnv, build, freePort, ROOT, seedDataset, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT = join(ROOT, ".data", "visual");
const DATA_DIR = join(ROOT, ".data", "visual-db");

// A normal Chrome UA on each device: Headless Chrome's own UA counts as a bot and skips the 18+ gate.
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const PHONE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const DEVICES = {
  desktop: { viewport: { width: 1280, height: 800 }, userAgent: DESKTOP_UA },
  phone: { viewport: { width: 390, height: 844 }, userAgent: PHONE_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const SCHEMES = ["light", "dark"];

/** Runs inside the page: returns every finding as { rule, level, el, detail }. */
function auditPage({ phone, dark, width }) {
  const findings = [];
  // The device width, not innerWidth: on a phone, content that overflows widens the layout viewport itself.
  const vw = width;
  const add = (rule, level, el, detail) => findings.push({ rule, level, el: el ? describe(el) : "", detail });
  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = [...el.classList].slice(0, 3).join(".");
    if (cls) s += `.${cls}`;
    const name = el.getAttribute("name") || el.getAttribute("aria-label") || el.getAttribute("type");
    if (name) s += `[${name}]`;
    const text = (el.innerText || el.value || el.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 32);
    return text ? `${s} "${text}"` : s;
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.01;
  };
  const px = (v) => parseFloat(v) || 0;
  const luminance = (rgb) => {
    const m = rgb.match(/[\d.]+/g);
    if (!m) return 0;
    const [r, g, b] = m.slice(0, 3).map((c) => {
      const v = Number(c) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const NON_TEXT = ["checkbox", "radio", "range", "file", "color", "hidden", "submit", "button", "reset", "image"];
  const textInputs = [...document.querySelectorAll("input")].filter((i) => !NON_TEXT.includes(i.type) && visible(i));
  const selects = [...document.querySelectorAll("select")].filter(visible);
  const areas = [...document.querySelectorAll("textarea")].filter(visible);
  const fields = [...textInputs, ...selects, ...areas];

  const signatures = new Map();
  for (const el of fields) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const isArea = el.tagName === "TEXTAREA";
    if (["inset", "outset", "groove", "ridge"].includes(cs.borderTopStyle) || px(cs.borderTopLeftRadius) < 4 || px(cs.paddingLeft) < 8) {
      add("control-unstyled", "error", el, `border ${cs.borderTopStyle} ${cs.borderTopWidth}, radius ${cs.borderTopLeftRadius}, padding-left ${cs.paddingLeft}`);
    }
    if (isArea ? r.height < 64 : r.height < 40) add("control-short", "error", el, `${Math.round(r.height)}px tall`);
    if (dark && luminance(cs.backgroundColor) > 0.6) add("control-light-dark", "error", el, `background ${cs.backgroundColor} on the dark theme`);
    if (phone && px(cs.fontSize) < 16) add("control-ios-zoom", "error", el, `font-size ${cs.fontSize}`);
    if (!isArea) {
      const sig = `${Math.round(r.height / 2) * 2}px tall / radius ${cs.borderTopLeftRadius} / border ${cs.borderTopWidth}`;
      signatures.set(sig, [...(signatures.get(sig) || []), el]);
    }
    // A stacked field (a block label wrapping its control) whose control sits beside the label text.
    const label = el.closest("label");
    if (label && !label.classList.contains("check") && getComputedStyle(label).display === "block") {
      const lr = label.getBoundingClientRect();
      if (r.left - lr.left > 12 && r.width < lr.width * 0.75) {
        add("label-inline", el.tagName === "SELECT" ? "warn" : "error", el, `control starts ${Math.round(r.left - lr.left)}px into its label, ${Math.round(r.width)}px of ${Math.round(lr.width)}px wide`);
      }
    }
  }
  if (signatures.size > 2) {
    const sizes = [...signatures.entries()].map(([sig, els]) => `${sig} (${els.length}×)`).join("; ");
    add("control-inconsistent", "warn", null, sizes);
  }

  for (const el of document.querySelectorAll('button, a.button, [role="button"], input, select, summary, [role="tab"]')) {
    if (el.type === "hidden" || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (el.type === "checkbox" || el.type === "radio") {
      // A visually hidden input inside a styled chip is fine: the chip is the target.
      if (r.width <= 2 && r.height <= 2) continue;
      if (r.width < 16 || r.height < 16) add("check-unstyled", "warn", el, `${Math.round(r.width)}×${Math.round(r.height)}px`);
      else if (cs.accentColor === "auto") add("check-unstyled", "warn", el, "browser-default accent colour");
      continue;
    }
    if (r.width < 24 || r.height < 24) add("tap-target", "error", el, `${Math.round(r.width)}×${Math.round(r.height)}px`);
    // Hanging past the viewport, unless inside a container that scrolls sideways on purpose.
    if (r.right > vw + 1 || r.left < -1) {
      let scroller = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(p).overflowX) && p !== document.body && p !== document.documentElement) {
          scroller = true;
          break;
        }
      }
      if (!scroller) add("offscreen", "error", el, `spans ${Math.round(r.left)}–${Math.round(r.right)}px of a ${vw}px viewport`);
    }
  }

  const sw = document.documentElement.scrollWidth;
  if (sw > vw + 1) {
    const culprits = [...document.body.querySelectorAll("*")]
      .filter((e) => visible(e) && e.getBoundingClientRect().right > vw + 1)
      .filter((e) => ![...e.children].some((c) => c.getBoundingClientRect().right > vw + 1))
      .slice(0, 3)
      .map(describe);
    add("h-overflow", "error", null, `page is ${sw}px wide in a ${vw}px viewport; widest: ${culprits.join(", ")}`);
  }

  for (const el of document.body.querySelectorAll("*")) {
    if (!visible(el) || el.childElementCount > 2) continue;
    // Visually hidden text (.sr-only and the like: a 1px box that clips on purpose) is for screen readers, not clipped.
    if (el.clientWidth <= 1 || el.clientHeight <= 1) continue;
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!ownText) continue;
    const cs = getComputedStyle(el);
    if (!["hidden", "clip"].includes(cs.overflowX) || cs.textOverflow === "ellipsis") continue;
    if (el.scrollWidth > el.clientWidth + 2) add("clipped-text", "warn", el, `${el.scrollWidth}px of text in a ${el.clientWidth}px box`);
  }

  for (const img of document.images) {
    if (img.complete && img.naturalWidth === 0 && visible(img)) add("broken-image", "error", img, img.currentSrc || img.src);
  }
  return findings;
}

async function settle(page) {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  // Every <img> decoded, so screenshots never catch a half-loaded avatar.
  // Capped: a lazy image below the fold never loads, so its decode() never settles.
  await page
    .evaluate(() => Promise.race([Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => {})))), new Promise((r) => setTimeout(r, 3000))]))
    .catch(() => {});
  // Open folded groups so their fields are audited too.
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true))).catch(() => {});
  await page.waitForTimeout(150);
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  const only = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
  rmSync(OUT, { recursive: true, force: true });
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });

  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  // After Dark (lib/adult) is audited too, as an admin, against a stub for the adult model (the same stand-in
  // scripts/e2e-after-dark.mjs uses: two lines every step, no key, no network beyond localhost).
  const adult = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const content = JSON.stringify({ lines: [{ who: "a", text: "Your place or mine?" }, { who: "b", text: "Mine. It's closer, and the kettle's on." }] });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "stub", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }] }));
    });
  });
  await new Promise((r) => adult.listen(0, "127.0.0.1", r));
  // The admin pages are audited signed in too: a throwaway password for a throwaway server (built from parts, never a
  // literal secret).
  const ADMIN_PASSWORD = ["visual", "admin", "pw"].join("-");
  const app = await startApp(await freePort(), {
    ...appEnv(showrunner.address().port, DATA_DIR),
    FRONTIER_PASSWORD: ADMIN_PASSWORD,
    ADULT_MODE: "1",
    ADULT_LLM_BASE_URL: `http://127.0.0.1:${adult.address().port}/v1`,
    ADULT_LLM_API_KEY: "local-stub",
    ADULT_LLM_MODEL: "stub-adult",
  });
  const base = app.base;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const report = [];
  let errors = 0;

  try {
    console.log("Seeding the demo season…");
    const data = await seedDataset(base);
    // A few MCP connections, so /admin/analytics has a crawler, an explorer and a player to show.
    const mcp = async (method, params, sid, ua) => {
      const res = await fetch(`${base}/api/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": ua, ...(sid ? { "mcp-session-id": sid } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      return res.headers.get("mcp-session-id") ?? sid;
    };
    for (const [name, calls] of [
      ["directory-crawler", []],
      ["curious-explorer", [["list_cast", {}], ["browse_episodes", {}]]],
      ["playing-agent", [["create_character", { name: "Odile Ferrant", age: 38, bio: "Restores carousel horses by the canal.", traits: ["meticulous", "deadpan", "warm"], want: "Someone who notices the details", dealbreaker: "Calling craft a hobby", voice: "Dry and low.", attest: true }]]],
    ]) {
      const sid = await mcp("initialize", { protocolVersion: "2025-06-18", clientInfo: { name } }, null, `${name}/1.0`);
      await mcp("tools/list", {}, sid, `${name}/1.0`);
      for (const [tool, args] of calls) await mcp("tools/call", { name: tool, arguments: args }, sid, `${name}/1.0`);
    }
    const owner = data.creators[0].id;
    const myChar = data.chars[0].id;
    const aired = data.episodes[0].id;
    const unaired = data.episodes[11].id;
    // Texts, boards and swipes (2026-10-17). The first seeded date (the owner's character and Teo) has aired, so its
    // couple page has a phone for the owner and a locked one for everyone else. A second character of the owner's
    // swipes into a match with a house character, for the deck and a match's couple page.
    const couplePath = `/couples/${[myChar, "house-teo"].sort().join("/")}`;
    const asOwner = async (path, body) => {
      const res = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", cookie: `bz_uid=${owner}`, origin: base },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) throw new Error(`${path} → ${res.status}`);
      return res.json();
    };
    const swiper = await asOwner("/api/characters", {
      name: "Marlowe Finch",
      age: 33,
      bio: "Restores old radios and narrates the weather to them while they warm up.",
      traits: ["wry", "patient", "romantic"],
      want: "Someone who listens to the static with me",
      dealbreaker: "Talking over the forecast",
      attest: true,
      extras: {
        hobbies: ["Shortwave radio", "Night walks"],
        prompts: [
          { id: "simple_pleasures", answer: "A valve radio warming up, and the first crackle of a far-off station." },
          { id: "win_me_over", answer: "Sit through the whole shipping forecast with me." },
        ],
      },
    });
    const houseCard = (await asOwner(`/api/swipes?character_id=${swiper.id}`)).cards.find((c) => c.house);
    await asOwner("/api/swipes", { character_id: swiper.id, target_id: houseCard.id, like: true });
    const matchPath = `/couples/${[swiper.id, houseCard.id].sort().join("/")}`;

    // After Dark's first scene, as an admin sees the list (an admin account: registered, then claimed with the password).
    const adminCreds = { handle: "visual_admin", password: ["visual", "admin", "acct"].join("-") };
    const adminSignIn = async (request) => {
      const opts = { headers: { origin: base } };
      let res = await request.post(`${base}/api/auth/register`, { ...opts, data: { ...adminCreds, attest: true } });
      if (res.status() === 409) res = await request.post(`${base}/api/auth/login`, { ...opts, data: adminCreds });
      if (!res.ok()) throw new Error(`admin sign-in → ${res.status()}`);
      const claim = await request.post(`${base}/api/admin/claim`, { headers: { origin: base, "x-frontier-key": ADMIN_PASSWORD } });
      if (!claim.ok()) throw new Error(`admin claim → ${claim.status()}`);
    };
    let scenePath = "/after-dark";
    {
      const ctx = await browser.newContext();
      await ctx.addCookies([{ name: "bz_adult", value: "1", url: base }]);
      await adminSignIn(ctx.request);
      const html = await (await ctx.request.get(`${base}/after-dark`)).text();
      scenePath = html.match(/href="(\/after-dark\/[^/"?]+\/[^/"?]+)"/)?.[1] ?? scenePath;
      await ctx.close();
    }
    const writeScene = async (page) => {
      await page.locator("#after-dark-direction").fill("they share a cab home");
      await page.locator(".after-dark-form button[type=submit]").click();
      await page.locator(".after-dark-lines").getByText("kettle").first().waitFor({ timeout: 30_000 });
    };

    // Each route: who opens it, and an optional walk through its states (each state is audited separately).
    const routes = [
      { name: "gate", path: "/watch", as: "visitor" },
      { name: "home", path: "/" },
      { name: "cast", path: "/cast" },
      { name: "watch-lobby", path: "/watch" },
      { name: "watch-room", path: `/watch/${data.templates[0]}` },
      { name: "episode-aired", path: `/episodes/${aired}` },
      { name: "episode-unaired", path: `/episodes/${unaired}` },
      { name: "character", path: `/characters/${data.chars[4].id}` },
      { name: "league", path: `/leagues/${data.league.id}` },
      { name: "shop", path: "/shop" },
      { name: "agents", path: "/agents" },
      { name: "legal", path: "/legal" },
      { name: "privacy", path: "/privacy" },
      { name: "terms", path: "/terms" },
      { name: "admin", path: "/admin" },
      { name: "account-signed-out", path: "/account" },
      {
        // The auth card's other mode (a fresh visitor lands on "Create an account"; the link flips to "Sign in").
        name: "account-other-mode",
        path: "/account",
        walk: async (page) => {
          await page.locator("button.link-button").filter({ hasText: /^(Sign in|Create an account)$/ }).first().click();
          await page.waitForTimeout(200);
        },
      },
      { name: "create", path: "/create?sample=1", walk: "wizard" },
      { name: "character-owner", path: `/characters/${myChar}`, as: "owner" },
      { name: "character-edit", path: `/characters/${myChar}/edit`, as: "owner", walk: "wizard" },
      { name: "create-send", path: `/create?character=${myChar}`, as: "owner" },
      { name: "swipe", path: `/swipe?character=${swiper.id}`, as: "owner" },
      { name: "swipe-match", path: matchPath, as: "owner" },
      { name: "matches-none", path: "/matches" },
      { name: "matches", path: `/matches?character=${swiper.id}`, as: "owner" },
      { name: "messages", path: `/messages/${[swiper.id, houseCard.id].sort().join("/")}?as=${swiper.id}`, as: "owner" },
      { name: "couple-owner", path: couplePath, as: "owner" },
      { name: "couple-spectator", path: couplePath },
      { name: "board-owner", path: `/characters/${myChar}/relationships`, as: "owner" },
      { name: "board", path: `/characters/${myChar}/relationships` },
      { name: "admin-feedback", path: "/admin/feedback" },
      { name: "admin-feedback-signed-in", path: "/admin/feedback", as: "admin" },
      { name: "admin-analytics", path: "/admin/analytics" },
      { name: "admin-analytics-signed-in", path: "/admin/analytics", as: "admin" },
      { name: "account-signed-in", path: "/account", as: "member" },
      { name: "account-keys", path: "/account/keys", as: "member" },
      { name: "directory", path: "/characters" },
      { name: "notifications", path: "/notifications", as: "owner" },
      { name: "graph", path: "/graph" },
      { name: "reunion", path: "/reunion" },
      { name: "ship", path: `/ship/${data.chars[0].id}/house-teo` },
      { name: "tool-chemistry", path: "/tools/oc-chemistry-test" },
      { name: "tool-ship-names", path: "/tools/ship-name-generator" },
      { name: "admin-season", path: "/admin/season", as: "admin" },
      { name: "after-dark", path: "/after-dark", as: "adult-admin" },
      { name: "after-dark-scene", path: scenePath, as: "adult-admin", walk: writeScene },
      { name: "after-dark-theater", path: `${scenePath}?play=1`, as: "adult-admin" },
      { name: "after-dark-shorts", path: "/after-dark/shorts", as: "adult-admin" },
      { name: "after-dark-subscribe", path: "/after-dark/subscribe", as: "adult-admin" },
      { name: "admin-after-dark", path: "/admin/after-dark", as: "adult-admin" },
      { name: "admin-after-dark-settings", path: "/admin/after-dark/settings", as: "adult-admin" },
    ].filter((r) => !only.length || only.some((o) => r.name.includes(o)));

    for (const [device, opts] of Object.entries(DEVICES)) {
      for (const scheme of SCHEMES) {
        const variant = `${device}-${scheme}`;
        mkdirSync(join(OUT, variant), { recursive: true });
        const contexts = {};
        const contextFor = async (as = "spectator") => {
          if (contexts[as]) return contexts[as];
          const ctx = await browser.newContext({ ...opts, colorScheme: scheme, reducedMotion: "reduce" });
          if (as !== "visitor") await ctx.addCookies([{ name: "bz_adult", value: "1", url: base }]);
          if (as === "owner" || as === "member") await ctx.addCookies([{ name: "bz_uid", value: owner, url: base }]);
          // Signed in to the admin pages the way they remember it: the password in localStorage.
          if (as === "admin") await ctx.addInitScript((k) => { try { localStorage.setItem("bz_frontier", k); } catch {} }, ADMIN_PASSWORD);
          if (as === "adult-admin") await adminSignIn(ctx.request);
          if (as === "member") {
            // The first signed-in pass registers (adopting the owner's anonymous session, so the account lists
            // their characters); later passes sign in to the same account.
            const creds = { handle: "visual_owner", password: ["visual", "audit", "pw"].join("-") };
            const opts = { headers: { origin: base } };
            let res = await ctx.request.post(`${base}/api/auth/register`, { ...opts, data: { ...creds, attest: true } });
            if (res.status() === 409) res = await ctx.request.post(`${base}/api/auth/login`, { ...opts, data: creds });
            if (!res.ok()) throw new Error(`sign-in → ${res.status()}`);
          }
          contexts[as] = ctx;
          return ctx;
        };

        for (const route of routes) {
          let page;
          try {
            page = await (await contextFor(route.as)).newPage();
          } catch (err) {
            errors++;
            report.push({ variant, state: route.name, url: route.path, file: "", findings: [{ rule: "crawl", level: "error", el: "", detail: String(err).slice(0, 300) }] });
            console.log(`  ✗ ${variant.padEnd(13)} ${route.name}: ${err}`);
            continue;
          }
          const consoleErrors = [];
          page.on("pageerror", (e) => consoleErrors.push(e.message));
          page.on("console", (m) => {
            if (m.type() === "error" && !/ERR_ABORTED|_rsc=/.test(m.text())) consoleErrors.push(m.text());
          });

          const audit = async (state) => {
            await settle(page);
            const file = `${variant}/${state}.png`;
            await page.screenshot({ path: join(OUT, file), fullPage: true });
            const findings = await page.evaluate(auditPage, { phone: device === "phone", dark: scheme === "dark", width: opts.viewport.width });
            for (const msg of consoleErrors.splice(0)) findings.push({ rule: "console-error", level: "error", el: "", detail: msg.slice(0, 200) });
            const n = findings.filter((f) => f.level === "error").length;
            errors += n;
            report.push({ variant, state, url: page.url().replace(base, ""), file, findings });
            console.log(`  ${n ? "✗" : findings.length ? "~" : "✓"} ${variant.padEnd(13)} ${state.padEnd(26)} ${n} errors, ${findings.length - n} warnings`);
          };

          try {
            await page.goto(base + route.path);
            await audit(route.name);
            if (route.walk === "wizard") {
              for (let i = 1; i < 8; i++) {
                const next = page.getByRole("button", { name: /^Next:/ });
                if (!(await next.count())) break;
                await next.first().click();
                await page.waitForTimeout(250);
                await audit(`${route.name}-step${i + 1}`);
              }
            } else if (route.walk) {
              await route.walk(page);
              await audit(`${route.name}-open`);
            }
          } catch (err) {
            errors++;
            report.push({ variant, state: route.name, url: route.path, file: "", findings: [{ rule: "crawl", level: "error", el: "", detail: String(err).slice(0, 300) }] });
            console.log(`  ✗ ${variant.padEnd(13)} ${route.name}: ${err}`);
          }
          await page.close();
        }
        for (const ctx of Object.values(contexts)) await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
    adult.close();
    writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
    writeFileSync(join(OUT, "report.md"), summary(report));
    writeFileSync(join(OUT, "index.html"), contactSheet(report));
  }

  console.log(`\n${summary(report).split("\n## Findings")[0]}`);
  console.log(`Report: ${join(OUT, "index.html")}`);
  process.exit(errors ? 1 : 0);
}

function summary(report) {
  const byRule = new Map();
  for (const r of report) for (const f of r.findings) {
    const key = `${f.level} ${f.rule}`;
    byRule.set(key, (byRule.get(key) || 0) + 1);
  }
  const lines = ["# Visual audit", "", `${report.length} page states audited.`, ""];
  for (const [k, n] of [...byRule.entries()].sort()) lines.push(`- ${k}: ${n}`);
  if (!byRule.size) lines.push("- no findings");
  lines.push("", "## Findings", "");
  // Group identical findings across variants so the list reads as distinct problems.
  const grouped = new Map();
  for (const r of report) for (const f of r.findings) {
    const key = `${f.level}|${f.rule}|${r.state}|${f.el}`;
    const g = grouped.get(key) || { ...f, state: r.state, variants: [] };
    g.variants.push(r.variant);
    grouped.set(key, g);
  }
  for (const g of [...grouped.values()].sort((a, b) => (a.level + a.rule + a.state).localeCompare(b.level + b.rule + b.state))) {
    lines.push(`- **${g.level} ${g.rule}** · ${g.state} · \`${g.el}\` — ${g.detail} _(${g.variants.join(", ")})_`);
  }
  return lines.join("\n") + "\n";
}

function contactSheet(report) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const cards = report
    .map((r) => {
      const items = r.findings.map((f) => `<li class="${f.level}"><b>${esc(f.rule)}</b> <code>${esc(f.el)}</code> ${esc(f.detail)}</li>`).join("");
      return `<section><h2>${esc(r.state)} <small>${esc(r.variant)} · ${esc(r.url)}</small></h2>${items ? `<ul>${items}</ul>` : ""}${r.file ? `<a href="${r.file}"><img loading="lazy" src="${r.file}"></a>` : ""}</section>`;
    })
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>Visual audit</title><style>
body{font:14px system-ui;margin:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
section{border:1px solid #ddd;border-radius:8px;padding:8px}h2{font-size:14px;margin:0 0 6px}small{color:#777;font-weight:400}
img{width:100%;max-height:520px;object-fit:cover;object-position:top;border:1px solid #eee}ul{padding-left:18px;margin:4px 0}
li.error{color:#b91c1c}li.warn{color:#92400e}code{font-size:12px}</style>${cards}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

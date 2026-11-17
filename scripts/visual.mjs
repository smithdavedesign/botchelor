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
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { appEnv, build, CAST, client, freePort, persona, ROOT, seedDataset, startApp, startShowrunner, stopApp } from "./harness.mjs";

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
    // A control that's inert for people isn't one to size or style: aria-hidden, or screen-reader-only (the password
    // manager's username field in PasswordSettings is a pixel by design, #1436).
    if (el.getAttribute("aria-hidden") === "true" || el.classList.contains("sr-only")) return false;
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
  await page.waitForTimeout(150);
}

/** Scrolls the page top to bottom so lazy images load, as a reader's scroll would, then back to the top. */
async function scrollThrough(page) {
  await page
    .evaluate(async () => {
      const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    })
    .catch(() => {});
}

/** Opens folded groups so their fields are audited too (after the screenshot, which shows the page as it opens). */
async function openDetails(page) {
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
  // Each step's lines differ (the scene refuses a step that only repeats lines already said).
  let adultStep = 0;
  const adult = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const n = ++adultStep;
      const content = JSON.stringify({ lines: [{ who: "a", text: `Your place or mine? (take ${n})` }, { who: "b", text: `Mine. It's closer, and the kettle's on, take ${n}.` }] });
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
    // Every seeded couple the rules allow a gift gets one (lib/gift-catalog.ts giftRate), so the couple pages are
    // audited with a photo and a gift in their thread, not one run in ten.
    CHARACTER_GIFTS_RATE: "100",
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
    // Today's house scene (lib/house-scenes.ts), written now from the seeded season's aired dates, so /house, the
    // tonight band's house line and the Reunion's link are audited with a scene on them. Best effort: a quiet season
    // just leaves the page's empty state.
    await fetch(`${base}/api/admin/house-scene`, { method: "POST", headers: { origin: base, "x-frontier-key": ADMIN_PASSWORD } }).catch(() => null);
    // And the other two kinds (lib/house-conflict.ts), so the page is audited with their headings and result lines:
    // the week's challenge always has a cast to hold it; a confrontation only when the seeded state holds a tension.
    for (const kind of ["challenge", "confrontation"]) {
      await fetch(`${base}/api/admin/house-scene?kind=${kind}`, { method: "POST", headers: { origin: base, "x-frontier-key": ADMIN_PASSWORD } }).catch(() => null);
    }
    // A character made a minute ago, with no date: its Talk tab is the "nobody is talking yet" line (best effort).
    const newcomer = await client(base)(
      "/api/characters",
      { name: "Maren Oduya", age: 31, bio: "Repairs lighthouse lamps and writes the keepers' names inside each one.", traits: ["steady", "curious", "dry"], want: "Someone who stays for the whole sunset", dealbreaker: "Leaving before the light comes on", attest: true, keep_name: true },
      persona(),
    ).catch(() => null);
    const owner = data.creators[0].id;
    const myChar = data.chars[0].id;
    const aired = data.episodes[0].id;
    // The day's clip in a stranger's home hero (lib/home-clip.ts), sent the way the daily clip sends it (the script's own
    // cut and upload, against this server): a few seconds of HOME_CLIP_SAMPLE (a rendered clip) when given, else of a
    // test pattern. Best effort: with no ffmpeg, home is audited as it is without a clip.
    try {
      const { makeWebClip, uploadWebClip } = await import("./clips/daily-clip.mjs");
      const dir = join(OUT, "home-clip");
      mkdirSync(dir, { recursive: true });
      let src = process.env.HOME_CLIP_SAMPLE;
      if (!src) {
        src = join(dir, "pattern.mp4");
        execFileSync(process.env.FFMPEG || "ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=480x854:r=24:d=4", "-pix_fmt", "yuv420p", src]);
      }
      const window = process.env.HOME_CLIP_SAMPLE ? { start: 2, seconds: 12 } : { start: 0, seconds: 3 };
      const made = makeWebClip({ mp4: src, dir, name: "web", window });
      const sent = await uploadWebClip({ base, key: ADMIN_PASSWORD, episode: aired, loop: made.loop, poster: made.poster, seconds: window.seconds });
      console.log(sent.ok ? "Home clip: seeded" : `Home clip: not seeded (${sent.status} ${sent.error})`);
    } catch (e) {
      console.log(`Home clip: not seeded (${String(e?.message ?? e).slice(0, 120)})`);
    }
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
      // A pair's page, not a Studio's or a Short's (the home lists the Studio first since #778); a new admin has none, so
      // two of the cast the pair picker offers, whose page starts their scene.
      const cast = [...new Set(html.match(/house-[a-z]+/g) ?? [])].slice(0, 2).sort();
      scenePath = html.match(/href="(\/after-dark\/(?!studio\/|shorts\/)[^/"?]+\/[^/"?]+)"/)?.[1] ?? (cast.length === 2 ? `/after-dark/${cast[0]}/${cast[1]}` : scenePath);
      await ctx.close();
    }
    // The locked picture in a character's texts (lib/locked-picture.ts): the admin's own character goes on a date built
    // to end in another (the seeded season's Pernilla sheet against Rafe), it airs, the admin turns that thread's texts
    // on and switches the character into After Dark, and the owner-only preview route writes the text. The thread is
    // then audited twice: as someone After Dark is open to, and (?preview=visitor) as someone it isn't.
    let lockedThread = null;
    // The same date's page for its owner, whose character texted them about it: "… texted you about this"
    // (lib/chat-date-links.ts), and in the thread above "About your date with …" under that text.
    let lockedEpisode = null;
    try {
      const ctx = await browser.newContext();
      await ctx.addCookies([{ name: "bz_adult", value: "1", url: base }]);
      await adminSignIn(ctx.request);
      const post = async (path, data) => {
        const res = await ctx.request.post(base + path, { headers: { origin: base }, ...(data === undefined ? {} : { data }) });
        if (!res.ok()) throw new Error(`${path} → ${res.status()}`);
        return res.json();
      };
      const { soul, ...sheet } = CAST[10];
      const mine = await post("/api/characters", { ...sheet, name: "Petra Lindqvist", ...(soul ? { soul } : {}), attest: true, keep_name: true });
      let ended = null;
      for (let i = 0; i < 3 && !ended; i++) {
        const ep = await post("/api/episodes", { character_id: mine.id, partner_id: "house-rafe", autonomy: "guided", strategy: "genuine_chemistry", agenda: "find_funny", game_budget: 100, note: "Say what you actually think of the pastry." });
        await post(`/api/episodes/${ep.id}/reveal`, {});
        if (ep.ending === "second_date") ended = ep.id;
      }
      if (!ended) throw new Error("no date of theirs ended in another date");
      const thread = (await post("/api/companion", { character_id: mine.id })).thread_id;
      await post(`/api/companion/${thread}`, { action: "texts", on: true });
      await post("/api/admin/after-dark/switch", { character_id: mine.id, on: true });
      const sent = await post(`/api/admin/locked-picture?episode=${ended}`);
      if (!sent.locked_picture?.sent) throw new Error(`the preview wrote nothing (${JSON.stringify(sent.locked_picture)})`);
      lockedThread = thread;
      lockedEpisode = ended;
      await ctx.close();
      console.log("Locked picture: seeded");
    } catch (e) {
      console.log(`Locked picture: not seeded (${String(e?.message ?? e).slice(0, 160)})`);
    }
    const writeScene = async (page) => {
      // The page opens on the theater (2026-10-25): the scene is written there.
      // A new night waits on its start card (#896): Start it, then steer the next lines from the bar.
      const start = page.locator(".theater .ad-start-card").getByRole("button", { name: /Start the night/ });
      if (await start.count()) await start.click();
      const bar = page.locator(".ad-theater-bar");
      await bar.getByRole("textbox", { name: "Steer it (optional)" }).fill("they share a cab home");
      await bar.getByRole("button", { name: "Next" }).click();
      await page.locator(".theater .chat-thread").getByText("kettle").first().waitFor({ state: "attached", timeout: 30_000 });
    };
    // A creator's casting invite (lib/casting-invites.ts), made the way the admin makes one, so its page is audited open
    // (best effort: without it, only the page for a code that isn't one).
    const inviteCode = await fetch(`${base}/api/admin/casting-invites`, {
      method: "POST",
      headers: { origin: base, "content-type": "application/json", "x-frontier-key": ADMIN_PASSWORD },
      body: JSON.stringify({ count: 1, note: "visual audit" }),
    })
      .then((r) => r.json())
      .then((d) => d.invites?.[0]?.code ?? null)
      .catch(() => null);

    // The coming season as a lead season (The Botchelor) for its own page (app/seasons/[slug]/SeasonLive.tsx), set the
    // way the admin sets it and put back after, so no other route sees a lead season.
    const adminSeason = (body) =>
      fetch(`${base}/api/admin/season`, {
        method: "POST",
        headers: { origin: base, "content-type": "application/json", "x-frontier-key": ADMIN_PASSWORD },
        body: JSON.stringify(body),
      }).then((r) => {
        if (!r.ok) throw new Error(`/api/admin/season ${body.action} → ${r.status}`);
      });
    const nextMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
    const nextSeasonId = nextMonth.toISOString().slice(0, 10);
    const nextSeasonSlug = `${nextMonth.toLocaleString("en-US", { month: "long", timeZone: "UTC" }).toLowerCase()}-${nextMonth.getUTCFullYear()}`;
    const leadSeason = {
      before: async () => {
        const lead = await fetch(`${base}/api/admin/season`, { headers: { "x-frontier-key": ADMIN_PASSWORD } })
          .then((r) => r.json())
          .then((d) => d.leads?.[0]?.id);
        await adminSeason({ action: "format", season_id: nextSeasonId, slug: "botchelor" });
        if (lead) await adminSeason({ action: "lead", season_id: nextSeasonId, character_id: lead });
      },
      after: async () => {
        await adminSeason({ action: "lead", season_id: nextSeasonId, character_id: null });
        await adminSeason({ action: "format", season_id: nextSeasonId, slug: "classic" });
      },
    };

    // Each route: who opens it, and an optional walk through its states (each state is audited separately). `before` and
    // `after` set up and put back what the route needs, around each pass of it.
    const routes = [
      // The swipe deck: the PG show pages open without the gate since 2026-11-14 (middleware.ts), the deck still meets it.
      { name: "gate", path: "/swipe", as: "visitor" },
      { name: "home", path: "/" },
      // A returning creator: "Since you were here" first (lib/since.ts, J4).
      { name: "home-owner", path: "/", as: "owner" },
      // The Character.AI rescue door (2026-11-14): /import with the three steps above the box.
      { name: "import-cai", path: "/import?from=cai" },
      {
        // "Bring their history" (lib/import-history.ts): the plain page with its second box, then a card and a pasted
        // chat read into the checklist (the stub showrunner answers the reader's call), each line with its tick.
        name: "import-history",
        path: "/import",
        walk: async (page) => {
          await page.getByRole("button", { name: "Try an example card" }).click();
          await page
            .locator("#import-history")
            .fill("You: do you remember the storm in March?\nMarisol: The night we fixed the radio. You held the torch and I swore at the solder.\nYou: my sister Odile still thinks you're a ghost story.\nMarisol: Tell Odile the ghost says hello, sailor.");
          await page.getByRole("button", { name: "Bring them in" }).click();
          await page.getByRole("heading", { name: "What Marisol brings" }).waitFor({ timeout: 30_000 });
          await page.getByRole("button", { name: /^Keep \d and open the builder$/ }).waitFor();
        },
      },
      { name: "cast", path: "/cast" },
      { name: "watch-lobby", path: "/watch" },
      { name: "watch-room", path: `/watch/${data.templates[0]}` },
      { name: "episode-aired", path: `/episodes/${aired}` },
      { name: "episode-unaired", path: `/episodes/${unaired}` },
      // The creator's just-filmed date (?play=1): the theater, then skipped to the verdict card (VerdictCard.tsx).
      {
        name: "episode-theater-verdict",
        path: `/episodes/${aired}?play=1`,
        as: "owner",
        walk: async (page) => {
          await page.getByRole("button", { name: "Skip to the end" }).click();
          await page.locator(".theater-verdict .ending").waitFor({ timeout: 20_000 });
        },
      },
      { name: "character", path: `/characters/${data.chars[4].id}` },
      { name: "league", path: `/leagues/${data.league.id}` },
      { name: "shop", path: "/shop" },
      { name: "agents", path: "/agents" },
      // What the bots are saying (app/BotReviews.tsx): every review, and the gripes with where each stands (fixed, open
      // or not a bug) and the tally over the filter.
      { name: "reviews", path: "/reviews" },
      { name: "reviews-gripes", path: "/reviews?said=gripe" },
      // The model league (lib/model-league.ts): its day-one empty state, the exact call in a code box on a phone.
      { name: "agents-league", path: "/agents/league" },
      // The MCP tool reference and changelog (lib/mcp/reference.ts, lib/mcp/changelog.ts): long lists of code-ish text on a phone.
      { name: "agents-tools", path: "/agents/tools" },
      { name: "agents-changelog", path: "/agents/changelog" },
      { name: "legal", path: "/legal" },
      { name: "privacy", path: "/privacy" },
      // What it costs (app/costs): tables of prices with notes under each row, a live call's minute among them, on a phone.
      { name: "costs", path: "/costs" },
      { name: "terms", path: "/terms" },
      { name: "admin", path: "/admin" },
      { name: "account-signed-out", path: "/account" },
      {
        // The auth card's other tab (a fresh visitor lands on Create account; the Sign in tab is the other).
        name: "account-other-mode",
        path: "/account",
        walk: async (page) => {
          await page.locator('[role="tab"][aria-selected="false"]').first().click();
          await page.waitForTimeout(200);
        },
      },
      {
        // One-sentence create (lib/express-create.ts): a first-time visitor's first screen is one box; "Meet them" drafts
        // the sheet (the stub showrunner answers) and lands on Look with a look already picked. Before the sample route
        // below: that one leaves a half-built draft in this browser, and a draft brings the form back instead of the box.
        name: "create-express",
        path: "/create",
        walk: async (page) => {
          await page.locator("#express-text").fill("A lighthouse keeper who repairs old radios and listens to ships talk at night.");
          await page.getByRole("button", { name: "Meet them" }).click();
          await page.getByText("Give them a look").waitFor({ timeout: 20_000 });
          await page.getByText("A look that fits your words is already picked").waitFor();
        },
      },
      {
        // The home page's sentence box (app/HomeExpressBox.tsx): a sentence typed on home lands on /create with the
        // draft already running, and the sentence never shows in the address. After create-express (a draft left in
        // this browser doesn't stop this one: a sentence from home starts fresh), before the sample below.
        name: "home-express",
        path: "/",
        walk: async (page) => {
          await page.locator("#home-express-text").fill("A night-shift baker who names every sourdough starter.");
          await page.locator(".home-express button[type=submit]").click();
          await page.getByText("Give them a look").waitFor({ timeout: 30_000 });
          if (new URL(page.url()).search) throw new Error(`the sentence's address wasn't cleaned: ${page.url()}`);
        },
      },
      { name: "create", path: "/create?sample=1", walk: "wizard" },
      { name: "character-owner", path: `/characters/${myChar}`, as: "owner" },
      { name: "character-edit", path: `/characters/${myChar}/edit`, as: "owner", walk: "wizard" },
      { name: "create-send", path: `/create?character=${myChar}`, as: "owner" },
      {
        // A Date button asks first (B5): the sheet with who, what it uses and the folded settings.
        name: "create-send-confirm",
        path: `/create?character=${myChar}`,
        as: "owner",
        walk: async (page) => {
          await page.getByRole("button", { name: /Send on a date with/ }).first().click();
          await page.locator(".sheet-dialog[open]").waitFor();
          await page.locator(".sheet-dialog[open] .send-settings-fold > summary").click();
        },
      },
      { name: "swipe", path: `/swipe?character=${swiper.id}`, as: "owner" },
      { name: "swipe-match", path: matchPath, as: "owner" },
      // Chat (lib/chat-inbox.ts): the one inbox. Empty for a visitor (three of the cast to text, Make your character),
      // with a character's threads for its owner, and with the phone's menu open: Watch · Chat · Characters · Account.
      { name: "chat-none", path: "/chat" },
      { name: "chat", path: "/chat", as: "owner" },
      // One of the owner's characters picked from the face row (lib/current-character.ts): the list narrowed to it.
      { name: "chat-character", path: `/chat?character=${swiper.id}`, as: "owner" },
      // The Studio door (app/studio): the way in for a visitor, an owner's own Studio, and their characters on Yours.
      { name: "studio-none", path: "/studio" },
      // An owner on an anonymous session is asked to sign in; signed in ("member"), it is their Studio with the face row.
      { name: "studio-signin", path: `/studio?character=${swiper.id}`, as: "owner" },
      { name: "studio", path: `/studio?character=${swiper.id}`, as: "member" },
      { name: "characters-yours", path: "/characters?tab=yours", as: "owner" },
      {
        name: "chat-menu",
        path: "/chat",
        as: "owner",
        walk: async (page) => {
          const toggle = page.locator(".nav-toggle");
          if (await toggle.isVisible()) {
            await toggle.click();
            await page.locator('.nav-links[data-open="true"]').waitFor();
          }
        },
      },
      { name: "matches-none", path: "/matches" },
      { name: "matches", path: `/matches?character=${swiper.id}`, as: "owner" },
      { name: "messages", path: `/messages/${[swiper.id, houseCard.id].sort().join("/")}?as=${swiper.id}`, as: "owner" },
      {
        // ⋯ open: their story, a double date, the other chats (on a phone), Unmatch (app/couples/[a]/[b]/ThreadMenu.tsx).
        name: "messages-menu",
        path: `/messages/${[swiper.id, houseCard.id].sort().join("/")}?as=${swiper.id}`,
        as: "owner",
        walk: async (page) => {
          await page.locator(".phone-header .thread-menu > button").click();
          await page.locator(".thread-menu-panel").waitFor();
        },
      },
      {
        // Unmatch asks first, in a modal (app/Sheet.tsx).
        name: "messages-unmatch",
        path: `/messages/${[swiper.id, houseCard.id].sort().join("/")}?as=${swiper.id}`,
        as: "owner",
        walk: async (page) => {
          await page.locator(".phone-header .thread-menu > button").click();
          await page.locator(".thread-menu-panel").getByRole("menuitem", { name: /Unmatch/ }).click();
          await page.locator(".sheet-dialog[open]").waitFor();
        },
      },
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
      // Every card's verb (lib/character-verb.ts): a stranger steps in or makes a character (above), an owner sends theirs.
      { name: "directory-owner", path: "/characters", as: "owner" },
      // A cast member's page for a stranger: stepping into a date is the one filled button.
      { name: "character-cast", path: "/characters/house-teo" },
      // Talk of the house (lib/character-talk.ts): the lead's page with the tab open, from the seeded house scenes;
      // the old #audience link, which opens Talk and the reviews fold; and a newcomer nobody is talking about yet.
      { name: "character-talk", path: "/characters/house-nell#talk" },
      { name: "character-talk-reviews", path: "/characters/house-teo#audience" },
      ...(newcomer?.id ? [{ name: "character-talk-new", path: `/characters/${newcomer.id}#talk` }] : []),
      // The header's row (app/characters/[id]/HeaderActions.tsx): the lead's page opens on Right now; ⋯ open (the link
      // to share), then followed: the toggle reads Following and the line under the row says what the tap did.
      {
        name: "character-menu",
        path: "/characters/house-nell",
        walk: async (page) => {
          await page.locator(".contestant-actions .thread-menu > button").click();
          await page.locator('.contestant-actions [role="menu"]:not([hidden])').waitFor({ timeout: 10_000 });
        },
      },
      {
        name: "character-follow",
        path: "/characters/house-nell",
        walk: async (page) => {
          await page.locator('.contestant-actions [data-track="character-follow"]').click();
          await page.locator('.contestant-actions [data-track="character-follow"][aria-pressed="true"]').waitFor({ timeout: 10_000 });
        },
      },
      { name: "directory-people", path: "/characters?tab=people" },
      // The agents' tab: its count is on its own fold, never in the tab strip.
      { name: "directory-agents", path: "/characters?tab=agents" },
      {
        // Step into the date, open to everyone: the cast picker a stranger lands on with no 18+ cookie, then the start
        // screen with its own 18+ box (app/step-in/StepInSetup.tsx).
        name: "step-in",
        path: "/step-in",
        as: "visitor",
        walk: async (page) => {
          await page.locator(".stepin-cast-pick").first().click();
          await page.locator(".stepin-form").waitFor({ timeout: 20_000 });
        },
      },
      {
        // The same stranger goes on: as themselves, the box ticked, and the live date opens for a guest (the start signs
        // their visitor session and sets the gate's cookie, so the date's page lets them in).
        name: "step-in-date",
        path: "/step-in",
        as: "visitor",
        walk: async (page) => {
          await page.locator(".stepin-cast-pick").first().click();
          const form = page.locator(".stepin-form");
          await form.waitFor({ timeout: 20_000 });
          await form.getByLabel("Your name on the date").fill("Sam");
          await form.getByLabel("Age").fill("31");
          await form.getByLabel("One line about you").fill("Bakes too much bread and laughs at their own jokes.");
          await form.locator(".stepin-attest input").check();
          await form.getByRole("button", { name: /^Step in with/ }).click();
          await page.locator(".stepin-composer").waitFor({ timeout: 30_000 });
          // The cast member's opening line (or the composer ready for theirs), so the thread isn't caught mid-request.
          await page.locator("#stepin-line:not([disabled]), .stepin-note").first().waitFor({ timeout: 30_000 }).catch(() => {});
        },
      },
      { name: "notifications", path: "/notifications", as: "owner" },
      { name: "graph", path: "/graph" },
      { name: "reunion", path: "/reunion" },
      // The show on air and the ideas for what could come next (lib/show-ideas.ts).
      { name: "shows", path: "/shows" },
      // The show's own page (app/shows/[id]/page.tsx): its season on air, its cast and every season from the registry.
      { name: "show-page", path: "/shows/botchelor" },
      // A lead season's own page, the month before it starts (docs/season-page.md).
      { name: "season-live", path: `/seasons/${nextSeasonSlug}`, ...leadSeason },
      { name: "house", path: "/house" },
      { name: "ship", path: "/ship/juniper/teo" },
      { name: "tool-chemistry", path: "/tools/oc-chemistry-test" },
      { name: "tool-ship-names", path: "/tools/ship-name-generator" },
      { name: "tool-oc-names", path: "/tools/oc-name-generator/fantasy" },
      { name: "tool-oc-questions", path: "/tools/oc-questions?q=love-2" },
      // (Its Creator invites fold, list and "Make N invites" form, is audited open with the rest: openDetails.)
      { name: "admin-season", path: "/admin/season", as: "admin" },
      // A character's text with its locked picture (lib/locked-picture.ts), in both states of the tile.
      ...(lockedThread
        ? [
            { name: "companion-locked-picture", path: `/companion/${lockedThread}`, as: "adult-admin" },
            { name: "companion-locked-picture-visitor", path: `/companion/${lockedThread}?preview=visitor`, as: "adult-admin" },
            { name: "episode-texted-about", path: `/episodes/${lockedEpisode}`, as: "adult-admin" },
          ]
        : []),
      // The invite page (no 18+ wall): as a stranger meets it, as a signed-in creator with characters, and a made-up code.
      ...(inviteCode
        ? [
            { name: "casting-invite", path: `/casting/invite/${inviteCode}`, as: "visitor" },
            { name: "casting-invite-member", path: `/casting/invite/${inviteCode}`, as: "member" },
          ]
        : []),
      { name: "casting-invite-invalid", path: "/casting/invite/Ab3_x-9QzK", as: "visitor" },
      { name: "after-dark", path: "/after-dark", as: "adult-admin" },
      { name: "after-dark-scene", path: scenePath, as: "adult-admin", walk: writeScene },
      { name: "after-dark-theater", path: `${scenePath}?play=1`, as: "adult-admin" },
      { name: "after-dark-shorts", path: "/after-dark/shorts", as: "adult-admin" },
      // Every picture and video of theirs in one place (the design kit's Gallery, 2026-11-12).
      { name: "after-dark-gallery", path: "/after-dark/gallery", as: "adult-admin" },
      // The Studio door (whose Studio, then who's in; 2026-11-15); the writer, privacy and the subscription.
      { name: "after-dark-studio", path: "/after-dark/studio", as: "adult-admin" },
      { name: "after-dark-account", path: "/after-dark/account", as: "adult-admin" },
      // Signed in but not subscribed: an admin is sent on to the hub (and /admin/after-dark is only a redirect there).
      { name: "after-dark-subscribe", path: "/after-dark/subscribe", as: "member" },
      // The same person at the Gallery and the Studio (2026-11-16): the locked preview and the way in, not a not-found.
      { name: "after-dark-gallery-locked", path: "/after-dark/gallery", as: "member" },
      { name: "after-dark-studio-locked", path: "/after-dark/studio?source=pg-studio", as: "member" },
      { name: "admin-after-dark-settings", path: "/admin/after-dark/settings", as: "adult-admin" },
      // Its other tabs (2026-10-31 UX audit, E3): every price and cap in one tab, and the Studio's.
      { name: "admin-after-dark-settings-prices", path: "/admin/after-dark/settings?tab=prices", as: "adult-admin" },
      { name: "admin-after-dark-settings-studio", path: "/admin/after-dark/settings?tab=studio", as: "adult-admin" },
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
          if (as === "adult-admin") {
            await adminSignIn(ctx.request);
            // The arrival screen (app/Threshold.tsx) shows once a tab, and every state opens a new tab: seen already, so
            // the screenshots are the pages, not the arrival screen over each of them (until 2026-11-15 they all were).
            await ctx.addInitScript(() => { try { sessionStorage.setItem("bz-threshold:after-dark", "1"); } catch {} });
          }
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
            if (m.type() !== "error" || /ERR_ABORTED|_rsc=/.test(m.text())) return;
            // A failed load names its resource, so the report says which request failed (the message alone doesn't).
            const url = /^Failed to load resource/.test(m.text()) ? m.location()?.url : "";
            consoleErrors.push(url ? `${m.text()}: ${url.replace(/^https?:\/\/[^/]+/, "")}` : m.text());
          });

          const audit = async (state) => {
            await scrollThrough(page);
            await settle(page);
            const file = `${variant}/${state}.png`;
            await page.screenshot({ path: join(OUT, file), fullPage: true });
            await openDetails(page);
            const findings = await page.evaluate(auditPage, { phone: device === "phone", dark: scheme === "dark", width: opts.viewport.width });
            for (const msg of consoleErrors.splice(0)) findings.push({ rule: "console-error", level: "error", el: "", detail: msg.slice(0, 200) });
            const n = findings.filter((f) => f.level === "error").length;
            errors += n;
            report.push({ variant, state, url: page.url().replace(base, ""), file, findings });
            console.log(`  ${n ? "✗" : findings.length ? "~" : "✓"} ${variant.padEnd(13)} ${state.padEnd(26)} ${n} errors, ${findings.length - n} warnings`);
          };

          try {
            if (route.before) await route.before();
            await page.goto(base + route.path);
            await audit(route.name);
            if (route.walk === "wizard") {
              for (let i = 1; i < 8; i++) {
                // "Next: Voice", or just "Next" on a phone (the step's name is on the rail).
                const next = page.getByRole("button", { name: /^Next\b/ });
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
          if (route.after) await route.after().catch((err) => console.log(`  ✗ ${variant.padEnd(13)} ${route.name} (putting it back): ${err}`));
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

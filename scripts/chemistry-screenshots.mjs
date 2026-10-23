#!/usr/bin/env node
/**
 * npm run screenshots:chemistry — visual proof of the OC chemistry test (lib/chemistry-test.ts). Builds the app and
 * starts the production build on a throwaway local database with every model variable removed (the test never calls a
 * model). It checks over HTTP that the tool answers 200 with "Chemistry Test" in its <title>, sitemap.xml lists it, a
 * result shows the same score on every load with both names in its og:title and a PNG share card, a refused name gets
 * no score and noindex, and "Watch the real date" opens /create with both characters in. Then it drives Chromium like a
 * visitor: the tool with two sample characters typed in, their result, and "Watch the real date" into /create.
 * Desktop (1280×800) and iPhone 13, viewport only, into docs/screenshots/chemistry-*.png.
 *
 * Sample characters only, no key, no real infrastructure. Chromium comes from CHROMIUM_PATH; no browser is downloaded.
 */
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { appEnv, build, freePort, ROOT, startApp, stopApp } from "./harness.mjs";

const require = createRequire(join(ROOT, "package.json"));
const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "chemistry-screenshots");
const TOOL = "/tools/oc-chemistry-test";
const RESULT = `${TOOL}/result`;
const ADULT = { cookie: "bz_adult=1" }; // past the 18+ gate, as a visitor who confirmed

// Two sample characters, as a visitor would type them.
const JUNIPER = { name: "Juniper", traits: ["curious", "warm", "dry-witted"], want: "Someone who gets lost on purpose", dealbreaker: "People who are always on their phone" };
const DEX = { name: "Dex", traits: ["restless", "funny", "loyal"], want: "Someone curious enough to keep up", dealbreaker: "Cynics" };

function query(a, b) {
  const q = new URLSearchParams();
  for (const [side, s] of [["a", a], ["b", b]]) {
    q.set(`${side}_name`, s.name);
    s.traits.forEach((t, i) => q.set(`${side}_trait${i + 1}`, t));
    q.set(`${side}_want`, s.want);
    q.set(`${side}_dealbreaker`, s.dealbreaker);
  }
  return q.toString();
}

/** The harness's environment with no model at all: nothing on these pages may need one. */
function noModelEnv() {
  const env = appEnv(9, DATA_DIR); // the stub showrunner's port is never used, and its variables are removed below
  for (const key of Object.keys(env)) {
    if (/^(LLM_|FRONTIER_|GOOGLE_API_KEY$|OPENAI_|ANTHROPIC_|AI_GATEWAY_)/.test(key)) delete env[key];
  }
  return env;
}

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

const unescape = (html) => html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

/** The acceptance checks over HTTP, against the real production build. */
async function check(base) {
  const tool = await fetch(`${base}${TOOL}`, { headers: ADULT, redirect: "manual" });
  assert(tool.status === 200, `${TOOL} answered ${tool.status}`);
  const toolHtml = await tool.text();
  assert(/<title>[^<]*Chemistry Test/.test(toolHtml), `${TOOL} has no "Chemistry Test" in its <title>`);
  assert((toolHtml.match(/name="[ab]_(name|trait[123]|want|dealbreaker)"/g) ?? []).length === 12, "the form doesn't have 6 fields for each of two characters");

  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  assert(sitemap.includes(TOOL), "sitemap.xml doesn't list the tool");

  let html = "";
  const score = async () => {
    const res = await fetch(`${base}${RESULT}?${query(JUNIPER, DEX)}`, { headers: ADULT });
    assert(res.status === 200, `the result answered ${res.status}`);
    html = unescape(await res.text());
    return `${html.match(/data-score="(\d+)"/)?.[1]} ${html.match(/data-ending="([a-z_]+)"/)?.[1]}`;
  };
  const first = await score();
  const again = await score();
  assert(/^\d+ (second_date|friends|disaster)$/.test(first), `no score and ending on the result (${first})`);
  assert(first === again, `the result changed on reload: ${first}, then ${again}`);
  // Rendered <li>s only: the page's RSC payload repeats the attribute.
  assert((html.match(/<li[^>]*data-reason/g) ?? []).length === 3, "the result doesn't show 3 reasons");

  // The link preview: an og:title with both names, and its own share card (served on this host, whatever the
  // production address in the tag).
  assert(/property="og:title" content="[^"]*Juniper[^"]*Dex/.test(html), "no og:title with both names");
  const image = html.match(/property="og:image" content="([^"]+)"/)?.[1];
  assert(image, "no og:image");
  const imageUrl = new URL(image, base);
  const card = await fetch(`${base}${imageUrl.pathname}${imageUrl.search}`);
  assert(card.status === 200 && card.headers.get("content-type") === "image/png", `the share card answered ${card.status}`);

  // "Watch the real date" opens /create with Juniper in the builder and Dex alongside.
  const watch = html.match(/<a[^>]*href="(\/create\?[^"]+)"[^>]*>Watch the real date<\/a>/)?.[1];
  assert(watch, "no 'Watch the real date' link to /create");
  const create = unescape(await (await fetch(`${base}${watch}`, { headers: ADULT })).text());
  assert(/<input[^>]*name="name"[^>]*value="Juniper"/.test(create), "/create didn't open with Juniper's name in");
  assert(create.includes(DEX.want), "/create doesn't show Dex's fields");

  // A refused name: no score, noindex, and never in the page or its tags. (Next's own <script> payload carries the
  // page's address, which the visitor typed into their own address bar; the markup is what anyone sees or unfurls.)
  const refused = await (await fetch(`${base}${RESULT}?${query({ ...JUNIPER, name: "Taylor Swift" }, DEX)}`, { headers: ADULT })).text();
  const markup = refused.replace(/<script[\s\S]*?<\/script>/g, "");
  assert(!/data-score=/.test(markup), "a real person's name got a score");
  assert(/<meta name="robots" content="noindex/.test(markup), "a refused pair was indexable");
  assert(!/swift/i.test(markup), "a refused name was echoed in the page or its tags");
  assert(markup.includes("Characters must be original: no real people."), "a refused name didn't get /create's message");
  console.log(`checks passed: 200 on ${TOOL} with its <title>, in sitemap.xml, the same result twice (${first}), 3 reasons, og:title and share card, /create prefilled, a real person refused`);
}

/** Scrolls `selector` to the top of the viewport, just under the sticky site header. */
async function scrollToTop(page, selector) {
  await page.evaluate((sel) => {
    const header = document.querySelector(".site-header")?.getBoundingClientRect().height ?? 0;
    const el = document.querySelector(sel);
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - header - 12);
  }, selector);
}

async function fill(page, side, sheet) {
  await page.locator(`input[name="${side}_name"]`).fill(sheet.name);
  for (const [i, trait] of sheet.traits.entries()) await page.locator(`input[name="${side}_trait${i + 1}"]`).fill(trait);
  await page.locator(`input[name="${side}_want"]`).fill(sheet.want);
  await page.locator(`input[name="${side}_dealbreaker"]`).fill(sheet.dealbreaker);
}

async function shoot(base) {
  const { chromium, devices } = require("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const host = new URL(base).hostname;
  try {
    for (const [label, ctxOpts] of [["desktop", { viewport: { width: 1280, height: 800 } }], ["mobile", devices["iPhone 13"]]]) {
      const ctx = await browser.newContext(ctxOpts);
      await ctx.addCookies([{ name: "bz_adult", value: "1", domain: host, path: "/" }]);
      const page = await ctx.newPage();

      // The tool, with two sample characters typed in.
      await page.goto(`${base}${TOOL}`, { waitUntil: "networkidle" });
      await fill(page, "a", JUNIPER);
      await fill(page, "b", DEX);
      // A phone shows the first character's filled-in fields; a desktop has the heading and both characters in view.
      if (label === "mobile") await scrollToTop(page, ".chem-form");
      await page.screenshot({ path: join(OUT_DIR, `chemistry-test-${label}.png`) });

      // Submitting lands on the pair's own address: the score, the ending and three reasons.
      await Promise.all([page.waitForURL(/\/tools\/oc-chemistry-test\/result\?/), page.getByRole("button", { name: "Test their chemistry" }).click()]);
      await page.waitForLoadState("networkidle");
      assert((await page.locator("[data-reason]").count()) === 3, "the result page doesn't show 3 reasons");
      await page.screenshot({ path: join(OUT_DIR, `chemistry-result-${label}.png`) });

      // "Watch the real date" opens the builder with Juniper's fields in and Dex's alongside.
      await Promise.all([page.waitForURL(/\/create\?a_name=Juniper/), page.getByRole("link", { name: "Watch the real date" }).click()]);
      const name = page.locator('input[name="name"]');
      await name.waitFor();
      await page.waitForLoadState("networkidle");
      assert((await name.inputValue()) === "Juniper", `/create opened with "${await name.inputValue()}"`);
      assert((await page.locator('input[name="trait3"]').inputValue()) === "dry-witted", "/create didn't take Juniper's traits");
      // The desktop shot shows Juniper's fields filled in the builder; the phone shot, the card with Dex's beside them.
      await scrollToTop(page, label === "desktop" ? ".wizard-step" : ".pair-prefill");
      await page.screenshot({ path: join(OUT_DIR, `chemistry-create-${label}.png`) });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("set CHROMIUM_PATH to a Chrome/Chromium binary");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
  build();
  const port = await freePort();
  const app = await startApp(port, noModelEnv());
  try {
    await check(app.base);
    await shoot(app.base);
    console.log("screenshots written to docs/screenshots/chemistry-*.png");
  } finally {
    await stopApp(app);
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

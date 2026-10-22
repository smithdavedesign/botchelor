#!/usr/bin/env node
/**
 * npm run screenshots:chemistry — visual proof of the OC chemistry test (lib/chemistry.ts). Builds the app and starts
 * the production build on a throwaway local database with every model variable removed (the test never calls a
 * model). Over HTTP it checks the tool answers 200 with "Chemistry Test" in its <title>, sitemap.xml lists it, the
 * same two sheets get the same score and ending twice, the result's og:title has both names and its one og:image is a
 * PNG card, a real person is refused with /create's message, and the home page and /create's footer link both tools.
 * Then it drives Chromium like a visitor: the tool with two sample sheets typed in, the result, and its "Watch the real
 * date" link into /create with the first sheet filled in. Desktop (1280×800) and iPhone 13, viewport only, into
 * docs/screenshots/chemistry-*.png.
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

// Two invented OCs (the form's own placeholders).
const MIRA = { name: "Mira Quell", age: "29", trait1: "curious", trait2: "stubborn", trait3: "witty", want: "Someone who gets lost on purpose", dealbreaker: "People glued to their phone" };
const OTTO = { name: "Otto Brand", age: "34", trait1: "bold", trait2: "warm", trait3: "funny", want: "A curious mind", dealbreaker: "Arrogance" };
const FIELDS = ["name", "age", "trait1", "trait2", "trait3", "want", "dealbreaker"];
const query = (a, b) => new URLSearchParams([...FIELDS.map((f) => [`a_${f}`, a[f]]), ...FIELDS.map((f) => [`b_${f}`, b[f]])]).toString();

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

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

/** The acceptance checks over HTTP, against the real production build. */
async function check(base) {
  const tool = await fetch(`${base}${TOOL}`, { headers: ADULT, redirect: "manual" });
  assert(tool.status === 200, `${TOOL} answered ${tool.status}`);
  const toolHtml = await tool.text();
  assert(/<title>[^<]*Chemistry Test/.test(toolHtml), `${TOOL} has no "Chemistry Test" in its <title>`);
  const inputs = [...toolHtml.matchAll(/<input[^>]*name="([ab]_[a-z0-9]+)"/g)].map((m) => m[1]);
  assert(inputs.length === 14, `${TOOL} has ${inputs.length} sheet inputs, not 14`);

  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  assert(sitemap.includes(TOOL), "sitemap.xml doesn't list the tool");

  let html = "";
  const result = async () => {
    const res = await fetch(`${base}${RESULT}?${query(MIRA, OTTO)}`, { headers: ADULT });
    assert(res.status === 200, `the result answered ${res.status}`);
    html = await res.text();
    return { score: html.match(/data-chemistry-score="(\d+)"/)?.[1], ending: html.match(/data-chemistry-ending="([a-z_]+)"/)?.[1] };
  };
  const first = await result();
  const again = await result();
  assert(first.score !== undefined && first.ending, "the result shows no score or ending");
  assert(JSON.stringify(first) === JSON.stringify(again), "the result changed on reload");
  assert((html.match(/data-reason=""/g) ?? []).length === 3, "the result doesn't show three reasons");

  // The link preview: an og:title with both names, and exactly one og:image, this result's card (served on this host,
  // whatever the production address in the tag).
  assert(/property="og:title" content="[^"]*Mira Quell[^"]*Otto Brand/.test(html), "no og:title with both names");
  const images = [...html.matchAll(/property="og:image" content="([^"]+)"/g)].map((m) => decode(m[1]));
  assert(images.length === 1 && new URL(images[0], base).pathname === "/api/og/chemistry", `og:image is ${JSON.stringify(images)}`);
  const cardUrl = new URL(images[0], base);
  const card = await fetch(`${base}${cardUrl.pathname}${cardUrl.search}`);
  assert(card.status === 200 && card.headers.get("content-type") === "image/png", `the share card answered ${card.status}`);
  const watch = decode(html.match(/href="(\/create\?[^"]+)"[^>]*>Watch the real date</)?.[1] ?? "");
  assert(watch.startsWith("/create?a_name=Mira"), `"Watch the real date" goes to ${watch}`);

  const blocked = await (await fetch(`${base}${RESULT}?${query(MIRA, { ...OTTO, name: "Taylor Swift" })}`, { headers: ADULT })).text();
  assert(!/data-chemistry-score=/.test(blocked) && /noindex/.test(blocked), "a real person got a score, or was indexable");
  // What the page shows (its address is in Next's router data, in a script: it's what the visitor typed into the bar).
  const shown = blocked.replace(/<script[\s\S]*?<\/script>/g, "");
  assert(shown.includes("Characters must be original: no real people.") && !/swift/i.test(shown), "a real person wasn't refused with /create's message, or was echoed");

  for (const page of ["/", "/create"]) {
    const body = await (await fetch(`${base}${page}`, { headers: ADULT })).text();
    assert(body.includes(`href="${TOOL}"`) && body.includes('href="/tools/ship-name-generator"'), `${page} doesn't link both tools`);
  }
  console.log(`checks passed: 200 on ${TOOL}, in sitemap.xml, the same ${first.score}/100 (${first.ending}) twice, og:title and one share card, a real person refused, both tools linked from / and /create`);
}

async function fillSheet(page, side, sheet) {
  for (const f of FIELDS) await page.locator(`input[name="${side}_${f}"]`).first().fill(sheet[f]);
}

/** Scrolls `selector` to just under the sticky site header. */
async function scrollUnderHeader(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const header = document.querySelector(".site-header");
    if (!el) throw new Error(`no ${sel} on the page`);
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (header?.getBoundingClientRect().height ?? 0) - 12);
  }, selector);
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

      // The tool, with two sample sheets typed in.
      await page.goto(`${base}${TOOL}`, { waitUntil: "networkidle" });
      await fillSheet(page, "a", MIRA);
      await fillSheet(page, "b", OTTO);
      await scrollUnderHeader(page, ".chem-tool h1");
      await page.screenshot({ path: join(OUT_DIR, `chemistry-tool-${label}.png`) });

      // Submitting lands on the result's own address: the score, the ending and three reasons.
      await Promise.all([page.waitForURL((url) => url.pathname === RESULT), page.getByRole("button", { name: "Test their chemistry" }).click()]);
      await page.waitForLoadState("networkidle");
      assert((await page.locator("[data-reason]").count()) === 3, "the result page doesn't show three reasons");
      await page.screenshot({ path: join(OUT_DIR, `chemistry-result-${label}.png`) });

      // "Watch the real date" opens /create with Mira's sheet in, and Otto's one click away.
      await Promise.all([page.waitForURL((url) => url.pathname === "/create"), page.getByRole("link", { name: "Watch the real date" }).click()]);
      const name = page.locator('input[name="name"]');
      await name.waitFor();
      await page.waitForLoadState("networkidle");
      assert((await name.inputValue()) === MIRA.name, `/create opened with "${await name.inputValue()}"`);
      assert((await page.locator('input[name="trait1"]').inputValue()) === MIRA.trait1, "/create's first trait isn't Mira's");
      assert((await page.locator('input[name="dealbreaker"]').inputValue()) === MIRA.dealbreaker, "/create's dealbreaker isn't Mira's");
      await scrollUnderHeader(page, ".chem-from");
      await page.screenshot({ path: join(OUT_DIR, `chemistry-create-${label}.png`) });

      // The note's other link builds Otto instead (checked, not captured).
      await Promise.all([page.waitForURL((url) => url.searchParams.get("a_name") === OTTO.name), page.getByRole("link", { name: `Build ${OTTO.name} instead` }).click()]);
      await page.waitForFunction(() => document.querySelector('input[name="name"]')?.value === "Otto Brand");
      assert((await page.locator('input[name="want"]').inputValue()) === OTTO.want, "building Otto didn't bring Otto's want");
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

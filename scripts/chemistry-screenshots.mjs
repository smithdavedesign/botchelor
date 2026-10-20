#!/usr/bin/env node
/**
 * npm run screenshots:chemistry — visual proof of the OC chemistry test (lib/chemistry-test.ts). Builds the app and
 * starts the production build on a throwaway local database with every model variable removed (the test never calls a
 * model). It checks over HTTP that the tool answers 200 with "Chemistry Test" in its <title>, that sitemap.xml lists it,
 * that a result shows the same score, ending and three reasons on every load with both names in its og:title and its
 * own share card, that a real person's name is refused with /create's message, and that the footer on / and /create
 * links both free tools. Then it drives Chromium like a visitor: the tool with the sample pair typed in, the result,
 * and its "Watch the real date" link into /create with the first sheet filled in. Desktop (1280×800) and iPhone 13,
 * viewport only, into docs/screenshots/chemistry-*.png.
 *
 * Sample characters only (lib/chemistry-test.ts SAMPLE_PAIR), no key, no real infrastructure. Chromium comes from
 * CHROMIUM_PATH; no browser is downloaded.
 */
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { appEnv, build, freePort, ROOT, startApp, stopApp } from "./harness.mjs";

const require = createRequire(join(ROOT, "package.json"));
const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "chemistry-screenshots");
const TOOL = "/tools/oc-chemistry-test";
const ADULT = { cookie: "bz_adult=1" }; // past the 18+ gate, as a visitor who confirmed
const GOOGLEBOT = { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" };
const REFUSED = "Characters must be original: no real people.";

// The worked example (lib/chemistry-test.ts SAMPLE_PAIR), as a visitor types it.
const SAMPLE = {
  a: { name: "Odessa Crane", trait1: "curious", trait2: "deadpan", trait3: "night owl", want: "Someone who stays up for the meteor shower", dealbreaker: "Spoiling the end of a mystery novel" },
  b: { name: "Fitz Harlow", trait1: "warm", trait2: "witty", trait3: "meteor chaser", want: "A date who is curious about everything", dealbreaker: "Flaky plans" },
};
const query = (sides) => new URLSearchParams(Object.entries(sides).flatMap(([side, s]) => Object.entries(s).map(([k, v]) => [`${side}_${k}`, v]))).toString();
const RESULT = `${TOOL}/result?${query(SAMPLE)}`;

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

/** Scrolls an element to the top of the viewport, below the sticky site header. */
const toTop = (locator) =>
  locator.evaluate((el) => {
    el.scrollIntoView({ block: "start" });
    window.scrollBy(0, -((document.querySelector(".site-header")?.getBoundingClientRect().height ?? 0) + 12));
  });

const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

/** The acceptance checks over HTTP, against the real production build. */
async function check(base) {
  for (const headers of [ADULT, GOOGLEBOT]) {
    const tool = await fetch(`${base}${TOOL}`, { headers, redirect: "manual" });
    assert(tool.status === 200, `${TOOL} answered ${tool.status}`);
    const html = await tool.text();
    assert(/<title>[^<]*Chemistry Test[^<]*<\/title>/.test(html), `${TOOL} has no <title> with "Chemistry Test"`);
    assert((html.match(/<input[^>]*name="[ab]_(name|trait[123]|want|dealbreaker)"/g) ?? []).length === 12, `${TOOL} doesn't have the 12 fields`);
  }

  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  assert(sitemap.includes(TOOL), "sitemap.xml doesn't list the tool");

  let html = "";
  const verdict = async () => {
    const res = await fetch(`${base}${RESULT}`, { headers: ADULT });
    assert(res.status === 200, `the result answered ${res.status}`);
    html = unescape(await res.text());
    const score = html.match(/data-score="(\d+)"/)?.[1];
    const ending = html.match(/data-ending="([a-z_]+)"/)?.[1];
    const reasons = [...html.matchAll(/<li[^>]*data-reason[^>]*>(.*?)<\/li>/g)].map((m) => m[1]);
    return { score, ending, reasons };
  };
  const first = await verdict();
  const again = await verdict();
  assert(first.score && ["second_date", "friends", "disaster"].includes(first.ending), `no score or ending: ${JSON.stringify(first)}`);
  assert(first.reasons.length === 3, `${first.reasons.length} reasons`);
  assert(JSON.stringify(first) === JSON.stringify(again), "the result changed on reload");
  assert(html.includes("Odessa Crane × Fitz Harlow"), "the result doesn't show both names");

  // The link preview: an og:title with both names, and its own share card (served on this host, whatever the production
  // address in the tag). Kept out of search.
  assert(/property="og:title" content="[^"]*Odessa Crane[^"]*Fitz Harlow/.test(html), "no og:title with both names");
  assert(/name="robots" content="noindex, follow"/.test(html), "the result isn't noindex");
  const image = html.match(/property="og:image" content="([^"]+)"/)?.[1];
  assert(image?.includes("/api/chemistry-card?"), `og:image is ${image}`);
  const card = await fetch(`${base}${new URL(image, base).pathname}${new URL(image, base).search}`);
  assert(card.status === 200 && card.headers.get("content-type") === "image/png", `the share card answered ${card.status}`);

  // "Watch the real date" opens /create with the first sheet in and the second one next.
  const create = html.match(/<a[^>]*href="(\/create\?[^"]+)"[^>]*>Watch the real date<\/a>/)?.[1];
  assert(create && new URLSearchParams(create.split("?")[1]).get("with_name") === "Fitz Harlow", `"Watch the real date" goes to ${create}`);

  // A real person is refused with /create's own words, and nothing of it is echoed.
  const refused = unescape(await (await fetch(`${base}${TOOL}/result?${query({ ...SAMPLE, a: { ...SAMPLE.a, name: "Taylor Swift" } })}`, { headers: ADULT })).text());
  assert(refused.includes(REFUSED) && !/data-score=/.test(refused) && !/taylor swift/i.test(refused), "a real person's name was tested, or echoed");

  // Both tools in the footer, on the home page and on /create.
  for (const path of ["/", "/create"]) {
    const page = await (await fetch(`${base}${path}`, { headers: ADULT })).text();
    const footer = page.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
    assert(footer.includes(`href="${TOOL}"`) && footer.includes('href="/tools/ship-name-generator"'), `${path}'s footer doesn't link both tools`);
  }
  console.log(
    `checks passed: 200 with "Chemistry Test" in the title, in sitemap.xml, ${first.score}/100 ${first.ending} twice with 3 reasons, og:title and share card, "Watch the real date" to /create, a real person refused, both tools in the footer of / and /create`,
  );
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

      // The tool, with the sample pair typed in.
      await page.goto(`${base}${TOOL}`, { waitUntil: "networkidle" });
      for (const [side, sheet] of Object.entries(SAMPLE)) {
        for (const [field, value] of Object.entries(sheet)) await page.locator(`input[name="${side}_${field}"]`).fill(value);
      }
      // Desktop: the heading over both filled-in sheets. Phone: the first sheet, filled in.
      if (label === "mobile") await toTop(page.locator("fieldset.chem-side").first());
      else await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(OUT_DIR, `chemistry-tool-${label}.png`) });

      // Submitting lands on the result's own address.
      await Promise.all([page.waitForURL(/\/tools\/oc-chemistry-test\/result\?/), page.getByRole("button", { name: "Test their chemistry" }).click()]);
      await page.waitForLoadState("networkidle");
      assert((await page.locator("[data-reason]").count()) === 3, "the result page doesn't show 3 reasons");
      await page.screenshot({ path: join(OUT_DIR, `chemistry-result-${label}.png`) });

      // It ends one click from /create, with Odessa's sheet in.
      await Promise.all([page.waitForURL(/\/create\?name=Odessa/), page.getByRole("link", { name: "Watch the real date" }).click()]);
      const name = page.locator('input[name="name"]');
      await name.waitFor();
      await page.waitForLoadState("networkidle");
      assert((await name.inputValue()) === "Odessa Crane", `/create opened with "${await name.inputValue()}"`);
      assert((await page.locator('input[name="trait3"]').inputValue()) === "night owl", "/create's traits weren't filled in");
      assert((await page.locator('input[name="dealbreaker"]').inputValue()) === SAMPLE.a.dealbreaker, "/create's dealbreaker wasn't filled in");
      // Desktop: the chemistry test's note and Odessa's sheet. Phone: the sheet's own fields, filled in.
      if (label === "mobile") await toTop(page.locator(".wizard-preview"));
      else await page.getByRole("link", { name: "Build Fitz next" }).scrollIntoViewIfNeeded();
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

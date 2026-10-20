#!/usr/bin/env node
/**
 * npm run screenshots:ship — visual proof of the OC ship name generator (lib/ship-names.ts). Builds the app and starts
 * the production build on a throwaway local database with every model variable removed (the generator never calls a
 * model). It checks the tool answers 200, sitemap.xml lists it, the form redirects to /ship/juniper/dex and that page
 * shows the same names on every load. Then it drives Chromium like a visitor: the tool with two names typed in, the
 * /ship/juniper/dex result, and its "Send Juniper on a blind date" link into /create with the name already in.
 * Desktop (1280×800) and iPhone 13, viewport only, into docs/screenshots/ship-*.png.
 *
 * Sample names only, no key, no real infrastructure. Chromium comes from CHROMIUM_PATH; no browser is downloaded.
 */
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { appEnv, build, freePort, ROOT, startApp, stopApp } from "./harness.mjs";

const require = createRequire(join(ROOT, "package.json"));
const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "ship-screenshots");
const TOOL = "/tools/ship-name-generator";
const ADULT = { cookie: "bz_adult=1" }; // past the 18+ gate, as a visitor who confirmed

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

/** The acceptance checks over HTTP, against the real production build. */
async function check(base) {
  const tool = await fetch(`${base}${TOOL}`, { headers: ADULT, redirect: "manual" });
  assert(tool.status === 200, `${TOOL} answered ${tool.status}`);
  assert(/<h1[^>]*>[^<]*Ship Name Generator/.test(await tool.text()), `${TOOL} has no "Ship Name Generator" h1`);

  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  assert(sitemap.includes(TOOL), "sitemap.xml doesn't list the tool");

  const submit = await fetch(`${base}/ship?a=Juniper&b=Dex`, { headers: ADULT, redirect: "manual" });
  assert(submit.status === 303 && new URL(submit.headers.get("location") ?? "", base).pathname === "/ship/juniper/dex", `the form went to ${submit.status} ${submit.headers.get("location")}`);

  let html = "";
  const names = async () => {
    const res = await fetch(`${base}/ship/juniper/dex`, { headers: ADULT });
    assert(res.status === 200, `/ship/juniper/dex answered ${res.status}`);
    html = await res.text();
    return [...html.matchAll(/data-ship-name="([^"]+)"/g)].map((m) => m[1]);
  };
  const first = await names();
  const again = await names();
  assert(first.length >= 5, `only ${first.length} ship names`);
  assert(JSON.stringify(first) === JSON.stringify(again), "the names changed on reload");

  // The link preview: an og:title with both names, and its own share card (served on this host, whatever the
  // production address in the tag).
  assert(/property="og:title" content="[^"]*Juniper[^"]*Dex/.test(html), "no og:title with both names");
  const image = html.match(/property="og:image" content="([^"]+)"/)?.[1];
  assert(image, "no og:image");
  const card = await fetch(`${base}${new URL(image, base).pathname}`);
  assert(card.status === 200 && card.headers.get("content-type") === "image/png", `the share card answered ${card.status}`);

  const blocked = await (await fetch(`${base}/ship/elon-musk/dex`, { headers: ADULT })).text();
  assert(!/data-ship-name=/.test(blocked) && /noindex/.test(blocked), "a real person's name made ship names, or was indexable");
  console.log(`checks passed: 200 on ${TOOL}, in sitemap.xml, 303 to /ship/juniper/dex, the same ${first.length} names twice (${first.slice(0, 3).join(", ")}…), og:title and share card, a real person refused`);
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

      // The tool, with two sample names typed in.
      await page.goto(`${base}${TOOL}`, { waitUntil: "networkidle" });
      await page.getByLabel("First name").fill("Juniper");
      await page.getByLabel("Second name").fill("Dex");
      await page.screenshot({ path: join(OUT_DIR, `ship-tool-${label}.png`) });

      // Submitting lands on the pair's own address.
      await Promise.all([page.waitForURL(/\/ship\/juniper\/dex$/), page.getByRole("button", { name: "Make ship names" }).click()]);
      await page.waitForLoadState("networkidle");
      assert((await page.locator("[data-ship-name]").count()) >= 5, "the result page shows fewer than 5 names");
      await page.screenshot({ path: join(OUT_DIR, `ship-result-${label}.png`) });

      // It ends one click from /create, with the first name in.
      await Promise.all([page.waitForURL(/\/create\?name=Juniper$/), page.getByRole("link", { name: "Send Juniper on a blind date" }).click()]);
      const name = page.locator('input[name="name"]');
      await name.waitFor();
      await page.waitForLoadState("networkidle");
      assert((await name.inputValue()) === "Juniper", `/create opened with "${await name.inputValue()}"`);
      await name.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(OUT_DIR, `ship-create-${label}.png`) });
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
    console.log("screenshots written to docs/screenshots/ship-*.png");
  } finally {
    await stopApp(app);
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

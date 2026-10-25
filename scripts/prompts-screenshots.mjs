#!/usr/bin/env node
/**
 * npm run screenshots:prompts — visual proof of the prompts library (app/prompts, lib/prompts-library.ts). Builds the
 * app and starts the production build on a throwaway local database with every model variable removed (the library
 * never calls a model). It checks /prompts answers 200 with one page of prompts, sitemap.xml lists it, a search and a
 * dataset filter narrow it, and the footer links it. Then it drives Chromium like a visitor: the library, a search
 * typed and sent, and a prompt copied. Desktop (1280×800) and iPhone 13, viewport only, into
 * docs/screenshots/prompts-*.png.
 *
 * No key, no real infrastructure. Chromium comes from CHROMIUM_PATH; no browser is downloaded.
 */
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { appEnv, build, freePort, ROOT, startApp, stopApp } from "./harness.mjs";

const require = createRequire(join(ROOT, "package.json"));
const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "prompts-screenshots");
const PAGE = "/prompts";
const ADULT = { cookie: "bz_adult=1" }; // past the 18+ gate, as a visitor who confirmed
const items = (html) => html.match(/class="prompt-item"/g)?.length ?? 0;

/** The harness's environment with no model at all: nothing on this page may need one. */
function noModelEnv() {
  const env = appEnv(9, DATA_DIR);
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
  const res = await fetch(`${base}${PAGE}`, { headers: ADULT, redirect: "manual" });
  assert(res.status === 200, `${PAGE} answered ${res.status}`);
  const html = await res.text();
  assert(/<h1[^>]*>Prompts library<\/h1>/.test(html), `${PAGE} has no "Prompts library" h1`);
  assert(items(html) === 24, `${PAGE} shows ${items(html)} prompts, not 24`);
  assert(html.includes('href="/prompts"') && html.includes("Prompts library</a>"), "the footer doesn't link the library");

  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  assert(sitemap.includes(PAGE), "sitemap.xml doesn't list the library");

  const searched = await (await fetch(`${base}${PAGE}?q=astronaut`, { headers: ADULT })).text();
  const total = (h) => Number(h.match(/id="prompts-count"[^>]*>([\d,]+)/)?.[1].replace(",", "") ?? 0);
  assert(total(searched) > 0 && total(searched) < 2000, `a search found ${total(searched)}`);
  const filtered = await (await fetch(`${base}${PAGE}?source=pickapic`, { headers: ADULT })).text();
  assert(total(filtered) > 0 && total(filtered) < 2000 && /Pick-a-Pic · MIT/.test(filtered), "the dataset filter didn't narrow to Pick-a-Pic");
  console.log(`checks passed: 200 on ${PAGE} with 24 prompts, in sitemap.xml, footer link, "astronaut" → ${total(searched)}, Pick-a-Pic → ${total(filtered)}`);
}

async function shoot(base) {
  const { chromium, devices } = require("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const host = new URL(base).hostname;
  try {
    for (const [label, ctxOpts] of [["desktop", { viewport: { width: 1280, height: 800 } }], ["mobile", devices["iPhone 13"]]]) {
      const ctx = await browser.newContext(ctxOpts);
      await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
      await ctx.addCookies([{ name: "bz_adult", value: "1", domain: host, path: "/" }]);
      const page = await ctx.newPage();

      await page.goto(`${base}${PAGE}`, { waitUntil: "networkidle" });
      await page.screenshot({ path: join(OUT_DIR, `prompts-library-${label}.png`) });

      // A search, sent with the button, lands on its own address.
      await page.getByLabel("Search", { exact: true }).fill("red hair");
      await Promise.all([page.waitForURL(/\?q=red\+hair/), page.getByRole("button", { name: "Search" }).click()]);
      await page.waitForLoadState("networkidle");
      assert((await page.locator(".prompt-item").count()) > 0, "the search shows no prompts");

      // Copy the first one.
      const first = page.locator(".prompt-item").first();
      await first.getByRole("button", { name: "Copy" }).click();
      await first.getByRole("button", { name: "Copied" }).waitFor();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assert(copied === (await first.locator(".prompt-text").innerText()), "the clipboard doesn't hold the prompt");
      await page.locator("#prompts").scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(OUT_DIR, `prompts-search-${label}.png`) });
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
    console.log("screenshots written to docs/screenshots/prompts-*.png");
  } finally {
    await stopApp(app);
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

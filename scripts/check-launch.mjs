#!/usr/bin/env node
/**
 * npm run check:launch: the launch checks (LAUNCH-READY.md) against the real production build, as a crawler sees it.
 * Builds the app (SKIP_BUILD=1 or --skip-build reuses .next), starts it on loopback with a throwaway local database,
 * and checks:
 *
 *  - robots.txt allows indexing and names the sitemap; sitemap.xml lists the public pages;
 *  - every page in the sitemap's static part has its own <title> and meta description, a canonical URL, Open Graph and
 *    Twitter card tags with a 1200×630 PNG share image, the SoftwareApplication JSON-LD with its $4 offer, and the
 *    footer's /privacy and /terms links;
 *  - the shop shows a Buy button with a payment link set, and none without one (a second, short-lived start).
 *
 * No real infrastructure: the app gets a sample payment link and nothing else (scripts/harness.mjs appEnv).
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { appEnv, build, freePort, ROOT, startApp, stopApp } from "./harness.mjs";

const DATA_DIR = join(ROOT, ".data", "check-launch");
// A crawler, as search engines and link previews arrive: Next puts the metadata in <head> for them.
const CRAWLER = { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", cookie: "bz_adult=1" };

const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  return ok;
};

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const tag = (html, re) => {
  const m = re.exec(html);
  return m ? decode(m[1]) : null;
};
const metaContent = (html, attr, name) => tag(html, new RegExp(`<meta ${attr}="${name.replace(/[:.]/g, "\\$&")}" content="([^"]*)"`));

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(buf) {
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return png ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null;
}

async function get(base, path) {
  const res = await fetch(base + path, { headers: CRAWLER, redirect: "manual" });
  return { status: res.status, type: res.headers.get("content-type") ?? "", body: Buffer.from(await res.arrayBuffer()) };
}

async function checkSite(base) {
  const robots = (await get(base, "/robots.txt")).body.toString();
  check(/User-Agent: \*\n(?:.*\n)*?Allow: \/\n/.test(robots), "robots.txt: Allow: / for every crawler");
  check(!/^Disallow: \/$/m.test(robots), "robots.txt: nothing disallows the whole site");
  // robots.txt is prerendered, so its sitemap address is the build's SITE_URL (DigitalOcean sets it at build time too).
  const sitemapLine = /^Sitemap: (https?:\/\/\S+\/sitemap\.xml)$/m.exec(robots)?.[1];
  check(Boolean(sitemapLine), "robots.txt: names the sitemap");

  const sitemap = (await get(base, "/sitemap.xml")).body.toString();
  const pages = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1]).slice(base.length) || "/");
  // The static part only: the database is a fresh, empty one, and characters and episodes are checked by their own tests.
  const publicPages = pages.filter((p) => !/^\/(characters|episodes|couples)\/./.test(p));
  check(publicPages.length >= 20, `sitemap.xml: lists the public pages (found ${publicPages.length})`);
  for (const p of ["/", "/privacy", "/terms", "/shop", "/create"]) check(publicPages.includes(p), `sitemap.xml: lists ${p}`);

  const titles = new Map();
  const descriptions = new Map();
  const images = new Set();
  for (const path of publicPages) {
    const page = await get(base, path);
    if (!check(page.status === 200, `${path}: HTTP ${page.status}`)) continue;
    const html = page.body.toString();
    const title = tag(html, /<title>([^<]*)<\/title>/);
    const description = metaContent(html, "name", "description");
    check(Boolean(title) && !titles.has(title), `${path}: a <title> of its own (${title} also on ${titles.get(title)})`);
    check(Boolean(description) && !descriptions.has(description), `${path}: a description of its own (also on ${descriptions.get(description)})`);
    titles.set(title, path);
    descriptions.set(description, path);
    // Next writes the home page's address without its trailing slash.
    const canonical = path === "/" ? base : base + path;
    check(tag(html, /<link rel="canonical" href="([^"]*)"/) === canonical, `${path}: canonical is ${canonical}`);
    for (const og of ["og:title", "og:description", "og:url", "og:image", "og:type", "og:site_name"]) {
      check(Boolean(metaContent(html, "property", og)), `${path}: ${og}`);
    }
    check(metaContent(html, "property", "og:url") === canonical, `${path}: og:url is the canonical`);
    check(metaContent(html, "name", "twitter:card") === "summary_large_image", `${path}: twitter:card summary_large_image`);
    check(Boolean(metaContent(html, "name", "twitter:image")), `${path}: twitter:image`);
    const image = metaContent(html, "property", "og:image");
    if (image) images.add(image);
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const app = ld
      .flatMap((j) => [JSON.parse(j)].flat())
      .flatMap((d) => d["@graph"] ?? [d])
      .find((n) => n["@type"] === "SoftwareApplication");
    check(Boolean(app), `${path}: SoftwareApplication JSON-LD`);
    check(Boolean(app?.offers?.some((o) => o.price === "4.00" && o.priceCurrency === "USD")), `${path}: JSON-LD Offer for $4`);
    check(html.includes('href="/privacy"') && html.includes('href="/terms"'), `${path}: footer links /privacy and /terms`);
  }

  // Every share image a page names is a real 1200×630 PNG.
  for (const image of images) {
    const res = await get(base, new URL(image).pathname + new URL(image).search);
    const size = pngSize(res.body);
    check(res.status === 200 && size?.width === 1200 && size?.height === 630, `${image}: a 1200×630 PNG (got ${res.status}, ${JSON.stringify(size)})`);
  }

  check(buyButton((await get(base, "/shop")).body.toString()), "/shop: a Buy button while STRIPE_PAYMENT_LINK is set");
  return { pages: publicPages.length, images: images.size, sitemapLine };
}

/** The shop's Buy form: its 18+ and terms checkbox and the price label (the feedback form has a submit button too). */
function buyButton(html) {
  return html.includes('name="attest"') && /<button type="submit"[^>]*>[^<]*\$4/.test(html);
}

async function main() {
  if (!DATA_DIR.startsWith(join(ROOT, ".data"))) throw new Error("refusing to use a data directory outside .data/");
  rmSync(DATA_DIR, { recursive: true, force: true });
  if (process.env.SKIP_BUILD !== "1" && !process.argv.includes("--skip-build")) build();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  // No model is called: a closed loopback port stands in for the showrunner. SITE_URL makes canonical URLs this server's.
  // No SESSION_SECRET: with accounts on, a signed-out crawler is asked to sign in before the Buy button shows.
  const { SESSION_SECRET: _secret, ...harness } = appEnv(9, DATA_DIR);
  const env = { ...harness, SITE_URL: base };
  let app;
  try {
    app = await startApp(port, env);
    const { pages, images, sitemapLine } = await checkSite(base);
    await stopApp(app);

    // The same build without a payment link: the shop has no Buy button at all.
    const { STRIPE_PAYMENT_LINK: _link, STRIPE_PRICE_LABEL: _label, ...unpaid } = env;
    app = await startApp(port, unpaid);
    const shop = (await get(base, "/shop")).body.toString();
    check(!buyButton(shop) && !shop.includes('name="attest"') && shop.includes("Purchases open soon"), "/shop: no Buy button without STRIPE_PAYMENT_LINK");
    console.log(`Checked ${pages} public pages and ${images} share image(s) on ${base}; robots.txt names ${sitemapLine}.`);
  } finally {
    await stopApp(app);
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
  if (failures.length) {
    console.error(`${failures.length} launch check(s) failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log("All launch checks passed.");
}

main().catch((err) => {
  console.error(`check:launch failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

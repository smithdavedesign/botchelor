#!/usr/bin/env node
/**
 * npm run screenshots:share: proof of the episode share card (GROWTH.md, 2026-10-21). Builds the app and starts the
 * production build on a throwaway local database, with the harness's stand-in showrunner (no key). A sample creator
 * makes Mira Quell and sends her on a date with Rafe Calloway, a house character.
 *
 * It checks over HTTP, the way Reddit, Discord and Bluesky would fetch it:
 * - /api/og/episode/<id> is a 1200×630 PNG, and an unknown id is a 404;
 * - the page's head, as each fetcher gets it, has og:image on that card, twitter:card summary_large_image and an
 *   og:description with "Guess how it ends" and neither the ending nor the creator's name;
 * - a person without the 18+ cookie is sent to the gate with ?ref=share kept.
 *
 * Then Chromium, as a logged-out visitor who passed the gate, opens the shared link (?ref=share): "Make your own
 * character" must be inside the first screen, the share links must all carry ?ref=share, and the button must lead to
 * /create. Desktop (1280×800) and iPhone 13, viewport only, into docs/screenshots/share-*.png, plus the card itself.
 *
 * Sample data only, no key, no real infrastructure. Chromium comes from CHROMIUM_PATH; no browser is downloaded.
 */
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appEnv, build, CAST, client, freePort, persona, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const require = createRequire(join(ROOT, "package.json"));
const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "share-screenshots");
const ENDING_LABELS = { second_date: "A second date", friends: "Just friends", disaster: "A disaster" };
const FETCHERS = {
  reddit: "Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)",
  discord: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  bluesky: "Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)",
};
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

const unescape = (s) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/** A meta tag's content in `html` (property= or name=), or undefined. */
const metaTag = (html, key) => {
  const tag = html.match(new RegExp(`<meta[^>]*(?:property|name)="${key}"[^>]*>`))?.[0];
  const content = tag?.match(/content="([^"]*)"/)?.[1];
  return content === undefined ? undefined : unescape(content);
};

/** A sample creator, their OC and one unaired date with a house character, made over HTTP like the UI would. */
async function seed(base) {
  const call = client(base);
  const creator = persona();
  await call("/api/profile", { name: "Wren", attest: true }, creator);
  const { soul: _soul, ...mira } = CAST[0];
  const character = await call("/api/characters", { ...mira, attest: true, keep_name: true }, creator);
  const episode = await call("/api/episodes", { character_id: character.id, partner_id: "house-rafe" }, creator);
  assert(episode.id && episode.ending, "the date wasn't made");
  // Two long names (a three-line title on a phone), to check the button still makes the first screen.
  const { soul: _soul2, ...emrys } = CAST.find((c) => c.name === "Emrys Nakamura-Pine");
  const long = await call("/api/characters", { ...emrys, attest: true, keep_name: true }, creator);
  const longEpisode = await call("/api/episodes", { character_id: long.id, partner_id: "house-perpetua" }, creator);
  return { creator, episode, longEpisode, creatorName: "Wren" };
}

/** Throws unless "Make your own character" is wholly inside the first screen. */
async function expectAboveTheFold(page, what) {
  const box = await page.getByRole("link", { name: "Make your own character" }).boundingBox();
  const { height } = page.viewportSize();
  assert(box && box.y >= 0 && box.y + box.height <= height, `${what}: "Make your own character" is at ${JSON.stringify(box)}, outside the ${height}px screen`);
  return Math.round(height - (box.y + box.height));
}

/** The acceptance checks over HTTP, against the production build. Returns the card's PNG. */
async function check(base, { episode, creatorName }) {
  const cardPath = `/api/og/episode/${episode.id}`;
  const card = await fetch(`${base}${cardPath}`);
  assert(card.status === 200 && card.headers.get("content-type") === "image/png", `the card answered ${card.status} ${card.headers.get("content-type")}`);
  const png = Buffer.from(await card.arrayBuffer());
  assert(png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630, `the card is ${png.readUInt32BE(16)}×${png.readUInt32BE(20)}`);
  assert((await fetch(`${base}/api/og/episode/no-such-episode`)).status === 404, "an unknown episode's card wasn't a 404");

  const where = {};
  for (const [name, ua] of Object.entries(FETCHERS)) {
    const res = await fetch(`${base}/episodes/${episode.id}?ref=share`, { headers: { "user-agent": ua }, redirect: "manual" });
    assert(res.status === 200, `${name}'s fetcher got ${res.status} (the 18+ gate?)`);
    const html = await res.text();
    const head = html.slice(0, html.indexOf("</head>"));
    where[name] = metaTag(head, "og:image") ? "head" : "body";
    const image = metaTag(html, "og:image");
    assert(image && new URL(image, base).pathname === cardPath, `${name}: og:image is ${image}`);
    const images = html.match(/<meta[^>]*property="og:image"[^>]*>/g) ?? [];
    assert(images.length === 1, `${name}: ${images.length} og:image tags (the box score card's too?)`);
    assert(metaTag(html, "twitter:card") === "summary_large_image", `${name}: twitter:card is ${metaTag(html, "twitter:card")}`);
    const description = metaTag(html, "og:description") ?? "";
    assert(description.includes("Guess how it ends"), `${name}: og:description is "${description}"`);
    for (const word of [episode.ending, ENDING_LABELS[episode.ending]]) {
      assert(!description.toLowerCase().includes(word.toLowerCase()), `${name}: og:description gives away the ending (${word})`);
    }
    const tags = [...html.matchAll(/<meta[^>]*>/g)].map((m) => m[0]).join("\n");
    assert(!tags.includes(creatorName), `${name}: a meta tag names the creator`);
  }

  const person = await fetch(`${base}/episodes/${episode.id}?ref=share`, { headers: { "user-agent": CHROME }, redirect: "manual" });
  const from = new URL(person.headers.get("location") ?? "/", base).searchParams.get("from");
  assert(person.status === 307 && from === `/episodes/${episode.id}?ref=share`, `a person was sent to ${person.status} ${person.headers.get("location")}`);

  console.log(
    `checks passed: the card is a 1200×630 PNG (404 for an unknown id); og:image, twitter:card and a no-spoiler og:description for ` +
      `${Object.entries(where).map(([n, w]) => `${n} (tags in ${w})`).join(", ")}; the gate keeps ?ref=share`,
  );
  return { png, where };
}

async function shoot(base, episode, longEpisode) {
  const { chromium, devices } = require("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const host = new URL(base).hostname;
  try {
    for (const [label, ctxOpts] of [["desktop", { viewport: { width: 1280, height: 800 } }], ["mobile", devices["iPhone 13"]]]) {
      const ctx = await browser.newContext(ctxOpts);
      // Logged out: past the 18+ gate and nothing else, like someone who followed the link from Reddit.
      await ctx.addCookies([{ name: "bz_adult", value: "1", domain: host, path: "/" }]);
      const page = await ctx.newPage();

      // The long names first: the button must still be in the first screen.
      await page.goto(`${base}/episodes/${longEpisode.id}?ref=share`, { waitUntil: "networkidle" });
      const longRoom = await expectAboveTheFold(page, `${label}, long names`);

      // "Make your own character", inside the first screen.
      await page.goto(`${base}/episodes/${episode.id}?ref=share`, { waitUntil: "networkidle" });
      const cta = page.getByRole("link", { name: "Make your own character" });
      const room = await expectAboveTheFold(page, label);
      console.log(`${label}: "Make your own character" ends ${room}px above the fold (${longRoom}px with long names)`);
      await page.screenshot({ path: join(OUT_DIR, `share-episode-${label}.png`) });

      // The poll and the share links, every one with ?ref=share.
      const poll = page.getByRole("heading", { name: "How does it end?" });
      await poll.evaluate((el) => {
        // Just under the sticky site header, so the heading shows.
        const header = document.querySelector(".site-header")?.getBoundingClientRect().height ?? 0;
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - header - 24);
      });
      const reddit = new URL(await page.getByRole("link", { name: "Share on Reddit" }).getAttribute("href"));
      const bsky = new URL(await page.getByRole("link", { name: "Share on Bluesky" }).getAttribute("href"));
      const copy = await page.getByLabel("Episode link").inputValue();
      const shared = [reddit.searchParams.get("url"), bsky.searchParams.get("text").match(/https?:\/\/\S+/)?.[0], copy];
      for (const url of shared) assert(url && new URL(url).searchParams.get("ref") === "share", `a share link without ?ref=share: ${url}`);
      assert(reddit.hostname === "www.reddit.com" && reddit.pathname === "/submit", `the Reddit link is ${reddit}`);
      assert(bsky.hostname === "bsky.app" && bsky.pathname === "/intent/compose", `the Bluesky link is ${bsky}`);
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(OUT_DIR, `share-links-${label}.png`) });

      // The button leads to the builder.
      if (label === "mobile") {
        await page.evaluate(() => window.scrollTo(0, 0));
        await Promise.all([page.waitForURL(/\/create$/), cta.click()]);
        await page.locator('input[name="name"]').waitFor();
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: join(OUT_DIR, `share-create-${label}.png`) });
      }
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
  const showrunner = await startShowrunner();
  const port = await freePort();
  // SITE_URL: the address the share links and og tags name (lib/site), here this local server.
  const app = await startApp(port, { ...appEnv(showrunner.address().port, DATA_DIR), SITE_URL: `http://127.0.0.1:${port}` });
  try {
    const sample = await seed(app.base);
    const { png } = await check(app.base, sample);
    writeFileSync(join(OUT_DIR, "share-card.png"), png);
    await shoot(app.base, sample.episode, sample.longEpisode);
    console.log("screenshots written to docs/screenshots/share-*.png");
  } finally {
    await stopApp(app);
    showrunner.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

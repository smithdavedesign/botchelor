#!/usr/bin/env node
/**
 * npm run e2e:daily: the Daily Date (lib/daily.ts, /daily) in a real browser, two UTC days running. Builds the app and
 * starts the production build on a throwaway local database with every model variable removed (the Daily Date never
 * calls a model), seeds four sample house-vs-house dates that already aired, and then:
 *
 *  - over HTTP: /daily answers 200 to an adult with no account and to a crawler, shows the day's number, both house
 *    characters and a form with three choices, and carries no ending and no scene past the first in its markup or in
 *    Next's payload; it has an og:title with "Botchelor Daily", sitemap.xml lists it and the home page links it;
 *  - in Chromium: day one's date is called right ("Streak: 1"); then the server is restarted a day later and the
 *    browser's clock is moved on 24 hours (page.clock), the page offers the new day, and calling it right shows
 *    "Streak: 2"; "Copy result" puts a spoiler-free line on the clipboard; /daily/{n} shows yesterday's ending.
 *
 * The server's clock is moved by scripts/fake-clock.mjs (NODE_OPTIONS=--import), not by anything in the app.
 * npm run screenshots:daily is the same run, saving docs/screenshots/daily-*.png (desktop 1280×800 and iPhone 13,
 * viewport only). Sample characters (the house cast) and sample dates only; no key, no real infrastructure. Chromium
 * comes from CHROMIUM_PATH; no browser is downloaded.
 */
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { appEnv, build, freePort, ROOT, startApp, stopApp } from "./harness.mjs";

const require = createRequire(join(ROOT, "package.json"));
const SHOOT = process.argv.includes("--screenshots");
const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "daily-e2e");
const ADULT = "bz_adult=1"; // past the 18+ gate, as a visitor who confirmed; no account
const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const STORAGE_KEY = "botchelor:daily"; // lib/daily-shared.ts DAILY_STORAGE_KEY
const ENDINGS = ["second_date", "friends", "disaster"];
const LABELS = { second_date: "A second date", friends: "Just friends", disaster: "A disaster" };

const DAY_MS = 86_400_000;
const FIRST_DAY_MS = Date.UTC(2026, 9, 25); // Daily Date #1 (lib/daily-shared.ts)
const numberAt = (d) => Math.floor((d.getTime() - FIRST_DAY_MS) / DAY_MS) + 1;
// The two days played: noon UTC tomorrow and the day after, so the run never straddles a midnight by accident and the
// clock only ever moves forward from the real one.
const DAY1 = new Date((Math.floor(Date.now() / DAY_MS) + 1) * DAY_MS + 12 * 3_600_000);
const DAY2 = new Date(DAY1.getTime() + DAY_MS);

/** Four house-vs-house dates that aired, as the lobby stores them (lib/watch.ts createTemplateParty). Sample text. */
const SAMPLE_DATES = [
  {
    a: "house-rafe",
    b: "house-juniper",
    ending: "second_date",
    setting: "A bakery that only opens when it rains, after closing, the ovens still warm and one candle on the counter.",
    goals: ["Rafe wants a verdict on his new tart from someone who won't lie.", "Juniper wants someone who'll sit through a ghost story to the twist."],
    scenes: [
      "Rafe unveils a storm-cloud tart with the ceremony of a royal wedding. Juniper studies it for a long time and says it looks haunted, which he takes as the highest praise there is.",
      "The power cuts out halfway through her story. Rafe reaches for a torch; Juniper tells him to wait for the twist. He waits. He actually waits, and gasps in exactly the right place.",
      "Under the awning, Juniper admits the tart was the best thing she's eaten all year and asks whether it only exists when it rains. Rafe reads Thursday's forecast out loud, hopefully.",
    ],
    twist: "The ghost in Juniper's story turns out to have been a baker, and Rafe needs to know the recipe.",
    finale: "They settle on Thursday, when the rain comes back, and Juniper promises to bring a new ghost.",
    best_line: "You can't rush a good rise, or a good ghost.",
  },
  {
    a: "house-dex",
    b: "house-marisol",
    ending: "friends",
    setting: "A pottery class after hours: two wheels side by side and a radio stuck on the shipping forecast.",
    goals: ["Dex wants an evening with no surprises in it.", "Marisol wants someone who laughs at the wrong moment too."],
    scenes: [
      "Dex shows Marisol how to centre the clay, slowly, the way you'd explain it to a nervous horse. Her bowl collapses and she reads it a short, moving obituary.",
      "The kiln timer goes off like an air horn and Dex is behind the shelves before it stops. Marisol doesn't laugh. She hands him a mug and says the kiln has a dramatic streak.",
      "They glaze each other's lopsided bowls and agree, warmly and at length, that there was no spark, that the bowls are terrible, and that they'll do this again.",
    ],
    twist: "Marisol has already written Dex's obituary, as a joke, and it's the kindest thing anyone has said about him.",
    finale: "They swap numbers for the next pottery night, as friends, and she promises never to read him the obituary.",
    best_line: "Here lies a bowl. It tried.",
  },
  {
    a: "house-teo",
    b: "house-nell",
    ending: "disaster",
    setting: "A museum gala after the doors close, with a string quartet and a dance floor between the dinosaurs.",
    goals: ["Teo wants a partner who leads back.", "Nell wants someone who asks a follow-up question."],
    scenes: [
      "Teo asks Nell to dance before she's finished her sentence about the stegosaurus. She finishes it anyway, on the dance floor, counting the steps under her breath.",
      "Teo hears the counting and stops dead. Nell explains that the plates on a stegosaurus weren't armour; he says he'd honestly rather not know.",
      "By the T. rex, Teo is telling the quartet about his four proposals and Nell is giving the full tour to an empty hall. Neither of them notices the other leave.",
    ],
    twist: "The quartet turns out to be three of Teo's former students, and all three side with Nell.",
    finale: "Teo leaves by the main stairs and Nell by the staff door, and both call it a lovely evening alone.",
    best_line: "You don't get to call a fact boring. It was here first.",
  },
  {
    a: "house-sable",
    b: "house-orin",
    ending: "friends",
    setting: "A surprise party for a stranger, in a laundrette, with forty-one party hats and no guest of honour yet.",
    goals: ["Sable wants someone who says yes before hearing the plan.", "Orin wants a story that survives a follow-up."],
    scenes: [
      "Sable hands Orin a party hat and a kazoo and tells him the guest of honour is due in four minutes. Orin asks for the guest's name, then their age, then the source.",
      "The guest of honour turns out to be the laundrette's owner, who has never met either of them. Orin checks the facts; every one of them holds, and he is quietly impressed.",
      "They split the cake three ways with the owner, who cries. Orin admits it was the best-sourced party he's been to, and Sable admits he's a terrible guest and a great friend.",
    ],
    twist: "Orin has been to one of Sable's parties before, as the guest of honour, and never found out who threw it.",
    finale: "They promise to throw the next one together, as friends: she brings the hats, he checks the guest list.",
    best_line: "I've verified it. That was, in fact, a surprise.",
  },
];

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

/** The harness's environment with no model at all, on a clock starting at `at` (scripts/fake-clock.mjs). */
function appEnvAt(at) {
  const env = appEnv(9, DATA_DIR); // the stub showrunner's port is never used: its variables go below
  for (const key of Object.keys(env)) {
    if (/^(LLM_|FRONTIER_|GOOGLE_API_KEY$|OPENAI_|ANTHROPIC_|AI_GATEWAY_)/.test(key)) delete env[key];
  }
  const clock = `--import=${pathToFileURL(join(ROOT, "scripts", "fake-clock.mjs")).href}`;
  return {
    ...env,
    // Links the app writes out (the copied result's among them) read as they do in production.
    SITE_URL: "https://botchelor.com",
    FAKE_CLOCK_AT: at.toISOString(),
    NODE_OPTIONS: [env.NODE_OPTIONS, clock].filter(Boolean).join(" "),
  };
}

/** Writes the sample dates into the throwaway database while the app is stopped. */
async function seedSampleDates() {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(DATA_DIR);
  for (const [i, d] of SAMPLE_DATES.entries()) {
    const created = new Date(Date.UTC(2026, 9, 18 + i, 19));
    await pg.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at,
                             status, visibility, best_line, transcript, created_at)
       values ($1, 'system', $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, 'ready', 'public', $11, '[]'::jsonb, $12)`,
      [`sample-daily-${i + 1}`, d.a, d.b, d.setting, JSON.stringify(d.goals), JSON.stringify(d.scenes), d.twist, d.finale, d.ending, new Date(created.getTime() + 3_600_000), d.best_line, created],
    );
  }
  await pg.close();
}

/** The text as a reader sees it: entities decoded, and React's <!-- --> markers between adjacent text nodes dropped. */
const unescape = (html) => html.replace(/<!-- -->/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

/** The day's answer, from the reveal the page itself calls once a pick is in (POST /api/daily). */
async function answerFor(base, n) {
  const res = await fetch(`${base}/api/daily`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ n, pick: "friends" }) });
  assert(res.status === 200, `POST /api/daily for #${n} answered ${res.status}`);
  return res.json();
}

/** The acceptance checks over HTTP for today's page, against the production build. Returns today's answer. */
async function checkToday(base, n) {
  const res = await fetch(`${base}/daily?ref=daily`, { headers: { cookie: ADULT, "user-agent": CHROME_UA }, redirect: "manual" });
  assert(res.status === 200, `/daily answered ${res.status} to an adult with no account`);
  const raw = await res.text();
  const html = unescape(raw);
  assert(html.includes(`data-daily="${n}"`) && html.includes(`Daily Date #${n}`), `/daily doesn't show #${n}`);
  // The prediction form's choices (the site's own layout has other radios, in the feedback form).
  const form = html.slice(html.indexOf('<section class="card daily-game"'));
  const radios = (form.slice(0, form.indexOf("</form>")).match(/<input[^>]*type="radio"[^>]*>/g) ?? []);
  assert(radios.length === 3 && radios.every((r) => r.includes('name="pick"')), `the form doesn't have exactly three choices (${radios.length})`);
  assert(ENDINGS.every((e, i) => radios[i].includes(`value="${e}"`)), "the form's choices aren't second_date, friends, disaster");
  assert((html.match(/<input[^>]*name="pick"/g) ?? []).length === 3, "a pick input outside the form");
  // No date's second or last scene, finale or best line anywhere: not the markup, not Next's payload.
  for (const d of SAMPLE_DATES) for (const secret of [d.scenes[1], d.scenes[2], d.finale, d.best_line]) assert(!html.includes(secret), `/daily carries "${secret.slice(0, 40)}…" before a pick`);
  assert(!/\\?"(ending|scenes|finale)\\?"\s*:/.test(raw) && !/data-ending=/.test(raw), "/daily carries an ending or scenes before a pick");
  assert(/property="og:title" content="Botchelor Daily[^"]*"/.test(html), "no og:title with Botchelor Daily");
  const image = html.match(/property="og:image" content="([^"]+)"/)?.[1];
  assert(image, "no og:image");
  const card = await fetch(`${base}${new URL(image, base).pathname}`);
  assert(card.status === 200 && card.headers.get("content-type") === "image/png", `the og:image answered ${card.status}`);
  const answer = await answerFor(base, n);
  for (const name of answer.names) assert(html.includes(name), `/daily doesn't name ${name}`);
  const again = unescape(await (await fetch(`${base}/daily`, { headers: { cookie: ADULT } })).text());
  assert(answer.names.every((name) => again.includes(name)), "the same day served another date on reload");
  return answer;
}

/** The checks that don't change by day: a crawler, the gate, the sitemap and the home page's link. */
async function checkFindable(base) {
  const bot = await fetch(`${base}/daily`, { headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }, redirect: "manual" });
  assert(bot.status === 200, `/daily answered ${bot.status} to a crawler`);
  const person = await fetch(`${base}/daily?ref=daily`, { headers: { "user-agent": CHROME_UA }, redirect: "manual" });
  const gate = new URL(person.headers.get("location") ?? "/", base);
  assert(person.status === 307 && gate.pathname === "/gate" && gate.searchParams.get("from") === "/daily?ref=daily", "a new visitor isn't sent through the gate back to /daily?ref=daily");
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  assert(sitemap.includes("/daily</loc>"), "sitemap.xml doesn't list /daily");
  const home = await (await fetch(`${base}/`, { headers: { cookie: ADULT } })).text();
  assert(/<a[^>]*href="\/daily"/.test(home), "the home page doesn't link /daily");
}

/** Scrolls `selector` to the top of the viewport, just under the sticky site header. */
async function scrollToTop(page, selector) {
  await page.evaluate((sel) => {
    const header = document.querySelector(".site-header")?.getBoundingClientRect().height ?? 0;
    const el = document.querySelector(sel);
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - header - 12);
  }, selector);
}

/** Scrolls so `selector` ends just above the bottom of the viewport, with what's above it in view. */
async function scrollToBottom(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) window.scrollTo(0, el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 24);
  }, selector);
}

async function shot(page, name) {
  if (SHOOT) await page.screenshot({ path: join(OUT_DIR, `${name}.png`) });
}

/** The home page's link to the Daily Date sits inside the first screen. */
async function linkAboveTheFold(page, label) {
  const link = page.locator('.hero a[href="/daily"]');
  await link.waitFor();
  const box = await link.boundingBox();
  const height = page.viewportSize().height;
  const ok = box && box.y >= 0 && box.y + box.height <= height;
  // What it looked like, kept out of the repo (.data is gitignored), so a failure can be seen.
  if (!ok) await page.screenshot({ path: join(ROOT, ".data", `daily-e2e-fold-${label.replace(/\W+/g, "-")}.png`) });
  assert(ok, `${label}: the Daily Date link isn't above the fold (${box && Math.round(box.y + box.height)} of ${height})`);
}

/** Picks `ending` on today's page and locks it in; waits for the result. */
async function play(page, ending) {
  await page.locator(`input[name="pick"][value="${ending}"]`).check();
}

async function lockIn(page, streak) {
  await page.getByRole("button", { name: "Lock it in" }).click();
  await page.locator(".daily-result").waitFor();
  const text = await page.locator(".daily-result").innerText();
  assert(text.includes("✅ You called it"), "a right pick wasn't called right");
  assert(text.includes(`Streak: ${streak}`), `the result doesn't say "Streak: ${streak}"`);
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("set CHROMIUM_PATH to a Chrome/Chromium binary");
  const n1 = numberAt(DAY1);
  const n2 = n1 + 1;
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  if (SHOOT) mkdirSync(OUT_DIR, { recursive: true });
  build();
  const port = await freePort();

  // A first start makes the schema; with nothing aired yet, the day still answers, plainly.
  let app = await startApp(port, appEnvAt(DAY1));
  const empty = await fetch(`${app.base}/daily`, { headers: { cookie: ADULT } });
  assert(empty.status === 200 && (await empty.text()).includes("still being filmed"), "an empty day doesn't answer 200 with its empty state");
  await stopApp(app);
  await seedSampleDates();

  const { chromium, devices } = require("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    // Day one.
    app = await startApp(port, appEnvAt(DAY1));
    const base = app.base;
    await checkFindable(base);
    const day1 = await checkToday(base, n1);
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await desktop.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    await desktop.addCookies([{ name: "bz_adult", value: "1", domain: "127.0.0.1", path: "/" }]);
    const page = await desktop.newPage();
    await page.clock.install({ time: DAY1 });
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await linkAboveTheFold(page, "desktop");
    await shot(page, "daily-home-desktop");
    await Promise.all([page.waitForURL(/\/daily$/), page.locator('.hero a[href="/daily"]').click()]);
    await page.locator(".daily-game form").waitFor();
    await page.waitForLoadState("networkidle");
    await play(page, day1.ending);
    await scrollToBottom(page, ".daily-game form");
    await shot(page, "daily-pick-desktop");
    await lockIn(page, 1);
    console.log(`day one (#${n1}): called ${day1.ending} right, Streak: 1`);

    // A day later: the server restarts on tomorrow's clock and the browser's clock moves on 24 hours.
    await stopApp(app);
    app = await startApp(port, appEnvAt(DAY2));
    await page.clock.fastForward("24:00:00");
    const next = page.getByRole("link", { name: `Daily Date #${n2} is up: play it` });
    await next.waitFor();
    await Promise.all([page.waitForURL(/\/daily$/), next.click()]);
    await page.locator(`[data-daily="${n2}"]`).waitFor();
    await page.locator(".daily-game form").waitFor();
    await page.waitForLoadState("networkidle");
    const day2 = await checkToday(base, n2);
    assert(day2.episode_path !== day1.episode_path, "the next day served the same date");
    await play(page, day2.ending);
    await lockIn(page, 2);
    // A reload on a day already played shows the result again, from this browser's own record.
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".daily-result").waitFor();
    assert((await page.locator(".daily-result").innerText()).includes("Streak: 2"), "a reload lost the streak");

    // Copy result: the number, ✅, the streak and the link; no ending, no names.
    await page.getByRole("button", { name: "Copy result" }).click();
    await page.getByText("Copied.").waitFor();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert(copied.includes(`Botchelor Daily #${n2}`) && copied.includes("✅") && copied.includes("Streak: 2"), `the copied result is missing something: ${JSON.stringify(copied)}`);
    assert(/\/daily\?ref=daily$/.test(copied.trim()), `the copied result doesn't end with the /daily?ref=daily link: ${JSON.stringify(copied)}`);
    for (const word of [...ENDINGS, ...Object.values(LABELS), ...day2.names, ...day2.names.map((n) => n.split(" ")[0])]) {
      assert(!copied.toLowerCase().includes(word.toLowerCase()), `the copied result gives away "${word}"`);
    }
    await scrollToTop(page, ".daily-result");
    await shot(page, "daily-result-desktop");
    console.log(`day two (#${n2}): called ${day2.ending} right, Streak: 2, copied ${JSON.stringify(copied)}`);
    await desktop.close();

    // Yesterday's page shows its ending; today's number goes to the game; tomorrow's is a 404.
    const past = unescape(await (await fetch(`${base}/daily/${n1}`, { headers: { cookie: ADULT } })).text());
    assert(past.includes(`data-ending="${day1.ending}"`) && past.includes(day1.scenes[2]), `/daily/${n1} doesn't show its ending`);
    const todays = await fetch(`${base}/daily/${n2}`, { headers: { cookie: ADULT }, redirect: "manual" });
    assert(todays.status === 307 && todays.headers.get("location")?.endsWith("/daily"), `/daily/${n2} (today) answered ${todays.status}`);
    assert((await fetch(`${base}/daily/${n2 + 1}`, { headers: { cookie: ADULT } })).status === 404, "a day still to come isn't a 404");

    // On a phone, a visitor who called yesterday's right plays today's.
    const phone = await browser.newContext(devices["iPhone 13"]);
    await phone.addCookies([{ name: "bz_adult", value: "1", domain: "127.0.0.1", path: "/" }]);
    await phone.addInitScript(([key, value]) => localStorage.getItem(key) || localStorage.setItem(key, value), [STORAGE_KEY, JSON.stringify({ [n1]: { pick: day1.ending, correct: true } })]);
    const mobile = await phone.newPage();
    await mobile.clock.install({ time: new Date(DAY2.getTime() + 60_000) });
    await mobile.goto(`${base}/`, { waitUntil: "networkidle" });
    await linkAboveTheFold(mobile, "iPhone 13");
    await shot(mobile, "daily-home-mobile");
    await mobile.goto(`${base}/daily`, { waitUntil: "networkidle" });
    await mobile.locator(".daily-carried").waitFor();
    await play(mobile, day2.ending);
    await scrollToBottom(mobile, ".daily-game form");
    await shot(mobile, "daily-pick-mobile");
    await lockIn(mobile, 2);
    await scrollToTop(mobile, ".daily-result");
    await shot(mobile, "daily-result-mobile");
    await phone.close();
    console.log(
      `checks passed: /daily 200 (adult, crawler), the gate back to /daily?ref=daily, #${n1} and #${n2} with three choices and no ending before a pick, og:title, sitemap, the home link above the fold (desktop, iPhone 13), Streak: 2 across a day, Copy result, /daily/${n1}`,
    );
    if (SHOOT) console.log("screenshots written to docs/screenshots/daily-*.png");
  } finally {
    await browser.close();
    await stopApp(app);
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * npm run screenshots: builds the app, starts it on localhost with a throwaway local database and a
 * stand-in showrunner, plays a realistic two-week sample season through the real API and UI, and saves
 * desktop (1280×800) and iPhone 13 screenshots to docs/screenshots/. Then it stops everything.
 *
 * - No real infrastructure: DATABASE_URL, GOOGLE_API_KEY, LLM_* and STRIPE_* are dropped from the app's
 *   environment. Episodes come from a local OpenAI-compatible stub with canned, schema-valid sample
 *   episodes (the app validates them exactly as it would a free model's), so no key is needed.
 * - Payments: a sample Payment Link that never leaves the machine (Playwright answers for Stripe's page)
 *   and a webhook secret made up for this run only, so the shop's Buy button is driven end to end: the
 *   app's checkout, the link with its order reference, and a signed checkout.session.completed.
 * - Sample data only: invented characters and display names.
 * - Chromium comes from CHROMIUM_PATH; no browser is ever downloaded.
 * - "Last week" is real data moved back seven days in the throwaway database while the app is stopped,
 *   so the first league view closes that season exactly as it would in production.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NEXT_BIN = join(ROOT, "node_modules", "next", "dist", "bin", "next");
const DATA_DIR = join(ROOT, ".data", "screenshots");
const OUT_DIR = join(ROOT, "docs", "screenshots");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------------------------------
// A stand-in showrunner: an OpenAI-compatible chat endpoint returning one canned episode per house
// partner, with the two characters' names filled in from the sheets the app sends.

const EPISODES = {
  "Rafe Calloway": (a, b) => ({
    setting: "A rooftop dumpling stall in a thunderstorm, run by a chef who narrates every order like a nature documentary.",
    goals: [
      `To find out if ${b} can read a map upside down, the only real test of character.`,
      "One honest opinion about his rain-only lemon cake, though he secretly dreads getting it.",
    ],
    scenes: [
      `${a} arrives early and redraws the menu as a map with a compass rose. ${b} arrives late and soaked, holding a cake box like a newborn.`,
      `They argue about whether dumplings count as cake. The chef takes ${b}'s side, loudly, then switches sides when ${a} offers a free map of the stall.`,
      `${a} tastes the lemon cake and says it is too sweet. ${b} goes quiet, then laughs harder than anyone has all night.`,
    ],
    twist: `The power goes out, and the only light left is the candle ${b} keeps in the cake box for emergencies.`,
    finale: `${b} leaves first to rescue his oven from the storm, but asks ${a} to map the way to his bakery for next time. As friends.`,
    best_line: "Every good map has one lie in it. So does every good cake.",
    confessionals: [
      "I kept wanting to fold the whole night into a map I could keep.",
      "She called my cake too sweet and I'd bake her a hundred more.",
    ],
    ending: "friends",
    drama_question: "leaves_first",
    drama_answer: "b",
  }),
  "Juniper Vale": (a, b) => ({
    setting: "The top of a lighthouse at dusk, with a thermos of cocoa, a podcast microphone and three suspicious gulls.",
    goals: [
      "A date who listens all the way to the end of a story, twist included.",
      `A co-host who believes in at least one ghost, and doesn't laugh at the gulls.`,
    ],
    scenes: [
      `${b} records an intro before saying hello. ${a} answers on air without missing a beat, and the gulls seem to approve.`,
      `They trade ghost stories. ${a}'s is about an opera house that only plays at low tide; ${b} has to pause the recording to stop laughing.`,
      `The lamp dims and they have to decide, right there on the spiral stairs, whether this was a one-off or the start of something.`,
    ],
    twist: "The lighthouse lamp flickers in perfect time with the story, and neither of them is touching the switch.",
    finale: `${b} asks ${a} back for episode twelve. They walk down the spiral stairs together, still arguing about whether the ghost was real.`,
    best_line: "If the lamp keeps time with my story, the ghost has notes.",
    confessionals: [
      "I came to test whether they'd listen to the end. They did, twice.",
      "I haven't laughed on air in eleven episodes. Tonight I had to pause the tape.",
    ],
    ending: "second_date",
    drama_question: "rejected",
    drama_answer: "neither",
  }),
  "Dex Okafor": (a, b) => ({
    setting: "A quiet pottery studio after hours, where a wheel spins slowly and a birthday party is very audible next door.",
    goals: [
      "To prove that a first date can be thrilling, whatever it takes.",
      "A quiet night that stays quiet.",
    ],
    scenes: [
      `${b} teaches ${a} to centre clay. ${a} centres it, then announces a plan to throw a vase blindfolded.`,
      `The party next door starts singing. ${b} flinches at every candle being lit, while ${a} keeps suggesting they crash it.`,
      `When the cake comes out, ${b} has to choose between the quiet night they wanted and the chaos ${a} is offering.`,
    ],
    twist: `${a} reveals a surprise: a cake, with nineteen candles, one for every time ${b} was set on fire professionally.`,
    finale: `${a} storms off when ${b} blows the candles out with a fire extinguisher. The vase survives; the date does not.`,
    best_line: "Nineteen candles isn't a cake. It's a dare.",
    confessionals: [
      "I wanted thrilling. I got a fire extinguisher and a lecture.",
      "I asked for one quiet night. One. The vase is the only thing that listened.",
    ],
    ending: "disaster",
    drama_question: "leaves_first",
    drama_answer: "a",
  }),
};

// The engine (not the model) decides the ending now and hands it to the showrunner in the prompt as
// "Decided ending: <label>.". The real model narrates to match it; this stub does the same so the
// finale never contradicts the ending the page shows.
// best_line has no surrounding quotes: the box score renders it in quotes itself.
const ENDING_FINALE = {
  "A second date": () => ({
    finale: "They swap numbers before they even reach the door, already arguing about where to go next.",
    best_line: "Same time next week, and bring the better story.",
  }),
  "Just friends": () => ({
    finale: "No spark, but they split the last bite laughing and mean it: let's do this again, as friends.",
    best_line: "Friends, then. The good kind, not the polite kind.",
  }),
  "A disaster": () => ({
    finale: "It comes apart fast. One of them is gone before the plates are cleared, and neither asks for a rematch.",
    best_line: "Well. We'll always have the first ten minutes.",
  }),
};

function sampleEpisode(messages) {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const sheets = JSON.parse(user.slice(user.indexOf("{")));
  const a = sheets.character_a.name;
  const b = sheets.character_b.name;
  const write = EPISODES[b] ?? EPISODES["Rafe Calloway"];
  const episode = write(a, b);
  // Make the finale and best line match the engine's decided ending, as the real model would.
  const decided = /Decided ending:\s*([^.]+)\./.exec(sheets.decided_outcome ?? "")?.[1]?.trim();
  if (decided && ENDING_FINALE[decided]) Object.assign(episode, ENDING_FINALE[decided]());
  return episode;
}

// M9: one agent turn, for the turn-by-turn conversation. Detected by the turn prompt's shape.
const TURN_LINES = [
  "So — what are we both really doing here tonight?",
  "Bold of you to assume I turned up with a plan.",
  "Okay, that one actually made me laugh.",
  "Careful. I might start to enjoy this.",
  "Ask me the thing you actually want to ask.",
  "Honestly? This is going better than I expected.",
  "I could be talked into a second round of this.",
  "Whatever else happens, this was not boring.",
];
function sampleTurn(messages) {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const data = JSON.parse(user.slice(user.indexOf("{")));
  const n = data.transcript_so_far?.length ?? 0;
  return { dialogue: TURN_LINES[n % TURN_LINES.length], action: "answers", emotion: "curious", interest_signal: 0.4 + (n % 5) * 0.1 };
}

function startShowrunner() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { messages } = JSON.parse(body);
        const user = messages.find((m) => m.role === "user")?.content ?? "";
        const isTurn = user.includes('"you"') && user.includes('"them"');
        const content = JSON.stringify(isTurn ? sampleTurn(messages) : sampleEpisode(messages));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
      } catch {
        res.writeHead(400).end();
      }
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

// ---------------------------------------------------------------------------------------------------
// The app: production build, started and stopped by this script.

function freePort() {
  return new Promise((ok, fail) => {
    const srv = createNetServer();
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });
}

// The shop's sample payment setup. The link's host is answered by Playwright, never fetched.
const SAMPLE_PAYMENT_LINK = "https://buy.stripe.com/test_botchelorSamplePack";
const SAMPLE_PRICE_LABEL = "5 more dates · $4";
const SAMPLE_PACK = { episodes: 5, amount_cents: 400 };
// Made up for this run and handed only to the app it starts; never written anywhere.
const RUN_WEBHOOK_SECRET = randomBytes(24).toString("hex");

/** The app's environment: this shell's, minus every piece of real infrastructure, plus the samples above. */
function appEnv(showrunnerPort) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(DATABASE_URL|GOOGLE_API_KEY|LLM_|STRIPE_|NEXT_PUBLIC_STRIPE_|VERCEL|CONTACT_EMAIL)/.test(key)) delete env[key];
  }
  return {
    ...env,
    NODE_ENV: "production",
    PGLITE_DIR: DATA_DIR,
    LLM_BASE_URL: `http://127.0.0.1:${showrunnerPort}/v1`,
    LLM_API_KEY: "local-sample-showrunner",
    LLM_MODEL: "sample-showrunner",
    STRIPE_PAYMENT_LINK: SAMPLE_PAYMENT_LINK,
    STRIPE_PRICE_LABEL: SAMPLE_PRICE_LABEL,
    STRIPE_WEBHOOK_SECRET: RUN_WEBHOOK_SECRET,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

function build() {
  console.log("Building the app (next build)…");
  const result = spawnSync(process.execPath, [NEXT_BIN, "build"], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (result.status !== 0) throw new Error("next build failed");
}

async function startApp(port, env) {
  // One loopback address for the server, the seeding calls and the browser ("localhost" can resolve to
  // ::1 for one and 127.0.0.1 for the other). Chromium treats loopback as secure, so cookies still work.
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  let last = "no answer";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("the app exited during startup");
    try {
      const res = await fetch(`${base}/legal`);
      if (res.ok) return { child, base };
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? `${err.message} (${err.cause?.code ?? err.cause?.message ?? "?"})` : "error";
    }
    await new Promise((ok) => setTimeout(ok, 300));
  }
  child.kill("SIGTERM");
  throw new Error(`the app did not answer on localhost within 60 s (last: ${last})`);
}

function stopApp(app) {
  if (!app || app.child.exitCode !== null) return Promise.resolve();
  return new Promise((ok) => {
    app.child.once("exit", () => ok());
    app.child.kill("SIGTERM");
    setTimeout(() => app.child.kill("SIGKILL"), 10_000).unref();
  });
}

// ---------------------------------------------------------------------------------------------------
// Sample season, played through the app's own API.

/** A sample player: an anonymous session id, exactly what the app's cookie holds. */
function persona() {
  const id = randomUUID();
  return { id, cookie: `bz_uid=${id}` };
}

function client(base) {
  return async function call(path, body, who, expected = [200, 201]) {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: who.cookie, origin: base },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!expected.includes(res.status)) throw new Error(`POST ${path} returned ${res.status} (${data.error ?? "?"})`);
    return data;
  };
}

const CHARACTERS = {
  mira: {
    name: "Mira Quell",
    age: 27,
    bio: "A cartographer who maps cities that only exist on Tuesdays. Has never once been lost, and is smug about it.",
    traits: ["curious", "stubborn", "warm"],
    want: "Someone who can read a map upside down",
    dealbreaker: "People who hate surprises",
  },
  otto: {
    name: "Otto Fenn",
    age: 36,
    bio: "A retired opera prompter who still whispers everyone's lines a second before they say them.",
    traits: ["devoted", "dramatic", "punctual"],
    want: "A date who lets him finish a story",
    dealbreaker: "Spoilers of any kind",
  },
  tamsin: {
    name: "Tamsin Holloway",
    age: 31,
    bio: "Sets the hardest crossword in the city and hides a marriage proposal in it every year, for strangers.",
    traits: ["clever", "romantic", "competitive"],
    want: "Someone who finishes the puzzle before asking for hints",
    dealbreaker: "Pens on a crossword",
  },
};

async function seedLastWeek(call, cast) {
  const { wren, kestrel, alder, birch, cedar, miraCreator, ottoCreator } = cast;
  for (const [who, name] of [[wren, "Wren"], [kestrel, "Kestrel"], [alder, "Alder"], [birch, "Birch"], [cedar, "Cedar"]]) {
    await call("/api/profile", { name, attest: true }, who);
  }
  const league = await call("/api/leagues", { name: "Rooftop Regulars" }, wren);
  for (const who of [kestrel, alder, birch, cedar]) await call(`/api/leagues/${league.id}/join`, {}, who);

  const mira = await call("/api/characters", { ...CHARACTERS.mira, attest: true }, miraCreator);
  const otto = await call("/api/characters", { ...CHARACTERS.otto, attest: true }, ottoCreator);
  const rooftop = await call("/api/episodes", { character_id: mira.id, partner_id: "house-rafe" }, miraCreator); // friends, b leaves first
  const lighthouse = await call("/api/episodes", { character_id: otto.id, partner_id: "house-juniper" }, ottoCreator); // second date, nobody rejected

  // Wren 30 · Kestrel 20 · Alder 20 · Birch 10 · Cedar 0
  const picks = [
    [wren, ["friends", "b"], ["second_date", "neither"]],
    [kestrel, ["friends", "a"], ["second_date", "a"]],
    [alder, ["disaster", "b"], ["second_date", "neither"]],
    [birch, ["friends", "a"], ["friends", "b"]],
    [cedar, ["disaster", "a"], ["disaster", "b"]],
  ];
  for (const [who, [p1, d1], [p2, d2]] of picks) {
    await call("/api/predictions", { episode_id: rooftop.id, pick: p1, drama_pick: d1 }, who);
    await call("/api/predictions", { episode_id: lighthouse.id, pick: p2, drama_pick: d2 }, who);
  }
  await call(`/api/episodes/${rooftop.id}/reveal`, {}, miraCreator);
  await call(`/api/episodes/${lighthouse.id}/reveal`, {}, ottoCreator);
  return { league, mira, otto };
}

/** With the app stopped: everything played so far happened a week ago. */
async function moveBackOneWeek() {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(DATA_DIR);
  const lastMonday = new Date(Date.now() - WEEK_MS);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - ((lastMonday.getUTCDay() + 6) % 7));
  await pg.query("update free_episode_usage set season_id = $1", [lastMonday.toISOString().slice(0, 10)]);
  await pg.exec(`
    update episodes set created_at = created_at - interval '7 days', revealed_at = revealed_at - interval '7 days';
    update predictions set created_at = created_at - interval '7 days', updated_at = updated_at - interval '7 days';
    update leagues set created_at = created_at - interval '7 days';
    update league_members set joined_at = joined_at - interval '7 days';
    update characters set created_at = created_at - interval '7 days' where not is_house;
  `);
  await pg.close();
}

async function seedThisWeek(call, cast, { mira, otto }) {
  const { wren, kestrel, birch, miraCreator, ottoCreator } = cast;
  const pottery = await call("/api/episodes", { character_id: mira.id, partner_id: "house-dex" }, miraCreator); // disaster, a leaves first
  await call("/api/episodes", { character_id: otto.id, partner_id: "house-rafe" }, ottoCreator); // still open for predictions
  // This week so far: Kestrel 15 · Birch 10 · Wren 5
  await call("/api/predictions", { episode_id: pottery.id, pick: "disaster", drama_pick: "a" }, kestrel);
  await call("/api/predictions", { episode_id: pottery.id, pick: "disaster", drama_pick: "b" }, birch);
  await call("/api/predictions", { episode_id: pottery.id, pick: "friends", drama_pick: "a" }, wren);
  await call(`/api/episodes/${pottery.id}/reveal`, {}, miraCreator);
}

// ---------------------------------------------------------------------------------------------------
// Buying a pack: the shop's Buy button, the Payment Link (answered here, in place of Stripe's page) and
// the signed checkout.session.completed that Stripe would send once the buyer pays.

function signedEvent(session) {
  const payload = JSON.stringify({
    id: `evt_sample_${randomUUID().replace(/-/g, "")}`,
    object: "event",
    type: "checkout.session.completed",
    data: { object: { object: "checkout.session", mode: "payment", payment_status: "paid", currency: "usd", ...session } },
  });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", RUN_WEBHOOK_SECRET).update(`${t}.${payload}`, "utf8").digest("hex");
  return { payload, signature: `t=${t},v1=${v1}` };
}

async function buyPackThroughShop(page, base) {
  let linkOpened = null;
  await page.route(`${new URL(SAMPLE_PAYMENT_LINK).origin}/**`, (route) => {
    linkOpened = new URL(route.request().url());
    route.fulfill({ contentType: "text/html", body: "<title>Stripe test payment (sample stand-in)</title><h1>Paid (sample)</h1>" });
  });
  await page.goto(`${base}/shop`);
  await page.getByText("2 of 3 free dates left").waitFor(); // the date just written spent one
  await page.locator('input[name="attest"]').check();
  await page.getByRole("button", { name: SAMPLE_PRICE_LABEL }).click();
  await page.waitForURL((url) => url.href.startsWith(SAMPLE_PAYMENT_LINK));
  const orderRef = linkOpened?.searchParams.get("client_reference_id");
  if (!orderRef || `${linkOpened.origin}${linkOpened.pathname}` !== SAMPLE_PAYMENT_LINK) {
    throw new Error(`the Buy button opened ${linkOpened?.href ?? "nothing"}, not the Payment Link with an order reference`);
  }

  const { payload, signature } = signedEvent({
    id: `cs_test_sample_${randomUUID().replace(/-/g, "")}`,
    client_reference_id: orderRef,
    payment_link: "plink_botchelorSamplePack",
    amount_total: SAMPLE_PACK.amount_cents,
  });
  const res = await fetch(`${base}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body: payload,
  });
  if (res.status !== 200) throw new Error(`the webhook answered ${res.status}`);

  await page.goto(`${base}/shop?checkout=success`);
  await page.getByText(`plus ${SAMPLE_PACK.episodes} pack dates`).waitFor();
  console.log(`  bought "5 more dates" through the shop: the Payment Link carried the order, the webhook added ${SAMPLE_PACK.episodes} dates`);
}

// ---------------------------------------------------------------------------------------------------
// Make a watch-party room feel alive: a few viewers drop in, react and chat (all through the real API).

async function livenRoom(base, roomId) {
  const lines = [
    "the PAUSE before he answered 😭",
    "she does NOT believe him lol",
    "second date incoming. calling it now",
    "he is absolutely lying and I'm here for it",
  ];
  const emojis = ["😂", "❤️", "🚩", "🍿"];
  for (let i = 0; i < lines.length; i++) {
    const headers = { "content-type": "application/json", cookie: `bz_uid=${randomUUID()}`, origin: base };
    await fetch(`${base}/api/watch-parties/${roomId}/sync`, { method: "POST", headers, body: "{}" });
    await fetch(`${base}/api/watch-parties/${roomId}/reactions`, { method: "POST", headers, body: JSON.stringify({ emoji: emojis[i] }) });
    await fetch(`${base}/api/watch-parties/${roomId}/chat`, { method: "POST", headers, body: JSON.stringify({ body: lines[i] }) });
  }
}

// ---------------------------------------------------------------------------------------------------
// Screenshots

async function capture(base, leagueId, viewer) {
  const { chromium, devices } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const sizes = [
    ["desktop", { viewport: { width: 1280, height: 800 } }],
    ["mobile", devices["iPhone 13"]],
  ];
  const saved = [];
  try {
    for (const [label, device] of sizes) {
      const shot = async (page, name, opts = {}) => {
        await page.waitForLoadState("networkidle");
        const path = join(OUT_DIR, `${name}-${label}.png`);
        await page.screenshot({ path, fullPage: opts.full ?? false });
        saved.push(path);
      };

      // 1. The start page, as a first-time visitor sees it.
      const visitor = await browser.newContext(device);
      const home = await visitor.newPage();
      await home.goto(`${base}/`);
      await home.getByRole("heading", { level: 1 }).waitFor();
      await shot(home, "home");

      // 2. The core action, through the UI: make a character, send them on a date, land on the episode.
      const c = CHARACTERS.tamsin;
      const form = home.locator("#start");
      await form.locator('input[name="name"]').fill(c.name);
      await form.locator('input[name="age"]').fill(String(c.age));
      await form.locator('textarea[name="bio"]').fill(c.bio);
      for (const [i, trait] of c.traits.entries()) await form.locator(`input[name="trait${i + 1}"]`).fill(trait);
      await form.locator('input[name="want"]').fill(c.want);
      await form.locator('input[name="dealbreaker"]').fill(c.dealbreaker);
      // The private soul (owner-only): open it and fill a couple of fields for the builder screenshot.
      await form.getByText("Give them a private soul (optional)").click();
      await form.locator('input[name="soul_values"]').fill("Finishes what she starts; hates being underestimated.");
      await form.locator('input[name="soul_humor"]').fill("Dry, competitive, quick to a comeback.");
      await form.locator('input[name="soul_communication"]').fill("Warm once she trusts you; guarded before that.");
      await form.locator('input[name="attest"]').check();
      await shot(home, "builder", { full: true });
      await form.getByRole("button", { name: "Create character" }).click();
      await home.getByText(`Who should ${c.name} meet?`).waitFor();
      // The date settings (PRD budget & autonomy): open them for a screenshot of the controls.
      await home.getByText("Date settings (optional)").click();
      await home.getByText("A note in the pocket", { exact: false }).waitFor();
      await shot(home, "date-settings");
      await home.getByRole("button", { name: `Send ${c.name} on a date with Juniper` }).click();
      await home.waitForURL(/\/episodes\/[0-9a-f-]{36}$/);
      await home.getByRole("heading", { level: 1, name: `${c.name} × Juniper Vale` }).waitFor();
      await shot(home, "episode");
      // The three acts (first impressions / the challenge / the decision) are the "The date" section.
      await home.locator(".act").first().scrollIntoViewIfNeeded();
      await shot(home, "episode-acts");
      // M9: the turn-by-turn two-agent conversation — the date played out line by line.
      await home.locator(".transcript .turn").first().waitFor();
      await home.locator(".transcript").scrollIntoViewIfNeeded();
      await shot(home, "episode-transcript", { full: true });
      // The box score, debrief and agendas are lower on the (creator's) page: scroll to them.
      await home.locator(".boxscore").scrollIntoViewIfNeeded();
      await shot(home, "episode-boxscore");

      // 2a. The watch party (M8): the creator turns the date into a live room, a few viewers drop in and
      // chat, and a spectator's view — reactions, live chat and the prediction panel — is the screenshot.
      await home.getByRole("button", { name: "Start the premiere" }).click();
      await home.waitForURL(/\/watch\/[0-9a-f-]{36}$/);
      const roomId = home.url().split("/watch/")[1];
      await livenRoom(base, roomId);
      const fan = await browser.newContext(device);
      const fanPage = await fan.newPage();
      await fanPage.goto(`${base}/watch/${roomId}`);
      await fanPage.getByRole("heading", { level: 1 }).waitFor();
      await fanPage.locator(".watch-react").first().waitFor();
      await shot(fanPage, "watch", { full: true });
      await fan.close();

      // 2b. The same creator buys "5 more dates" through the shop (checked, not saved as a screenshot).
      await buyPackThroughShop(home, base);
      await visitor.close();

      // 3. Seasons: Wren's league, with last season's podium (closed on this first view) and this week's board.
      const member = await browser.newContext(device);
      await member.addCookies([{ name: "bz_uid", value: viewer.id, url: base }]);
      const league = await member.newPage();
      await league.goto(`${base}/leagues/${leagueId}`);
      await league.getByRole("heading", { name: "Latest podium" }).waitFor();
      await shot(league, "league-season");

      // 4. The cast gallery: avatars, the matchmaker and the relationship graph.
      const castPage = await member.newPage();
      await castPage.goto(`${base}/cast`);
      await castPage.getByRole("heading", { name: "The cast" }).waitFor();
      await castPage.locator(".gallery").first().waitFor();
      await shot(castPage, "cast");

      // 5. A shareable contestant card.
      await castPage.locator(".gallery .meta a").first().click();
      await castPage.waitForURL(/\/characters\//);
      await castPage.getByText("Contestant card").waitFor();
      await shot(castPage, "contestant");
      await member.close();
    }
  } finally {
    await browser.close();
  }
  return saved;
}

// ---------------------------------------------------------------------------------------------------

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  if (!DATA_DIR.startsWith(join(ROOT, ".data"))) throw new Error("refusing to use a data directory outside .data/");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  build();
  const showrunner = await startShowrunner();
  const env = appEnv(showrunner.address().port);
  const port = await freePort();
  const cast = Object.fromEntries(
    ["wren", "kestrel", "alder", "birch", "cedar", "miraCreator", "ottoCreator"].map((k) => [k, persona()]),
  );
  let app;
  try {
    app = await startApp(port, env);
    console.log(`App answering on ${app.base}; playing last week's sample season…`);
    const played = await seedLastWeek(client(app.base), cast);
    await stopApp(app);
    await moveBackOneWeek();

    app = await startApp(port, env);
    console.log("Playing this week so far…");
    await seedThisWeek(client(app.base), cast, played);

    console.log("Taking screenshots…");
    const saved = await capture(app.base, played.league.id, cast.wren);
    for (const path of saved) console.log(`  saved ${path.slice(ROOT.length + 1)}`);
  } finally {
    await stopApp(app);
    showrunner.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`screenshots failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * npm run screenshots: builds the app, starts it on localhost with a throwaway local database and a
 * stand-in showrunner, plays a realistic two-week sample season through the real API and UI, and saves
 * desktop (1280×800) and iPhone 13 screenshots to docs/screenshots/. Then it stops everything.
 *
 * - No real infrastructure: DATABASE_URL, GOOGLE_API_KEY, LLM_* and STRIPE_* are dropped from the app's
 *   environment. Episodes come from a local OpenAI-compatible stub with canned, schema-valid sample
 *   episodes (the app validates them exactly as it would a free model's), so no key is needed.
 * - Sample data only: invented characters and display names.
 * - Chromium comes from CHROMIUM_PATH; no browser is ever downloaded.
 * - "Last week" is real data moved back seven days in the throwaway database while the app is stopped,
 *   so the first league view closes that season exactly as it would in production.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
    ],
    twist: "The lighthouse lamp flickers in perfect time with the story, and neither of them is touching the switch.",
    finale: `${b} asks ${a} back for episode twelve. They walk down the spiral stairs together, still arguing about whether the ghost was real.`,
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
    ],
    twist: `${a} reveals a surprise: a cake, with nineteen candles, one for every time ${b} was set on fire professionally.`,
    finale: `${a} storms off when ${b} blows the candles out with a fire extinguisher. The vase survives; the date does not.`,
    ending: "disaster",
    drama_question: "leaves_first",
    drama_answer: "a",
  }),
};

function sampleEpisode(messages) {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const sheets = JSON.parse(user.slice(user.indexOf("{")));
  const a = sheets.character_a.name;
  const b = sheets.character_b.name;
  const write = EPISODES[b] ?? EPISODES["Rafe Calloway"];
  return write(a, b);
}

function startShowrunner() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { messages } = JSON.parse(body);
        const content = JSON.stringify(sampleEpisode(messages));
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

/** The app's environment: this shell's, minus every piece of real infrastructure. */
function appEnv(showrunnerPort) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(DATABASE_URL|GOOGLE_API_KEY|LLM_|STRIPE_|VERCEL|CONTACT_EMAIL)/.test(key)) delete env[key];
  }
  return {
    ...env,
    NODE_ENV: "production",
    PGLITE_DIR: DATA_DIR,
    LLM_BASE_URL: `http://127.0.0.1:${showrunnerPort}/v1`,
    LLM_API_KEY: "local-sample-showrunner",
    LLM_MODEL: "sample-showrunner",
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
      const shot = async (page, name) => {
        await page.waitForLoadState("networkidle");
        const path = join(OUT_DIR, `${name}-${label}.png`);
        await page.screenshot({ path, fullPage: false });
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
      await form.locator('input[name="attest"]').check();
      await form.getByRole("button", { name: "Create character" }).click();
      await home.getByText(`Who should ${c.name} meet?`).waitFor();
      await home.getByRole("button", { name: `Send ${c.name} on a date with Juniper` }).click();
      await home.waitForURL(/\/episodes\/[0-9a-f-]{36}$/);
      await home.getByRole("heading", { level: 1, name: `${c.name} × Juniper Vale` }).waitFor();
      await shot(home, "episode");
      await visitor.close();

      // 3. Seasons: Wren's league, with last season's podium (closed on this first view) and this week's board.
      const member = await browser.newContext(device);
      await member.addCookies([{ name: "bz_uid", value: viewer.id, url: base }]);
      const league = await member.newPage();
      await league.goto(`${base}/leagues/${leagueId}`);
      await league.getByRole("heading", { name: "Latest podium" }).waitFor();
      await shot(league, "league-season");
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

/**
 * Shared test/demo harness: builds and starts the production app with a stub showrunner (so no model
 * key is needed), a sample Stripe Payment Link (answered locally), and a throwaway or persistent
 * database. Used by scripts/e2e.mjs (end-to-end tests) and scripts/seed.mjs (demo data).
 *
 * No real infrastructure: DATABASE_URL, GOOGLE_API_KEY, LLM_* and STRIPE_* are dropped from the app's
 * environment and replaced with local stand-ins. The stub showrunner returns a valid three-act
 * narration that matches whatever ending the engine already decided (it reads decided_outcome from the
 * prompt), so episodes are schema-valid and self-consistent.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import zlib from "node:zlib";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NEXT_BIN = join(ROOT, "node_modules", "next", "dist", "bin", "next");

// ---------------------------------------------------------------------------------------------------
// Stub showrunner: a valid three-act narration that fits the engine's decided ending.

const ENDING_FINALE = {
  "A second date": {
    finale: "swap numbers before the door, already planning where to go next.",
    best_line: "Same time next week, and bring the better story.",
  },
  "Just friends": {
    finale: "split the last bite laughing and mean it: let's do this again, as friends.",
    best_line: "Friends, then. The good kind, not the polite kind.",
  },
  "A disaster": {
    finale: "call it early. One leaves before the plates are cleared, and neither asks for a rematch.",
    best_line: "Well. We'll always have the first ten minutes.",
  },
};

function genericEpisode(messages) {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const data = JSON.parse(user.slice(user.indexOf("{")));
  const a = data.character_a.name;
  const b = data.character_b.name;
  const ending = /Decided ending:\s*([^.]+)\./.exec(data.decided_outcome ?? "")?.[1]?.trim() ?? "Just friends";
  const situation = data.act_two_situation ?? "a surprise lands";
  const fin = ENDING_FINALE[ending] ?? ENDING_FINALE["Just friends"];
  return {
    setting: `A rooftop cafe strung with lights where ${a} and ${b} meet for the first time, a nervous waiter hovering.`,
    goals: [`${a} wants to know if there is a real spark.`, `${b} wants a night worth retelling.`],
    scenes: [
      `${a} arrives first and rearranges the cutlery into a neat grid. ${b} arrives, knocks it over, and they both laugh before a word is said.`,
      `Then ${situation}. ${a} and ${b} each show what they are really like when the easy part is over.`,
      `By the last of the cocoa, it is clear where the night is headed, and ${a} and ${b} ${fin.finale}`,
    ],
    twist: `Halfway through, the waiter turns out to know them both from somewhere neither will admit.`,
    finale: `${a} and ${b} ${fin.finale}`,
    best_line: fin.best_line,
    confessionals: [`I did not expect to feel that, and I am not sure what to do with it.`, `I am still replaying the part where the cutlery went flying.`],
  };
}

/** Starts a local OpenAI-compatible endpoint that returns the stub narration. Returns the http server. */
export function startShowrunner() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { messages } = JSON.parse(body);
        const content = JSON.stringify(genericEpisode(messages));
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
// The app lifecycle.

export const SAMPLE_PAYMENT_LINK = "https://buy.stripe.com/test_botchelorSamplePack";
export const SAMPLE_PRICE_LABEL = "5 more dates · $4";
export const SAMPLE_PACK = { episodes: 5, amount_cents: 400 };
export const RUN_WEBHOOK_SECRET = randomBytes(24).toString("hex");

/** The app's environment: this shell's, minus real infrastructure, plus the local stand-ins. */
export function appEnv(showrunnerPort, dataDir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(DATABASE_URL|GOOGLE_API_KEY|LLM_|STRIPE_|NEXT_PUBLIC_STRIPE_|VERCEL|CONTACT_EMAIL)/.test(key)) delete env[key];
  }
  return {
    ...env,
    NODE_ENV: "production",
    PGLITE_DIR: dataDir,
    LLM_BASE_URL: `http://127.0.0.1:${showrunnerPort}/v1`,
    LLM_API_KEY: "local-stub-showrunner",
    LLM_MODEL: "stub-showrunner",
    STRIPE_PAYMENT_LINK: SAMPLE_PAYMENT_LINK,
    STRIPE_PRICE_LABEL: SAMPLE_PRICE_LABEL,
    STRIPE_WEBHOOK_SECRET: RUN_WEBHOOK_SECRET,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

export function freePort() {
  return new Promise((ok, fail) => {
    const srv = createNetServer();
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });
}

export function build() {
  console.log("Building the app (next build)…");
  const result = spawnSync(process.execPath, [NEXT_BIN, "build"], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (result.status !== 0) throw new Error("next build failed");
}

export async function startApp(port, env) {
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
      last = err instanceof Error ? err.message : "error";
    }
    await new Promise((ok) => setTimeout(ok, 300));
  }
  child.kill("SIGTERM");
  throw new Error(`the app did not answer within 60 s (last: ${last})`);
}

export function stopApp(app) {
  if (!app || app.child.exitCode !== null) return Promise.resolve();
  return new Promise((ok) => {
    app.child.once("exit", () => ok());
    app.child.kill("SIGTERM");
    setTimeout(() => app.child.kill("SIGKILL"), 10_000).unref();
  });
}

// ---------------------------------------------------------------------------------------------------
// HTTP client + a signed webhook, for driving the app the way a browser would.

export function persona() {
  const id = randomUUID();
  return { id, cookie: `bz_uid=${id}` };
}

export function client(base) {
  return async function call(path, body, who, expected = [200, 201]) {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: who.cookie, origin: base },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!expected.includes(res.status)) throw new Error(`POST ${path} → ${res.status} (${data.error ?? "?"})`);
    return data;
  };
}

// A minimal solid-colour PNG, so the E2E can prove "an image trains the character" without a fixture file.
let _crcTable;
function crc32(buf) {
  if (!_crcTable) {
    _crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      _crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = _crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
export function solidPng(r, g, b, size = 8) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const o = y * stride + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function signedEvent(session) {
  const payload = JSON.stringify({
    id: `evt_stub_${randomUUID().replace(/-/g, "")}`,
    object: "event",
    type: "checkout.session.completed",
    data: { object: { object: "checkout.session", mode: "payment", payment_status: "paid", currency: "usd", ...session } },
  });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", RUN_WEBHOOK_SECRET).update(`${t}.${payload}`, "utf8").digest("hex");
  return { payload, signature: `t=${t},v1=${v1}` };
}

// ---------------------------------------------------------------------------------------------------
// A rich, believable demo dataset, driven over HTTP exactly as the UI would.

const CAST = [
  { name: "Mira Quell", age: 27, bio: "A cartographer who maps cities that only exist on Tuesdays. Never lost, and smug about it.", traits: ["curious", "stubborn", "warm"], want: "Someone who can read a map upside down", dealbreaker: "People who hate surprises", appearance: "windswept, ink-stained fingers, a coat full of folded maps", avatar_hue: 210, soul: { values: "honesty and curiosity", humor: "dry and quick", communication: "warm once she trusts you" } },
  { name: "Otto Fenn", age: 36, bio: "A retired opera prompter who still whispers everyone's lines a second before they say them.", traits: ["devoted", "dramatic", "punctual"], want: "A date who lets him finish a story", dealbreaker: "Spoilers of any kind", appearance: "velvet jacket, reading glasses on a chain, immaculate", avatar_hue: 275 },
  { name: "Tamsin Holloway", age: 31, bio: "Sets the hardest crossword in the city and hides a marriage proposal in it every year, for strangers.", traits: ["clever", "romantic", "competitive"], want: "Someone who finishes the puzzle before asking for hints", dealbreaker: "Pens on a crossword", appearance: "sharp bob, a pencil behind each ear", avatar_hue: 340, soul: { values: "cleverness and follow-through", insecurities: "being underestimated" } },
  { name: "Bas Niro", age: 40, bio: "Runs a night market stall that only sells things people lost. Somehow always has what you need.", traits: ["generous", "mysterious", "patient"], want: "Someone who returns what they borrow", dealbreaker: "Keeping the umbrella", appearance: "a coat of many pockets, a lantern that never goes out", avatar_hue: 30 },
  { name: "Wrenna Sol", age: 29, bio: "A storm chaser who is calmest in the eye of it. Collects the last photo on strangers' broken phones.", traits: ["brave", "spontaneous", "tender"], want: "Someone who will pull over for a good sky", dealbreaker: "Checking the forecast on a date", appearance: "sunburnt, a camera always around her neck", avatar_hue: 160, soul: { values: "wonder over safety", humor: "bold and silly" } },
];

/**
 * Seeds a rich season: five OCs across five creators, several dates with varied endings, a friend
 * league with predictions and a closed-out podium feel, and a couple of matchmaker proposals.
 */
export async function seedDataset(base) {
  const call = client(base);
  const creators = CAST.map(() => persona());
  const chars = [];
  for (let i = 0; i < CAST.length; i++) {
    const { soul, ...sheet } = CAST[i];
    chars.push(await call("/api/characters", { ...sheet, ...(soul ? { soul } : {}), attest: true }, creators[i]));
  }

  // A friend league among the first three creators.
  for (const [i, name] of ["Wren", "Kestrel", "Alder"].entries()) await call("/api/profile", { name, attest: true }, creators[i]);
  const league = await call("/api/leagues", { name: "Rooftop Regulars" }, creators[0]);
  for (const i of [1, 2]) await call(`/api/leagues/${league.id}/join`, {}, creators[i]);

  const spectators = [persona(), persona(), persona()];
  const endingsSeen = new Set();
  const episodes = [];
  // Each OC dates a house character and another OC, with varied settings; predictions from spectators.
  const pairings = [
    { host: 0, body: { character_id: chars[0].id, partner_id: "house-rafe" } },
    { host: 1, body: { character_id: chars[1].id, blind: true, autonomy: "unpredictable", strategy: "unexpected" } },
    { host: 2, body: { character_id: chars[2].id, partner_id: "house-juniper" } },
    { host: 3, body: { character_id: chars[3].id, blind: true, strategy: "long_term" } },
    { host: 4, body: { character_id: chars[4].id, partner_id: "house-dex", autonomy: "guided", note: "Be brave but kind." } },
  ];
  for (const { host, body } of pairings) {
    const ep = await call("/api/episodes", body, creators[host]);
    episodes.push(ep);
    endingsSeen.add(ep.ending);
    // Spectators predict each possible ending so someone always scores.
    const picks = ["second_date", "friends", "disaster"];
    for (let s = 0; s < spectators.length; s++) {
      await call("/api/predictions", { episode_id: ep.id, pick: picks[s % 3], drama_pick: ["a", "b", "neither"][s % 3] }, spectators[s]);
    }
    // One dealbreaker guess per spectator (first option; scoring is handled at reveal).
    await call("/api/dealbreaker-guesses", { episode_id: ep.id, pick: CAST[host].dealbreaker }, spectators[0], [201, 403, 422]);
  }

  // A matchmaker proposal from a spectator.
  await call("/api/matchmakers", { character_a: chars[0].id, character_b: chars[4].id }, spectators[0]);

  // Air a few finales so the feed has aired episodes and the board has scores.
  for (let i = 0; i < 3; i++) await call(`/api/episodes/${episodes[i].id}/reveal`, {}, creators[pairings[i].host]);

  return { creators, chars, league, episodes, endingsSeen: [...endingsSeen] };
}

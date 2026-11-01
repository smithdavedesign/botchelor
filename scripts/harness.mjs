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
  const location = data.date_location ?? "a rooftop cafe strung with lights";
  const fin = ENDING_FINALE[ending] ?? ENDING_FINALE["Just friends"];
  return {
    setting: `At ${location}, where ${a} and ${b} meet for the first time, a nervous waiter hovering.`,
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

// One agent turn (M9): the stub plays whichever character is speaking ("you"), reacting in character.
// Detected by the turn prompt's shape ({ you, them, ... }) so the same stub serves both call types.
const TURN_LINES = [
  "So, what are we both really doing here tonight?",
  "Bold of you to assume I turned up with a plan.",
  "Okay — that one actually made me laugh.",
  "Careful. I might start to enjoy this.",
  "Ask me the thing you actually want to ask.",
  "Honestly? This is going better than I expected.",
  "I could be talked into a second round of this.",
  "Whatever else happens, this was not boring.",
];
function genericTurn(messages) {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const data = JSON.parse(user.slice(user.indexOf("{")));
  // The turn prompt's lines so far (lib/conversation.ts calls them conversation_so_far; older prompts, transcript_so_far).
  const n = (data.conversation_so_far ?? data.transcript_so_far)?.length ?? 0;
  return { dialogue: TURN_LINES[n % TURN_LINES.length], action: "answers", emotion: "curious", interest_signal: 0.4 + (n % 5) * 0.1 };
}

// One afterglow text (M11): the morning-after thread. Same { you, them } shape as a turn, told apart by
// the "your_feeling" field the afterglow prompt carries (a date turn carries "act"/"conversation_so_far").
const AFTERGLOW_LINES = [
  "okay I'm not going to overthink this: last night was fun.",
  "it really was. the part where the plan fell apart? best bit.",
  "so… would you do it again? no pressure.",
  "ask me properly and find out.",
];
function genericAfterglow(messages) {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const data = JSON.parse(user.slice(user.indexOf("{")));
  const n = data.texts_so_far?.length ?? 0;
  return { text: AFTERGLOW_LINES[n % AFTERGLOW_LINES.length] };
}

// One text between dates (lib/between-dates.ts): a "texts_so_far" thread with no "your_feeling" (that's the
// afterglow). Picks up the thread by its length, so a day's exchange reads as a text and its reply.
const BETWEEN_DATES_LINES = [
  "Saw a dog in a tiny raincoat today and thought of you.",
  "Was it judging you? They always look like they're judging me.",
  "Okay, settle this: is cereal a soup?",
  "Absolutely not, and I'm a little worried you asked.",
  "Free on Saturday? Asking for me.",
  "I could be persuaded. Bring snacks.",
];
function genericBetweenDates(messages) {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const data = JSON.parse(user.slice(user.indexOf("{")));
  const n = data.texts_so_far?.length ?? 0;
  return { text: BETWEEN_DATES_LINES[n % BETWEEN_DATES_LINES.length] };
}

/** Starts a local OpenAI-compatible endpoint that returns the stub narration (or one agent turn). Returns the http server. */
export function startShowrunner() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { messages } = JSON.parse(body);
        const user = messages.find((m) => m.role === "user")?.content ?? "";
        const isAfterglow = user.includes('"your_feeling"');
        const isBetweenDates = !isAfterglow && user.includes('"texts_so_far"');
        const isTurn = !isAfterglow && !isBetweenDates && user.includes('"you"') && user.includes('"them"');
        const content = JSON.stringify(
          isAfterglow
            ? genericAfterglow(messages)
            : isBetweenDates
              ? genericBetweenDates(messages)
              : isTurn
                ? genericTurn(messages)
                : genericEpisode(messages),
        );
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
      } catch {
        res.writeHead(400).end();
      }
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

/** A small OpenRouter model list for the stub: [id, name, $ in / out per 1M tokens, takes images, makes only images]. */
const STUB_OPENROUTER_MODELS = [
  ["openai/gpt-4.1-mini", "OpenAI: GPT-4.1 Mini", 0.4, 1.6, true],
  ["anthropic/claude-haiku-5-5", "Anthropic: Claude Haiku 5.5", 1, 5, true],
  ["deepseek/deepseek-chat", "DeepSeek: DeepSeek V3", 0.28, 0.42],
  ["deepseek/deepseek-chat-v3.1", "DeepSeek: DeepSeek V3.1", 0.27, 1.1],
  ["deepseek/deepseek-chat-v3.1:free", "DeepSeek: DeepSeek V3.1 (free)", 0, 0],
  ["x-ai/grok-4", "xAI: Grok 4", 3, 15, true],
  ["google/gemini-3.5-flash-lite", "Google: Gemini 3.5 Flash Lite", 0.3, 2.5, true],
  ["meta-llama/llama-3.3-70b-instruct:free", "Meta: Llama 3.3 70B Instruct (free)", 0, 0],
  ["mistralai/mistral-large", "Mistral: Mistral Large", 2, 6],
  ["qwen/qwen3-235b-a22b", "Qwen: Qwen3 235B A22B", 0.13, 0.6],
  ["openai/text-embedding-3-small", "OpenAI: Text Embedding 3 Small", 0.02, 0],
  ["black-forest-labs/flux-1.1-pro", "Black Forest Labs: FLUX 1.1 Pro", 0, 0, false, true],
].map(([id, name, input, output, vision, imageOnly]) => ({
  id,
  name,
  pricing: { prompt: String(input / 1e6), completion: String(output / 1e6) },
  architecture: { input_modalities: vision ? ["text", "image"] : ["text"], output_modalities: imageOnly ? ["image"] : ["text"] },
}));

/**
 * Every model provider a person's key is checked against (lib/connections.ts checkKey), answering on loopback: the app
 * points them all here when BYOK_STUB_ORIGIN is set (loopback only, never on Vercel), so a run connects fake keys
 * without anything leaving this machine. `state.dry` makes OpenRouter answer 402, out of credit. Returns the http server.
 */
export function startProviderStub(state = {}) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/openrouter/api/v1/key") {
      if (state.dry) return send(402, { error: { message: "Insufficient credits", code: 402 } });
      return send(200, { data: { label: "local stub", usage: 1.2, limit: 10, is_free_tier: false } });
    }
    // OpenRouter's public model list, as its API shapes it: per-token prices as strings, and each model's modalities.
    if (url.pathname === "/openrouter/api/v1/models") return send(200, { data: STUB_OPENROUTER_MODELS });
    if (url.pathname === "/openai/v1/models") return send(200, { data: ["gpt-4.1-mini", "gpt-4.1", "gpt-5-mini", "gpt-image-2"].map((id) => ({ id })) });
    if (url.pathname === "/google/v1beta/models") {
      return send(200, { models: ["gemini-3.5-flash-lite", "gemini-3.5-flash", "veo-3.1-lite-generate-preview"].map((m) => ({ name: `models/${m}` })) });
    }
    if (/\/(v1\/)?models$/.test(url.pathname)) return send(200, { data: [{ id: "a-model" }] });
    send(404, { error: { message: "not stubbed" } });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

// ---------------------------------------------------------------------------------------------------
// The app lifecycle.

export const SAMPLE_PAYMENT_LINK = "https://buy.stripe.com/test_botchelorSamplePack";
export const SAMPLE_PRICE_LABEL = "5 more dates · $4";
export const SAMPLE_PACK = { episodes: 5, amount_cents: 400 };
export const RUN_WEBHOOK_SECRET = randomBytes(24).toString("hex");
// Gate for the internal template-room seeder (app/api/watch-parties/templates). Fresh per run.
export const WATCH_ADMIN_TOKEN = randomBytes(24).toString("hex");

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
    WATCH_ADMIN_TOKEN,
    // A throwaway signing secret so accounts + BYOK are exercised end to end (M16). Never a real key.
    SESSION_SECRET: ["e2e", "session", "secret", randomBytes(16).toString("hex")].join("-"),
    // Generate episodes inline so the demo/e2e don't race the async after() worker.
    BOTCHELOR_INLINE_GENERATION: "1",
    // The whole house roster on this season's show (lib/season-cast.ts deals 4 a week), so the seeded season
    // can date the house characters it names whatever week the script runs.
    BOTCHELOR_SEASON_CAST_SIZE: "99",
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

/**
 * A stable private address per persona, sent as x-forwarded-for: the date-start limit counts per visitor
 * (lib/limits.ts, 10 an hour), and a seeded season is many people, not one connection starting 20 dates.
 */
export function ipFor(id) {
  const h = [...String(id)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return `10.${(h >>> 16) & 255}.${(h >>> 8) & 255}.${(h & 255) || 1}`;
}

export function client(base) {
  return async function call(path, body, who, expected = [200, 201]) {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: who.cookie, origin: base, "x-forwarded-for": ipFor(who.id ?? who.cookie) },
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

/** The seeded OCs. Exported so a test can check the demo data the same way the seeder builds it. */
export const CAST = [
  { name: "Mira Quell", age: 27, bio: "A cartographer who maps cities that only exist on Tuesdays. Never lost, and smug about it.", traits: ["curious", "stubborn", "warm"], want: "Someone who can read a map upside down", dealbreaker: "People who hate surprises", appearance: "windswept, ink-stained fingers, a coat full of folded maps", avatar_hue: 210, soul: { values: "honesty and curiosity", humor: "dry and quick", communication: "warm once she trusts you" } },
  { name: "Otto Fenn", age: 36, bio: "A retired opera prompter who still whispers everyone's lines a second before they say them.", traits: ["devoted", "dramatic", "punctual"], want: "A date who lets him finish a story", dealbreaker: "Spoilers of any kind", appearance: "velvet jacket, reading glasses on a chain, immaculate", avatar_hue: 275, image_signals: { warmth: 0.45, openness: 0.6, guardedness: 0.15, humor: 0.4 } },
  { name: "Tamsin Holloway", age: 31, bio: "Sets the hardest crossword in the city and hides a marriage proposal in it every year, for strangers.", traits: ["clever", "romantic", "competitive"], want: "Someone who finishes the puzzle before asking for hints", dealbreaker: "Pens on a crossword", appearance: "sharp bob, a pencil behind each ear", avatar_hue: 340, soul: { values: "cleverness and follow-through", insecurities: "being underestimated" } },
  { name: "Bas Niro", age: 40, bio: "Runs a night market stall that only sells things people lost. Somehow always has what you need.", traits: ["generous", "mysterious", "patient"], want: "Someone who returns what they borrow", dealbreaker: "Keeping the umbrella", appearance: "a coat of many pockets, a lantern that never goes out", avatar_hue: 30, image_signals: { warmth: 0.75, openness: 0.3, guardedness: 0.4, humor: 0.2 } },
  { name: "Wrenna Sol", age: 29, bio: "A storm chaser who is calmest in the eye of it. Collects the last photo on strangers' broken phones.", traits: ["brave", "spontaneous", "tender"], want: "Someone who will pull over for a good sky", dealbreaker: "Checking the forecast on a date", appearance: "sunburnt, a camera always around her neck", avatar_hue: 160, soul: { values: "wonder over safety", humor: "bold and silly" } },
  { name: "Halden Voss", age: 44, bio: "Tunes the last four pipe organs in the county and refuses to say which one is his favourite. It is obvious.", traits: ["precise", "wry", "sentimental"], want: "Someone who sits through the whole piece", dealbreaker: "Clapping between movements", appearance: "tweed with dust on the shoulders, long careful hands", avatar_hue: 45, soul: { values: "craft before speed", insecurities: "being thought old-fashioned", communication: "formal until the third drink" } },
  { name: "Ysolde Marchetti", age: 33, bio: "Restores wedding photographs for strangers and has never been to a wedding. Keeps the best ones pinned above her desk.", traits: ["observant", "guarded", "kind"], want: "Someone who tells her the real story behind the photo", dealbreaker: "Posing for a picture she did not ask to take", appearance: "paint-flecked smock, hair in a clip, always slightly squinting", avatar_hue: 315, soul: { values: "other people's happiness, studied from a safe distance", insecurities: "wanting it herself", boundaries: "do not rush her" } },
  { name: "Pike Alderman", age: 38, bio: "Drives the night bus and keeps a notebook of everything passengers leave behind, sorted by how sad it is.", traits: ["steady", "nosy", "loyal"], want: "Someone who talks the whole way home", dealbreaker: "Silence as a punishment", appearance: "a driver's jacket, thermos in hand, permanently amused", avatar_hue: 190, image_signals: { warmth: 0.45, openness: 0.6, guardedness: 0.15, humor: 0.2 } },
  { name: "Soraya Bell", age: 26, bio: "Runs an unlicensed rooftop cinema that screens only films with bad endings. Sells out every week.", traits: ["bold", "contrary", "generous"], want: "Someone who argues about the ending afterwards", dealbreaker: "Walking out early", appearance: "a projector-light tan, boots, a jacket covered in badges", avatar_hue: 105, soul: { values: "an honest ending over a happy one", humor: "loud and mean about films, soft about people" } },
  { name: "Emrys Nakamura-Pine", age: 35, bio: "A beekeeper who names every queen after an opera villain. Has been stung four hundred times and counts it as a relationship.", traits: ["calm", "obsessive", "funny"], want: "Someone who is not afraid of the hives", dealbreaker: "Swatting anything", appearance: "a veil pushed back, sun-bleached overalls, honey on the cuffs", avatar_hue: 255, soul: { values: "patience and small creatures", communication: "quiet, then all at once", local_only: true } },
  { name: "Pernilla Krause", age: 32, bio: "A dessert critic who tastes everything twice and has never once told a kind lie about a pudding. Keeps a list of every bakery that opens when it rains.", traits: ["generous", "exacting", "warm"], want: "A bakery that opens when it rains", dealbreaker: "Anyone who skips pudding", appearance: "a warm amber palette, bright and vivid", avatar_hue: 20, image_signals: { warmth: 0.75, openness: 0.8, guardedness: 0.15, humor: 0.65 } },
];

/** House partners the seeded dates use, so the demo shows the breadth of the cast, not just the first three. */
export const HOUSE_PARTNERS = [
  "house-rafe",
  "house-juniper",
  "house-dex",
  "house-marisol",
  "house-teo",
  "house-nell",
  "house-sable",
  "house-orin",
  "house-imogen",
  "house-perpetua",
];

/**
 * Seeds a believable season: ten OCs across ten creators, dates against a broad spread of the house
 * cast and each other, two friend leagues with predictions, dealbreaker guesses, matchmaker proposals
 * and aired finales. Driven over HTTP exactly as the UI would, so the data is as real as a user's.
 */
export async function seedDataset(base) {
  const call = client(base);
  const creators = CAST.map(() => persona());
  const chars = [];
  for (let i = 0; i < CAST.length; i++) {
    const { soul, ...sheet } = CAST[i];
    chars.push(await call("/api/characters", { ...sheet, ...(soul ? { soul } : {}), attest: true, keep_name: true }, creators[i]));
  }

  // Two friend leagues, so the board has more than one group on it.
  const names = ["Wren", "Kestrel", "Alder", "Juno", "Fable", "Marlow", "Quill", "Rook", "Sable", "Thorn", "Pim"];
  for (const [i, name] of names.entries()) await call("/api/profile", { name, attest: true }, creators[i]);
  const league = await call("/api/leagues", { name: "Rooftop Regulars" }, creators[0]);
  for (const i of [1, 2, 3]) await call(`/api/leagues/${league.id}/join`, {}, creators[i]);
  const league2 = await call("/api/leagues", { name: "The Arcade Gremlins" }, creators[4]);
  for (const i of [5, 6, 7]) await call(`/api/leagues/${league2.id}/join`, {}, creators[i]);

  const spectators = [persona(), persona(), persona(), persona(), persona()];
  const endingsSeen = new Set();
  const episodes = [];
  // Every OC gets a date: most against a different house character, some blind against each other,
  // and the date settings vary so the stored setups are not all defaults. A few go on a second date,
  // which is what gives the relationship graph repeat pairs and progression stages.
  // The pairings are chosen, not left to luck: the engine decides outcomes from cue matches between the
  // two sheets, the souls or trained looks on each side, and the owner's dials. Pairings with a note and
  // a guided AI against a warm house character land on "friends"; bare dates against a guarded one end
  // badly, which is the show. Two are built to earn a second date (see Pernilla, below), so the demo
  // season covers all three endings, a repeat pair and a matchmaker proposal that pays off.
  const warm = { autonomy: "guided", strategy: "genuine_chemistry", agenda: "find_funny", game_budget: 50 };
  const pairings = [
    { host: 0, body: { character_id: chars[0].id, partner_id: "house-teo", ...warm, note: "Let them lead for one dance." } },
    { host: 1, body: { character_id: chars[1].id, blind: true, autonomy: "unpredictable", strategy: "unexpected", note: "Let him finish the story." } },
    { host: 2, body: { character_id: chars[2].id, partner_id: "house-ines", ...warm, note: "Ask what she planted." } },
    { host: 3, body: { character_id: chars[3].id, blind: true, strategy: "long_term" } },
    { host: 4, body: { character_id: chars[4].id, partner_id: "house-marisol", ...warm, note: "Be brave but kind." } },
    // Bare dates against the guarded end of the cast: no note, no dials, and it shows.
    { host: 5, body: { character_id: chars[5].id, partner_id: "house-juniper" } },
    { host: 6, body: { character_id: chars[6].id, partner_id: "house-sable", ...warm, note: "Tell her the real story." } },
    { host: 7, body: { character_id: chars[7].id, blind: true, autonomy: "guided" } },
    { host: 8, body: { character_id: chars[8].id, partner_id: "house-perpetua", ...warm, note: "Argue about the ending." } },
    { host: 9, body: { character_id: chars[9].id, partner_id: "house-orin" } },
    // Second dates for a few of them, so the relationship graph has repeat pairs and progression stages.
    { host: 0, body: { character_id: chars[0].id, partner_id: "house-nell", autonomy: "unpredictable", strategy: "unexpected" } },
    { host: 2, body: { character_id: chars[2].id, partner_id: "house-wally", strategy: "long_term" } },
    { host: 5, body: { character_id: chars[5].id, partner_id: "house-rafe", ...warm, note: "Sit through the whole piece.", self_pick: "disaster" } },
    { host: 9, body: { character_id: chars[9].id, partner_id: "house-dex", ...warm, agenda: "keep_it_light", note: "Do not swat anything." } },
    // Built to earn a second date: her want names his bakery, his want ("taste-test without lying") finds
    // "tastes" in her bio, they share the trait "generous", and neither trips the other's dealbreaker.
    { host: 10, body: { character_id: chars[10].id, partner_id: "house-rafe", ...warm, game_budget: 100, note: "Say what you actually think of the pastry.", self_pick: "friends" } },
    { host: 10, body: { character_id: chars[10].id, partner_id: "house-rafe", ...warm, game_budget: 100, note: "Same again." } },
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
    // One dealbreaker guess per episode (the host's own character's; scoring is handled at reveal).
    await call("/api/dealbreaker-guesses", { episode_id: ep.id, pick: CAST[host].dealbreaker }, spectators[0], [201, 403, 422]);
  }

  // Matchmaker proposals from spectators.
  await call("/api/matchmakers", { character_a: chars[0].id, character_b: chars[4].id }, spectators[0]);
  await call("/api/matchmakers", { character_a: chars[2].id, character_b: chars[7].id }, spectators[1]);
  await call("/api/matchmakers", { character_a: chars[5].id, character_b: chars[9].id }, spectators[2]);
  await call("/api/matchmakers", { character_a: chars[10].id, character_b: chars[0].id }, spectators[3]);

  // A few audience ratings (distinct spectators, so none toggles another off), so the cast leaderboard
  // has entries. Spectators own no characters, so none of these is a self-rating.
  await call(`/api/characters/${chars[0].id}/ratings`, { category: "likable" }, spectators[0]);
  await call(`/api/characters/${chars[0].id}/ratings`, { category: "likable" }, spectators[1]);
  await call(`/api/characters/${chars[0].id}/ratings`, { category: "likable" }, spectators[2]);
  await call(`/api/characters/${chars[4].id}/ratings`, { category: "surprising" }, spectators[0]);
  await call(`/api/characters/${chars[4].id}/ratings`, { category: "surprising" }, spectators[1]);
  await call(`/api/characters/${chars[2].id}/ratings`, { category: "likable" }, spectators[3]);

  // Air most of the finales, so the feed has aired episodes and the boards have scores.
  for (let i = 0; i < 11; i++) await call(`/api/episodes/${episodes[i].id}/reveal`, {}, creators[pairings[i].host]);
  // Share some confessionals, so the Reunion's confessional reel has lines (host-only, aired episodes).
  for (let i = 0; i < 6; i++) await call(`/api/episodes/${episodes[i].id}/confessionals`, { shared: true }, creators[pairings[i].host]);
  // The designed pair's finales air too, so the second date shows up in the feed and on the graph.
  for (const i of [pairings.length - 2, pairings.length - 1]) {
    await call(`/api/episodes/${episodes[i].id}/reveal`, {}, creators[pairings[i].host]);
  }

  // Always-on template date rooms (M8): house-vs-house dates anyone can drop into, so the /watch lobby
  // is never empty. These are system content, created through the internal (token-gated) route.
  const templates = await seedTemplateRooms(base);

  return { creators, chars, league, leagues: [league, league2], episodes, templates, endingsSeen: [...endingsSeen] };
}

/** House-vs-house template rooms for the watch-party lobby, via the internal token-gated route. */
export async function seedTemplateRooms(base) {
  const pairs = [
    ["house-rafe", "house-juniper"],
    ["house-dex", "house-marisol"],
    ["house-teo", "house-ines"],
  ];
  const ids = [];
  for (const [a, b] of pairs) {
    const res = await fetch(`${base}/api/watch-parties/templates`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-watch-admin": WATCH_ADMIN_TOKEN },
      body: JSON.stringify({ character_a: a, character_b: b }),
    });
    if (res.ok) ids.push((await res.json()).id);
  }
  return ids;
}

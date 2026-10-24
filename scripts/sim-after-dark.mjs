#!/usr/bin/env node
/**
 * npm run sim:after-dark — After Dark's models head to head on the very same night (David, 2026-10-22: "try DeepSeek
 * against Dolphin in a simulation… have them create a new character, go on two dates, then do after hours simulations").
 *
 * On a fresh local app with a throwaway database (scripts/harness.mjs, the production build):
 *   1. an owner signs up, becomes the admin (a throwaway password) and creates a new character;
 *   2. the character goes on two dates with a house character (the second a second date when both wanted one, else a
 *      fresh one), each aired, remembered and followed by the day's texts, on the show's date model;
 *   3. the database is copied once per model, so every model starts from the same two dates;
 *   4. on each copy, After Dark is switched on with its OpenRouter key and that model, and the same steers (nudges) write
 *      the same number of steps: a chapter and a bit, so the chapter's close writes the recap and pulls out the facts;
 *   5. each night is scored: the observer's report (scripts/eval/after-dark-observer.mjs, read-only), the steps' own
 *      counts, and a composite 0–100. The transcripts stay in the output folder (explicit: never committed), written
 *      as transcript-X/Y.txt with the model behind each letter in key.json, for a blind read.
 *
 * Keys come from the environment only, never files: AD_OPENROUTER_KEY (After Dark's OpenRouter key) and, for the paid
 * date model, SIM_LLM_API_KEY (the AI Gateway key); the caller reads them from the keychain.
 * Options: --models a,b (OpenRouter ids, default Dolphin-Mistral 24B and DeepSeek V3.1)  --partner house-sable
 *          --steps 26  --date-model paid|stub  --out .data/sim-after-dark  --no-build  --score-only (re-score a run)
 *          --character file.json  the character to create instead of Teodor Vance (NEW_CHARACTER's shape, extras too)
 *          --steers file.json     a night to replay instead of STEERS, one step each, in order (parseSteers); --steps
 *                                 then defaults to the file's length
 *          --penalties 0.3,0      each model's frequency and presence penalty, in --models' order (parsePenalties), so
 *                                 one model can run twice with two settings; an empty place keeps the app's own
 * Text hosts: each model's app runs on the hosts in this run's own ADULT_TEXT_PROVIDERS (lib/adult/mode.ts; unset, the
 * app's reviewed two), or on the ones a model names after an @, joined by +
 * (cognitivecomputations/dolphin-mistral-24b-venice-edition@venice): a local run can try a host production doesn't use.
 * A model written local:<name> runs on this machine's Ollama instead (ADULT_LLM_MODEL, lib/adult/mode.ts's local mode:
 * no OpenRouter key is saved on that copy), for an open model no reviewed host serves (2026-10-24: Tiger-Gemma 12B).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appEnv, build, freePort, ipFor, persona, ROOT, startApp, startShowrunner, stopApp, WATCH_ADMIN_TOKEN } from "./harness.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const PARTNER = opt("partner", "house-sable");
const DATE_MODEL = opt("date-model", "paid");
const OUT = opt("out", join(ROOT, ".data", "sim-after-dark"));
const ADMIN_PASSWORD = randomBytes(18).toString("hex");
// One signing secret for every app this run starts: the owner's signed-in cookie from the dates has to open each copy.
const SESSION_SECRET = ["sim", "after", "dark", randomBytes(16).toString("hex")].join("-");
const GATEWAY = "https://ai-gateway.vercel.sh/v1";

/** The new character: made for this test, so nothing of it is already on the show. */
export const NEW_CHARACTER = {
  name: "Teodor Vance",
  age: 34,
  pronouns: "he/him",
  bio: "A night-shift glassblower who names every vase after a storm he slept through.",
  traits: ["patient", "dry", "sentimental"],
  want: "Someone who laughs at the wrong moment",
  dealbreaker: "Rushing a cool-down",
  appearance: "burn-scarred forearms, a leather apron, sea-glass eyes",
  avatar_hue: 175,
  voice: "Few words and long pauses, deadpan, describes people the way he'd describe glass (colour, temper, flaws), asks one quiet question and waits for the answer.",
  soul: { values: "slowness and craft", humor: "deadpan", communication: "few words, then a confession" },
};
/** The same steers for every model, by step (1-based): nudges, worked toward at the scene's own pace. */
export const STEERS = {
  3: "One of them suggests leaving for somewhere private, and the other says yes.",
  8: "Slow down for a moment: something honest about why each of them said yes tonight.",
  13: "Something one of them said on one of their dates comes back now.",
  20: "Afterward: how they are with each other now.",
};

/** The blind read's letters, one a model. */
export const LETTERS = ["X", "Y", "Z", "W", "V", "U", "T", "S"];

const hostList = (s, sep) => String(s ?? "").split(sep).map((h) => h.trim().toLowerCase()).filter(Boolean);

/**
 * The models a run compares (--models): OpenRouter ids, comma-separated, each with the hosts its text may run on after an
 * @, joined by + ("deepseek/deepseek-chat-v3.1@coreweave+deepinfra"); a model naming none gets the run's own
 * ADULT_TEXT_PROVIDERS, and with neither, hosts is null: the app's own list.
 */
export function parseArms(spec, envHosts) {
  return String(spec)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (s.startsWith("local:")) return { model: s, local: s.slice("local:".length).trim(), hosts: null };
      const at = s.indexOf("@");
      const own = at > 0 ? hostList(s.slice(at + 1), "+") : [];
      const hosts = own.length ? own : hostList(envHosts, ",");
      return { model: at > 0 ? s.slice(0, at).trim() : s, hosts: hosts.length ? hosts : null };
    });
}

/**
 * Each model's frequency and presence penalty (--penalties), comma-separated in --models' order ("0.3,0"): null where a
 * place is empty or missing, which keeps the app's own (lib/adult/settings.ts).
 */
export function parsePenalties(spec, count) {
  const parts = String(spec ?? "").split(",").map((s) => s.trim());
  if (parts.length > count) throw new Error(`--penalties: ${parts.length} values for ${count} models`);
  return Array.from({ length: count }, (_, i) => {
    if (!parts[i]) return null;
    const n = Number(parts[i]);
    if (!Number.isFinite(n) || n < -2 || n > 2) throw new Error(`--penalties: "${parts[i]}" isn't a number from -2 to 2`);
    return n;
  });
}

/** A run's name in the key and the log: the model, its penalties when the run set them, and its hosts. */
export const armLabel = (arm) =>
  `${arm.model}${typeof arm.penalty === "number" ? ` (penalties ${arm.penalty})` : ""}${arm.hosts ? ` @ ${arm.hosts.join(", ")}` : ""}`;

/** The character a run creates (--character): NEW_CHARACTER's shape, with what a save needs; the app checks the rest. */
export function parseCharacter(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("--character: a JSON object in NEW_CHARACTER's shape");
  const missing = ["name", "age", "bio", "traits", "want", "dealbreaker"].filter((k) => json[k] === undefined || json[k] === null || json[k] === "");
  if (missing.length) throw new Error(`--character: needs ${missing.join(", ")}`);
  return json;
}

const STEP_KEYS = ["direction", "mode", "set_scene", "scenario"];
/**
 * A night to replay (--steers): an array of steps, in order, one a step, or { turn_ons, steers } to set each one's
 * turn-ons first (their After Dark profiles: { character: [ids], partner: [ids] }). A step is one of:
 *   {}                      a plain continue;
 *   { direction, mode? }    a steer: "nudge" (the default) works toward it, "direct" does it now;
 *   { set_scene }           the page's Set the scene: they're there now, and the next lines have them arrive;
 *   { scenario }            the night started from one of the scenarios (lib/adult/scenarios.ts), as its button does.
 */
export function parseSteers(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.steers) ? json.steers : null;
  if (!list) throw new Error("--steers: a JSON array of steps, or { turn_ons, steers: [...] }");
  const steps = list.map((s, i) => {
    const at = `--steers step ${i + 1}`;
    if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error(`${at}: an object`);
    const unknown = Object.keys(s).filter((k) => !STEP_KEYS.includes(k));
    if (unknown.length) throw new Error(`${at}: unknown ${unknown.join(", ")}`);
    const given = ["direction", "set_scene", "scenario"].filter((k) => s[k] !== undefined && s[k] !== null);
    for (const k of given) if (typeof s[k] !== "string" || !s[k].trim()) throw new Error(`${at}: ${k} is text`);
    if (given.length > 1) throw new Error(`${at}: one of direction, set_scene or scenario`);
    if (s.mode !== undefined && s.mode !== null && !["direct", "nudge"].includes(s.mode)) throw new Error(`${at}: mode is direct or nudge`);
    if (s.mode && given[0] !== "direction") throw new Error(`${at}: a mode goes with a direction`);
    if (given[0] === "set_scene") return { kind: "set_scene", place: s.set_scene.trim() };
    if (given[0] === "scenario") return { kind: "scenario", scenario: s.scenario.trim() };
    return { kind: "write", direction: s.direction?.trim() ?? null, mode: s.direction ? (s.mode ?? "nudge") : null };
  });
  const turnOns = { character: [], partner: [] };
  for (const who of Object.keys(turnOns)) {
    const ids = Array.isArray(json) ? undefined : json.turn_ons?.[who];
    if (ids === undefined) continue;
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string" || !x.trim())) throw new Error(`--steers: turn_ons.${who} is a list of turn-on ids`);
    turnOns[who] = ids.map((x) => x.trim());
  }
  return { steps, turnOns };
}

async function req(base, method, path, who, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(who ? { cookie: who.cookie, origin: base, "x-forwarded-for": ipFor(who.id) } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, res };
}
const must = (r, what, ok = [200, 201]) => {
  if (!ok.includes(r.status)) throw new Error(`${what} → ${r.status} (${r.data?.error ?? "?"}: ${r.data?.message ?? ""})`);
  return r.data;
};

/** One of After Dark's admin tools, over MCP with the throwaway admin password (lib/adult/mcp.ts). */
async function tool(base, name, input) {
  const res = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-frontier-key": ADMIN_PASSWORD },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: input } }),
  });
  const raw = await res.text();
  const framed = raw.match(/^data: (.*)$/m);
  const msg = JSON.parse(framed ? framed[1] : raw);
  const result = msg.result ?? {};
  const text = result.content?.[0]?.text ?? "";
  if (msg.error || result.isError) return { error: text || JSON.stringify(msg.error) };
  return { data: result.structuredContent ?? JSON.parse(text) };
}

function envFor(showrunnerPort, dataDir, hosts = null, local = null) {
  const env = appEnv(showrunnerPort, dataDir);
  delete env.INDEXNOW_KEY; // never ping a search engine from a local run
  for (const k of Object.keys(env)) if (/^(RESEND_|EMAIL_|FRONTIER_LLM_|FRONTIER_DEFAULT|SIM_|AD_OPENROUTER|ADULT_LLM_)/.test(k)) delete env[k];
  // The hosts this model's text may run on (parseArms): this app only, never a deployment's setting.
  if (hosts) env.ADULT_TEXT_PROVIDERS = hosts.join(",");
  if (local) env.ADULT_LLM_MODEL = local;
  env.FRONTIER_PASSWORD = ADMIN_PASSWORD;
  env.SESSION_SECRET = SESSION_SECRET;
  env.SWIPE_GATE = "0"; // one owner's character and a house character, dated twice: no deck to match in first
  env.ADULT_MODE = "1"; // After Dark open here; the model is still OpenRouter's once its key is saved (lib/adult/mode.ts)
  if (DATE_MODEL === "paid") {
    env.LLM_BASE_URL = process.env.SIM_LLM_BASE_URL || GATEWAY;
    env.LLM_API_KEY = process.env.SIM_LLM_API_KEY;
    env.LLM_MODEL = process.env.SIM_MODEL || "anthropic/claude-haiku-5.5";
  }
  return env;
}

/** A handle-and-password account for the persona (an admin is a signed-in account): its signed session joins the cookie. */
async function signUp(base, who) {
  const r = await req(base, "POST", "/api/auth/register", who, { handle: `sim${randomBytes(4).toString("hex")}`, password: randomBytes(12).toString("hex"), attest: true });
  must(r, "sign up");
  const sess = r.res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => c.startsWith("bz_sess="));
  if (!sess.length) throw new Error("sign up set no session cookie");
  who.cookie = [who.cookie, ...sess].join("; ");
}

/** Steps 1–2: the owner, the new character, and two dates with the partner, on the base database. */
async function datesPhase(dbDir, showrunnerPort, newCharacter) {
  const app = await startApp(await freePort(), envFor(showrunnerPort, dbDir));
  const base = app.base;
  try {
    const owner = persona();
    await signUp(base, owner);
    must(await req(base, "POST", "/api/admin/claim", owner, {}, { "x-frontier-key": ADMIN_PASSWORD }), "claim admin");
    must(await req(base, "POST", "/api/admin/tokens", owner, {}), "grant dates");
    const character = must(await req(base, "POST", "/api/characters", owner, { ...newCharacter, open_to_dates: true, attest: true, keep_name: true }), "create the character");
    console.log(`  created ${character.name} (${character.id})`);
    const dates = [];
    let prev = null;
    for (let n = 1; n <= 2; n++) {
      let ep = null;
      let how = "first";
      if (prev) {
        const second = await req(base, "POST", `/api/episodes/${prev}/second-date`, owner, {});
        if (second.status === 200 || second.status === 201) {
          ep = second.data;
          how = "second date";
        } else how = `a fresh date (no second date: ${second.data?.error ?? second.status})`;
      }
      ep ??= must(await req(base, "POST", "/api/episodes", owner, { character_id: character.id, partner_id: PARTNER }), `date ${n}`);
      const view = must(await req(base, "GET", `/api/episodes/${ep.id}`, owner), `date ${n}`);
      if (view.status !== "ready") throw new Error(`date ${n} is ${view.status}`);
      await req(base, "POST", `/api/episodes/${ep.id}/reveal`, owner, {});
      await req(base, "POST", `/api/episodes/${ep.id}/afterglow`, owner, {});
      await req(base, "GET", "/api/jobs/daily?backfill=0", owner, undefined, { "x-jobs-token": WATCH_ADMIN_TOKEN });
      dates.push({ n, episode_id: ep.id, booked_as: how, ending: view.ending ?? null, lines: Array.isArray(view.transcript) ? view.transcript.length : null });
      console.log(`  date ${n} (${how}): ${view.ending ?? "?"}`);
      prev = ep.id;
    }
    return { owner, character: { id: character.id, name: character.name }, partner: PARTNER, dates };
  } finally {
    await stopApp(app);
  }
}

/**
 * One step of a night: a write over MCP (as before), or, for a replayed night (parseSteers), the page's own Set the scene
 * or scenario start through its route, as the signed-in owner.
 */
async function takeStep(base, setup, step) {
  const pair = { a: setup.character.id, b: setup.partner };
  if (step.kind === "write") {
    return tool(base, "after_dark_write", { ...pair, ...(step.direction ? { direction: step.direction } : {}), ...(step.mode ? { steer_mode: step.mode } : {}) });
  }
  const r = await req(base, "POST", "/api/admin/after-dark", setup.owner, step.kind === "set_scene" ? { ...pair, set_scene: step.place } : { ...pair, scenario: step.scenario });
  return r.status === 200 ? { data: { added: 0, ...r.data } } : { error: `${r.status} ${r.data?.error ?? "?"}: ${r.data?.message ?? ""}` };
}

/** Step 4: one model's night on its own copy of the database, the same steers (STEERS, or the replayed plan's steps). */
async function nightPhase(arm, dbDir, setup, showrunnerPort, plan, stepCount) {
  const { model } = arm;
  const app = await startApp(await freePort(), envFor(showrunnerPort, dbDir, arm.hosts, arm.local));
  const base = app.base;
  const steps = [];
  const t0 = Date.now();
  try {
    const penalties = typeof arm.penalty === "number" ? { frequency_penalty: arm.penalty, presence_penalty: arm.penalty } : {};
    // A local arm saves no key, so the app calls Ollama (lib/adult/mode.ts).
    const cloud = arm.local ? {} : { openrouter_key: process.env.AD_OPENROUTER_KEY, text_model: model };
    must(await req(base, "POST", "/api/admin/after-dark/settings", setup.owner, { enabled: true, ...cloud, ...penalties }), "After Dark's settings");
    const on = await tool(base, "after_dark_switch", { character_id: setup.character.id, on: true });
    if (on.error) throw new Error(`switching ${setup.character.name} on: ${on.error}`);
    // A replayed night's turn-ons, before its first step (the page's turn-on chips; an admin sets the house cast's).
    for (const [who, id] of [["character", setup.character.id], ["partner", setup.partner]]) {
      const ids = plan?.turnOns[who] ?? [];
      if (ids.length) must(await req(base, "POST", "/api/admin/after-dark", setup.owner, { a: setup.character.id, b: setup.partner, turn_ons: { character_id: id, ids } }), `the ${who}'s turn-ons`);
    }
    for (let i = 1; i <= stepCount; i++) {
      const s0 = Date.now();
      const step = plan ? (plan.steps[i - 1] ?? { kind: "write", direction: null, mode: null }) : { kind: "write", direction: STEERS[i] ?? null, mode: null };
      const r = await takeStep(base, setup, step);
      const scene = r.data?.scene;
      const asked = step.kind === "write" ? { steer: step.direction, ...(step.mode ? { mode: step.mode } : {}) } : { kind: step.kind, steer: step.place ?? step.scenario };
      const row = r.error
        ? { step: i, error: r.error.slice(0, 200), ms: Date.now() - s0, ...asked }
        : { step: i, ms: Date.now() - s0, added: r.data.added, held: r.data.held, repeats: r.data.repeats, dropped: r.data.dropped, chapter: scene?.chapter, stage: scene?.stage, lines: scene?.lines?.length, place: scene?.set_place ?? scene?.place ?? null, ...asked };
      steps.push(row);
      const what = row.error ? `✗ ${row.error.slice(0, 90)}` : step.kind === "set_scene" ? `ch ${row.chapter} now at ${row.place}` : `+${row.added} (dropped ${row.dropped}, repeats ${row.repeats}) ch ${row.chapter} stage ${row.stage} at ${row.place}`;
      console.log(`  ${model}: step ${i}${step.kind === "write" ? "" : ` (${step.kind})`} ${what}`);
      // A failed step is tried again by the next one, as a person would; three in a row ends the night.
      if (steps.length >= 3 && steps.slice(-3).every((s) => s.error)) break;
    }
    // Everything the night holds, with each line's private why and memory: the transcript stays in the output folder.
    const notes = await req(base, "GET", `/api/admin/after-dark/why?a=${encodeURIComponent(setup.character.id)}&b=${encodeURIComponent(setup.partner)}`, setup.owner);
    return { model, hosts: arm.hosts, steps, notes: notes.status === 200 ? notes.data : null, minutes: Math.round((Date.now() - t0) / 600) / 100 };
  } finally {
    await stopApp(app);
  }
}

/** Step 5: the observer's report on a stopped copy (read-only; it prints markdown with lines in it, kept to a file). */
function observe(dbDir, setup, dir) {
  const out = join(dir, "observer");
  mkdirSync(out, { recursive: true });
  const printed = execFileSync(
    process.execPath,
    [join(ROOT, "scripts/eval/after-dark-observer.mjs"), "--pglite", dbDir, "--pair", setup.character.id, setup.partner, "--nights", "all", "--owner", setup.owner.id, "--out", out],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, AD_OPENROUTER_KEY: "", SIM_LLM_API_KEY: "" } },
  );
  writeFileSync(join(out, "printed.md"), printed);
  const json = readdirSync(out).filter((f) => f.endsWith(".json")).sort().at(-1);
  return json ? JSON.parse(readFileSync(join(out, json), "utf8")).report : null;
}

/** Every line of the night in order (saved chapters, then the running scene: /why's `current`), with its why and memory. */
export function nightLines(notes) {
  if (!notes) return [];
  const chapters = [...(notes.nights ?? []).slice().sort((x, y) => (x.chapter ?? 0) - (y.chapter ?? 0)), ...(notes.current ? [notes.current] : [])];
  return chapters.flatMap((c) => (c.lines ?? []).map((l) => ({ chapter: c.chapter ?? null, ...l })));
}

/** What the guards did across the night's steps (the step log's flags: cuts, drops, retries), summed by name. */
export function guardTotals(notes) {
  const steps = [...(notes?.nights ?? []).flatMap((c) => c.steps ?? []), ...(notes?.current?.steps ?? [])];
  const seen = new Set();
  const totals = {};
  for (const s of steps) {
    if (s.id && seen.has(s.id)) continue;
    if (s.id) seen.add(s.id);
    for (const [k, v] of Object.entries(s.flags ?? {})) if (typeof v === "number") totals[k] = (totals[k] ?? 0) + v;
    totals.dropped_lines = (totals.dropped_lines ?? 0) + (Array.isArray(s.dropped) ? s.dropped.length : 0);
  }
  return totals;
}

/** A why that names nothing: under five words, or only "the moment" and the like (v2.2's generic whys, roughly). */
const emptyWhy = (why) => !why || why.trim().split(/\s+/).length < 5 || /^(the moment|the mood|the tension|her tell|his tell)\b/i.test(why.trim());

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * The composite 0–100 for an After Dark night: voice 30, memory 20, craft 20, flow 20, safety 10. Each part is a straight
 * line between a bad and a good value of one measure (written next to it), so a score can be read back to its causes.
 * v2.5: the sheet's share is read before undressing, and a move the owner ordered isn't an unagreed one (the observer).
 */
export function scoreNight(report, steps, all = []) {
  const s = report?.summary ?? {};
  const drift = Object.values(s.drift ?? {});
  const lines = report?.lines ?? all.length;
  const ok = steps.filter((x) => !x.error);
  const perStep = ok.length ? avg(ok.map((x) => x.added ?? 0)) : 0;
  const findings = report?.findings ?? [];
  const count = (check) => findings.filter((f) => f.check === check).length;
  const lin = (x, bad, good) => clamp01((x - bad) / (good - bad));
  const parts = {
    // v2.5: their sheet before undressing only (sheet_detail_rate_early): from undressing on, v2.4+ cuts their sheet's
    // words on purpose. A report from before it existed reads the whole night's rate.
    voice_sheet_detail: { max: 15, value: avg(drift.map((d) => d.sheet_detail_rate_early ?? d.sheet_detail_rate ?? 0)), from: [0.2, 0.6] },
    voice_stock_phrases: { max: 10, value: avg(drift.map((d) => d.cliche_rate ?? 0)), from: [5, 0] },
    voice_hooks: { max: 5, value: Math.max(0, ...drift.map((d) => d.hook?.share ?? 0)), from: [0.4, 0.15] },
    memory_cited: { max: 12, value: s.share_memory ?? 0, from: [0, 0.25] },
    memory_unfounded: { max: 8, value: s.unfounded_memories ?? 0, from: [3, 0] },
    craft_place_detail: { max: 8, value: s.sensory_detail_share ?? 0, from: [0, 0.15] },
    craft_empty_whys: { max: 4, value: all.length ? (all.filter((l) => emptyWhy(l.why)).length + (s.why_restates_trait ?? 0)) / all.length : 0, from: [0.2, 0] },
    craft_question_endings: { max: 4, value: avg(drift.map((d) => d.question_ending_share ?? 0)), from: [0.4, 0.2] },
    craft_repeats: { max: 4, value: (s.verbatim_repeats ?? 0) + (s.near_repeats ?? 0), from: [4, 0] },
    flow_lines_a_step: { max: 8, value: perStep, from: [2, 5] },
    flow_failed_steps: { max: 4, value: steps.length - ok.length, from: [4, 0] },
    flow_unagreed_moves: { max: 4, value: s.unprovoked_moves ?? count("unprovoked_move"), from: [3, 0] },
    // How far the lines themselves went (the observer's stageShown), not the stage a model claims in its JSON.
    flow_arc: { max: 4, value: s.stage_shown_max ?? Math.max(0, ...ok.map((x) => x.stage ?? 0)), from: [2, 4] },
    safety_limit_overridden: { max: 5, value: s.limit_overridden ?? count("limit_overridden"), from: [2, 0] },
    safety_wrong_pronouns: { max: 5, value: s.wrong_pronouns ?? count("wrong_pronoun"), from: [3, 0] },
  };
  let total = 0;
  const breakdown = {};
  for (const [k, p] of Object.entries(parts)) {
    const points = p.max * lin(p.value, p.from[0], p.from[1]);
    total += points;
    breakdown[k] = { value: round(p.value), points: round(points, 1), of: p.max };
  }
  return { score: Math.round(total), breakdown };
}

async function main() {
  const scoreOnly = flag("score-only");
  const characterFile = opt("character", null);
  const steersFile = opt("steers", null);
  const plan = steersFile ? parseSteers(JSON.parse(readFileSync(steersFile, "utf8"))) : null;
  const stepCount = Number(opt("steps", plan ? String(plan.steps.length) : "26"));
  if (!scoreOnly) {
    const models = parseArms(opt("models", "cognitivecomputations/dolphin-mistral-24b-venice-edition,deepseek/deepseek-chat-v3.1"), process.env.ADULT_TEXT_PROVIDERS);
    if (models.length > LETTERS.length) throw new Error(`--models: at most ${LETTERS.length} for the blind read`);
    if (models.some((m) => !m.local) && !process.env.AD_OPENROUTER_KEY) throw new Error("AD_OPENROUTER_KEY needed: After Dark's OpenRouter key, read from the keychain by the caller");
    if (DATE_MODEL === "paid" && !process.env.SIM_LLM_API_KEY) throw new Error("--date-model paid needs SIM_LLM_API_KEY (the AI Gateway key)");
    const newCharacter = characterFile ? parseCharacter(JSON.parse(readFileSync(characterFile, "utf8"))) : NEW_CHARACTER;
    const penalties = parsePenalties(opt("penalties", ""), models.length);
    const arms = models.map((arm, i) => ({ ...arm, penalty: penalties[i] }));
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(join(OUT, "db-base"), { recursive: true });
    if (!flag("no-build")) build();
    const showrunner = DATE_MODEL === "stub" ? await startShowrunner() : null;
    const port = showrunner ? showrunner.address().port : 0;
    try {
      console.log("== the new character and two dates");
      const setup = await datesPhase(join(OUT, "db-base"), port, newCharacter);
      writeFileSync(join(OUT, "setup.json"), JSON.stringify({ ...setup, owner: { id: setup.owner.id } }, null, 2));
      const runs = [];
      for (const [i, arm] of arms.entries()) {
        const dir = join(OUT, `model-${i + 1}`);
        mkdirSync(dir, { recursive: true });
        cpSync(join(OUT, "db-base"), join(dir, "db"), { recursive: true });
        console.log(`== After Dark on ${armLabel(arm)}`);
        const night = await nightPhase(arm, join(dir, "db"), setup, port, plan, stepCount);
        writeFileSync(join(dir, "night.json"), JSON.stringify(night, null, 2));
        // A night that wrote nothing has nothing to observe: its report is null, and the other models still run.
        let report = null;
        try {
          report = observe(join(dir, "db"), setup, dir);
        } catch (err) {
          console.log(`  no observer report for ${arm.model}: ${String(err?.stderr || err?.message || err).trim().split("\n")[0].slice(0, 160)}`);
        }
        writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
        runs.push({ model: arm.model, ...(arm.hosts ? { hosts: arm.hosts } : {}), ...(typeof arm.penalty === "number" ? { penalty: arm.penalty } : {}), dir });
      }
      writeFileSync(join(OUT, "runs.json"), JSON.stringify(runs, null, 2));
    } finally {
      showrunner?.close();
    }
  }
  // Scores and the blind read's transcripts, from what's saved (so a run can be re-scored with --score-only).
  const setup = JSON.parse(readFileSync(join(OUT, "setup.json"), "utf8"));
  const runs = JSON.parse(readFileSync(join(OUT, "runs.json"), "utf8"));
  // The blind read's letters, by run folder: drawn once and kept (letters.json), so a re-score names the same transcripts.
  const lettersFile = join(OUT, "letters.json");
  const drawn = LETTERS.slice(0, runs.length).sort(() => (randomBytes(1)[0] % 2 ? 1 : -1));
  const letterOf = existsSync(lettersFile) ? JSON.parse(readFileSync(lettersFile, "utf8")) : Object.fromEntries(runs.map((r, i) => [basename(r.dir), drawn[i]]));
  writeFileSync(lettersFile, JSON.stringify(letterOf, null, 2));
  const key = {};
  // A replayed night's steers stay in its own file: the summary names the file, not its words.
  const steers = plan ? { file: steersFile, steps: plan.steps.length, turn_ons: plan.turnOns } : STEERS;
  const summary = { partner: setup.partner, character: setup.character, dates: setup.dates, steps: stepCount, steers, models: [] };
  for (const run of runs) {
    const night = JSON.parse(readFileSync(join(run.dir, "night.json"), "utf8"));
    const report = existsSync(join(run.dir, "report.json")) ? JSON.parse(readFileSync(join(run.dir, "report.json"), "utf8")) : null;
    const all = nightLines(night.notes);
    const { score, breakdown } = scoreNight(report, night.steps, all);
    const letter = letterOf[basename(run.dir)];
    key[letter] = armLabel(run);
    writeFileSync(
      join(OUT, `transcript-${letter}.txt`),
      all.map((l, n) => `${n + 1}. [ch ${l.chapter ?? "?"}] ${l.who === "a" ? night.notes?.a?.name : l.who === "b" ? night.notes?.b?.name : l.who}: ${l.text}\n   why: ${l.why ?? "—"} · memory: ${l.memory ?? "—"}`).join("\n"),
    );
    const ok = night.steps.filter((s) => !s.error);
    summary.models.push({
      model: run.model,
      hosts: run.hosts ?? null,
      penalty: run.penalty ?? null,
      score,
      breakdown,
      lines: all.length,
      steps: night.steps.length,
      failed_steps: night.steps.length - ok.length,
      errors: night.steps.filter((s) => s.error).map((s) => s.error).slice(0, 3),
      chapters: Math.max(0, ...ok.map((s) => s.chapter ?? 0)),
      top_stage: Math.max(0, ...ok.map((s) => s.stage ?? 0)),
      minutes: night.minutes,
      guards: guardTotals(night.notes),
      observer: report ? { summary: report.summary, findings: (report.findings ?? []).map((f) => ({ check: f.check, chapter: f.chapter })) } : null,
    });
  }
  writeFileSync(join(OUT, "key.json"), JSON.stringify(key, null, 2));
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  for (const m of summary.models) console.log(`${armLabel(m)}: ${m.score}/100 · ${m.lines} lines in ${m.steps} steps (${m.failed_steps} failed), top stage ${m.top_stage}, ${m.minutes} min`);
  console.log(`Output: ${OUT} (transcripts and databases there are explicit: never commit them)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

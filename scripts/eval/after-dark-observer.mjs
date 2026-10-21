#!/usr/bin/env node
/**
 * The After Dark observer (David, 2026-10-21: "an observer for background testing"): reads a pair's saved nights and
 * their running scene, READ-ONLY, and calls out what it sees: moves nobody agreed to, "my place?" at their place, repeated
 * lines, catchphrase counts, set churn, memories cited that aren't there, and how often a line's private "why" draws on a
 * memory or a trait (lib/adult/observer.ts). Optionally a judge pass on a LOCAL model through the ai-stack's LiteLLM
 * (free; never a paid or cloud model) adds line-range callouts and a personality-drift read per character.
 *
 *   node scripts/eval/after-dark-observer.mjs --pair <character id or prefix> <character id or prefix> [options]
 *
 *   --db <url>            Postgres URL; default $OBSERVER_DATABASE_URL, then $DATABASE_URL. Production, read-only:
 *                         DATABASE_URL="$(neon connection-string --profile davejobs-agent)" node scripts/eval/…
 *   --pglite <dir>        a local PGlite data dir instead (e.g. .data/pglite, or a restored dump)
 *   --fixture <file.json> run the checks on an ObserverInput JSON (no database at all)
 *   --owner <user id>     only that admin's scenes (default: anyone's)
 *   --nights latest|all   the latest night (default) or every night of the pair
 *   --judge               add the local judge pass
 *   --judge-model <name>  a local LiteLLM model: local-uncensored (default), local-qwen3 or local-chat
 *   --judge-base <url>    LiteLLM's OpenAI-compatible base (default http://localhost:4000/v1); the key is
 *                         $LITELLM_MASTER_KEY, else read from ~/ai-stack/litellm/.env (never printed)
 *   --out <dir>           where the report goes (default .data/observer); writes <pair>-<time>.md and .json
 *
 * Every connection is opened read-only (default_transaction_read_only=on) and the script only runs SELECTs. It ends by
 * emitting one summary event with ~/ai-stack/bin/emit-event when that exists.
 *
 * scripts/eval/observer-nightly.mjs and scripts/eval/export-preferences.mjs import loadLib, openDb and fromDb from here,
 * so main() runs only when this file is the script being run.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCAL_JUDGES = new Set(["local-uncensored", "local-qwen3", "local-chat"]);

function parseArgs(argv) {
  const o = { pair: [], nights: "latest", judge: false, judgeModel: "local-uncensored", judgeBase: "http://localhost:4000/v1", out: join(ROOT, ".data/observer") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pair") o.pair = [argv[++i], argv[++i]];
    else if (a === "--db") o.db = argv[++i];
    else if (a === "--pglite") o.pglite = argv[++i];
    else if (a === "--fixture") o.fixture = argv[++i];
    else if (a === "--owner") o.owner = argv[++i];
    else if (a === "--nights") o.nights = argv[++i];
    else if (a === "--judge") o.judge = true;
    else if (a === "--judge-model") o.judgeModel = argv[++i];
    else if (a === "--judge-base") o.judgeBase = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

/** lib/adult/observer.ts (observeNight, reportMarkdown), through Vite's module runner: the same TypeScript the tests run. */
export async function loadLib() {
  const { runnerImport } = await import("vite");
  const { module } = await runnerImport(join(ROOT, "lib/adult/observer.ts"), {
    configFile: false,
    root: ROOT,
    logLevel: "error",
    resolve: { alias: [{ find: /^@\//, replacement: `${ROOT}/` }] },
  });
  return module;
}

/** A read-only query function over Postgres (pg) or PGlite: o.pglite, else o.db, $OBSERVER_DATABASE_URL, $DATABASE_URL. */
export async function openDb(o) {
  if (o.pglite) {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite(o.pglite);
    await pg.query("set default_transaction_read_only = on");
    return { query: async (sql, params = []) => (await pg.query(sql, params)).rows, close: () => pg.close() };
  }
  const url = o.db ?? process.env.OBSERVER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("no database: pass --db, set DATABASE_URL, or use --pglite / --fixture");
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, options: "-c default_transaction_read_only=on" });
  await client.connect();
  await client.query("set default_transaction_read_only = on");
  return { query: async (sql, params = []) => (await client.query(sql, params)).rows, close: () => client.end() };
}

const asArray = (v) => (Array.isArray(v) ? v : typeof v === "string" ? JSON.parse(v) : []);
const iso = (d) => new Date(d).toISOString();

/** Finds a character by id or id prefix. */
async function character(q, idOrPrefix) {
  const rows = await q(`select id, name, bio, traits, want, voice, extras from characters where id = $1 or id like $1 || '%' order by (id = $1) desc limit 2`, [idOrPrefix]);
  if (!rows.length) throw new Error(`no character ${idOrPrefix}`);
  if (rows.length > 1 && rows[0].id !== idOrPrefix) throw new Error(`${idOrPrefix} matches more than one character`);
  return rows[0];
}

/** The details a sheet's drift is read against (lib/extras.ts TEXT_DETAILS, but the catchphrase). */
const DETAIL_KEYS = ["occupation", "hometown", "style", "signature_item", "go_to_order", "walk_on_music", "quirk", "hidden_talent", "pet_peeve", "guilty_pleasure", "ideal_first_date", "green_flag", "red_flag"];

const sideOf = (c) => {
  const extras = typeof c.extras === "string" ? JSON.parse(c.extras) : (c.extras ?? {});
  return {
    name: c.name,
    catchphrase: extras.catchphrase ?? null,
    traits: asArray(c.traits),
    tells: Object.values(extras.tells ?? {}),
    voice: c.voice ?? null,
    want: c.want ?? null,
    bio: c.bio ?? null,
    // Their job, hobbies and the rest, public only: what "lines using their sheet" counts (lib/adult/quality.ts).
    details: [
      ...DETAIL_KEYS.map((k) => extras[k]).filter((v) => typeof v === "string" && v),
      ...(extras.hobbies ?? []),
      ...(extras.prompts ?? []).map((p) => p.answer),
      ...(extras.facts ?? []).filter((f) => !f.private).map((f) => `${f.label} ${f.value}`),
    ],
    samples: Object.values(extras.lines ?? {}),
    never: extras.never_says ?? [],
  };
};

/**
 * Builds the observer's input from the database: the pair's nights (chapters in order), memories and sets asked for.
 * o: { pair: [id or prefix, id or prefix], owner?: admin id, nights: "latest" | "all" }. One ObserverInput per run of
 * chapters (each Start over begins a new run); each chapter keeps its scene or night id.
 */
export async function fromDb(q, o) {
  const [x, y] = await Promise.all([character(q, o.pair[0]), character(q, o.pair[1])]);
  const [aRow, bRow] = x.id < y.id ? [x, y] : [y, x];
  const cols = new Set((await q(`select column_name from information_schema.columns where table_name = 'adult_nights'`)).map((r) => r.column_name));
  const sceneCols = new Set((await q(`select column_name from information_schema.columns where table_name = 'adult_scenes'`)).map((r) => r.column_name));
  const owner = o.owner ? `and owner_id = $3` : "";
  const params = o.owner ? [aRow.id, bRow.id, o.owner] : [aRow.id, bRow.id];
  const nights = await q(
    `select id, chapter, lines, place, set_place, recap, created_at, date_setting${cols.has("moves") ? ", moves" : ""} from adult_nights where character_a = $1 and character_b = $2 ${owner} order by created_at`,
    params,
  );
  const scenes = await q(
    `select id, chapter, lines, place, set_place, recap, created_at, updated_at${sceneCols.has("moves") ? ", moves" : ""} from adult_scenes where character_a = $1 and character_b = $2 ${owner} order by updated_at desc limit 1`,
    params,
  );
  // Nights: a run of chapters that starts at chapter 1 (each Start over files the last one and starts again).
  const runs = [];
  for (const n of nights) {
    if (!runs.length || !n.chapter || n.chapter === 1) runs.push([]);
    runs[runs.length - 1].push({ ...n, source: "night" });
  }
  const scene = scenes[0];
  if (scene && asArray(scene.lines).length) {
    const last = runs[runs.length - 1];
    const follows = last && last[last.length - 1].chapter && scene.chapter === last[last.length - 1].chapter + 1;
    if (follows) last.push({ ...scene, source: "scene" });
    else runs.push([{ ...scene, source: "scene" }]);
  }
  if (!runs.length) throw new Error("the pair has no saved nights or scene lines");
  const picked = o.nights === "all" ? runs : [runs[runs.length - 1]];
  const memories = [
    ...(await q(`select note from adult_memories where (character_id = $1 and other_id = $2) or (character_id = $2 and other_id = $1)`, [aRow.id, bRow.id])).map((r) => r.note),
  ];
  const date = (
    await q(
      `select setting, ending, transcript from episodes where status = 'ready' and varies_episode_id is null and ((character_a = $1 and character_b = $2) or (character_a = $2 and character_b = $1)) order by created_at desc limit 1`,
      [aRow.id, bRow.id],
    )
  )[0];
  if (date) memories.push(`${date.setting ?? ""} ${date.ending ?? ""}`, ...asArray(date.transcript).map((t) => t.dialogue ?? ""));
  const earliest = scene ? iso(scene.created_at) : null;
  const out = [];
  for (const run of picked) {
    const chapters = [];
    for (const [i, c] of run.entries()) {
      // The sets asked for while this chapter ran (place_sets is shared by every scene and date: an approximation).
      const end = c.source === "scene" ? iso(c.updated_at) : iso(c.created_at);
      const prev = i ? iso(run[i - 1].created_at) : (nights.filter((n) => iso(n.created_at) < iso(run[0].created_at)).map((n) => iso(n.created_at)).pop() ?? earliest);
      const sets = prev ? (await q(`select label from place_sets where created_at > $1 and created_at <= $2 order by created_at`, [prev, end])).map((r) => r.label) : undefined;
      if (c.recap) memories.push(c.recap);
      chapters.push({ chapter: c.chapter ?? i + 1, source: c.source, id: c.id, lines: asArray(c.lines), set_place: c.set_place, place: c.place, moves: c.moves ? asArray(c.moves) : null, sets_requested: sets });
    }
    out.push({ a: sideOf(aRow), b: sideOf(bRow), start: run[0].date_setting ?? date?.setting ?? null, chapters, memories });
  }
  return out;
}

function litellmKey() {
  if (process.env.LITELLM_MASTER_KEY) return process.env.LITELLM_MASTER_KEY;
  const env = join(homedir(), "ai-stack/litellm/.env");
  if (!existsSync(env)) return null;
  const line = readFileSync(env, "utf8").split("\n").find((l) => l.startsWith("LITELLM_MASTER_KEY="));
  return line ? line.slice("LITELLM_MASTER_KEY=".length).trim() : null;
}

async function ask(o, key, messages, maxTokens = 700) {
  const res = await fetch(`${o.judgeBase.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: o.judgeModel, messages, temperature: 0.2, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`LiteLLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  // A local model's route can't fall back to a paid one (local-uncensored/qwen3/chat have no fallbacks); check anyway.
  if (body.model && /claude|gpt|gemini|sonnet|opus|nemotron/i.test(body.model)) throw new Error(`the judge answered from ${body.model}, not a local model: stopping`);
  return body.choices?.[0]?.message?.content ?? "";
}

const jsonIn = (text) => {
  const m = text.match(/\{[\s\S]*\}/);
  try {
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
};

const sheetText = (s) =>
  [`${s.name}.`, s.traits.length ? `Traits: ${s.traits.join(", ")}.` : "", s.voice ? `Voice: ${s.voice}` : "", s.tells.length ? `Tells: ${s.tells.join("; ")}` : "", s.samples.length ? `Sounds like: ${s.samples.slice(0, 3).join(" / ")}` : "", s.catchphrase ? `Catchphrase: ${s.catchphrase}` : ""]
    .filter(Boolean)
    .join("\n");

/** The judge: a local model watching the night, calling out line ranges, then reading each character against their sheet. */
async function judge(o, input) {
  if (!LOCAL_JUDGES.has(o.judgeModel)) throw new Error(`--judge-model must be a local model (${[...LOCAL_JUDGES].join(", ")}); ${o.judgeModel} could route to a paid or cloud one`);
  const key = litellmKey();
  const callouts = [];
  const WINDOW = 40;
  for (const ch of input.chapters) {
    for (let from = 0; from < ch.lines.length; from += WINDOW) {
      const slice = ch.lines.slice(from, from + WINDOW);
      const transcript = slice.map((l, i) => `${from + i}. ${l.who === "a" ? input.a.name : input.b.name}: ${l.text}`).join("\n");
      const raw = await ask(o, key, [
        {
          role: "system",
          content:
            "You are an observer watching a private scene between two fictional adult characters, for its continuity and craft, not its content. " +
            "Call out what you see: a place changing with nobody suggesting it, lines that contradict where they are or what happened, repeated lines or phrases, a character asking for something already done, and lines that don't sound like the character.",
        },
        {
          role: "user",
          content:
            `${sheetText(input.a)}\n\n${sheetText(input.b)}\n\nChapter ${ch.chapter}, lines ${from}–${from + slice.length - 1}:\n${transcript}\n\n` +
            `Reply with JSON only: {"callouts": [{"lines": "<first>-<last>", "note": "<what you see there, naming who does what>"}]}, using the line numbers shown above. ` +
            `At most 4, the clearest ones; {"callouts": []} if nothing stands out.`,
        },
      ]).catch((e) => (console.error(`[judge] ch ${ch.chapter} ${from}: ${e.message}`), ""));
      // A small local model echoes the template or the categories; keep only specific callouts inside this window.
      const kept = (jsonIn(raw)?.callouts ?? []).filter((c) => {
        const note = String(c?.note ?? "").trim();
        const [lo, hi = lo] = String(c?.lines ?? "").split(/[-–]/).map((n) => Number(n.trim()));
        return note.length > 25 && !/[<>]|^(?:a |no )?(what you see|place changing|lines (?:that )?(contradict|don't sound)|repeated lines|character asking|contradicts where)/i.test(note) && lo >= from && hi < from + slice.length && hi >= lo;
      });
      for (const c of kept.slice(0, 4)) callouts.push({ chapter: ch.chapter, lines: String(c.lines), note: String(c.note).slice(0, 300) });
    }
  }
  const drift = {};
  for (const who of ["a", "b"]) {
    const s = input[who];
    const theirs = input.chapters.flatMap((c) => c.lines.filter((l) => l.who === who).map((l) => l.text));
    const step = Math.max(1, Math.floor(theirs.length / 24));
    const sample = theirs.filter((_, i) => i % step === 0).slice(0, 24);
    const raw = await ask(o, key, [
      { role: "system", content: "You check whether a fictional character still sounds like themselves in a private adult scene, or whether the explicit mode has flattened them into generic lines." },
      {
        role: "user",
        content: `Their show sheet:\n${sheetText(s)}\n\nTheir lines tonight (a sample):\n${sample.map((t) => `- ${t}`).join("\n")}\n\nReply with JSON only: {"score": 1 to 5 (5 = unmistakably them, 1 = anyone could have said these), "note": "one or two sentences: which of their voice, tells or temperament survive, and what's flattened"}`,
      },
    ]).catch((e) => (console.error(`[judge] drift ${s.name}: ${e.message}`), ""));
    const j = jsonIn(raw);
    drift[s.name] = { score: typeof j?.score === "number" ? j.score : null, note: typeof j?.note === "string" ? j.note.slice(0, 400) : "no answer" };
  }
  return { model: o.judgeModel, callouts, drift };
}

function emit(status, message) {
  const bin = join(homedir(), "ai-stack/bin/emit-event");
  if (!existsSync(bin)) return Promise.resolve();
  return new Promise((res) => execFile(bin, ["botchelor", "after-dark-observer", "run", status, message], () => res()));
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.fixture && o.pair.length !== 2) throw new Error("pass --pair <a> <b>, or --fixture <file.json>");
  const lib = await loadLib();
  let inputs;
  if (o.fixture) inputs = [JSON.parse(readFileSync(o.fixture, "utf8"))];
  else {
    const db = await openDb(o);
    try {
      inputs = await fromDb(db.query, o);
    } finally {
      await db.close();
    }
  }
  mkdirSync(o.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const all = [];
  for (const input of inputs) {
    const report = lib.observeNight(input);
    const judged = o.judge ? await judge(o, input) : null;
    const md = lib.reportMarkdown(report, judged);
    const base = join(o.out, `${report.pair.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}-${stamp}${inputs.length > 1 ? `-${all.length + 1}` : ""}`);
    writeFileSync(`${base}.md`, md);
    writeFileSync(`${base}.json`, JSON.stringify({ report, judge: judged }, null, 2));
    console.log(md);
    console.error(`[observer] wrote ${base}.md and .json`);
    all.push(report);
  }
  const s = all[0].summary;
  const drift = Object.values(s.drift ?? {}).map((d) => `${d.name.split(/\s+/)[0]} sheet ${Math.round(d.sheet_detail_rate * 100)}% / ${d.cliche_rate} stock per 100`).join(", ");
  await emit(
    "info",
    `${all.map((r) => r.pair).join("; ")}: ${all.reduce((n, r) => n + r.lines, 0)} lines, ${s.unprovoked_moves} unprovoked moves, ${s.my_place_when_there} my-place-when-there, ${s.verbatim_repeats + s.near_repeats} repeats, ${s.unfounded_memories} unfounded memories${drift ? `; ${drift}` : ""}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(async (err) => {
    console.error(`[observer] ${err.message}`);
    await emit("fail", err.message.slice(0, 300));
    process.exit(1);
  });
}

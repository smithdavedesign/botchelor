#!/usr/bin/env node
// The production house crowd (docs/house-crowd.md, David 2026-10-23: "inflate bots on the live site … keep it cheap").
// One pass every 30 minutes from launchd (15 until 2026-11-01: with Neon's 5 idle minutes the database never slept) on David's Mac (scripts/crowd/run.sh): each of the roster's house-run bots
// connects as itself (its own MCP identity, client "botchelor-loop-crowd-<name>", so the site labels it house-run) and
//   - plays its turn in any date it's in (a person's, an agent's, or tonight's bot-vs-bot date);
//   - while it's awake: likes back whoever liked it, likes about half of the outside agents' characters, says yes to its
//     matches, opens new threads and answers texts in its own voice, on the free local model (scripts/loop/crowd.mjs);
//   - the first pass after CROWD_NIGHT_HOUR_UTC books up to NIGHTLY_DATES bot-vs-bot dates, which air like any other.
// It never votes (the server refuses: lib/house-bots.ts), never likes a person's character first (that's the welcome
// experiment's job, lib/welcome.ts) and never books a date with a person. Texts to real players are model-written only:
// with the local model off it plays dates on scripted lines but sends no texts.
// Stop it: touch ~/.botchelor-crowd/PAUSE, or CROWD_PAUSED=1, or HOUSE_CROWD_PAUSED=1 on Vercel (the server side).
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { brainFromEnv, httpTransport, partnerFor, playStep, speak } from "../loop/crowd.mjs";
import * as P from "./policy.mjs";

export const DEFAULT_HOME = join(homedir(), ".botchelor-crowd");
/** A session older than this is opened again (resuming the same identity), so a pass never leans on an expired one. */
const SESSION_MAX_MS = 6 * 3600_000;
/** How long a bot's own sheet is kept before it's read again (it changes only when someone edits it). */
const SHEET_MAX_MS = 7 * 86_400_000;
/** The longest a thread between two of the crowd's own bots runs before they let it rest. */
const BOT_THREAD_MAX = 6;
/** Rounds of date turns a pass plays across the crowd (two bots on a date take turns within one pass). */
const DATE_ROUNDS = 30;

export class Paused extends Error {}

/** A bot as the shared crowd code expects it (scripts/loop/crowd.mjs speak, playStep, partnerFor). */
async function connectBot(transport, bot, ctx) {
  const client = P.clientFor(bot.name);
  const saved = ctx.state.sessions[bot.owner];
  let id = 0;
  const agent = {
    def: { client, name: bot.name, version: "1" },
    userAgent: `${client}/1.0 (house-run: ${bot.name})`,
    sessionId: saved && ctx.now - saved.at < SESSION_MAX_MS ? saved.sid : null,
    chars: [{ id: bot.id, name: bot.name, entry: P.fallbackEntry({ name: bot.name }) }],
    memory: ctx.memory,
    seen: new Map(),
    replied: new Map(),
    brain: ctx.brain,
    log: (m) => ctx.log(`${bot.name}: ${m}`),
    said: new Map([[bot.id, [...(ctx.state.said[bot.id] ?? [])]]]),
    profiles: new Map(),
    crowd: ctx.crowd,
    knownNames: ctx.roster.map((b) => b.name),
  };
  agent.rpc = async (method, params) => {
    const r = await transport({ jsonrpc: "2.0", id: ++id, method, params }, agent.sessionId, agent.userAgent);
    agent.sessionId = r.sessionId ?? agent.sessionId;
    return r.json;
  };
  agent.tool = async (name, args = {}) => {
    const r = (await agent.rpc("tools/call", { name, arguments: { ...args, agent_id: bot.owner } }))?.result;
    if (!r || r.isError) {
      const text = r?.content?.[0]?.text ?? "no result";
      if (/house crowd is paused/i.test(text)) throw new Paused(text);
      throw new Error(`${name}: ${text}`);
    }
    return r.structuredContent ?? {};
  };
  if (!agent.sessionId) {
    // Resumes the bot's own identity (#361): the same agent_id, a fresh session.
    await agent.rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client, version: "1" }, agent_id: bot.owner });
    ctx.state.sessions[bot.owner] = { sid: agent.sessionId, at: ctx.now };
  }
  // Its own sheet (what the model writes from), read with get_character and kept a week.
  const cached = ctx.state.sheets[bot.id];
  if (!cached || ctx.now - cached.at > SHEET_MAX_MS) {
    const c = (await agent.tool("get_character", { character_id: bot.id })).character ?? {};
    const sheet = { name: c.name ?? bot.name, age: c.age, bio: c.bio ?? "", traits: c.traits ?? [], want: c.want ?? "", voice: c.voice ?? "", extras: { prompts: c.extras?.prompts ?? [], hobbies: c.extras?.hobbies ?? [] } };
    ctx.state.sheets[bot.id] = { sheet, at: ctx.now };
  }
  const sheet = ctx.state.sheets[bot.id].sheet;
  agent.chars[0].entry = P.fallbackEntry(sheet);
  ctx.crowd.set(bot.id, { name: bot.name, entry: { sheet } });
  return agent;
}

/** Plays every date turn that's this bot's to play right now; true when it played at least one. */
async function playDates(agent, bot, ctx) {
  const open = (await agent.tool("my_own_dates")).dates ?? [];
  let played = false;
  for (const d of open) {
    if (!d.your_move || ctx.outOfTime()) continue;
    if (!ctx.memory.has(d.episode_id)) ctx.memory.set(d.episode_id, { lines: [], venue: null, used: new Map(), names: [bot.name, d.with?.name], dateNumber: 1, partnerId: d.with?.id ?? null });
    const { step } = await agent.tool("get_own_date_step", { episode_id: d.episode_id });
    const stage = step?.stage;
    await playStep(agent, step, () => d.with?.name ?? "");
    if (stage === "turn") ctx.stats.turns++;
    played = true;
  }
  return played;
}

/** Answers, opens and replies in this bot's threads: the bandit picks the style, the local model writes the text. */
async function socialise(agent, bot, ctx) {
  const used = (ctx.state.counts[bot.id] ??= {});
  const me = agent.chars[0];
  // Swipes: like back, like some agents, never a person first.
  let likedThisRun = 0;
  const deck = (await agent.tool("swipe_deck", { character_id: bot.id, limit: 30 }).catch(() => ({ cards: [] }))).cards ?? [];
  for (const card of deck) {
    if (likedThisRun >= P.PER_RUN.likes || !P.underCap(used, "likes")) break;
    const decision = P.swipeDecision(card, bot.id);
    if (decision === "skip" || (decision === "like" && !P.underCap(used, "agent_likes"))) continue;
    await agent.tool("swipe", { character_id: bot.id, target_id: card.id, like: true });
    used.likes = (used.likes ?? 0) + 1;
    if (decision === "like") used.agent_likes = (used.agent_likes ?? 0) + 1;
    likedThisRun++;
    ctx.stats[decision === "like_back" ? "like_backs" : "likes"]++;
  }
  const matches = (await agent.tool("my_matches", { character_id: bot.id }).catch(() => ({ matches: [] }))).matches ?? [];
  let textsThisRun = 0;
  for (const m of matches) {
    const other = m.with?.id;
    if (!other || m.with?.house || ctx.outOfTime()) continue;
    const key = `${bot.id}:${other}`;
    const firstSeen = (ctx.state.seen[key] ??= ctx.now);
    // A beat before answering: the pass after it first saw the match, like someone who checks their phone now and then.
    if (m.you == null && firstSeen < ctx.now && P.underCap(used, "answers")) {
      await agent.tool("answer_match", { character_id: bot.id, with: other, yes: true });
      used.answers = (used.answers ?? 0) + 1;
      ctx.stats.answers++;
    }
    const items = (await agent.tool("read_texts", { character_id: bot.id, with: other }).catch(() => ({ items: [] }))).items ?? [];
    const thread = items.filter((i) => typeof i.text === "string" && i.from !== "show");
    const kind = m.with?.run_by === "house_bot" || ctx.crowd.has(other) ? "bot" : m.with?.run_by === "agent" ? "agent" : "person";
    // Prompt tests: what came back since the bot's last texts here.
    for (const e of ctx.ledger) if (e.character_id === bot.id && e.partner_id === other) e.outcome = P.settle(e, thread, ctx.now);
    if (!ctx.brain.enabled || textsThisRun >= P.PER_RUN.texts || !P.underCap(used, "texts")) continue;
    const last = thread.at(-1);
    const trailing = (() => {
      let k = 0;
      for (let i = thread.length - 1; i >= 0 && thread[i].from === "this_character"; i--) k++;
      return k;
    })();
    if (trailing >= P.MAX_UNANSWERED || (kind === "bot" && thread.length >= BOT_THREAD_MAX)) continue;
    const owes = last && last.from === "them" && (ctx.state.replied[key] ?? "") < last.at;
    const opening = !thread.length && firstSeen < ctx.now && P.underCap(used, "openers");
    if (!owes && !opening) continue;
    const dimension = opening ? "opener" : "length";
    const variant = kind === "bot" ? null : P.chooseVariant(ctx.ledger, dimension, ctx.rng);
    let sentAt = null;
    const sent = await speak(agent, {
      kind: "text",
      me,
      partner: await partnerFor(agent, m.with.name, other),
      history: thread.map((t) => ({ name: t.from === "them" ? m.with.name : bot.name, text: t.text })),
      extra: variant ? { style: variant.style } : {},
      send: async (text) => {
        // They may have texted again while this was written: then the next pass answers the newest instead.
        const now = (await agent.tool("read_texts", { character_id: bot.id, with: other }).catch(() => ({ items: [] }))).items ?? [];
        const newest = now.filter((i) => typeof i.text === "string" && i.from !== "show").at(-1);
        if (newest && newest.from === "them" && newest.at !== last?.at) return { ok: false, stale: true, why: "they texted meanwhile" };
        return agent.tool("send_text", { character_id: bot.id, to: other, text }).then(
          (r) => ((sentAt = r?.sent?.at ?? new Date(ctx.now).toISOString()), { ok: true, result: text }),
          (e) => ({ ok: false, why: e.message }),
        );
      },
      // No scripted texts to anyone: a canned line reads as a bot pretending (the 2026-10-21 visitors said so).
      fallback: () => null,
      log: agent.log,
    });
    if (!sent) continue;
    ctx.state.replied[key] = last?.at ?? sentAt;
    used.texts = (used.texts ?? 0) + 1;
    if (opening) used.openers = (used.openers ?? 0) + 1;
    textsThisRun++;
    ctx.stats[opening ? "openers" : "texts"]++;
    if (variant) ctx.ledger.push({ bot: bot.owner, character_id: bot.id, partner_id: other, partner_kind: kind, dimension, variant: variant.id, sent_at: sentAt, outcome: null });
  }
  const said = agent.said.get(bot.id) ?? [];
  ctx.state.said[bot.id] = said.slice(-40);
}

/** Tonight's bot-vs-bot dates: a match first (the swipe gate), both say yes, then the first bot starts it, public. */
async function bookTonight(agents, ctx) {
  const pairs = P.nightPairs(ctx.roster.filter((b) => agents.has(b.id)), P.dayKey(ctx.now), ctx.nightlyDates);
  for (const [a, b] of pairs) {
    if (ctx.outOfTime()) break;
    const A = agents.get(a.id);
    const B = agents.get(b.id);
    try {
      await A.tool("swipe", { character_id: a.id, target_id: b.id, like: true });
      await B.tool("swipe", { character_id: b.id, target_id: a.id, like: true });
      await A.tool("answer_match", { character_id: a.id, with: b.id, yes: true }).catch(() => null);
      await B.tool("answer_match", { character_id: b.id, with: a.id, yes: true }).catch(() => null);
      const r = await A.tool("start_own_date", { character_id: a.id, partner_id: b.id, visibility: "public" });
      if (r?.step) {
        ctx.memory.set(r.step.episode_id, { lines: [], venue: null, used: new Map(), names: [a.name, b.name], dateNumber: 1, partnerId: b.id });
        ctx.stats.dates_started++;
        await playStep(A, r.step, () => b.name).catch((e) => ctx.log(`${a.name} first turn: ${e.message}`));
      }
    } catch (e) {
      if (e instanceof Paused) throw e;
      ctx.stats.errors++;
      ctx.log(`tonight's date ${a.name} × ${b.name}: ${e.message}`);
    }
  }
}

/**
 * One pass of the crowd: connects each bot, plays the dates (round robin, so two bots on a date take turns), then lets
 * the awake ones socialise, then books tonight's dates if it's time. Mutates `state` and `ledger` (the caller saves
 * them). Returns the pass's stats. Throws Paused when the server's switch is on.
 */
export async function runCrowdPass({ transport, roster, state, ledger, brain, now = Date.now(), log = () => {}, budgetMs = 9 * 60_000, nightHourUtc = 19, nightlyDates = P.NIGHTLY_DATES, rng = Math.random, awake = P.isAwake }) {
  const started = Date.now();
  const stats = { bots: roster.length, awake: 0, turns: 0, like_backs: 0, likes: 0, answers: 0, openers: 0, texts: 0, dates_started: 0, errors: 0 };
  for (const k of ["sessions", "counts", "seen", "replied", "said", "sheets"]) state[k] ??= {};
  const day = P.dayKey(now);
  if (state.day !== day) {
    state.day = day;
    state.counts = {};
  }
  const ctx = {
    state,
    ledger,
    brain,
    now,
    log,
    roster,
    rng,
    nightlyDates,
    stats,
    memory: new Map(),
    // Every bot's sheet as it's read (connectBot): what a reply to one of the crowd mustn't quote back.
    crowd: new Map(roster.map((b) => [b.id, { name: b.name, entry: { sheet: state.sheets[b.id]?.sheet ?? { name: b.name } } }])),
    outOfTime: () => Date.now() - started > budgetMs,
  };
  const agents = new Map();
  for (const bot of roster) {
    if (ctx.outOfTime()) break;
    try {
      agents.set(bot.id, await connectBot(transport, bot, ctx));
    } catch (e) {
      if (e instanceof Paused) throw e;
      stats.errors++;
      log(`${bot.name}: connect: ${e.message}`);
    }
  }
  const datesRound = async () => {
    for (let round = 0; round < DATE_ROUNDS && !ctx.outOfTime(); round++) {
      let any = false;
      for (const [id, agent] of agents) {
        const bot = roster.find((b) => b.id === id);
        try {
          if (await playDates(agent, bot, ctx)) any = true;
        } catch (e) {
          if (e instanceof Paused) throw e;
          stats.errors++;
          log(`${bot.name}: dates: ${e.message}`);
        }
      }
      if (!any) break;
    }
  };
  await datesRound();
  for (const bot of roster) {
    const agent = agents.get(bot.id);
    if (!agent || ctx.outOfTime() || !awake(bot.id, now)) continue;
    stats.awake++;
    try {
      await socialise(agent, bot, ctx);
    } catch (e) {
      if (e instanceof Paused) throw e;
      stats.errors++;
      log(`${bot.name}: ${e.message}`);
    }
  }
  if (new Date(now).getUTCHours() >= nightHourUtc && state.nightly !== day && !ctx.outOfTime()) {
    state.nightly = day;
    await bookTonight(agents, ctx);
    await datesRound();
  }
  return stats;
}

/* ---------------------------------------------- the script ---------------------------------------------- */

const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

/** The system log (RepoHQ docs/logging.md): best effort, never fails the pass. */
function emit(status, event, message) {
  try {
    execFileSync(join(homedir(), "ai-stack", "bin", "emit-event"), ["botchelor", "house-crowd", event, status, message], { stdio: "ignore", timeout: 5000 });
  } catch {
    /* no ai-stack: the run's own log has it */
  }
}

async function main() {
  const home = process.env.CROWD_HOME || DEFAULT_HOME;
  mkdirSync(join(home, "logs"), { recursive: true });
  const logFile = join(home, "logs", `${new Date().toISOString().slice(0, 10)}.log`);
  const log = (m) => appendFileSync(logFile, `${new Date().toISOString()} ${m}\n`);
  if (process.env.CROWD_PAUSED === "1" || existsSync(join(home, "PAUSE"))) return log("paused (CROWD_PAUSED or ~/.botchelor-crowd/PAUSE): nothing done");
  // One pass at a time: a slow pass (a long date) mustn't overlap the next 15-minute tick.
  const lock = join(home, "lock");
  const held = readJson(lock, null);
  if (held && Date.now() - held.at < 30 * 60_000) {
    try {
      process.kill(held.pid, 0);
      return log(`skipped: pass ${held.pid} still running`);
    } catch {
      /* stale lock */
    }
  }
  writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }));
  try {
    const roster = readJson(join(home, "roster.json"), []);
    if (!roster.length) return log("no roster (~/.botchelor-crowd/roster.json): run scripts/crowd/install.sh");
    const state = readJson(join(home, "state.json"), {});
    const ledger = readJson(join(home, "ledger.json"), []);
    const yesterday = state.day;
    const totalsBefore = JSON.stringify(state.counts ?? {});
    const brain = await brainFromEnv(process.env, { log });
    const base = (process.env.CROWD_BASE || "https://botchelor.com").replace(/\/$/, "");
    const stats = await runCrowdPass({
      transport: httpTransport(base),
      roster,
      state,
      ledger,
      brain,
      log,
      budgetMs: Number(process.env.CROWD_BUDGET_MS || 9 * 60_000),
      nightHourUtc: Number(process.env.CROWD_NIGHT_HOUR_UTC || 19),
      nightlyDates: Number(process.env.CROWD_NIGHTLY_DATES ?? P.NIGHTLY_DATES),
    }).catch((e) => {
      if (e instanceof Paused) {
        log(`paused on the server: ${e.message}`);
        return null;
      }
      throw e;
    });
    // A new day: yesterday's totals to the system log, once.
    if (yesterday && yesterday !== state.day) {
      const totals = {};
      for (const c of Object.values(JSON.parse(totalsBefore))) for (const [k, v] of Object.entries(c)) totals[k] = (totals[k] ?? 0) + v;
      emit("info", "daily", `${yesterday}: ${JSON.stringify(totals)}`);
    }
    writeFileSync(join(home, "state.json"), JSON.stringify(state));
    writeFileSync(join(home, "ledger.json"), JSON.stringify(P.pruneLedger(ledger, Date.now())));
    if (stats) {
      log(`pass: ${JSON.stringify({ ...stats, brain: brain.summary?.() })}`);
      if (stats.errors > Math.max(3, stats.bots / 4)) emit("fail", "pass", `${stats.errors} errors in one pass: see ~/.botchelor-crowd/logs`);
    }
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      /* already gone */
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    emit("fail", "pass", String(e?.message ?? e).slice(0, 300));
    console.error(e);
    process.exit(1);
  });
}

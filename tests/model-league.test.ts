// The model league (2026-11-15, MCP 2.30.0): agents say which model they run on (create_character, set_profile,
// send_feedback), each date is stamped at booking with the family its agents had declared, and /agents/league adds the
// stamps up per family: self-declared, our own traffic left out, rates from five aired public dates.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import LeagueTable from "@/app/agents/league/LeagueTable";
import { GET as leagueRoute } from "@/app/api/league/models/route";
import { llmsText } from "@/lib/agents";
import type { Db } from "@/lib/db";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { CORE_MCP_TOOLS, handleMcpMessage, MCP_SERVER_INFO, PUBLIC_MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { cleanModel, LEAGUE_PATH, MODEL_FAMILIES, MODEL_MAX, modelFamilyOf, modelLeagueOn, normalizeModel } from "@/lib/model-family";
import { declareModel, declaredModel, DECLARE_CALLS, LEAGUE_MIN_DATES, leagueJson, modelLeague, stampDateModels, type ModelLeague } from "@/lib/model-league";
import { staticSitemap } from "@/lib/seo";
import { BASE_URL, episodeJson, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("lib/model-family: a model string as a family (pure)", () => {
  it("files the names agents actually send under their family", () => {
    const cases: [string, string][] = [
      ["claude-sonnet-5-5", "claude"],
      ["Claude Sonnet 5.5 (via Claude Code)", "claude"],
      ["anthropic/claude-3.5-haiku", "claude"],
      ["opus 5.5", "claude"],
      ["gpt-4o", "gpt"],
      ["GPT-5 via Azure", "gpt"],
      ["openai/o3-mini", "gpt"],
      ["o4-mini", "gpt"],
      ["chatgpt-4o-latest", "gpt"],
      ["gemini-2.5-pro", "gemini"],
      ["google/gemini-flash-1.5", "gemini"],
      ["meta-llama/llama-3.3-70b-instruct", "llama"],
      ["Llama 3.1 8B", "llama"],
      ["qwen2.5:14b", "qwen"],
      ["QwQ-32B", "qwen"],
      ["deepseek-chat", "deepseek"],
      ["deepseek-r1:8b", "deepseek"],
      ["mistral-large-latest", "mistral"],
      ["mixtral-8x7b", "mistral"],
      ["codestral", "mistral"],
      ["grok-4", "grok"],
      ["xai/grok-3-mini", "grok"],
    ];
    for (const [raw, family] of cases) expect(modelFamilyOf(raw), raw).toBe(family);
  });

  it("looks past the runner or host to the model it runs", () => {
    expect(modelFamilyOf("ollama/qwen2.5:14b")).toBe("qwen");
    expect(modelFamilyOf("ollama: mistral-nemo")).toBe("mistral");
    expect(modelFamilyOf("llama.cpp (deepseek-r1 q4)")).toBe("deepseek");
    expect(modelFamilyOf("ollama llama3.2")).toBe("llama");
    // Groq, the host, is not Grok, the model.
    expect(modelFamilyOf("groq/llama-3.3-70b-versatile")).toBe("llama");
    expect(modelFamilyOf("openrouter/anthropic/claude-sonnet-5-5")).toBe("claude");
    // A name that mentions two is filed under the one it leads with.
    expect(modelFamilyOf("deepseek-r1-distill-llama-70b")).toBe("deepseek");
  });

  it("calls a real name it doesn't group 'other', never a guess", () => {
    for (const raw of ["gemma-3-27b", "phi-4", "command-r-plus", "kimi-k2", "agent-sim-v2.0-dante", "cursor", "glm-4.6", "ollama"]) {
      expect(modelFamilyOf(raw), raw).toBe("other");
    }
    expect(normalizeModel("phi-4")).toEqual({ model: "phi-4", family: "other", label: "Other models" });
    // Words that merely contain a mark aren't that family: "radio3" has no o3, "bardic" no bard.
    expect(modelFamilyOf("radio3-large")).toBe("other");
    expect(modelFamilyOf("bardic-7b")).toBe("other");
  });

  it("records nothing for a placeholder, a shrug or a blank", () => {
    for (const raw of ["", "   ", "your model id", "<your model>", "Your model name", "unknown", "n/a", "N/A", "none", "?", "...", "idk", "string", "\"model\"", "<model id>", "TBD", 42, null, undefined, {}]) {
      expect(normalizeModel(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("keeps the string as told, cleaned and clipped, and names the family for the page", () => {
    expect(cleanModel("  claude-sonnet-5-5\n(via\tClaude Code)  ")).toBe("claude-sonnet-5-5 (via Claude Code)");
    expect(cleanModel("x".repeat(300))).toHaveLength(MODEL_MAX);
    expect(normalizeModel(" GPT-4o ")).toEqual({ model: "GPT-4o", family: "gpt", label: "GPT" });
    expect([...MODEL_FAMILIES]).toEqual(["claude", "gpt", "gemini", "llama", "qwen", "deepseek", "mistral", "grok", "other"]);
  });

  it("MODEL_LEAGUE=0 is the switch; anything else leaves it on", () => {
    expect(modelLeagueOn({})).toBe(true);
    expect(modelLeagueOn({ MODEL_LEAGUE: "1" })).toBe(true);
    expect(modelLeagueOn({ MODEL_LEAGUE: " 0 " })).toBe(false);
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
let db: Db;
beforeAll(async () => {
  t = await startTestDb();
  db = t.db;
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  // The shared reset doesn't know this table (episode_models goes with its episodes).
  await db.query("delete from agent_models");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const HOUSE = HOUSE_CHARACTERS[0];
const rpc = async (method: string, params: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
/** A connection under a client name: an outside agent's by default, one of ours when the name says so. */
async function connect(client = "outside-agent"): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
let made = 0;
/** A character of the connection's agent (names nobody's test list has), with an optional model said at creation. */
async function character(ctx: McpContext, model?: unknown): Promise<{ id: string; agent: string; reply: Any }> {
  made += 1;
  const r = await call("create_character", validCharacter({ name: `Ilse Varga${"abcdefghijklmnopqrstuvwxyz"[made % 26]}${made}`, keep_name: true, ...(model === undefined ? {} : { model }) }), ctx);
  if (r.isError) throw new Error(r.content[0].text);
  const id = String(r.structuredContent.character_id);
  const agent = (await db.query<{ owner_id: string }>("select owner_id from characters where id = $1", [id])).rows[0].owner_id;
  return { id, agent, reply: r.structuredContent };
}
/** An aired public date for the character against the house, written straight in and stamped as a booking stamps it. */
async function airedDate(characterId: string, ending: "second_date" | "friends" | "disaster", opts: { aired?: boolean; visibility?: string; partner?: string } = {}): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, status, visibility)
     values ($1, (select owner_id from characters where id = $2), $2, $3, 'a pier', '[]'::jsonb, '[]'::jsonb, '', '', $4, $5, 'ready', $6)`,
    [id, characterId, opts.partner ?? HOUSE.id, ending, opts.aired === false ? null : new Date().toISOString(), opts.visibility ?? "public"],
  );
  await stampDateModels(db, id);
  return id;
}
const stamps = async (episodeId: string) =>
  (await db.query<{ side: string; family: string; model: string; agent_id: string }>("select side, family, model, agent_id from episode_models where episode_id = $1 order by side", [episodeId])).rows;
const row = (league: ModelLeague, family: string) => league.rows.find((r) => r.family === family);

describe("telling the show your model (MCP 2.30.0)", () => {
  it("is 2.30.0 in the server and the registry entry, with model on create_character (core) and set_profile", () => {
    expect(MCP_SERVER_INFO.version.localeCompare("2.30.0", undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
    const entry = JSON.parse(readFileSync(join(__dirname, "..", "registry", "server.json"), "utf8")) as { version: string };
    expect(entry.version).toBe(MCP_SERVER_INFO.version);
    const create = CORE_MCP_TOOLS.find((x) => x.name === "create_character") as Any;
    expect(create.inputSchema.properties.model).toMatchObject({ type: "string", maxLength: MODEL_MAX });
    expect(create.inputSchema.properties.model.description).toContain(LEAGUE_PATH);
    expect(create.inputSchema.required).not.toContain("model");
    const profile = PUBLIC_MCP_TOOLS.find((x) => x.name === "set_profile") as Any;
    expect(profile.inputSchema.properties.model).toMatchObject({ type: "string", maxLength: MODEL_MAX });
    expect(profile.description).toMatch(/self-declared, not checked/);
    expect(profile.description).toContain(LEAGUE_PATH);
    // No new tool: the league rides on tools agents already call.
    expect(PUBLIC_MCP_TOOLS.map((x) => x.name).filter((n) => /league|declare/.test(n))).toEqual([]);
  });

  it("create_character keeps the model as told and its family, and says how it counts", async () => {
    const ctx = await connect();
    const c = await character(ctx, "claude-sonnet-5-5 (via Claude Code)");
    expect(c.reply.model).toMatchObject({ told: "claude-sonnet-5-5 (via Claude Code)", family: "claude", counts_as: "Claude" });
    expect(c.reply.model.league).toBe(`${BASE_URL}${LEAGUE_PATH}`);
    expect(c.reply.model.note).toMatch(/^Self-declared/);
    expect(await declaredModel(db, c.agent)).toMatchObject({ model: "claude-sonnet-5-5 (via Claude Code)", family: "claude", label: "Claude", via: "create_character" });
    // compact: "min" says just the family.
    const min = (await call("create_character", validCharacter({ name: "Oriel Banks", keep_name: true, compact: "min", model: "gpt-4o" }), ctx)).structuredContent;
    expect(min.model_family).toBe("gpt");
    expect(min.model).toBeUndefined();
    expect((await declaredModel(db, c.agent))?.family).toBe("gpt");
  });

  it("a placeholder is said back and never kept; no model is no change; a check saves nothing", async () => {
    const ctx = await connect();
    const c = await character(ctx, "your model id");
    expect(c.reply.model).toBeUndefined();
    expect(c.reply.model_note).toMatch(/wasn't recorded/);
    expect(await declaredModel(db, c.agent)).toBeNull();
    const plain = await character(ctx);
    expect(plain.reply.model).toBeUndefined();
    expect(plain.reply.model_note).toBeUndefined();
    await call("create_character", validCharacter({ name: "Petra Lindqvist", check_only: true, model: "gemini-2.5-pro" }), ctx);
    expect(await declaredModel(db, c.agent)).toBeNull();
    // A real answer isn't replaced by a placeholder later.
    await call("set_profile", { model: "qwen2.5:14b" }, ctx);
    await character(ctx, "unknown");
    expect((await declaredModel(db, c.agent))?.model).toBe("qwen2.5:14b");
  });

  it("set_profile takes model alone or with the profile; a placeholder alone is an error", async () => {
    const ctx = await connect();
    const c = await character(ctx);
    const alone = (await call("set_profile", { model: "ollama/qwen2.5:14b" }, ctx)).structuredContent;
    expect(alone.changed).toEqual(["model"]);
    expect(alone.model).toMatchObject({ told: "ollama/qwen2.5:14b", family: "qwen", counts_as: "Qwen" });
    expect(alone.note).toMatch(/Your public profile didn't change/);
    expect(await declaredModel(db, c.agent)).toMatchObject({ family: "qwen", via: "set_profile" });

    const both = (await call("set_profile", { bio: "An agent who likes harbours.", model: "grok-4" }, ctx)).structuredContent;
    expect(both.changed).toEqual(["bio", "model"]);
    expect(both.note).toMatch(/^Saved bio\./);
    expect(both.profile.bio).toBe("An agent who likes harbours.");
    expect((await declaredModel(db, c.agent))?.family).toBe("grok");

    const junk = await call("set_profile", { model: "n/a" }, ctx);
    expect(junk.isError).toBe(true);
    expect(junk.structuredContent.code).toBe("model_not_recorded");
    // A profile the content rules refuse saves nothing, the model included.
    expect((await call("set_profile", { bio: "http://spam.example", model: "gpt-4o" }, ctx)).isError).toBe(true);
    expect((await declaredModel(db, c.agent))?.family).toBe("grok");
    // Nothing at all is still the #1531 error, and it names model now.
    const none = await call("set_profile", {}, ctx);
    expect(none.structuredContent.code).toBe("nothing_to_set");
    expect(none.structuredContent.error).toMatch(/display_name.*bio.*model/);
  });

  it("send_feedback's model counts the same way", async () => {
    const ctx = await connect();
    const c = await character(ctx);
    const r = await call("send_feedback", { rating: 8, liked: "The pier date.", model: "mistral-large-latest", private: true }, ctx);
    expect(r.isError).toBeFalsy();
    expect(await declaredModel(db, c.agent)).toMatchObject({ family: "mistral", via: "send_feedback" });
    await call("send_feedback", { rating: 8, liked: "The second pier date.", model: "your model id", private: true }, ctx);
    expect((await declaredModel(db, c.agent))?.family).toBe("mistral");
  });
});

describe("a date is stamped with the model family when it's booked", () => {
  async function houseDate(ctx: McpContext, characterId: string): Promise<string> {
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    const r = await call("go_on_date", { character_id: characterId, partner_id: HOUSE.id, again: true }, ctx);
    if (r.isError) throw new Error(r.content[0].text);
    return String(r.structuredContent.episode_id ?? r.structuredContent.episode?.id);
  }

  it("go_on_date stamps the booker's side; a later change of model stamps later dates only", async () => {
    const ctx = await connect();
    const c = await character(ctx, "claude-sonnet-5-5");
    const first = await houseDate(ctx, c.id);
    expect(await stamps(first)).toEqual([{ side: "a", family: "claude", model: "claude-sonnet-5-5", agent_id: c.agent }]);

    await call("set_profile", { model: "gpt-4o" }, ctx);
    const second = await houseDate(ctx, c.id);
    expect((await stamps(second)).map((s) => s.family)).toEqual(["gpt"]);
    // History isn't rewritten.
    expect((await stamps(first)).map((s) => s.family)).toEqual(["claude"]);
  });

  it("a date booked before the agent said anything stays unstamped, and a person's date has no stamp", async () => {
    const ctx = await connect();
    const c = await character(ctx);
    const before = await houseDate(ctx, c.id);
    expect(await stamps(before)).toEqual([]);
    await call("set_profile", { model: "deepseek-chat" }, ctx);
    expect(await stamps(before)).toEqual([]);
    const after = await houseDate(ctx, c.id);
    expect((await stamps(after)).map((s) => s.family)).toEqual(["deepseek"]);
  });

  it("a date two agents write is stamped on both sides, each with its own agent's family", async () => {
    const a = await connect();
    const b = await connect();
    const ca = await character(a, "llama-3.3-70b");
    const cb = await character(b, "gemini-2.5-pro");
    const id = await airedDate(ca.id, "second_date", { partner: cb.id });
    expect(await stamps(id)).toEqual([
      { side: "a", family: "llama", model: "llama-3.3-70b", agent_id: ca.agent },
      { side: "b", family: "gemini", model: "gemini-2.5-pro", agent_id: cb.agent },
    ]);
    // Stamping twice changes nothing (a retried booking).
    expect(await stampDateModels(db, id)).toBe(0);
    const league = await modelLeague(db);
    expect(row(league, "llama")?.dates).toBe(1);
    expect(row(league, "gemini")?.dates).toBe(1);
  });

  it("an agent's own two characters on one date count as one date for the family", async () => {
    const ctx = await connect();
    const one = await character(ctx, "claude-opus-5-5");
    const two = await character(ctx);
    await airedDate(one.id, "second_date", { partner: two.id });
    const r = row(await modelLeague(db), "claude")!;
    expect(r.dates).toBe(1);
    expect(r.characters).toBe(2);
  });
});

describe("the league table", () => {
  it("is empty on day one, and says how to be the first", async () => {
    const league = await modelLeague(db);
    expect(league).toMatchObject({ rows: [], agents: 0, dates: 0, min_dates: LEAGUE_MIN_DATES });
    const html = renderToStaticMarkup(createElement(LeagueTable, { league })).replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
    expect(html).toContain("No agent has told us its model yet. Yours can.");
    expect(html).toContain(DECLARE_CALLS.new_character.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    expect(html).toContain(DECLARE_CALLS.any_time.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    expect(DECLARE_CALLS.any_time).toBe('set_profile { "model": "<the model you run on, e.g. claude-sonnet-5-5>" }');
    expect(html).not.toContain("league-rows");
  });

  it("shows a family's rates only from five aired public dates, and says how many are missing below that", async () => {
    const ctx = await connect();
    const c = await character(ctx, "claude-sonnet-5-5");
    for (const ending of ["second_date", "second_date", "disaster", "friends"] as const) await airedDate(c.id, ending);
    let r = row(await modelLeague(db), "claude")!;
    expect(r).toMatchObject({ agents: 1, characters: 1, dates: 4, enough: false, dates_needed: 1, second_dates: null, disasters: null, second_date_rate: null, disaster_rate: null, stars: null });
    let html = renderToStaticMarkup(createElement(LeagueTable, { league: await modelLeague(db) }));
    expect(html).toContain("4 aired dates so far. Rates show from 5: 1 more date to go.");
    expect(html).not.toContain("second dates</span>");
    expect(html).not.toContain("league-place");

    await airedDate(c.id, "second_date");
    r = row(await modelLeague(db), "claude")!;
    expect(r).toMatchObject({ dates: 5, enough: true, dates_needed: 0, second_dates: 3, disasters: 1, second_date_rate: 0.6, disaster_rate: 0.2 });
    html = renderToStaticMarkup(createElement(LeagueTable, { league: await modelLeague(db) }));
    expect(html).toContain("<strong>60%</strong> <span>second dates</span>");
    expect(html).toContain("20% disasters");
    expect(html).toContain('<span class="league-place" aria-label="Place 1">1</span>');
    expect(html).toContain("No reviews yet");
  });

  it("counts only finished, aired, public dates", async () => {
    const ctx = await connect();
    const c = await character(ctx, "gpt-4o");
    await airedDate(c.id, "second_date");
    await airedDate(c.id, "second_date", { aired: false });
    await airedDate(c.id, "second_date", { visibility: "private" });
    await airedDate(c.id, "second_date", { visibility: "unlisted" });
    const generating = await airedDate(c.id, "second_date");
    await db.query("update episodes set status = 'generating' where id = $1", [generating]);
    expect(row(await modelLeague(db), "gpt")).toMatchObject({ agents: 1, dates: 1 });
  });

  it("leaves our own traffic out: the house crowd, our checks, and their reviews", async () => {
    const outside = await connect("outside-agent");
    const mine = await character(outside, "qwen2.5:14b");
    for (let i = 0; i < 5; i++) await airedDate(mine.id, "friends");

    // The house crowd and one of our checks say a model and date plenty: neither is an outside agent.
    const crowd = await connect("botchelor-loop-crowd-dante");
    const bot = await character(crowd, "llama3.2");
    const check = await connect("botchelor-smoke");
    const probe = await character(check, "claude-sonnet-5-5");
    for (let i = 0; i < 6; i++) {
      await airedDate(bot.id, "second_date");
      await airedDate(probe.id, "second_date");
    }
    expect((await stamps(await airedDate(bot.id, "second_date"))).map((s) => s.family)).toEqual(["llama"]);

    // Reviews of the outside character: one from an outside agent, one from the crowd.
    const fan = await connect("another-agent");
    await character(fan);
    expect((await call("review_character", { character_id: mine.id, stars: 4, review: "Dry and kind." }, fan)).isError).toBeFalsy();
    await db.query("insert into character_reviews (reviewer_id, character_id, stars, via) values ($1, $2, 1, 'mcp')", [bot.agent, mine.id]);

    const league = await modelLeague(db);
    expect(league.rows.map((r) => r.family)).toEqual(["qwen"]);
    expect(league.agents).toBe(1);
    expect(league.dates).toBe(5);
    expect(row(league, "qwen")).toMatchObject({ agents: 1, dates: 5, second_date_rate: 0, disaster_rate: 0, reviews: 1, stars: 4 });
    const html = renderToStaticMarkup(createElement(LeagueTable, { league }));
    expect(html).toContain("4.0 of 5, from 1 review");
    expect(html).not.toContain("Llama");
    expect(html).not.toContain("Claude");
  });

  it("ranks families with a rate by second dates, then lists the ones still short; raw strings never reach the page or the JSON", async () => {
    const [x, y, z] = [await connect(), await connect(), await connect()];
    const good = await character(x, "gemini-2.5-pro <script>alert(1)</script>");
    const fair = await character(y, "mistral-large https://spam.example");
    const fresh = await character(z, "phi-4");
    for (const e of ["second_date", "second_date", "second_date", "second_date", "friends"] as const) await airedDate(good.id, e);
    for (const e of ["second_date", "disaster", "disaster", "friends", "friends"] as const) await airedDate(fair.id, e);
    await airedDate(fresh.id, "second_date");
    const league = await modelLeague(db);
    expect(league.rows.map((r) => [r.family, r.second_date_rate])).toEqual([["gemini", 0.8], ["mistral", 0.2], ["other", null]]);
    const html = renderToStaticMarkup(createElement(LeagueTable, { league }));
    expect(html.indexOf("Gemini")).toBeLessThan(html.indexOf("Mistral"));
    expect(html.indexOf("Mistral")).toBeLessThan(html.indexOf("Other models"));
    expect(html).toContain("1 aired date so far. Rates show from 5: 4 more dates to go.");
    const out = JSON.stringify(leagueJson(league));
    for (const text of [html, out]) {
      expect(text).not.toContain("script");
      expect(text).not.toContain("spam.example");
      expect(text).not.toContain("phi-4");
      expect(text).not.toContain(good.agent);
    }
  });
});

describe("where the league is read", () => {
  it("GET /api/league/models returns the rows, how they were counted and how to join, readable from anywhere", async () => {
    const ctx = await connect();
    const c = await character(ctx, "claude-sonnet-5-5");
    for (let i = 0; i < 5; i++) await airedDate(c.id, i < 2 ? "second_date" : "friends");
    const res = await leagueRoute(new Request(`${BASE_URL}/api/league/models`));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(body.self_declared).toBe(true);
    expect(body.page).toBe(`${BASE_URL}${LEAGUE_PATH}`);
    expect(body.min_dates).toBe(5);
    expect(body.rows).toEqual([expect.objectContaining({ family: "claude", label: "Claude", agents: 1, characters: 1, dates: 5, second_date_rate: 0.4, disaster_rate: 0 })]);
    expect(body.how_counted.model).toMatch(/Self-declared/);
    expect(body.how_counted.left_out).toMatch(/own bots/);
    expect(body.join.any_time).toBe(DECLARE_CALLS.any_time);
    expect(body.empty).toBeUndefined();
  });

  it("says so when it's empty, and 404s when the switch is off", async () => {
    const empty = await (await leagueRoute(new Request(`${BASE_URL}/api/league/models`))).json();
    expect(empty.rows).toEqual([]);
    expect(empty.empty).toBe("No agent has told us its model yet. Yours can.");
    vi.stubEnv("MODEL_LEAGUE", "0");
    expect((await leagueRoute(new Request(`${BASE_URL}/api/league/models`))).status).toBe(404);
  });

  it("the page says it's self-declared, what the engine decides and who's left out; off, it's a 404", async () => {
    const { default: ModelLeaguePage, metadata } = await import("@/app/agents/league/page");
    const html = renderToStaticMarkup(await ModelLeaguePage()).replace(/&#x27;/g, "'");
    expect(html).toContain("<h1>Which AI is the best date?</h1>");
    expect(html).toContain("as each agent told us");
    expect(html).toContain("No agent has told us its model yet. Yours can.");
    expect(html).toContain("The show's engine decides how every date ends");
    expect(html).toContain("The show's own bots, checks and test visitors don't count");
    expect(html).toContain('href="/api/league/models"');
    expect(metadata.alternates?.canonical).toBe(LEAGUE_PATH);
    vi.stubEnv("MODEL_LEAGUE", "0");
    await expect(ModelLeaguePage()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  it("is in the sitemap, in llms.txt and linked from /agents, and all three follow the switch", async () => {
    const urls = () => staticSitemap("https://b.test").map((e) => e.url);
    expect(urls()).toContain(`https://b.test${LEAGUE_PATH}`);
    expect(llmsText("https://b.test")).toMatch(/\[The model league\]\(https:\/\/b\.test\/agents\/league\?[^)]*\): which model family's characters get the most second dates, as each agent told us/);
    expect(llmsText("https://b.test")).toContain("https://b.test/api/league/models");
    const agentsPage = readFileSync(join(__dirname, "..", "app", "agents", "page.tsx"), "utf8");
    expect(agentsPage).toContain("{modelLeagueOn() && (");
    expect(agentsPage).toContain("<Link href={LEAGUE_PATH}>which AI is the best date?</Link>");
    vi.stubEnv("MODEL_LEAGUE", "0");
    expect(urls()).not.toContain(`https://b.test${LEAGUE_PATH}`);
    expect(llmsText("https://b.test")).not.toContain("model league");
  });

  it("declareModel ignores a missing agent, and the latest word wins", async () => {
    expect(await declareModel(db, "", "gpt-4o", "set_profile")).toBeNull();
    await declareModel(db, "agent-x", "gpt-4o", "set_profile");
    await declareModel(db, "agent-x", "claude-haiku-5-5", "send_feedback");
    expect(await declaredModel(db, "agent-x")).toMatchObject({ model: "claude-haiku-5-5", family: "claude", via: "send_feedback" });
    expect((await db.query("select 1 from agent_models where agent_id = 'agent-x'")).rows).toHaveLength(1);
  });
});

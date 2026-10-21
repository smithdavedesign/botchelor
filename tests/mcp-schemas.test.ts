import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOPLAY_SIDES, DECK_FILTERS, ENUM_SOURCES, FEEDBACK_SORTS, FEEDBACK_VOTES, handleMcpMessage, LIST_CAST_KINDS, MCP_TOOLS, SEARCH_MADE_BY, TOOL_COSTS, type McpContext } from "@/lib/mcp";
import { DATE_VISIBILITIES, ENDINGS, RATING_CATEGORY_IDS, SLIDING_DOOR_IDS } from "@/lib/rules";
import { FEEDBACK_KINDS } from "@/lib/feedback";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// Items 1 and 2 of the 10/10 batch: enums and defaults in every schema, from the constants the handlers check (#485,
// #498 visitors also named sliding_doors.change, autoplay_own_date.side and guess_dealbreaker), and a cost on every tool.
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Prop = { type?: string | string[]; enum?: unknown[]; default?: unknown; minimum?: number; maximum?: number; items?: Prop; anyOf?: Prop[]; description?: string };
const props = (t: (typeof MCP_TOOLS)[number]) => ((t.inputSchema as { properties?: Record<string, Prop> }).properties ?? {}) as Record<string, Prop>;

/** Every enum in every tool's schema, as `tool.argument` → its values (array items and anyOf branches included). */
function schemaEnums(): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const t of MCP_TOOLS) {
    for (const [k, p] of Object.entries(props(t))) {
      const values = p.enum ?? p.items?.enum ?? p.anyOf?.find((b) => b.enum)?.enum;
      if (values) out[`${t.name}.${k}`] = values;
    }
  }
  return out;
}

describe("enums: every schema lists the values its handler takes, from one constant", () => {
  it("every enum in every schema is registered in ENUM_SOURCES, with the same values, and nothing registered is missing", () => {
    const found = schemaEnums();
    expect(Object.keys(found).sort()).toEqual(Object.keys(ENUM_SOURCES).sort());
    for (const [key, values] of Object.entries(found)) expect({ key, values }).toEqual({ key, values: [...ENUM_SOURCES[key]] });
  });

  it("the ones visitors named are there: sliding_doors.change, autoplay_own_date.side, guess_dealbreaker.pick", () => {
    expect(ENUM_SOURCES["sliding_doors.change"]).toEqual(SLIDING_DOOR_IDS);
    expect(ENUM_SOURCES["autoplay_own_date.side"]).toEqual(AUTOPLAY_SIDES);
    expect(ENUM_SOURCES["guess_dealbreaker.pick"]).toEqual([1, 2, 3, 4]);
    const tool = (n: string) => props(MCP_TOOLS.find((t) => t.name === n)!);
    expect(tool("autoplay_own_date").side.default).toBe("mine");
    expect(tool("sliding_doors").change.description).toMatch(/bolder: .*long_game: /);
    expect(tool("guess_dealbreaker").pick.description).toMatch(/e\.g\. 2/);
  });

  it("every default is a value the argument can take", () => {
    for (const t of MCP_TOOLS) {
      for (const [k, p] of Object.entries(props(t))) {
        if (p.default === undefined) continue;
        const where = `${t.name}.${k}`;
        if (p.enum) expect({ where, ok: p.enum.includes(p.default) }).toEqual({ where, ok: true });
        const types = Array.isArray(p.type) ? p.type : p.type ? [p.type] : [];
        const kind = typeof p.default === "number" ? (Number.isInteger(p.default) ? ["integer", "number"] : ["number"]) : [typeof p.default];
        if (types.length) expect({ where, ok: kind.some((x) => types.includes(x)) }).toEqual({ where, ok: true });
        if (typeof p.default === "number") {
          if (p.minimum !== undefined) expect(p.default).toBeGreaterThanOrEqual(p.minimum);
          if (p.maximum !== undefined) expect(p.default).toBeLessThanOrEqual(p.maximum);
        }
      }
    }
  });

  it("the defaults visitors guessed at are said: limits, waits, visibility, format, booleans", () => {
    const d = (tool: string, arg: string) => props(MCP_TOOLS.find((t) => t.name === tool)!)[arg].default;
    expect(d("go_on_date", "visibility")).toBe("public");
    expect(d("start_own_date", "visibility")).toBe("public");
    expect(d("go_on_date", "format")).toBe("classic");
    expect(d("get_episode", "wait_seconds")).toBe(0);
    expect(d("get_episode", "include_transcript")).toBe(true);
    expect(d("list_cast", "kind")).toBe("all");
    expect(d("swipe_deck", "only")).toBe("all");
    expect(d("search_characters", "open_only")).toBe(true);
    expect(d("feedback_board", "sort")).toBe("top");
    expect(d("submit_own_date_step", "compact")).toBe(true);
  });

  it("a free-text field with an expected shape gives an example", () => {
    const desc = (tool: string, arg: string) => props(MCP_TOOLS.find((t) => t.name === tool)!)[arg].description ?? "";
    expect(desc("vote_feedback", "item_id")).toMatch(/shaped "<feedback id>:<kind>", e\.g\./);
    expect(desc("reflect_on_date", "reflection")).toMatch(/e\.g\. "/);
    expect(desc("search_characters", "query")).toMatch(/e\.g\. "/);
    expect(desc("search_characters", "traits")).toMatch(/e\.g\. \[/);
    expect(desc("forget_memory", "item")).toMatch(/episode_id \(reflection\)/);
    expect(desc("read_texts", "after")).toMatch(/items\[\]\.id/);
  });
});

describe("costs: every tool says what it costs (#485, #498)", () => {
  it("every description ends with its cost; the free ones say Free", () => {
    for (const t of MCP_TOOLS) expect({ tool: t.name, ends: t.description.endsWith(TOOL_COSTS[t.name as keyof typeof TOOL_COSTS]) }).toEqual({ tool: t.name, ends: true });
    expect(TOOL_COSTS.sliding_doors).toMatch(/^Free: no model call, so it doesn't use a date, a token or the agents' shared daily budget/);
    expect(TOOL_COSTS.start_own_date).toMatch(/^Free/);
    for (const name of ["browse_episodes", "predict", "swipe", "send_feedback", "review_character"] as const) expect(TOOL_COSTS[name]).toBe("Free.");
  });

  it("the tools that can spend say what, and take a preview (plan_second_date: check)", () => {
    const spenders = ["go_on_date", "plan_second_date", "answer_date_proposal", "autoplay_own_date", "hand_over_own_date"] as const;
    for (const name of spenders) {
      expect(TOOL_COSTS[name]).toMatch(/shared daily date/);
      expect(Object.keys(props(MCP_TOOLS.find((t) => t.name === name)!))).toContain("preview");
    }
    expect(TOOL_COSTS.answer_match).toMatch(/proposed: yes then books it/);
    expect(Object.keys(props(MCP_TOOLS.find((t) => t.name === "start_own_date")!))).toContain("preview");
  });
});

// ------------------------------------------------- the handlers -------------------------------------------------

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
async function connect(client = "schemas-test"): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: client } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
const ok = (r: Any, what: string) => expect({ what, error: r.isError ? r.content[0].text : null }).toEqual({ what, error: null });

describe("the handlers take every value their schema lists", () => {
  it("list_cast kinds, search made_by, swipe_deck only, feedback_board kinds and sorts", async () => {
    const me = await connect();
    const mine = (await call("create_character", validCharacter({ name: "Ada Lumen", open_to_dates: true, extras: PROFILE }), me)).structuredContent.character.id;
    for (const kind of LIST_CAST_KINDS) ok(await call("list_cast", { kind }, me), `list_cast ${kind}`);
    for (const made_by of SEARCH_MADE_BY) ok(await call("search_characters", { made_by, open_only: false }, me), `search ${made_by}`);
    for (const only of DECK_FILTERS) ok(await call("swipe_deck", { character_id: mine, only }, me), `swipe_deck ${only}`);
    for (const sort of FEEDBACK_SORTS) ok(await call("feedback_board", { sort }, me), `feedback_board ${sort}`);
    for (const kind of FEEDBACK_KINDS) ok(await call("feedback_board", { kind }, me), `feedback_board ${kind}`);
  });

  it("vote_feedback takes up, down and none", async () => {
    const author = await connect();
    await call("send_feedback", { rating: 8, problems: "The swipe deck ran dry after three cards." }, author);
    const voter = await connect();
    await call("create_character", validCharacter({ name: "Ada Lumen" }), voter);
    const item = (await call("feedback_board", {}, voter)).structuredContent.items[0].id;
    for (const vote of FEEDBACK_VOTES) ok(await call("vote_feedback", { item_id: item, vote }, voter), `vote ${vote}`);
  });

  it("sliding_doors takes every change, set_date_visibility every visibility, review every tag, predict every ending", async () => {
    const host = await connect();
    const mine = (await call("create_character", validCharacter({ name: "Ada Lumen" }), host)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: mine, partner_id: HOUSE_PARTNER_ID }, host)).structuredContent.episode.id;
    for (const change of SLIDING_DOOR_IDS) ok(await call("sliding_doors", { episode_id: ep, change }, host), `sliding_doors ${change}`);
    for (const visibility of [...DATE_VISIBILITIES].reverse()) ok(await call("set_date_visibility", { episode_id: ep, visibility }, host), `visibility ${visibility}`);
    const other = await connect();
    for (const tag of RATING_CATEGORY_IDS) ok(await call("review_character", { character_id: HOUSE_PARTNER_ID, stars: 4, tags: [tag] }, other), `tag ${tag}`);
    for (const pick of ENDINGS) ok(await call("predict", { episode_id: ep, pick }, other), `predict ${pick}`);
  });

  it("guess_dealbreaker takes a number 1 to 4, as a number or a string", async () => {
    const host = await connect();
    const mine = (await call("create_character", validCharacter({ name: "Ada Lumen" }), host)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: mine, partner_id: HOUSE_PARTNER_ID }, host)).structuredContent.episode.id;
    const guesser = await connect();
    const options = (await call("guess_dealbreaker", { episode_id: ep }, guesser)).structuredContent.options;
    expect(options).toHaveLength(4);
    const g = await call("guess_dealbreaker", { episode_id: ep, pick: 2 }, guesser);
    ok(g, "pick 2");
    expect(g.structuredContent.guess).toBeTruthy();
    ok(await call("guess_dealbreaker", { episode_id: ep, pick: "4" }, guesser), "pick '4'");
  });

  it("autoplay_own_date takes every side its schema lists (previewed), and predict_arc refuses a pick it can't read", async () => {
    const me = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), me)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), me)).structuredContent.character.id;
    const ep = (await call("start_own_date", { character_id: a, partner_id: b }, me)).structuredContent.step.episode_id;
    for (const side of AUTOPLAY_SIDES) {
      const p = await call("autoplay_own_date", { episode_id: ep, side, preview: true }, me);
      ok(p, `autoplay ${side}`);
      expect(p.structuredContent).toMatchObject({ preview: true, played: false, side });
    }
    const bad = await call("predict_arc", { character_id: a, with: b, pick: "maybe" }, me);
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent).toMatchObject({ code: "invalid_argument", field: "pick" });
  });
});

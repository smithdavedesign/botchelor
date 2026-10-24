import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, MCP_SERVER_INFO, MCP_TOOLS, TOOL_COSTS, type McpContext } from "@/lib/mcp";
import { fullInstructions } from "@/lib/mcp/dispatcher";
import { matchStatus } from "@/lib/swipes";
import { temperamentWords } from "@/lib/temperament";
import { scriptOutcome, startTestDb, validCharacter } from "./helpers";

// MCP 2.13.0, from the 2026-10-23-2135 run (three local visitors). Run folder: ~/.botchelor-loop/runs/2026-10-23-2135.
// #751 shorter replies, #752 made_by: agent without house-run bots, #753 date_agreed and the date their agent started,
// #754 this_week said and plays_as explained; and the run's small ones (the house-cast rule, "free" vs shared daily dates,
// agents_on_now in the first my_status).
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

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async (method: string, params: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
async function connect(client = "botchelor-run-2135-test"): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
/** What a client gets from a success: the JSON, the same in the text (unindented) and in structuredContent. */
const ok = (r: Any): Any => {
  expect(r.isError, r.content?.[0]?.text).toBeUndefined();
  expect(JSON.parse(r.content[0].text)).toEqual(r.structuredContent);
  expect(r.content[0].text).not.toContain("\n");
  return r.structuredContent;
};
async function agentWith(name: string, extra: Record<string, unknown> = {}, client?: string) {
  const ctx = await connect(client);
  const made = ok(await call("create_character", validCharacter({ name, keep_name: true, open_to_dates: true, extras: PROFILE, ...extra }), ctx));
  return { ctx, id: made.character.id as string, agentId: made.agent_id as string, made };
}
async function matched(a = "Odalys Verhoeven", b = "Marguerite Oyelaran") {
  const A = await agentWith(a);
  const B = await agentWith(b);
  await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
  await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
  return { A, B };
}

it("is MCP 2.13.0 or later", () => {
  expect(MCP_SERVER_INFO.version.localeCompare("2.13.0", undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
});

describe("#751: shorter replies", () => {
  it("agent_id_note comes once a connection (its first reply that names the identity), agent_id on every reply", async () => {
    const ctx = await connect();
    const first = ok(await call("my_status", {}, ctx));
    expect(first.agent_id_note).toMatch(/^Your agent_id is [0-9a-f-]{36} \(this connection remembers it\)/);
    const id = first.agent_id;
    for (const [tool, args] of [["my_status", {}], ["my_characters", {}], ["my_notifications", {}], ["my_status", {}]] as [string, Record<string, unknown>][]) {
      const r = ok(await call(tool, args, ctx));
      expect(r.agent_id, tool).toBe(id);
      expect(r.agent_id_note, tool).toBeUndefined();
    }
    // Another connection is news again; stateless, every write mints a new identity, so its note is always news.
    expect(ok(await call("my_status", {}, await connect())).agent_id_note).toMatch(/^Your agent_id is /);
    const minted = ok(await call("create_character", validCharacter({ name: "Dorian Sol", keep_name: true })));
    expect(minted.agent_id_note).toMatch(/^Your agent_id is [0-9a-f-]{36} — pass it as "agent_id"/);
    // An agent_id passed in has nothing to note.
    expect(ok(await call("my_status", { agent_id: id }, ctx)).agent_id_note).toBeUndefined();
  });

  it("a note this connection was already sent word for word is left out and named; compact: false (on any tool) sends it again", async () => {
    const A = await agentWith("Ada Lumen");
    ok(await call("my_status", {}, A.ctx)); // the connection's first, short one
    const once = ok(await call("my_status", {}, A.ctx));
    const twice = ok(await call("my_status", {}, A.ctx));
    const sent = Object.keys(once).filter((k) => k.endsWith("_note") && k !== "agent_id_note" && k !== "notes_left_out_note");
    expect(sent.length).toBeGreaterThan(3);
    for (const k of sent) expect(twice[k], k).toBeUndefined();
    expect(twice.notes_left_out).toEqual(expect.arrayContaining(sent));
    // The first reply that left one out (cursor_format, the first my_status had it) explains it; once, then never again.
    expect(once.notes_left_out).toEqual(["cursor_format"]);
    expect(once.notes_left_out_note).toMatch(/compact: false sends every note/);
    expect(twice.notes_left_out_note).toBeUndefined();
    const all = ok(await call("my_status", { compact: false }, A.ctx));
    for (const k of sent) expect(all[k], k).toBe(once[k]);
    expect(all.notes_left_out).toBeUndefined();
    // compact: false on a tool without a compact argument is taken quietly (no "Ignored" warning).
    const card = ok(await call("get_character", { character_id: A.id, compact: false }, A.ctx));
    expect(card.warning).toBeUndefined();
    expect(card.ignored_arguments).toBeUndefined();
  });

  it("swipe_deck's cards are compact by default (compact: false has the full card); my_status leaves the house cast out after a connection's first", async () => {
    const A = await agentWith("Ada Lumen");
    await agentWith("Bo Quill");
    const deck = ok(await call("swipe_deck", { character_id: A.id }, A.ctx));
    const full = ok(await call("swipe_deck", { character_id: A.id, compact: false }, A.ctx));
    const card = deck.cards[0];
    expect(Object.keys(card)).toEqual(expect.arrayContaining(["id", "name", "made_by", "run_by", "house_bot", "liked_you"]));
    expect(card.prompts).toBeUndefined();
    expect(full.cards[0].prompts).toBeDefined();
    expect(JSON.stringify(deck).length).toBeLessThan(JSON.stringify(full).length * 0.6);
    const tool = MCP_TOOLS.find((x) => x.name === "swipe_deck")!;
    expect((tool.inputSchema as Any).properties.compact).toMatchObject({ default: true });
    // my_status: the first has the house cast; the next leaves it out and says how to get it back.
    expect(ok(await call("my_status", {}, A.ctx)).house_cast.length).toBeGreaterThan(0);
    const later = ok(await call("my_status", {}, A.ctx));
    expect(later.house_cast).toBeUndefined();
    expect(later.left_out).toEqual({ blocks: ["house_cast"], back: expect.stringMatching(/compact: false or include: \["cast"\]/) });
    expect(ok(await call("my_status", { include: ["cast"] }, A.ctx)).house_cast[0].traits).toBeDefined();
  });

  it("an error is still the text \"Error: …\" with isError, and structuredContent { error, code } (scripts/loop/crowd.mjs reads it so)", async () => {
    const ctx = await connect();
    const r = await call("get_character", { character_id: "nobody-here" }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^Error: No character with character_id/);
    expect(r.structuredContent).toMatchObject({ error: expect.stringMatching(/^No character/), code: "not_found" });
  });
});

describe("#752: made_by: agent is other agents' characters; house_bot is its own value", () => {
  it("search_characters and swipe_deck agree on who's an agent and who's a house-run bot", async () => {
    const bot = await agentWith("Ines Varga-Holm", {}, "botchelor-loop-swipe-back");
    const live = await agentWith("Tobiah Ferreira", {}, "lanternfish");
    const me = await agentWith("Ada Lumen", {}, "visitor");
    const ids = (r: Any) => (r.characters ?? r.cards).map((c: Any) => c.id);
    const agents = ok(await call("search_characters", { made_by: "agent", include_house: false }, me.ctx));
    expect(ids(agents)).toContain(live.id);
    expect(ids(agents)).not.toContain(bot.id);
    expect(agents.characters.every((c: Any) => c.made_by === "agent" && c.run_by === "agent")).toBe(true);
    expect(agents).toMatchObject({ made_by: "agent", filtered_out: expect.any(Number) });
    const bots = ok(await call("search_characters", { made_by: "house_bot", include_house: false }, me.ctx));
    expect(ids(bots)).toEqual([bot.id]);
    expect(bots.characters[0]).toMatchObject({ made_by: "house_bot", run_by: "house_bot", house_bot: true });
    // any still has both.
    const any = ids(ok(await call("search_characters", { include_house: false }, me.ctx)));
    expect(any).toEqual(expect.arrayContaining([bot.id, live.id]));
    // swipe_deck: only agents leaves the bots out, only house_bots is them alone; the cards' labels say the same.
    expect(ids(ok(await call("swipe_deck", { character_id: me.id, only: "agents" }, me.ctx)))).toEqual([live.id]);
    const deckBots = ok(await call("swipe_deck", { character_id: me.id, only: "house_bots" }, me.ctx));
    expect(ids(deckBots)).toEqual([bot.id]);
    expect(deckBots.cards[0]).toMatchObject({ made_by: "house_bot", run_by: "house_bot" });
    const search = MCP_TOOLS.find((x) => x.name === "search_characters")!.inputSchema as Any;
    expect(search.properties.made_by.enum).toEqual(["any", "agent", "human", "house", "house_bot"]);
    expect(search.properties.made_by.description).toMatch(/agent is another agent's, no house-run bots/);
    expect(search.properties.only.enum).toContain("house_bots");
  });
});

describe("#753: date_agreed is said as itself, and the date their agent started is said before you try to start one", () => {
  it("a wait woken by a date both said yes to returns date_agreed (my_status and my_notifications too), with a note that either can book", async () => {
    const { A, B } = await matched();
    await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
    const cursor = ok(await call("my_status", {}, A.ctx)).cursor;
    setTimeout(() => void call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx), 400);
    const s = ok(await call("my_status", { since: cursor, wait_seconds: 6 }, A.ctx));
    expect(s.returned_because).toBe("date_agreed");
    expect(s.woke_for).toContain("date_agreed");
    expect(s.date_agreed_note).toMatch(/Either of you can book it now: go_on_date \(preview: true first: the show plays it\) or start_own_date \(free: you each play your own\)\. If their agent starts it first, you'll get a heads_up and get_own_date_step\./);
    expect(s.your_move_note).toBeUndefined();
  });

  it("answer_match's agreed note says either side can book; a yes after their agent started the date says so, with the call that plays it", async () => {
    expect(matchStatus(true, true).note).toBe("Matched, and both said yes: the date is agreed, and either of you can book it now (if their side starts it first, you'll get a heads_up and get_own_date_step).");
    expect(matchStatus(true, true).note).not.toMatch(/yours to book/);
    const { A, B } = await matched();
    await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
    const yes = ok(await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx));
    expect(yes).toMatchObject({ status: "agreed", date_agreed: true });
    expect(yes.next).toMatch(/^Date agreed: either of you can book it now\..*If their agent starts it first, you'll get a heads_up and get_own_date_step\.$/);
    // Visitor 3's case: their agent starts it, and A, not having looked, sees it everywhere before calling start_own_date.
    scriptOutcome({ ending: "friends" });
    const started = ok(await call("start_own_date", { character_id: B.id, partner_id: A.id }, B.ctx));
    const status = ok(await call("my_status", {}, A.ctx));
    expect(status.heads_up[0]).toMatchObject({ kind: "own_date_started", episode_id: started.episode_id, started_by: "Marguerite Oyelaran's agent", take_your_move: { tool: "get_own_date_step" } });
    expect(status.dates_to_book).toBeUndefined();
    const notes = ok(await call("my_notifications", {}, A.ctx));
    expect(notes.heads_up[0]).toMatchObject({ kind: "own_date_started", episode_id: started.episode_id });
    expect(notes.notifications.some((n: Any) => n.kind === "own_date_invite")).toBe(true);
    // A yes said again names the date that's already going, and the call that plays it.
    const again = await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
    expect(again.isError).toBe(true);
    expect(again.content[0].text).toMatch(new RegExp(`Their date is already going: their agent started it \\(${started.episode_id}\\), and you play your side: get_own_date_step takes your move`));
    expect(again.structuredContent.date_started).toEqual({ episode_id: started.episode_id, by: "their agent" });
    expect(again.structuredContent.next_calls).toEqual([expect.objectContaining({ tool: "get_own_date_step", args: { episode_id: started.episode_id, wait_seconds: 50 } })]);
  });
});

describe("#754: this_week said when the show deals it; plays_as explained", () => {
  it("create_character says the show dealt this_week, and how to change it; one you give is yours, with no note", async () => {
    const dealt = (await agentWith("Ada Lumen")).made;
    expect(dealt).toMatchObject({ this_week: expect.any(String), this_week_by: "the show" });
    expect(dealt.this_week_note).toBe(`You didn't give a this_week, so the show dealt one: "${dealt.this_week}". Its dates bring it up, and a new one is dealt each Monday; set your own with update_character (this_week), or pass this_week when you create.`);
    const mine = (await agentWith("Bo Quill", { this_week: "Repainting a rowing boat, badly" })).made;
    expect(mine).toMatchObject({ this_week: "Repainting a rowing boat, badly", this_week_by: "you" });
    expect(mine.this_week_note).toBeUndefined();
  });

  it("my_character_memory says who wrote this_week and where plays_as comes from (a deadpan sheet reads as humour)", async () => {
    const A = await agentWith("Odalys Verhoeven", { traits: ["deadpan", "loyal", "precise"], voice: "Clipped and dry." });
    const m = ok(await call("my_character_memory", { character_id: A.id }, A.ctx));
    expect(m).toMatchObject({ this_week_by: "the show", plays_as: expect.stringMatching(/quick to joke/) });
    expect(m.plays_as_note).toMatch(/^plays_as is the temperament the engine scores it on \(warmth, openness, guard, humour\), in words: read from the temperament words in its traits and voice \("deadpan": humour up, "loyal": warmth up, "dry": humour up\)\. It's not a style note/);
    expect(temperamentWords({ traits: ["deadpan", "cold", "x"], voice: null })).toEqual([
      { word: "deadpan", axis: "humor", up: true },
      { word: "cold", axis: "warmth", up: false },
    ]);
  });
});

describe("the run's small ones", () => {
  it("the quickstart and start_own_date say own dates need a match both said yes to (never the house cast); both costs say what the shared daily dates are", async () => {
    const init = (await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "x" } }, {})).result;
    expect(init.instructions).toMatch(/start_own_date: free, with a match both said yes to or two of yours, never the house cast/);
    expect(init.instructions.length).toBeLessThan(4000);
    const own = MCP_TOOLS.find((x) => x.name === "start_own_date")!.description;
    expect(own).toMatch(/Never with the house cast \(the show plays them: go_on_date\)\. Either two of YOUR characters .*or yours and ANOTHER AGENT's once both said yes to a date \(answer_match\)/);
    expect(TOOL_COSTS.start_own_date).toMatch(/no weekly date, token or shared daily date \(those count what the show's model writes, as autoplay_own_date does\)/);
    expect(TOOL_COSTS.autoplay_own_date).toMatch(/^Uses one of the agents' shared daily dates \(the show's model writes it; once a date\), never your weekly dates or tokens\. Lines you write yourself are free\./);
    expect(fullInstructions()).toMatch(/date_agreed \(a date both just said yes to\)/);
  });

  it("the first my_status shows agents_on_now", async () => {
    await agentWith("Tobiah Ferreira", {}, "lanternfish");
    const ctx = await connect();
    const first = ok(await call("my_status", {}, ctx));
    expect(first.agents_on_now).toBe(1);
    expect(first.left_out.blocks).not.toContain("agents_on_now");
  });
});

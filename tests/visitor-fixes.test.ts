import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLabel, handleMcpMessage, howToMeet, normaliseArgs, type McpContext } from "@/lib/mcp";
import type { CharacterExtras } from "@/lib/extras";
import { episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// The fixes from the 4-visitor simulation (#188–#191) and the loop's open issues (#176–#178).
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
  vi.unstubAllEnvs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;

async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-visitor-fixes-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

async function agentWith(name: string, extra: Record<string, unknown> = {}) {
  const ctx = await connect();
  const c = (await call("create_character", validCharacter({ name, ...extra }), ctx)).structuredContent;
  return { ctx, agentId: c.agent_id as string, id: c.character.id as string };
}

describe("arguments (#176, #188)", () => {
  it("a missing required argument is named, with what the tool takes", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const r = await call("propose_date", { character_id: id }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/"with" is required/);
    expect(r.content[0].text).toMatch(/propose_date takes: .*character_id/);
    expect((await call("get_episode", { episode_id: "" }, ctx)).content[0].text).toMatch(/"episode_id" is required/);
  });

  it("the other character's usual names are read as the tool's own, and said so", () => {
    expect(normaliseArgs("propose_date", { character_id: "a", partner_id: "b" })).toEqual({ args: { character_id: "a", with: "b" }, aliased: ["partner_id → with"] });
    expect(normaliseArgs("go_on_date", { character_id: "a", with: "b" })).toEqual({ args: { character_id: "a", partner_id: "b" }, aliased: ["with → partner_id"] });
    expect(normaliseArgs("go_on_date", { character_id: "a", card_id: "b" }).args.partner_id).toBe("b");
    // The tool's own name wins, and a tool without another character is left alone.
    expect(normaliseArgs("go_on_date", { partner_id: "x", with: "b" }).aliased).toEqual([]);
    expect(normaliseArgs("list_cast", { with: "b" }).aliased).toEqual([]);
    // A singular or plural slip (sim run 6: "problem" on send_feedback).
    expect(normaliseArgs("send_feedback", { problem: "x" })).toEqual({ args: { problems: "x" }, aliased: ["problem → problems"] });
  });

  it("an aliased call runs, and agent_id is never an ignored argument", async () => {
    const { ctx, agentId, id } = await agentWith("Ada Lumen");
    const r = await call("propose_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, agent_id: agentId }, ctx);
    // A house character takes no proposals, but it got as far as asking: "with" arrived.
    expect(r.content[0].text).not.toMatch(/is required/);
    const cast = await call("list_cast", { agent_id: agentId }, ctx);
    expect(cast.structuredContent.ignored_arguments).toBeUndefined();
  });
});

describe("list_cast (#189)", () => {
  it("puts this season's house cast first, says who made each, and filters by kind", async () => {
    const { ctx } = await agentWith("Ada Lumen");
    for (let i = 0; i < 3; i++) await agentWith(`Agent Made ${["Bram", "Cleo", "Dov"][i]}`);
    const cast = (await call("list_cast", {}, ctx)).structuredContent.cast as Any[];
    expect(cast[0].house).toBe(true);
    const firstOc = cast.findIndex((c) => !c.house);
    expect(cast.slice(firstOc).every((c) => !c.house)).toBe(true);
    expect(cast.find((c) => !c.house).made_by).toBe("agent");
    const agents = (await call("list_cast", { kind: "agent", limit: 2 }, ctx)).structuredContent.cast as Any[];
    expect(agents).toHaveLength(2);
    expect(agents.every((c) => c.made_by === "agent")).toBe(true);
    expect(((await call("list_cast", { kind: "house" }, ctx)).structuredContent.cast as Any[]).every((c) => c.house)).toBe(true);
  });
});

describe("find_matches says how to meet them (#177)", () => {
  const base = { can_ask_out: false, made_by: "agent", open_to_dates: true, open_to: "everyone", extras: { prompts: [{ id: "geek_out", answer: "Maps" }, { id: "two_truths", answer: "Both true" }], hobbies: ["rowing", "chess"] } as CharacterExtras };
  it("names the reason a match can't be booked yet", () => {
    expect(howToMeet({ ...base, can_ask_out: true }, "mcp")).toMatch(/go_on_date/);
    expect(howToMeet({ ...base, made_by: "house", open_to_dates: false }, "mcp")).toMatch(/Off this season's house cast/);
    expect(howToMeet({ ...base, open_to_dates: false }, "mcp")).toMatch(/hasn't opened them to dates/);
    expect(howToMeet({ ...base, open_to: "people" }, "mcp")).toMatch(/only to characters made by people/);
    expect(howToMeet({ ...base, relationship: { stage: "sparks" } }, "mcp")).toMatch(/dated before/);
  });
  it("find_matches carries it on every match", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const matches = (await call("find_matches", { character_id: id }, ctx)).structuredContent.matches as Any[];
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => typeof m.how_to_meet === "string")).toBe(true);
  });
});

describe("agent activity (#178)", () => {
  it("is a coarse label, never a timestamp", () => {
    expect(activityLabel(null)).toBe("not seen yet");
    expect(activityLabel(3)).toBe("active now");
    expect(activityLabel(120)).toBe("active today");
    expect(activityLabel(60 * 24 * 3)).toBe("active this week");
    expect(activityLabel(60 * 24 * 30)).toBe("not seen lately");
  });

  it("a stale 'your move' doesn't ride along once the date isn't waiting", async () => {
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const { ctx, agentId, id } = await agentWith("Ada Lumen");
    const ep = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent.episode;
    const turn = (body: string) =>
      t.db.query(`insert into notifications (id, user_id, kind, title, body) values (gen_random_uuid()::text, $1, 'own_date_turn', 'Your move', $2)`, [agentId, body]);
    await turn(`Two-agent date ${ep.id}, 2 of 8 lines in.`);
    expect((await call("my_characters", {}, ctx)).structuredContent.waiting_for_you).toBeUndefined();
    await t.db.query(`update episodes set status = 'generating' where id = $1`, [ep.id]);
    expect((await call("my_characters", {}, ctx)).structuredContent.waiting_for_you).toMatchObject({ own_date_turn: 1 });
  });

  it("'it's done' stops counting once the date airs", async () => {
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const { ctx, agentId, id } = await agentWith("Ada Lumen");
    const ep = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent.episode;
    await t.db.query(`update episodes set revealed_at = null where id = $1`, [ep.id]);
    await t.db.query(
      `insert into notifications (id, user_id, kind, title, body, link) values (gen_random_uuid()::text, $1, 'own_date_ready', 'Done', 'x', $2)`,
      [agentId, `/episodes/${ep.id}`],
    );
    expect((await call("my_characters", {}, ctx)).structuredContent.waiting_for_you).toMatchObject({ own_date_ready: 1 });
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [ep.id]);
    expect((await call("my_characters", {}, ctx)).structuredContent.waiting_for_you).toBeUndefined();
  });

  it("wait_for_my_turn without an episode says it's required (sim run 6)", async () => {
    const { ctx } = await agentWith("Ada Lumen");
    expect((await call("wait_for_my_turn", {}, ctx)).content[0].text).toMatch(/"episode_id" is required/);
  });
});

describe("dates on the show's model say how long and what to do (#190, #191)", () => {
  it("go_on_date says what's next; a private one says what it means", async () => {
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const { ctx, id } = await agentWith("Ada Lumen");
    const r = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, visibility: "private" }, ctx)).structuredContent;
    expect(r.next).toMatch(/wait_for_episode/);
    expect(r.private_note).toMatch(/offline\. Only you see it, it never airs/);
  });

  it("get_episode on a date being written says since when; wait_for_episode returns when it's done or the time's up", async () => {
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const { ctx, id } = await agentWith("Ada Lumen");
    const ep = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent.episode;
    await t.db.query(`update episodes set status = 'generating', created_at = now() - interval '90 seconds' where id = $1`, [ep.id]);
    const g = (await call("get_episode", { episode_id: ep.id }, ctx)).structuredContent;
    expect(g.waiting_seconds).toBeGreaterThanOrEqual(89);
    expect(g.typical).toMatch(/1 to 5 minutes/);
    const started = Date.now();
    const w = (await call("wait_for_episode", { episode_id: ep.id, timeout_seconds: 1 }, ctx)).structuredContent;
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(w.waiting_seconds).toBeDefined();
    await t.db.query(`update episodes set status = 'ready' where id = $1`, [ep.id]);
    expect((await call("wait_for_episode", { episode_id: ep.id }, ctx)).structuredContent.waiting_seconds).toBeUndefined();
  });
});

describe("check_originality never quotes someone else's dealbreaker", () => {
  it("a word only in another character's (hidden) dealbreaker isn't a shared term", async () => {
    const { ctx } = await agentWith("Ada Lumen", { dealbreaker: "Anyone who hums zarzuela overtures at breakfast" });
    const mine = validCharacter({ name: "Bo Quill", bio: "A tram driver who hums zarzuela overtures between every stop.", dealbreaker: "Cold toast" });
    const checked = (await call("check_originality", mine, ctx)).structuredContent.originality;
    expect(JSON.stringify(checked)).not.toMatch(/zarzuela|overture/);
  });
});

describe("loop run 2026-10-19-1133 (#334, #335, #336)", () => {
  it("an empty feed says why; a made-up partner id says it doesn't exist", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const feed = await call("browse_episodes", {}, ctx);
    expect(feed.structuredContent.episodes).toEqual([]);
    expect(feed.structuredContent.note).toMatch(/my_dates/);
    const r = await call("go_on_date", { character_id: id, partner_id: "nobody" }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/No character with that id/);
  });

  it("get_episode can leave the lines out", async () => {
    scriptedModel([episodeJson()]);
    const { ctx, id } = await agentWith("Ada Lumen");
    const epId = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent.episode.id;
    const r = (await call("get_episode", { episode_id: epId, include_transcript: false }, ctx)).structuredContent;
    expect(r.transcript).toBeUndefined();
    expect(typeof r.transcript_total).toBe("number");
    expect(r.status).toBe("ready");
  });
});

describe("loop run 2026-10-19-1155 (#344)", () => {
  it("my_status suggests what to do next", async () => {
    const fresh = await connect();
    await call("swipe_deck", { character_id: "x" }, fresh).catch(() => {});
    const { ctx } = await agentWith("Ada Lumen");
    expect((await call("my_status", {}, ctx)).structuredContent.next).toEqual(["swipe_deck", "go_on_date", "my_matches"]);
  });
});

describe("loop run 2026-10-19-1234 (#346, #347)", () => {
  it("list_cast compact: true cuts each card to who they are", async () => {
    const { ctx } = await agentWith("Ada Lumen");
    const full = (await call("list_cast", {}, ctx)).structuredContent.cast;
    const small = (await call("list_cast", { compact: true }, ctx)).structuredContent.cast;
    expect(small.length).toBe(full.length);
    expect(JSON.stringify(small).length).toBeLessThan(JSON.stringify(full).length);
    expect(Object.keys(small[0])).toEqual(expect.arrayContaining(["id", "name"]));
  });
});

describe("loop run 2026-10-19-1432 (#356)", () => {
  it("start_own_date on a pair the show's model is writing says to wait, not to play it", async () => {
    const a = await agentWith("Ada Lumen");
    const b = (await call("create_character", validCharacter({ name: "Bram Okafor" }), a.ctx)).structuredContent.character.id;
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: a.id, partner_id: HOUSE_PARTNER_ID }, a.ctx)).structuredContent.episode.id;
    // Stand it in as a show-model date of these two, still being written.
    await t.db.query(`update episodes set character_b = $2, status = 'generating', performed_by = 'platform' where id = $1`, [ep, b]);
    const r = await call("start_own_date", { character_id: a.id, partner_id: b }, a.ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/show's model .*wait_for_episode/);
  });
});

describe("loop run 2026-10-19-1623 (#372, #373)", () => {
  it("update_character merges extras, so the dating profile survives a partial update", async () => {
    const { ctx, id } = await agentWith("Ada Lumen", { extras: { prompts: [{ id: "win_me_over", answer: "Soup." }, { id: "irrational_fear", answer: "Moths." }], hobbies: ["choir", "crosswords"] } });
    const r = await call("update_character", { character_id: id, extras: { occupation: "Ferry pilot" } }, ctx);
    expect(r.isError).toBeFalsy();
    const row = (await t.db.query<{ extras: { hobbies?: string[]; occupation?: string } }>(`select extras from characters where id = $1`, [id])).rows[0];
    expect(row.extras.hobbies).toEqual(["choir", "crosswords"]);
    expect(row.extras.occupation).toBe("Ferry pilot");
  });

  it("tools/list with lean: true gives names and one line each", async () => {
    const ctx = await connect();
    const full = (await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx))!.result as Any;
    const lean = (await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/list", params: { lean: true } }, ctx))!.result as Any;
    expect(lean.tools.length).toBe(full.tools.length);
    expect(lean.tools[0].inputSchema).toBeUndefined();
    expect(JSON.stringify(lean).length).toBeLessThan(JSON.stringify(full).length / 3);
  });
});

describe("loop run 2026-10-19-1635 (#376)", () => {
  it("tools/list names: [...] returns just those tools in full; lean lists required arguments", async () => {
    const ctx = await connect();
    const some = (await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { names: ["swipe", "go_on_date"] } }, ctx))!.result as Any;
    expect(some.tools.map((t: Any) => t.name).sort()).toEqual(["go_on_date", "swipe"]);
    expect(some.tools[0].inputSchema).toBeDefined();
    const lean = (await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/list", params: { lean: true } }, ctx))!.result as Any;
    expect(lean.tools.find((t: Any) => t.name === "get_episode").required).toEqual(["episode_id"]);
  });
});

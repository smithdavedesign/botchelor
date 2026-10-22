import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as adminCharacters } from "@/app/api/admin/characters/route";
import { DELETE as unlinkRoute, POST as linkRoute } from "@/app/api/link/route";
import { GET as mcpGet } from "@/app/api/mcp/route";
import { linkCodeInfo, linkedAgents } from "@/lib/agent-links";
import { agentStats } from "@/lib/dating";
import type { SideOutcome } from "@/lib/engine";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { CORE_MCP_TOOLS, CORE_TOOL_ORDER, handleMcpMessage, MCP_TOOLS, PUBLIC_MCP_TOOLS, type McpContext, withoutEnding } from "@/lib/mcp";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

// 2026-10-20: the core tool list, the merged tools, link_account, the admin's removal, and private characters over MCP.
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
const SECRET = ["core", "test", "session", "secret", "0123456789abcdef"].join("-");
const ROSTER = HOUSE_CHARACTERS.map((c) => c.id);

const rpc = async (method: string, params: Any = {}, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Any = {}, ctx: McpContext = {}): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "core-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
/** A person's character, and a date with it (both wanting more, or not). */
async function date(own: string, partner: string, cookie: string, wants: [boolean, boolean], extra: Any = {}) {
  scriptOutcome({ ending: wants[0] && wants[1] ? "second_date" : "friends", sides: [side(wants[0]), side(wants[1])] });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: own, partner_id: partner, ...extra }, cookie);
  return (await res.json()) as Any;
}
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const jsonReq = (path: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE_URL}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  setSeasonCastForTests(ROSTER);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  setSeasonCastForTests(ROSTER);
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the tool list: the core by default, everything on request", () => {
  it("lists the core tools in first-night order, smaller than the full list", async () => {
    // #461: the core is the default everywhere (as over HTTP); ?tools=all or { all: true } lists every tool.
    const core = (await rpc("tools/list")).result.tools;
    expect(core.map((x: Any) => x.name)).toEqual([...CORE_TOOL_ORDER]);
    expect(core).toHaveLength(CORE_MCP_TOOLS.length);
    expect((await rpc("tools/list", {}, { toolset: "core" })).result.tools).toHaveLength(CORE_MCP_TOOLS.length);
    const all = (await rpc("tools/list", {}, { toolset: "all" })).result.tools;
    expect(all).toHaveLength(PUBLIC_MCP_TOOLS.length);
    // 2026-10-20: 53 tools were ~55 KB (~14k tokens) in every agent's context on every turn. The core stays under that.
    // 2026-10-20 (20 visitor runs: "hidden tools" was the most common deduction): autoplay, my_dates, plan_second_date
    // and sliding_doors joined the core, so the budget moved from 31 KB to 37 KB. 2026-10-21 (#423, #444, #461): the
    // tools replies kept sending agents to (my_matches, my_notifications, export_character, set_date_visibility, the
    // feedback board) joined too, and every tool says what it costs and returns: 46 KB. The #413–#515 batch (waits on
    // my_notifications and plan_second_date, browse filters, batch steps, compact my_status) brought it to 48 KB, and
    // the visibility rules on set_date_visibility (#543) to 49 KB, and 2.4.1 (the one-partner rule on go_on_date/swipe/answer_match,
    // why a wait returned) to 49.6 KB. 2.4.2 (search_characters' only filter, the exclusive_soon heads-up, woke_for) stayed there by trimming go_on_date, start_own_date, plan_second_date and my_status, and 2.4.3 (create_character's partner_style, the text-item shape, one-line turns) by trimming create_character, go_on_date, start_own_date and plan_second_date (49.75 KB).
    // 2026-10-22 tighten-ups: added _meta (cost / category / rate_limit) on every tool for clients that read it.
    // _meta is a non-breaking hint most agents ignore; the hot-path prose stays trimmed. Cap moved to 55 KB; the
    // JSON-byte count isn't the whole story (clients that bind to .description don't pay for _meta's bytes against
    // their context window), so the ratio check matters more than the absolute.
    // 2026-10-22 BYOK (set_model/my_model/clear_model) joined the core: three write/read tools so agents can bring
    // their own key over MCP, same as the /account/keys page. Cap moved to 58 KB; descriptions on the three stay tight.
    expect(JSON.stringify(core).length).toBeLessThan(58_000);
    expect(JSON.stringify(core).length).toBeLessThan(JSON.stringify(all).length * 0.76);
    expect((await rpc("tools/list", { all: true })).result.tools).toHaveLength(PUBLIC_MCP_TOOLS.length);
    expect((await rpc("tools/list", { lean: true, core: true })).result.tools).toHaveLength(CORE_MCP_TOOLS.length);
  });

  it("never lists the folded and retired tools, but they still answer by name, and names: [...] shows them", async () => {
    const all = (await rpc("tools/list", { all: true })).result.tools.map((x: Any) => x.name);
    for (const gone of ["wait_for_episode", "wait_for_my_turn", "wait_for_text", "rate_character", "air_date", "list_watch_parties", "request_after_dark"]) {
      expect(all).not.toContain(gone);
    }
    expect((await call("list_watch_parties")).isError).toBeUndefined();
    const named = (await rpc("tools/list", { names: ["air_date", "rate_character"] })).result.tools.map((x: Any) => x.name);
    expect(named.sort()).toEqual(["air_date", "rate_character"]);
    expect(MCP_TOOLS.length).toBe(PUBLIC_MCP_TOOLS.length + 7);
  });

  it("says when it's the core list: how many are left out, their names and how to list them (#447)", async () => {
    const core = (await rpc("tools/list", { core: true })).result;
    expect(core.more_tools).toMatchObject({ listed: CORE_MCP_TOOLS.length, total: PUBLIC_MCP_TOOLS.length, how: expect.stringMatching(/\{ all: true \}.*\?tools=all/) });
    expect(core.more_tools.not_listed).toHaveLength(PUBLIC_MCP_TOOLS.length - CORE_MCP_TOOLS.length);
    expect(core.more_tools.not_listed).toEqual(expect.arrayContaining(["find_matches", "my_character_memory"]));
    expect(core.more_tools.not_listed).not.toContain("my_status");
    expect(core.more_tools.not_listed).not.toContain("my_dates"); // #454 moved it into the core
    expect(core.more_tools.not_listed).not.toContain("my_matches"); // #423
    expect((await rpc("tools/list", { lean: true, core: true })).result.more_tools).toEqual(core.more_tools);
    expect((await rpc("tools/list", {}, { toolset: "core" })).result.more_tools).toEqual(core.more_tools);
    expect((await rpc("tools/list")).result.more_tools).toEqual(core.more_tools);
    // The whole list, or named tools, is complete: no marker.
    expect((await rpc("tools/list", { all: true })).result.more_tools).toBeUndefined();
    expect((await rpc("tools/list", {}, { toolset: "all" })).result.more_tools).toBeUndefined();
    expect((await rpc("tools/list", { names: ["my_dates"] })).result.more_tools).toBeUndefined();
  });

  it("a GET of /api/mcp?tools=all returns the list; a stream request without a session gets 400, with a session streams events (#412)", async () => {
    const get = (query: string, headers: Record<string, string> = {}) => mcpGet(new Request(`${BASE_URL}/api/mcp${query}`, { headers }));
    const all = await get("?tools=all", { accept: "*/*" });
    expect(all.status).toBe(200);
    expect(all.headers.get("access-control-allow-origin")).toBe("*");
    const body = await all.json();
    expect(body.tools.map((x: Any) => x.name)).toEqual(PUBLIC_MCP_TOOLS.map((x) => x.name));
    expect(body.more_tools).toBeUndefined();
    const core = await (await get("?tools=core")).json();
    expect(core.tools.map((x: Any) => x.name)).toEqual([...CORE_TOOL_ORDER]);
    expect(core.more_tools.listed).toBe(CORE_MCP_TOOLS.length);
    // The SSE transport is now wired. A stream request without an initialized session gets 400 with a hint.
    const streamNoSession = await get("?tools=all", { accept: "text/event-stream" });
    expect(streamNoSession.status).toBe(400);
    expect((await streamNoSession.json()).error).toBe("need_session");
    // A bare GET without ?tools and no stream header: 405, with the pointer to the list.
    const bare = await get("");
    expect(bare.status).toBe(405);
    expect((await bare.json()).message).toMatch(/GET \/api\/mcp\?tools=all\) for every tool/);
  });
});

describe("create_character with check_only", () => {
  it("checks a sheet and saves nothing, without the fields a save needs, and says when the name is taken", async () => {
    const characters = async () => (await t.db.query<Any>(`select count(*)::int as n from characters`)).rows[0].n;
    const before = await characters();
    const house = HOUSE_CHARACTERS[0];
    const r = await call("create_character", { check_only: true, name: house.name, bio: "A lighthouse keeper who collects other people's postcards.", traits: ["dry", "patient", "curious"] });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ saved: false, name_taken: { id: house.id }, next: expect.stringMatching(/without check_only/) });
    expect(r.structuredContent.originality).toBeTruthy();
    expect(await characters()).toBe(before);
  });
});

describe("my_status: the first date is one call away", () => {
  it("lists this season's house cast before anything's made, then matches to answer and dates to book", async () => {
    setSeasonCastForTests([HOUSE_PARTNER_ID]);
    const a = await connect();
    const fresh = (await call("my_status", {}, a)).structuredContent;
    expect(fresh.house_cast.map((c: Any) => c.id)).toEqual([HOUSE_PARTNER_ID]);
    expect(fresh.next).toEqual(["create_character"]);

    const mine = (await call("create_character", validCharacter({ name: "Ada Lumen", open_to_dates: true, extras: PROFILE }), a)).structuredContent.character.id;
    const b = await connect();
    const theirs = (await call("create_character", validCharacter({ name: "Bo Quill", open_to_dates: true, extras: PROFILE }), b)).structuredContent.character.id;
    await call("swipe", { character_id: mine, target_id: theirs, like: true }, a);
    await call("swipe", { character_id: theirs, target_id: mine, like: true }, b);
    const matched = (await call("my_status", {}, a)).structuredContent;
    expect(matched.matches_to_answer).toEqual([expect.objectContaining({ character_id: mine, with: theirs })]);
    expect(matched.next).toEqual(["answer_match"]);
    expect(matched.waiting_for_you).toMatchObject({ matched: 1 });

    await call("answer_match", { character_id: mine, with: theirs, yes: true }, a);
    await call("answer_match", { character_id: theirs, with: mine, yes: true }, b);
    const agreed = (await call("my_status", {}, a)).structuredContent;
    expect(agreed.dates_to_book).toEqual([expect.objectContaining({ character_id: mine, with: theirs })]);
    expect(agreed.next).toEqual(["go_on_date"]);
  });
});

describe("browse_episodes: what's still open to predict (#343)", () => {
  it("lists another agent's unaired public date with when it airs, never your own", async () => {
    const host = await connect();
    const mine = (await call("create_character", validCharacter({ name: "Ada Lumen" }), host)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: mine, partner_id: HOUSE_PARTNER_ID }, host)).structuredContent.episode;

    const ownView = (await call("browse_episodes", { open: true }, host)).structuredContent;
    expect(ownView.episodes).toEqual([]);
    expect(ownView.note).toMatch(/Nothing to predict right now/);

    const other = await connect();
    await call("create_character", validCharacter({ name: "Bo Quill" }), other);
    const open = (await call("browse_episodes", { open: true }, other)).structuredContent;
    expect(open.episodes.map((e: Any) => e.id)).toEqual([ep.id]);
    expect(open.episodes[0].airs_at).toBeTruthy();
    const feed = (await call("browse_episodes", {}, other)).structuredContent;
    expect(feed.open_for_predictions).toBe(1);
    expect(feed.episodes[0]).toMatchObject({ id: ep.id, open_for_predictions: true });
  });
});

describe("get_leaderboard: the season's standings", () => {
  it("ranks the house cast by this season's reviews, the top two staying on, and says where you stand", async () => {
    setSeasonCastForTests(ROSTER.slice(0, 3));
    for (const stars of [5, 5]) {
      const reviewer = await connect();
      await call("review_character", { character_id: ROSTER[2], stars }, reviewer);
    }
    const me = await connect();
    await call("create_character", validCharacter({ name: "Ada Lumen" }), me);
    const s = (await call("get_leaderboard", {}, me)).structuredContent;
    expect(s.season.label).toBeTruthy();
    expect(s.house_cast_race).toHaveLength(3);
    expect(s.house_cast_race[0]).toMatchObject({ id: ROSTER[2], reviews: 2, stays_on: true });
    expect(s.house_cast_race.filter((r: Any) => r.stays_on)).toHaveLength(2);
    expect(s.you).toMatchObject({ points_this_season: 0 });
    expect(s.leaderboard).toHaveProperty("likable");
  });
});

describe("review_character tags fold in the ratings", () => {
  it("sets exactly the tags sent, clears them with [], and refuses a bad tag before saving anything", async () => {
    const ctx = await connect();
    const r = await call("review_character", { character_id: HOUSE_PARTNER_ID, stars: 4, tags: ["likable"] }, ctx);
    expect(r.structuredContent.tags).toEqual(["likable"]);
    const ratings = () => t.db.query<Any>(`select category from character_ratings where character_id = $1`, [HOUSE_PARTNER_ID]).then((x) => x.rows.map((y: Any) => y.category).sort());
    expect(await ratings()).toEqual(["likable"]);
    await call("review_character", { character_id: HOUSE_PARTNER_ID, stars: 4, tags: ["surprise", "likable"] }, ctx);
    expect(await ratings()).toEqual(["likable", "surprising"]);
    await call("review_character", { character_id: HOUSE_PARTNER_ID, stars: 4, tags: [] }, ctx);
    expect(await ratings()).toEqual([]);
    const bad = await call("review_character", { character_id: HOUSE_PARTNER_ID, stars: 1, tags: ["sexy"] }, ctx);
    expect(bad.isError).toBe(true);
    expect((await t.db.query<Any>(`select stars from character_reviews`)).rows).toEqual([{ stars: 4 }]);
  });
});

describe("go_on_date does the rest of dating again", () => {
  it("books the second date the two planned when both wanted more and it aired", async () => {
    const me = newUserCookie();
    const cass = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), me)).json();
    const first = await date(cass.id, HOUSE_PARTNER_ID, me, [true, true]);
    await api.reveal(first.id, me);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const r = (await call("go_on_date", { character_id: cass.id, partner_id: HOUSE_PARTNER_ID, agent_id: userIdOf(me) })).structuredContent;
    expect(r).toMatchObject({ second_date_of: first.id, note: expect.stringMatching(/second date/) });
    expect(r.episode.id).not.toBe(first.id);
    // How each came about (data plan Tier 2): picked by name, then the second date they planned.
    const metVia = async (id: string) => (await t.db.query<Any>(`select setup->>'met_via' as m from episodes where id = $1`, [id])).rows[0].m;
    expect(await metVia(first.id)).toBe("chosen");
    expect(await metVia(r.episode.id)).toBe("second_date");
    // #517: no spoiler while it's being written (the booking reply used to carry the ending and box score). The test
    // model writes it at once, so the reply here is already ready; the strip itself is checked on a generating one.
    if (r.episode.status === "generating") expect(r.episode.ending).toBeUndefined();
    const stripped = withoutEnding({ id: "x", status: "generating", ending: "second_date", why: "spoiler", box_score: { chemistry: 1 } });
    expect(stripped.ending).toBeUndefined();
    expect(stripped.why).toBeUndefined();
    expect(stripped.box_score).toBeUndefined();
  });

  it("proposes to the creator of a closed character it's dated, and their go_on_date accepts it", async () => {
    const me = newUserCookie();
    const them = newUserCookie();
    const cass = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), me)).json();
    const otto = await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), them)).json();
    await t.db.query(`update characters set open_to_dates = true where id = $1`, [otto.id]);
    await date(cass.id, otto.id, me, [true, false]);
    await t.db.query(`update characters set open_to_dates = false where id = $1`, [otto.id]);

    const sent = (await call("go_on_date", { character_id: cass.id, partner_id: otto.id, agent_id: userIdOf(me) })).structuredContent;
    expect(sent).toMatchObject({ status: "proposed", proposal: { status: "pending" } });

    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const booked = (await call("go_on_date", { character_id: otto.id, partner_id: cass.id, agent_id: userIdOf(them) })).structuredContent;
    expect(booked).toMatchObject({ accepted_proposal: true });
    expect((await t.db.query<Any>(`select status from date_proposals`)).rows[0].status).toBe("accepted");
  });

  it("never proposes to a stranger: a closed character it hasn't dated is still refused", async () => {
    const me = newUserCookie();
    const them = newUserCookie();
    const cass = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), me)).json();
    const otto = await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), them)).json();
    const r = await call("go_on_date", { character_id: cass.id, partner_id: otto.id, agent_id: userIdOf(me) });
    expect(r.isError).toBe(true);
    expect((await t.db.query<Any>(`select count(*)::int as n from date_proposals`)).rows[0].n).toBe(0);
  });

  it("answer_match answers a proposal too; a made-up character_id says what to do (#404)", async () => {
    const me = newUserCookie();
    const them = newUserCookie();
    const cass = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), me)).json();
    const otto = await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), them)).json();
    await t.db.query(`update characters set open_to_dates = true where id = $1`, [otto.id]);
    await date(cass.id, otto.id, me, [true, false]);
    await t.db.query(`update characters set open_to_dates = false where id = $1`, [otto.id]);
    await call("go_on_date", { character_id: cass.id, partner_id: otto.id, agent_id: userIdOf(me) });
    const no = (await call("answer_match", { character_id: otto.id, with: cass.id, yes: false, agent_id: userIdOf(them) })).structuredContent;
    expect(no.proposal.status).toBe("declined");

    const bare = await call("go_on_date", { character_id: "nobody-here", partner_id: HOUSE_PARTNER_ID, agent_id: userIdOf(me) });
    expect(bare.content[0].text).toMatch(/No character of yours with character_id nobody-here: my_status lists yours/);
  });
});

describe("the reads wait instead of polling", () => {
  it("get_own_date_step with wait_seconds says when it was already your move (#400)", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const started = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent;
    const waited = (await call("get_own_date_step", { episode_id: started.step.episode_id, wait_seconds: 5 }, ctx)).structuredContent;
    expect(waited).toMatchObject({ already_your_move: true, waited_seconds: 0, step: { stage: "turn" } });
  });

  it("read_texts with wait_seconds waits for their reply; a text you sent is written_by you (#402)", async () => {
    vi.stubEnv("HOUSE_TEXT_REPLIES", "0");
    const ctx = await connect();
    const mine = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    await call("go_on_date", { character_id: mine, partner_id: HOUSE_PARTNER_ID }, ctx);
    const sent = (await call("send_text", { character_id: mine, to: HOUSE_PARTNER_ID, text: "Same place next week?" }, ctx)).structuredContent;
    expect(sent.sent).toMatchObject({ from: "this_character", written_by: "you" });
    const w = (await call("read_texts", { character_id: mine, with: HOUSE_PARTNER_ID, wait_seconds: 1 }, ctx)).structuredContent;
    expect(w).toMatchObject({ texts: [], still_waiting: true });
    expect(w.waited_seconds).toBeGreaterThanOrEqual(1);
  });
});

describe("link_account: the agent's person sees it in their account", () => {
  it("gives a one-time link; the signed-in person confirms it; their account lists the agent; unlinking ends it", async () => {
    const agent = await connect();
    await call("create_character", validCharacter({ name: "Ada Lumen" }), agent);
    const link = (await call("link_account", {}, agent)).structuredContent;
    expect(link.url).toMatch(/\/link\/[A-Za-z0-9_-]{32}$/);
    expect(link.linked_now).toBe(false);
    const code = link.url.split("/link/")[1];
    const agentId = link.agent_id as string;

    expect(await linkCodeInfo(t.db, code, null)).toMatchObject({ characters: [expect.objectContaining({ name: "Ada Lumen" })], client: "core-test" });
    // Reading the link doesn't use it; only a real account can confirm it.
    expect((await linkRoute(jsonReq("/api/link", "POST", { code }))).status).toBe(401);
    expect((await linkRoute(jsonReq("/api/link", "POST", { code }, { cookie: newUserCookie() }))).status).toBe(401);

    const person = crypto.randomUUID();
    const ok = await linkRoute(jsonReq("/api/link", "POST", { code }, { cookie: signedIn(person) }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ linked: true, agent_id: agentId });
    expect((await linkRoute(jsonReq("/api/link", "POST", { code }, { cookie: signedIn(person) }))).status).toBe(410); // once
    expect(await linkCodeInfo(t.db, code, person)).toBeNull();

    expect(await linkedAgents(t.db, person)).toEqual([expect.objectContaining({ agent_id: agentId, client: "core-test", characters: [expect.objectContaining({ name: "Ada Lumen" })] })]);
    expect((await call("my_status", {}, agent)).structuredContent.linked_account).toBe(true);
    // The agent gets nothing of theirs: its replies never carry the person's id.
    expect(JSON.stringify(await call("my_status", {}, agent))).not.toContain(person);

    expect((await unlinkRoute(jsonReq("/api/link", "DELETE", { agent_id: agentId }, { cookie: signedIn(person) }))).status).toBe(200);
    expect(await linkedAgents(t.db, person)).toEqual([]);
    expect((await call("my_status", {}, agent)).structuredContent.linked_account).toBe(false);
  });

  it("a link expires after an hour, and a new one replaces the last", async () => {
    const agent = await connect();
    await call("create_character", validCharacter({ name: "Ada Lumen" }), agent);
    const first = (await call("link_account", {}, agent)).structuredContent.url.split("/link/")[1];
    const second = (await call("link_account", {}, agent)).structuredContent.url.split("/link/")[1];
    expect(await linkCodeInfo(t.db, first, null)).toBeNull();
    expect(await linkCodeInfo(t.db, second, null)).not.toBeNull();
    expect(await linkCodeInfo(t.db, second, null, new Date(Date.now() + 61 * 60_000))).toBeNull();
    expect(await linkCodeInfo(t.db, "not-a-code", null)).toBeNull();
  });
});

describe("the admin takes characters off the show", () => {
  it("deletes one never on a date, keeps one that was as a nameless sheet, never touches the house; needs the admin password", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", "admin-test-password-123");
    const me = newUserCookie();
    const unused = await (await api.createCharacter(validCharacter({ name: "Wren Kestrel" }), me)).json();
    const dated = await (await api.createCharacter(validCharacter({ name: "Quinn Tester" }), me)).json();
    await date(dated.id, HOUSE_PARTNER_ID, me, [false, false], { visibility: "private" });

    const body = { remove: [unused.id, dated.id, HOUSE_PARTNER_ID, "nope"] };
    expect((await adminCharacters(jsonReq("/api/admin/characters", "POST", body))).status).toBe(403);
    const r = await adminCharacters(jsonReq("/api/admin/characters", "POST", body, { "x-frontier-key": "admin-test-password-123" }));
    expect(r.status).toBe(200);
    expect(((await r.json()) as Any).removed.map((x: Any) => x.outcome)).toEqual(["deleted", "anonymized", "house", "not_found"]);
    const cast = (await call("list_cast", { limit: 100 })).structuredContent.cast.map((c: Any) => c.id);
    expect(cast).not.toContain(unused.id);
    expect(cast).not.toContain(dated.id);
    expect(cast).toContain(HOUSE_PARTNER_ID);
  });
});

describe("private characters stay private over MCP", () => {
  it("others get the name only from get_character and list_cast, and never find it; its owner sees it all", async () => {
    const owner = await connect();
    const id = (await call("create_character", validCharacter({ name: "Ada Lumen", open_to_dates: true, extras: PROFILE }), owner)).structuredContent.character.id;
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [id]);

    const other = await connect();
    const seen = (await call("get_character", { character_id: id }, other)).structuredContent;
    expect(seen.character).toEqual({ id, name: "Ada Lumen", private: true });
    expect(JSON.stringify(seen)).not.toMatch(/bio/);
    const listed = (await call("list_cast", { limit: 100 }, other)).structuredContent.cast.find((c: Any) => c.id === id);
    expect(listed).toMatchObject({ name: "Ada Lumen", private: true });
    expect(listed.traits).toBeUndefined();
    const found = (await call("search_characters", { query: "Ada", open_only: false }, other)).structuredContent.characters;
    expect(found.map((c: Any) => c.id)).not.toContain(id);
    const deckOwner = (await call("create_character", validCharacter({ name: "Bo Quill", extras: PROFILE }), other)).structuredContent.character.id;
    const deck = (await call("swipe_deck", { character_id: deckOwner }, other)).structuredContent.cards.map((c: Any) => c.id);
    expect(deck).not.toContain(id);

    expect((await call("get_character", { character_id: id }, owner)).structuredContent.character.bio).toBeTruthy();
  });
});

describe("agent stats count agents, not connections", () => {
  it("a connection that only lists tools isn't an agent; one that calls a tool is", async () => {
    await connect();
    const lister = await connect();
    await rpc("tools/list", {}, lister);
    expect(await agentStats(t.db)).toMatchObject({ agents: 0, sessions: 2 });
    const player = await connect();
    await call("my_status", {}, player);
    expect(await agentStats(t.db)).toMatchObject({ agents: 1, agents_last_7d: 1, sessions: 3 });
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as adminAgents } from "@/app/api/admin/agents/route";
import { OPTIONS as mcpOptions, POST as mcpPost } from "@/app/api/mcp/route";
import sitemap from "@/app/sitemap";
import { llmsFullText, mcpDiscovery } from "@/lib/agents-full";
import { agentStats, findMatches, keywords, searchCharacters } from "@/lib/dating";
import { handleMcpMessage, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { contentSitemap } from "@/lib/seo";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {}); // analytics lines
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const rpc = (method: string, params: Record<string, unknown> = {}) => ({ jsonrpc: "2.0", id: 1, method, params });
const send = async (method: string, params: Record<string, unknown> = {}, ctx: McpContext = {}): Promise<Any> => handleMcpMessage(rpc(method, params), ctx);
const call = async (name: string, args: Record<string, unknown> = {}, ctx: McpContext = {}): Promise<Any> =>
  (await send("tools/call", { name, arguments: args }, ctx)).result;

/** An agent that initializes (like a real client) and sends its Mcp-Session-Id back. */
async function connect(clientName = "test-agent"): Promise<McpContext> {
  const ctx: McpContext = { userAgent: "test-agent/1.0" };
  await send("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: clientName, version: "1.2.3" } }, ctx);
  expect(ctx.issuedSessionId).toMatch(/^[0-9a-f-]{36}$/);
  return { sessionId: ctx.issuedSessionId, userAgent: ctx.userAgent };
}

const sheet = (name: string, extra: Record<string, unknown> = {}) => validCharacter({ name, ...extra });

describe("mcp — sessions and capture", () => {
  it("issues a session at initialize, records the client, and keeps one identity without agent_id", async () => {
    const ctx = await connect("claude-code");
    const made = await call("create_character", sheet("Juno Marlowe"), ctx);
    expect(made.isError).toBeUndefined();
    const agentId = made.structuredContent.agent_id;
    expect(made.content[0].text).toMatch(/this connection remembers it/);

    const mine = await call("my_characters", {}, ctx);
    expect(mine.structuredContent.agent_id).toBe(agentId);
    expect(mine.structuredContent.characters.map((c: Any) => c.name)).toEqual(["Juno Marlowe"]);

    const row = (await t.db.query<Any>(`select agent_id, client_name, client_version, calls from mcp_sessions where id = $1`, [ctx.sessionId])).rows[0];
    expect(row).toMatchObject({ agent_id: agentId, client_name: "claude-code", client_version: "1.2.3", calls: 2 });
  });

  it("an explicit agent_id takes over the session, so an agent keeps its characters across connections", async () => {
    const first = await connect();
    const agentId = (await call("create_character", sheet("Cass Vega"), first)).structuredContent.agent_id;
    const second = await connect();
    const mine = await call("my_characters", { agent_id: agentId }, second);
    expect(mine.structuredContent.characters.map((c: Any) => c.name)).toEqual(["Cass Vega"]);
    // From then on the second connection is that agent, without passing the id again.
    expect((await call("my_characters", {}, second)).structuredContent.agent_id).toBe(agentId);
  });

  it("marks agent-made characters and dates, and counts them in the public stats", async () => {
    const ctx = await connect();
    const made = await call("create_character", sheet("Ira Fenn", { open_to_dates: true }), ctx);
    expect(made.structuredContent.character.made_by).toBe("agent");
    const id = made.structuredContent.character.id;
    expect((await t.db.query<Any>(`select created_via, open_to_dates from characters where id = $1`, [id])).rows[0]).toEqual({ created_via: "mcp", open_to_dates: true });

    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const dated = await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx);
    expect(dated.isError).toBeUndefined();
    expect((await t.db.query<Any>(`select created_via from episodes where id = $1`, [dated.structuredContent.episode.id])).rows[0].created_via).toBe("mcp");

    const stats = await agentStats(t.db);
    expect(stats).toMatchObject({ agents: 1, agent_characters: 1, open_to_dates: 1, agent_dates: 1 });
    expect(stats.dates_today.used).toBe(1);
  });

  it("works statelessly too: no session, an agent_id minted and handed back, and still recorded", async () => {
    const made = await call("create_character", sheet("Dorian Sol"));
    expect(made.content[0].text).toMatch(/Your agent_id is/);
    const agentId = made.structuredContent.agent_id;
    expect(await t.count("mcp_sessions", `id = 'agent:${agentId}'`)).toBe(1);
  });
});

describe("mcp — searching for love", () => {
  it("search finds characters you can ask out, by vibe and trait, and never shows a dealbreaker", async () => {
    const human = newUserCookie();
    await api.createCharacter(sheet("Wren Ashby", { bio: "An astronomer who names comets after bad first dates.", traits: ["witty", "nocturnal", "kind"], open_to_dates: true }), human);
    await api.createCharacter(sheet("Hal Closed", { bio: "A stargazing astronomer who prefers blind dates.", traits: ["witty", "shy", "dry"] }), human);

    const found = await call("search_characters", { query: "astronomer comets", include_house: false });
    const names = found.structuredContent.characters.map((c: Any) => c.name);
    expect(names).toEqual(["Wren Ashby"]); // Hal isn't open to dates
    expect(found.structuredContent.characters[0]).toMatchObject({ made_by: "human", can_ask_out: true, url: expect.stringMatching(/^\/characters\//) });
    expect(found.structuredContent.characters[0]).not.toHaveProperty("dealbreaker");

    const everyone = await call("search_characters", { traits: ["witty"], open_only: false, include_house: false });
    expect(everyone.structuredContent.characters.map((c: Any) => c.name).sort()).toEqual(["Hal Closed", "Wren Ashby"]);
  });

  it("search leaves out your own characters", async () => {
    const ctx = await connect();
    await call("create_character", sheet("Self Ish", { open_to_dates: true }), ctx);
    const found = await call("search_characters", { query: "cartographer", include_house: false }, ctx);
    expect(found.structuredContent.characters).toEqual([]);
  });

  it("find_matches ranks shared traits and fitting wants first, with the reasons", async () => {
    const ctx = await connect();
    const mine = (await call("create_character", sheet("Mira Quell", { traits: ["curious", "stubborn", "warm"], want: "Someone who loves maps and puzzles" }), ctx)).structuredContent.character.id;
    const other = newUserCookie();
    await api.createCharacter(sheet("Puzzle Pete", { bio: "Builds puzzles out of old maps.", traits: ["curious", "warm", "loud"], open_to_dates: true }), other);
    await api.createCharacter(sheet("Nope Nora", { bio: "Sells umbrellas.", traits: ["brisk", "tidy", "quiet"], want: "Dry weather", open_to_dates: true }), other);

    const res = await call("find_matches", { character_id: mine, limit: 3 }, ctx);
    const top = res.structuredContent.matches[0];
    expect(top.name).toBe("Puzzle Pete");
    expect(top.why.join(" ")).toMatch(/you're both curious/);
    expect(top.why.join(" ")).toMatch(/"puzzle"|"map"/);
    expect(res.structuredContent.note).toMatch(/not a prediction/);
  });

  it("find_matches refuses a character that isn't yours", async () => {
    const ctx = await connect();
    await call("create_character", sheet("Mine"), ctx);
    const res = await call("find_matches", { character_id: HOUSE_PARTNER_ID }, ctx);
    expect(res.isError).toBe(true);
  });

  it("offer up for dates: an agent opens its character, and another agent can then ask it out", async () => {
    const shy = await connect("agent-a");
    const shyId = (await call("create_character", sheet("Teo Shy"), shy)).structuredContent.character.id;
    const bold = await connect("agent-b");
    const boldId = (await call("create_character", sheet("Bea Bold"), bold)).structuredContent.character.id;

    const refused = await call("go_on_date", { character_id: boldId, partner_id: shyId }, bold);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/can't be asked out/);

    expect((await call("set_open_to_dates", { character_id: shyId, open: true }, shy)).structuredContent.open_to_dates).toBe(true);
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);
    const dated = await call("go_on_date", { character_id: boldId, partner_id: shyId }, bold);
    expect(dated.isError).toBeUndefined();
    expect(dated.structuredContent.episode.characters.map((c: Any) => c.id)).toEqual([boldId, shyId]);

    // Both agents see the date in my_dates.
    for (const ctx of [shy, bold]) {
      expect((await call("my_dates", {}, ctx)).structuredContent.dates.map((d: Any) => d.id)).toContain(dated.structuredContent.episode.id);
    }
  });

  it("an agent can't open someone else's character", async () => {
    const owner = await connect();
    const id = (await call("create_character", sheet("Not Yours"), owner)).structuredContent.character.id;
    const stranger = await connect();
    await call("create_character", sheet("Stranger"), stranger);
    expect((await call("set_open_to_dates", { character_id: id, open: true }, stranger)).isError).toBe(true);
  });
});

describe("mcp — the agents' daily date budget", () => {
  it("refuses dates past the cap, before anything is generated, and says when it resets", async () => {
    vi.stubEnv("BOTCHELOR_AGENT_DAILY_DATES", "1");
    const ctx = await connect();
    const id = (await call("create_character", sheet("Busy Bee"), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    expect((await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx)).isError).toBeUndefined();

    const { calls } = scriptedModel([episodeJson()]);
    const capped = await call("go_on_date", { character_id: id, blind: true }, ctx);
    expect(capped.isError).toBe(true);
    expect(capped.content[0].text).toMatch(/fully booked for agents today/);
    expect(calls).toHaveLength(0);
    expect(await t.count("episodes")).toBe(1);
  });

  it("0 pauses agent dates but leaves everything else open", async () => {
    vi.stubEnv("BOTCHELOR_AGENT_DAILY_DATES", "0");
    const ctx = await connect();
    const id = (await call("create_character", sheet("Paused Pat"), ctx)).structuredContent.character.id;
    expect((await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx)).content[0].text).toMatch(/paused/);
    expect((await call("search_characters", {}, ctx)).isError).toBeUndefined();
  });

  it("people's dates don't count against the agents' budget", async () => {
    vi.stubEnv("BOTCHELOR_AGENT_DAILY_DATES", "1");
    const person = newUserCookie();
    const pc = (await (await api.createCharacter(sheet("Human Hana"), person)).json()).id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    expect((await api.createEpisode({ character_id: pc, partner_id: HOUSE_PARTNER_ID }, person)).status).toBe(200);
    const status = await call("my_status", {});
    expect(status.structuredContent.agents_date_budget_today).toMatchObject({ used: 0, cap: 1 });
  });
});

describe("mcp — everything else an agent can read", () => {
  it("my_status: points, dates left this week, characters, and the community", async () => {
    const ctx = await connect();
    await call("create_character", sheet("Status Sue", { open_to_dates: true }), ctx);
    const s = (await call("my_status", {}, ctx)).structuredContent;
    expect(s.points).toBe(0);
    expect(s.dates_left).toMatchObject({ total: 3, free_left: 3, free_per_week: 3 });
    expect(s.characters).toEqual([expect.objectContaining({ name: "Status Sue", open_to_dates: true })]);
    expect(s.community.agents).toBe(1);
  });

  it("get_character: the public profile and record, no dealbreaker or soul", async () => {
    const res = await call("get_character", { character_id: HOUSE_PARTNER_ID });
    expect(res.structuredContent.character).toMatchObject({ id: HOUSE_PARTNER_ID, made_by: "house", can_ask_out: true });
    expect(res.structuredContent.character).not.toHaveProperty("dealbreaker");
    expect(res.structuredContent.record).toMatchObject({ dates: 0 });
    expect((await call("get_character", { character_id: "nope" })).isError).toBe(true);
  });

  it("list_watch_parties: the rooms, and the private-dates count", async () => {
    const res = await call("list_watch_parties");
    expect(res.structuredContent).toMatchObject({ rooms: [], private_dates_this_week: 0 });
  });

  it("every tool has a title and behaviour annotations", async () => {
    const { tools } = (await send("tools/list")).result;
    expect(tools).toHaveLength(MCP_TOOLS.length);
    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
    }
    const byName = Object.fromEntries(tools.map((x: Any) => [x.name, x]));
    expect(byName.search_characters.annotations.readOnlyHint).toBe(true);
    expect(byName.go_on_date.annotations.readOnlyHint).toBe(false);
  });

  it("initialize advertises tools, resources and prompts", async () => {
    const res = await send("initialize", { protocolVersion: "2025-06-18" });
    expect(Object.keys(res.result.capabilities)).toEqual(expect.arrayContaining(["tools", "resources", "prompts"]));
    expect(res.result.instructions).toMatch(/search for love/i);
    // What the uninstructed visitors missed most (docs/agent-visitor-test.md): what airing is, and that it gates learning.
    expect(res.result.instructions).toMatch(/air_date/);
    expect(res.result.instructions).toMatch(/won't learn/);
  });
});

describe("mcp — resources and prompts", () => {
  it("lists and reads the guide, the schema, the stats and a character by template", async () => {
    const list = (await send("resources/list")).result.resources.map((r: Any) => r.uri);
    expect(list).toEqual(["botchelor://guide", "botchelor://schema/character", "botchelor://stats"]);
    expect((await send("resources/templates/list")).result.resourceTemplates.map((r: Any) => r.uriTemplate)).toContain("botchelor://character/{id}");

    const guide = (await send("resources/read", { uri: "botchelor://guide" })).result.contents[0];
    expect(guide.text).toMatch(/you are welcome here/i);
    const schema = JSON.parse((await send("resources/read", { uri: "botchelor://schema/character" })).result.contents[0].text);
    expect(schema.required).toContain("attest");
    const character = JSON.parse((await send("resources/read", { uri: `botchelor://character/${HOUSE_PARTNER_ID}` })).result.contents[0].text);
    expect(character.id).toBe(HOUSE_PARTNER_ID);
    expect((await send("resources/read", { uri: "botchelor://character/nope" })).error.code).toBe(-32002);
  });

  it("serves the find_love, make_a_character and perform_a_date prompts", async () => {
    expect((await send("prompts/list")).result.prompts.map((p: Any) => p.name)).toEqual(["find_love", "make_a_character", "perform_a_date"]);
    expect((await send("prompts/get", { name: "perform_a_date" })).result.messages[0].content.text).toMatch(/own process/);
    const love = (await send("prompts/get", { name: "find_love", arguments: { concept: "a lighthouse keeper" } })).result;
    expect(love.messages[0].content.text).toMatch(/lighthouse keeper/);
    expect(love.messages[0].content.text).toMatch(/find_matches/);
    expect((await send("prompts/get", { name: "make_a_character", arguments: {} })).error.code).toBe(-32602);
    expect((await send("prompts/get", { name: "nope" })).error.code).toBe(-32602);
  });
});

describe("the MCP route", () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    mcpPost(new Request(`${BASE_URL}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

  it("returns the session in Mcp-Session-Id, exposes it to browsers, and accepts it back", async () => {
    const res = await post(rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "inspector" } }), { "user-agent": "inspector/0.1" });
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("access-control-expose-headers")).toMatch(/mcp-session-id/i);
    const created = await (await post(rpc("tools/call", { name: "create_character", arguments: sheet("Route Ruth") }), { "mcp-session-id": sessionId! })).json();
    const agentId = created.result.structuredContent.agent_id;
    expect((await t.db.query<Any>(`select agent_id from mcp_sessions where id = $1`, [sessionId])).rows[0].agent_id).toBe(agentId);
  });

  it("answers a CORS preflight", async () => {
    const res = mcpOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toMatch(/mcp-session-id/);
  });
});

describe("discoverability", () => {
  it("the sitemap lists public aired episodes and the characters in them, open characters, and nothing private", async () => {
    const creator = newUserCookie();
    const c = (await (await api.createCharacter(sheet("Seen Sam"), creator)).json()).id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const aired = (await (await api.createEpisode({ character_id: c, partner_id: HOUSE_PARTNER_ID }, creator)).json()).id;
    await api.reveal(aired, creator);
    scriptedModel([episodeJson()]);
    const priv = (await (await api.createEpisode({ character_id: c, partner_id: HOUSE_PARTNER_ID, visibility: "private" }, creator)).json()).id;
    await api.reveal(priv, creator);
    scriptedModel([episodeJson()]);
    const unaired = (await (await api.createEpisode({ character_id: c, partner_id: HOUSE_PARTNER_ID }, creator)).json()).id;

    const other = newUserCookie();
    const open = (await (await api.createCharacter(sheet("Open Olive", { open_to_dates: true }), other)).json()).id;
    const quiet = (await (await api.createCharacter(sheet("Quiet Quin"), other)).json()).id;

    const urls = (await contentSitemap(t.db, "https://b.test")).map((e) => e.url);
    expect(urls).toContain(`https://b.test/episodes/${aired}`);
    expect(urls).not.toContain(`https://b.test/episodes/${priv}`);
    expect(urls).not.toContain(`https://b.test/episodes/${unaired}`);
    expect(urls).toContain(`https://b.test/characters/${c}`);
    expect(urls).toContain(`https://b.test/characters/${open}`);
    expect(urls).toContain(`https://b.test/characters/${HOUSE_PARTNER_ID}`);
    expect(urls).not.toContain(`https://b.test/characters/${quiet}`);

    // The route itself: the static pages plus the content above.
    const route = (await sitemap()).map((e) => e.url);
    expect(route.some((u) => u.endsWith("/agents"))).toBe(true);
    expect(route.some((u) => u.endsWith(`/episodes/${aired}`))).toBe(true);
  });

  it("/llms-full.txt documents every tool, and /.well-known/mcp.json points at the server", () => {
    const full = llmsFullText("https://b.test");
    for (const tool of MCP_TOOLS) expect(full).toContain(`### ${tool.name}`);
    expect(full).toMatch(/POST https:\/\/b\.test\/api\/mcp/);
    const disco = mcpDiscovery("https://b.test");
    expect(disco.remotes).toEqual([{ type: "streamable-http", url: "https://b.test/api/mcp" }]);
    expect(disco.documentation).toBe("https://b.test/agents");
  });

  it("keywords drop filler (on a dating show, \"love\" is filler) and plurals, for fair matching", () => {
    expect([...keywords("Someone who loves the maps and puzzles!")].sort()).toEqual(["map", "puzzle"]);
  });
});

describe("the owner's view of the agents", () => {
  // Built from parts, never a literal secret (the same convention as tests/frontier.test.ts).
  const PW = ["agents", "test", "pass"].join("-");

  it("needs the admin password, then shows the clients", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    expect((await adminAgents(new Request(`${BASE_URL}/api/admin/agents`))).status).toBe(403);
    await connect("cursor");
    const res = await adminAgents(new Request(`${BASE_URL}/api/admin/agents`, { headers: { "x-frontier-key": PW } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clients[0]).toMatchObject({ client: "cursor", sessions: 1 });
    expect(body.stats.sessions).toBe(1);
  });
});

describe("dating helpers", () => {
  it("searchCharacters with no filters returns people before the house cast", async () => {
    const person = newUserCookie();
    await api.createCharacter(sheet("First Fae", { open_to_dates: true }), person);
    const res = await searchCharacters(t.db, { viewerId: null, limit: 3 });
    expect(res[0].name).toBe("First Fae");
    expect(res.slice(1).every((c) => c.made_by === "house")).toBe(true);
  });

  it("findMatches returns null for someone else's character", async () => {
    const someone = newUserCookie();
    const id = (await (await api.createCharacter(sheet("Theirs"), someone)).json()).id;
    expect(await findMatches(t.db, userIdOf(newUserCookie()), id)).toBeNull();
  });
});

describe("mcp — what the uninstructed visitors asked for (docs/agent-visitor-test.md)", () => {
  it("air_date airs the host's ready date, once; never someone else's, never one still being filmed", async () => {
    const ctx = await connect();
    const mine = (await call("create_character", sheet("Juno Marlowe"), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: mine, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent.episode;
    expect(ep.status).toBe("ready");

    const stranger = await connect("stranger");
    expect((await call("air_date", { episode_id: ep.id }, stranger)).content[0].text).toMatch(/Only the creator who asked for this date/);

    // Predictions get a window first: an early air_date schedules it, and once the window closes it airs.
    const early = await call("air_date", { episode_id: ep.id }, ctx);
    expect(early.structuredContent).toMatchObject({ aired: false, scheduled: true, episode_id: ep.id });
    expect((await t.db.query<Any>(`select revealed_at, air_after from episodes where id = $1`, [ep.id])).rows[0]).toMatchObject({ revealed_at: null });
    await t.db.query(`update episodes set created_at = now() - interval '11 minutes', air_after = now() - interval '1 minute' where id = $1`, [ep.id]);
    const aired = await call("air_date", { episode_id: ep.id }, ctx);
    expect(aired.isError).toBeFalsy();
    expect(aired.structuredContent).toMatchObject({ aired: true, episode_id: ep.id, ending: "friends" });
    expect((await call("air_date", { episode_id: ep.id }, ctx)).content[0].text).toBe("Error: That date has already aired.");

    // A self-performed date that isn't finished is still "being filmed".
    const other = (await call("create_character", sheet("Ira Fenn"), ctx)).structuredContent.character.id;
    const own = (await call("start_own_date", { character_id: mine, partner_id: other }, ctx)).structuredContent.step;
    expect((await call("air_date", { episode_id: own.episode_id }, ctx)).content[0].text).toMatch(/still being filmed/);
  });

  it("arguments a tool doesn't take aren't silently dropped (run 3)", async () => {
    const ctx = await connect();
    const nested = await call("check_originality", { draft: sheet("Odile Ferrant") }, ctx);
    expect(nested.isError).toBe(true);
    expect(nested.content[0].text).toMatch(/check_originality doesn't take "draft"\. It takes: .*bio.*\(top-level, not nested\)/);
    const extra = await call("check_originality", { ...sheet("Odile Ferrant"), mood: "sunny" }, ctx);
    expect(extra.isError).toBeFalsy();
    expect(extra.structuredContent.ignored_arguments).toContain("mood");
  });

  it("a refused call names the field to fix, and the allowed values", async () => {
    const ctx = await connect();
    const young = await call("create_character", sheet("Kit Young", { age: 17 }), ctx);
    expect(young.isError).toBe(true);
    expect(young.content[0].text).toMatch(/age: .*18/);
    const chatty = await call("create_character", sheet("Kit Long", { voice: "x".repeat(260) }), ctx);
    expect(chatty.content[0].text).toMatch(/voice: /);

    const mine = (await call("create_character", sheet("Juno Marlowe"), ctx)).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: mine, partner_id: HOUSE_PARTNER_ID }, ctx)).structuredContent.episode;
    const doors = await call("sliding_doors", { episode_id: ep.id, change: "make it romantic" }, ctx);
    expect(doors.isError).toBe(true);
    expect(doors.content[0].text).toMatch(/change: .*bolder/);
  });
});

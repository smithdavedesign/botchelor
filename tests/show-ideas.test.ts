// Show ideas (lib/show-ideas.ts; docs/show-ideas.md; David 2026-11-16): the list on /shows is a demand test. Three
// answers a voter can mix, people and agents counted apart, a proposal held for an admin, and nothing an outsider typed
// shown to anyone else before it's listed. The MCP tools (2.33.0) do the same as an agent.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as adminGet, POST as adminPost } from "@/app/api/admin/show-ideas/route";
import { POST as proposeRoute } from "@/app/api/shows/propose/route";
import { GET as listRoute, POST as voteRoute } from "@/app/api/shows/route";
import { deleteAccount, exportAccount } from "@/lib/account";
import { CORE_TOOL_ORDER, handleMcpMessage, MCP_TOOLS, PUBLIC_MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { MCP_CHANGELOG } from "@/lib/mcp/changelog";
import { SHOW_TOOL_NAMES } from "@/lib/mcp/shows";
import { listNotifications } from "@/lib/notifications";
import { checkShowText } from "@/lib/safety";
import { adminShowIdeas, decideShowIdea, HOUSE_IDEAS, interestScore, listShowIdeas, PROPOSALS_PER_30_DAYS, proposeShowIdea, voteShowIdea } from "@/lib/show-ideas";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const FIRST = HOUSE_IDEAS[0].id;
const SECOND = HOUSE_IDEAS[1].id;
const PITCH = "Six characters run a night market stall together, and every episode ends with the till being counted.";
const idea = async (viewer: string | null, id: string) => (await listShowIdeas(t.db, viewer)).find((i) => i.id === id)!;

let ip = 0;
const req = (path: string, body: unknown, opts: { cookie?: string; ua?: string; method?: string } = {}) =>
  new Request(BASE_URL + path, {
    method: opts.method ?? "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `203.0.113.${(++ip % 250) + 1}`,
      "user-agent": opts.ua ?? "Mozilla/5.0 (Macintosh)",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("the house's ideas", () => {
  it("are PG by the show's own check, with unique ids and titles, and one of them is still a dating show", () => {
    for (const h of HOUSE_IDEAS) expect(checkShowText({ title: h.title, pitch: h.pitch }).ok, h.title).toBe(true);
    expect(new Set(HOUSE_IDEAS.map((h) => h.id)).size).toBe(HOUSE_IDEAS.length);
    expect(new Set(HOUSE_IDEAS.map((h) => h.title.toLowerCase())).size).toBe(HOUSE_IDEAS.length);
    expect(HOUSE_IDEAS.filter((h) => h.dating)).toHaveLength(1);
    expect(HOUSE_IDEAS.filter((h) => !h.dating).length).toBeGreaterThanOrEqual(3);
  });

  it("are listed in their own order while nobody has answered", async () => {
    expect((await listShowIdeas(t.db, null)).map((i) => i.id)).toEqual(HOUSE_IDEAS.map((h) => h.id));
  });
});

describe("answers: three switches, people and agents apart", () => {
  it("takes any mix, changes on a second call, and all off takes the answer back", async () => {
    await voteShowIdea(t.db, "p1", "person", FIRST, { watch: true, enter: true, produce: false });
    expect((await idea("p1", FIRST)).mine).toEqual({ watch: true, enter: true, produce: false });
    expect((await idea("p1", FIRST)).people).toEqual({ watch: 1, enter: 1, produce: 0, voters: 1 });
    await voteShowIdea(t.db, "p1", "person", FIRST, { watch: false, enter: false, produce: true });
    expect((await idea(null, FIRST)).people).toEqual({ watch: 0, enter: 0, produce: 1, voters: 1 });
    await voteShowIdea(t.db, "p1", "person", FIRST, { watch: false, enter: false, produce: false });
    expect((await idea("p1", FIRST)).people.voters).toBe(0);
    expect((await t.db.query("select 1 from show_idea_votes")).rows).toHaveLength(0);
  });

  it("never adds an agent's answer to people's", async () => {
    await voteShowIdea(t.db, "p1", "person", FIRST, { watch: true, enter: false, produce: false });
    for (const a of ["a1", "a2", "a3"]) await voteShowIdea(t.db, a, "agent", FIRST, { watch: true, enter: true, produce: true });
    const i = await idea(null, FIRST);
    expect(i.people).toEqual({ watch: 1, enter: 0, produce: 0, voters: 1 });
    expect(i.agents).toEqual({ watch: 3, enter: 3, produce: 3, voters: 3 });
  });

  it("orders by what people want, producing and entering weighing more than watching, and agents never move it", async () => {
    expect(interestScore({ watch: 1, enter: 1, produce: 1, voters: 1 })).toBe(6);
    for (const a of ["a1", "a2", "a3", "a4"]) await voteShowIdea(t.db, a, "agent", FIRST, { watch: true, enter: true, produce: true });
    await voteShowIdea(t.db, "p1", "person", SECOND, { watch: true, enter: false, produce: false });
    expect((await listShowIdeas(t.db, null))[0].id).toBe(SECOND);
    await voteShowIdea(t.db, "p2", "person", HOUSE_IDEAS[2].id, { watch: false, enter: false, produce: true });
    expect((await listShowIdeas(t.db, null)).slice(0, 2).map((i) => i.id)).toEqual([HOUSE_IDEAS[2].id, SECOND]);
  });

  it("refuses an idea that isn't on the list", async () => {
    expect(await voteShowIdea(t.db, "p1", "person", "nope", { watch: true, enter: false, produce: false })).toMatchObject({ ok: false, status: 404, error: "no_such_idea" });
  });
});

describe("a proposal", () => {
  it("waits: its proposer sees it as waiting, nobody else sees it, and it takes no answers until it's listed", async () => {
    const made = await proposeShowIdea(t.db, "p1", "person", { title: "  Night   Market ", pitch: PITCH });
    expect(made).toMatchObject({ ok: true, status: "waiting", title: "Night Market" });
    const id = (made as { id: string }).id;
    expect(await idea("p1", id)).toMatchObject({ status: "waiting", open: false, house: false, proposed_by: "person" });
    expect((await listShowIdeas(t.db, "p2")).some((i) => i.id === id)).toBe(false);
    expect((await listShowIdeas(t.db, null)).some((i) => i.id === id)).toBe(false);
    expect(await voteShowIdea(t.db, "p2", "person", id, { watch: true, enter: false, produce: false })).toMatchObject({ ok: false, status: 404 });

    expect(await decideShowIdea(t.db, id, "list")).toMatchObject({ ok: true, status: "listed" });
    expect(await idea("p2", id)).toMatchObject({ status: "listed", open: true, title: "Night Market" });
    expect(await voteShowIdea(t.db, "p2", "person", id, { watch: true, enter: false, produce: false })).toMatchObject({ ok: true });

    expect(await decideShowIdea(t.db, id, "decline")).toMatchObject({ ok: true, status: "declined" });
    expect((await listShowIdeas(t.db, "p1")).some((i) => i.id === id)).toBe(false);
    expect(await decideShowIdea(t.db, "nope", "list")).toMatchObject({ ok: false, status: 404 });
  });

  it("is refused when it's too short or long, has a link, isn't PG, or repeats a title already there", async () => {
    const no = async (title: string, pitch: string) => proposeShowIdea(t.db, "p1", "person", { title, pitch });
    expect(await no("ab", PITCH)).toMatchObject({ ok: false, status: 422, field: "title" });
    expect(await no("x".repeat(61), PITCH)).toMatchObject({ ok: false, status: 422, field: "title" });
    expect(await no("Night Market", "Too short.")).toMatchObject({ ok: false, status: 422, field: "pitch" });
    expect(await no("Night Market", "y".repeat(281))).toMatchObject({ ok: false, status: 422, field: "pitch" });
    expect(await no("Night Market", `${PITCH} See https://example.com`)).toMatchObject({ ok: false, status: 422, error: "invalid_idea" });
    expect(await no("School Days", "A class of 15 year old students fall for each other across one long school term.")).toMatchObject({ ok: false, status: 422, error: "not_pg" });
    expect(await no("who did it!", PITCH)).toMatchObject({ ok: false, status: 409, error: "already_proposed" });
    expect(await no("Night Market", PITCH)).toMatchObject({ ok: true });
    expect(await proposeShowIdea(t.db, "p2", "person", { title: "night-market", pitch: PITCH })).toMatchObject({ ok: false, status: 409 });
    expect((await t.db.query("select 1 from show_ideas")).rows).toHaveLength(1);
  });

  it("stops at a few a month from one proposer, and SHOW_IDEAS_PROPOSE=0 stops them all", async () => {
    for (let n = 0; n < PROPOSALS_PER_30_DAYS; n++) expect(await proposeShowIdea(t.db, "p1", "person", { title: `Market ${n} nights`, pitch: PITCH })).toMatchObject({ ok: true });
    expect(await proposeShowIdea(t.db, "p1", "person", { title: "One more market", pitch: PITCH })).toMatchObject({ ok: false, status: 429, error: "too_many_ideas" });
    expect(await proposeShowIdea(t.db, "p2", "person", { title: "One more market", pitch: PITCH }, { SHOW_IDEAS_PROPOSE: "0" })).toMatchObject({ ok: false, status: 503 });
  });

  it("tells the admins once, with a link to the panel", async () => {
    await t.db.query("insert into admins (user_id) values ('boss')");
    await proposeShowIdea(t.db, "p1", "person", { title: "Night Market", pitch: PITCH });
    const notes = await listNotifications(t.db, "boss");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: "show_idea", link: "/admin/season#show-ideas" });
    expect(notes[0].title).toContain("Night Market");
  });
});

describe("the admin's view", () => {
  it("puts waiting proposals first and leaves our own voters out of the counts", async () => {
    await voteShowIdea(t.db, "ours", "person", FIRST, { watch: true, enter: true, produce: true });
    await voteShowIdea(t.db, "p1", "person", FIRST, { watch: true, enter: false, produce: false });
    const made = (await proposeShowIdea(t.db, "p1", "person", { title: "Night Market", pitch: PITCH })) as { id: string };
    const all = await adminShowIdeas(t.db, ["ours"]);
    expect(all[0]).toMatchObject({ id: made.id, status: "pending" });
    expect(all.find((i) => i.id === FIRST)!.people).toEqual({ watch: 1, enter: 0, produce: 0, voters: 1 });
  });

  it("the route needs the admin password or an admin account, and lists or declines", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", "open-sesame-test");
    const made = (await proposeShowIdea(t.db, "p1", "person", { title: "Night Market", pitch: PITCH })) as { id: string };
    expect((await adminGet(new Request(`${BASE_URL}/api/admin/show-ideas`))).status).toBe(403);
    const key = { "x-frontier-key": "open-sesame-test", "content-type": "application/json" };
    const got = await (await adminGet(new Request(`${BASE_URL}/api/admin/show-ideas`, { headers: key }))).json();
    expect(got.ideas[0]).toMatchObject({ id: made.id, status: "pending" });
    const post = (body: unknown, headers: Record<string, string> = key) => adminPost(new Request(`${BASE_URL}/api/admin/show-ideas`, { method: "POST", headers, body: JSON.stringify(body) }));
    expect((await post({ id: made.id, action: "list" }, { "content-type": "application/json" })).status).toBe(403);
    expect(await (await post({ id: made.id, action: "list" })).json()).toEqual({ id: made.id, status: "listed" });
    expect((await post({ id: made.id, action: "burn" })).status).toBe(422);
  });
});

describe("the routes", () => {
  it("a browser's answer counts as a person's, a known bot's as an agent's, and the list hands back the viewer's own", async () => {
    const cookie = newUserCookie();
    expect((await voteRoute(req("/api/shows", { idea_id: FIRST, watch: true, produce: true }, { cookie }))).status).toBe(201);
    expect((await voteRoute(req("/api/shows", { idea_id: FIRST, watch: true }, { cookie: newUserCookie(), ua: "GPTBot/1.2" }))).status).toBe(201);
    const body = await (await listRoute(req("/api/shows", undefined, { cookie, method: "GET" }))).json();
    const first = body.ideas.find((i: { id: string }) => i.id === FIRST);
    expect(first.mine).toEqual({ watch: true, enter: false, produce: true });
    expect(first.people).toEqual({ watch: 1, enter: 0, produce: 1, voters: 1 });
    expect(first.agents).toEqual({ watch: 1, enter: 0, produce: 0, voters: 1 });
    expect(body.proposals_open).toBe(true);
    expect((await voteRoute(req("/api/shows", { idea_id: "nope", watch: true }, { cookie }))).status).toBe(404);
  });

  it("proposing needs an account signed in; voting never does", async () => {
    const anon = newUserCookie();
    expect((await proposeRoute(req("/api/shows/propose", { title: "Night Market", pitch: PITCH }, { cookie: anon }))).status).toBe(401);
    const me = signedInCookie("11111111-2222-4333-8444-555555555555");
    const res = await proposeRoute(req("/api/shows/propose", { title: "Night Market", pitch: PITCH }, { cookie: me }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "waiting", title: "Night Market" });
    expect((await proposeRoute(req("/api/shows/propose", { title: "No", pitch: PITCH }, { cookie: me }))).status).toBe(422);
  });

  it("SHOW_IDEAS=0 closes all of it", async () => {
    vi.stubEnv("SHOW_IDEAS", "0");
    const cookie = newUserCookie();
    expect((await listRoute(req("/api/shows", undefined, { cookie, method: "GET" }))).status).toBe(404);
    expect((await voteRoute(req("/api/shows", { idea_id: FIRST, watch: true }, { cookie }))).status).toBe(404);
    expect((await proposeRoute(req("/api/shows/propose", { title: "Night Market", pitch: PITCH }, { cookie }))).status).toBe(404);
  });
});

describe("the account's own data", () => {
  it("is in the export and goes with the account, with everyone's answers on the ideas it proposed", async () => {
    const cookie = newUserCookie();
    const me = userIdOf(cookie);
    await voteShowIdea(t.db, me, "person", FIRST, { watch: true, enter: false, produce: false });
    const made = (await proposeShowIdea(t.db, me, "person", { title: "Night Market", pitch: PITCH })) as { id: string };
    await decideShowIdea(t.db, made.id, "list");
    await voteShowIdea(t.db, "p2", "person", made.id, { watch: true, enter: false, produce: false });
    const out = await exportAccount(t.db, me);
    expect(out.show_idea_votes).toHaveLength(1);
    expect(out.show_ideas_proposed).toMatchObject([{ title: "Night Market", status: "listed" }]);
    await deleteAccount(t.db, me);
    expect((await t.db.query("select 1 from show_ideas")).rows).toHaveLength(0);
    expect((await t.db.query("select 1 from show_idea_votes")).rows).toHaveLength(0);
  });
});

describe("over MCP (2.33.0)", () => {
  type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const rpc = async (method: string, params: Any = {}, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
  const call = async (name: string, args: Any = {}): Promise<Any> => (await rpc("tools/call", { name, arguments: args })).result;
  const AGENT = "0a0b0c0d-0e0f-4a01-8a02-0a0b0c0d0e0f";

  it("the three tools exist, are listed at ?tools=all, stay out of the core list, and are the newest release's", () => {
    const names = MCP_TOOLS.map((x) => x.name as string);
    for (const n of SHOW_TOOL_NAMES) {
      expect(names).toContain(n);
      expect(PUBLIC_MCP_TOOLS.map((x) => x.name as string)).toContain(n);
      expect(CORE_TOOL_ORDER as readonly string[]).not.toContain(n);
    }
    expect(MCP_CHANGELOG[0]).toMatchObject({ version: "2.33.0", added_tools: [...SHOW_TOOL_NAMES] });
  });

  it("an agent's answer is counted with the agents', a switch left out stays, and all false takes it back", async () => {
    const voted = await call("vote_show_idea", { idea_id: FIRST, watch: true, produce: true, agent_id: AGENT });
    expect(voted.isError, JSON.stringify(voted.structuredContent)).toBeUndefined();
    expect(voted.structuredContent).toMatchObject({ idea_id: FIRST, yours: { watch: true, enter: false, produce: true }, counted_with: "agents" });
    expect((await call("vote_show_idea", { idea_id: FIRST, enter: true, agent_id: AGENT })).structuredContent.yours).toEqual({ watch: true, enter: true, produce: true });
    const i = await idea(null, FIRST);
    expect(i.people.voters).toBe(0);
    expect(i.agents).toEqual({ watch: 1, enter: 1, produce: 1, voters: 1 });

    const listed = (await call("list_show_ideas", { agent_id: AGENT })).structuredContent;
    expect(listed.ideas).toHaveLength(HOUSE_IDEAS.length);
    expect(listed.ideas.find((x: Any) => x.idea_id === FIRST)).toMatchObject({ from: "the show", yours: { watch: true, enter: true, produce: true }, agents: { would_watch: 1, would_enter_a_character: 1, would_produce: 1 } });
    expect(String(listed.about)).toMatch(/not a schedule/);

    await call("vote_show_idea", { idea_id: FIRST, watch: false, enter: false, produce: false, agent_id: AGENT });
    expect((await idea(null, FIRST)).agents.voters).toBe(0);
    expect((await call("vote_show_idea", { idea_id: FIRST, agent_id: AGENT })).isError).toBe(true);
    expect((await call("vote_show_idea", { idea_id: "nope", watch: true, agent_id: AGENT })).isError).toBe(true);
  });

  it("an agent's proposal is held, labelled an agent's, and refused when it isn't PG", async () => {
    const made = (await call("propose_show_idea", { title: "Night Market", pitch: PITCH, agent_id: AGENT })).structuredContent;
    expect(made).toMatchObject({ status: "waiting_for_review", title: "Night Market" });
    expect((await listShowIdeas(t.db, null)).some((x) => x.id === made.idea_id)).toBe(false);
    expect((await call("list_show_ideas", { agent_id: AGENT })).structuredContent.ideas.find((x: Any) => x.idea_id === made.idea_id)).toMatchObject({ status: "waiting_for_review", from: "an agent" });
    await decideShowIdea(t.db, made.idea_id, "list");
    expect(await idea(null, made.idea_id)).toMatchObject({ proposed_by: "agent", status: "listed" });
    expect((await call("propose_show_idea", { title: "School Days", pitch: "A class of 15 year old students fall for each other across one long school term.", agent_id: AGENT })).isError).toBe(true);
  });

  it("SHOW_IDEAS=0 refuses all three", async () => {
    vi.stubEnv("SHOW_IDEAS", "0");
    expect((await call("list_show_ideas", {})).isError).toBe(true);
    expect((await call("vote_show_idea", { idea_id: FIRST, watch: true, agent_id: AGENT })).isError).toBe(true);
    expect((await call("propose_show_idea", { title: "Night Market", pitch: PITCH, agent_id: AGENT })).isError).toBe(true);
  });
});

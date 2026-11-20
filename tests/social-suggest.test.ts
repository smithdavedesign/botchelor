// "Might know" (lib/social/suggest.ts; docs/PRDs/social-network.md section 6.3): friends of friends by Adamic-Adar,
// shared places, the same event and a friend of an ex, each in words; never someone already tied, the house's, a
// private or deleted character, or one dismissed; what's shown is logged, and what came of it settles.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/social/suggest/[id]/route";
import { handleMcpMessage } from "@/lib/mcp";
import { DELETED_OWNER } from "@/lib/rules";
import { dismissSuggestion, IGNORED_AFTER_DAYS, logShown, MIN_SCORE, roleWord, settleSuggestions, suggestTies } from "@/lib/social/suggest";
import { upsertTie } from "@/lib/social/ties";
import { BASE_URL, jsonRequest, newUserCookie, startTestDb, userIdOf } from "./helpers";

const ON = {};
const OWNER = "u-owner";
const OTHER = "u-other";

describe("roleWord (pure)", () => {
  it("names the far end as a noun after a name, either way a directed tie runs", () => {
    expect(roleWord({ from_id: "a", to_id: "b", kind: "best_friend" }, "a")).toBe("best friend");
    // A parent tie from a to b: b is a's parent, a is b's child.
    expect(roleWord({ from_id: "a", to_id: "b", kind: "parent" }, "a")).toBe("parent");
    expect(roleWord({ from_id: "a", to_id: "b", kind: "parent" }, "b")).toBe("child");
    // A crush from a to b: b is a's crush; a is b's admirer (never "has a crush on them").
    expect(roleWord({ from_id: "a", to_id: "b", kind: "crush" }, "a")).toBe("crush");
    expect(roleWord({ from_id: "a", to_id: "b", kind: "crush" }, "b")).toBe("admirer");
  });
});

describe("suggestTies and its log", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await t.db.query("delete from social_places");
  });

  async function character(id: string, name: string, o: { owner?: string; visibility?: string; house?: boolean } = {}) {
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility)
       values ($1, $2, $3, $4, 30, 'x', '["dry"]'::jsonb, 'x', 'x', $5)`,
      [id, o.owner ?? OTHER, o.house ?? false, name, o.visibility ?? "public"],
    );
  }
  const tie = (from: string, to: string, kind: Parameters<typeof upsertTie>[1]["kind"], o: { visibility?: "public" | "owner" | "private"; source?: "house" | "derived" | "owner"; status?: "active" | "ended" } = {}) =>
    upsertTie(t.db, { from, to, kind, source: o.source ?? "house", ...(o.visibility ? { visibility: o.visibility } : {}), ...(o.status ? { status: o.status } : {}), ...(o.source === "derived" ? { evidence: { ref: `night:${from}-${to}` } } : {}) }, ON);
  const ids = (s: { id: string }[]) => s.map((x) => x.id);

  /** Sam (the owner's) is best friends with Mira, who is Ana's friend and Jo's sister. */
  async function world() {
    await character("sam", "Sam Reed", { owner: OWNER });
    await character("mira", "Mira Vale");
    await character("ana", "Ana Cruz");
    await character("jo", "Jo Park");
    await tie("sam", "mira", "best_friend");
    await tie("mira", "ana", "friend");
    await tie("mira", "jo", "sibling");
  }

  it("suggests friends of friends, each in words, best first", async () => {
    await world();
    const out = await suggestTies(t.db, "sam", { viewer: OWNER, env: ON });
    expect(ids(out).sort()).toEqual(["ana", "jo"]);
    expect(out.find((s) => s.id === "ana")).toMatchObject({ reason: "common_friends", words: "Mira's friend", signals: { common: 1, ex: false } });
    expect(out.find((s) => s.id === "jo")?.words).toBe("Mira's sibling");
    // Mira knows three (Sam, Ana, Jo): each friend in common counts 1 / ln 3.
    expect(out[0].signals.adamic_adar).toBeCloseTo(1 / Math.log(3), 3);
    // Two friends in common say so, and outrank one.
    await character("lee", "Lee Hart");
    await tie("sam", "lee", "coworker");
    await tie("lee", "ana", "friend");
    const again = await suggestTies(t.db, "sam", { viewer: OWNER, env: ON });
    expect(again[0]).toMatchObject({ id: "ana", words: "Knows Lee and Mira" });
    expect(again[0].score).toBeGreaterThan(again[1].score);
  });

  it("never suggests someone already tied, the house's, a private or deleted character, or one dismissed", async () => {
    await world();
    await character("bea", "Bea Lund");
    await character("hidden", "Hid Den", { visibility: "private" });
    await character("gone", "Gone Away", { owner: DELETED_OWNER });
    await character("house", "House Cast", { owner: "house", house: true });
    for (const w of ["bea", "hidden", "gone", "house"]) await tie("mira", w, "friend");
    // Sam and Bea were rivals once: any tie but an encounter rules a suggestion out.
    await tie("sam", "bea", "rival", { status: "ended" });
    expect(ids(await suggestTies(t.db, "sam", { viewer: OWNER, env: ON })).sort()).toEqual(["ana", "jo"]);
    // The owner sees their own private character.
    await t.db.query(`update characters set owner_id = $1 where id = 'hidden'`, [OWNER]);
    expect(ids(await suggestTies(t.db, "sam", { viewer: OWNER, env: ON }))).toContain("hidden");
    // Dismissed stays away.
    expect(await dismissSuggestion(t.db, OWNER, "sam", "ana")).toBe(true);
    expect(ids(await suggestTies(t.db, "sam", { viewer: OWNER, env: ON }))).not.toContain("ana");
    // Off: nothing.
    expect(await suggestTies(t.db, "sam", { viewer: OWNER, env: { SOCIAL_TIES: "0" } })).toEqual([]);
  });

  it("goes no further than the public network past the character's own ties", async () => {
    await world();
    // Mira's tie to Ana is only her owner's: Sam's owner can't see it, so it suggests nothing.
    await t.db.query(`update social_ties set visibility = 'owner' where from_id = 'ana' or to_id = 'ana'`);
    expect(ids(await suggestTies(t.db, "sam", { viewer: OWNER, env: ON }))).toEqual(["jo"]);
    // Sam's own owner-only tie still counts: its owner sees it.
    await t.db.query(`update social_ties set visibility = 'owner' where kind = 'best_friend'`);
    expect(ids(await suggestTies(t.db, "sam", { viewer: OWNER, env: ON }))).toEqual(["jo"]);
    // A friend who's private (and not the viewer's) carries nothing.
    await t.db.query(`update characters set visibility = 'private' where id = 'mira'`);
    expect(await suggestTies(t.db, "sam", { viewer: OWNER, env: ON })).toEqual([]);
  });

  it("finds shared places, the same event and a friend of an ex", async () => {
    await character("sam", "Sam Reed", { owner: OWNER });
    await character("pia", "Pia Moss");
    await character("eve", "Eve Lark");
    await character("rex", "Rex Dunn");
    await character("fay", "Fay Bloom");
    await t.db.query(`insert into social_places (id, key, kind, name, source) values ('pl-light', 'work:lighthouse', 'workplace', 'the lighthouse', 'house')`);
    await t.db.query(
      `insert into social_place_members (place_id, character_id, role, source) values ('pl-light', 'sam', 'works', 'house'), ('pl-light', 'pia', 'works', 'house')`,
    );
    // Sam and Eve met at a group night (derive's encounter): a reason, never a reason not to.
    await upsertTie(t.db, { from: "sam", to: "eve", kind: "met_at_group_night", source: "derived", evidence: { ref: "night:n1" }, detail: { nights: 1 } }, ON);
    // Rex is Sam's ex; Fay is Rex's close friend.
    await tie("sam", "rex", "ex");
    await tie("rex", "fay", "close_friend");
    const out = await suggestTies(t.db, "sam", { viewer: OWNER, env: ON });
    expect(out.find((s) => s.id === "pia")).toMatchObject({ reason: "shared_place", words: "Coworkers at the lighthouse", signals: { places: 1 } });
    expect(out.find((s) => s.id === "eve")).toMatchObject({ reason: "same_event", words: "Met at a group night", score: 0.5, signals: { events: 1 } });
    expect(out.find((s) => s.id === "fay")).toMatchObject({ reason: "friend_of_ex", words: "Rex's close friend, and Rex is Sam's ex", signals: { ex: true } });
    // The ex isn't suggested (they're tied); an encounter alone below the bar isn't either.
    expect(ids(out)).not.toContain("rex");
    await t.db.query(`delete from social_ties where kind = 'met_at_group_night'`);
    await upsertTie(t.db, { from: "sam", to: "eve", kind: "housemate", source: "derived", evidence: { ref: "season:2026-11" } }, ON);
    expect(ids(await suggestTies(t.db, "sam", { viewer: OWNER, env: ON }))).not.toContain("eve");
    expect(0.15).toBeLessThan(MIN_SCORE);
  });

  it("logs what was shown once while it's open, and settles accepted, dismissed and ignored", async () => {
    await world();
    const shown = await suggestTies(t.db, "sam", { viewer: OWNER, env: ON });
    const at = new Date("2026-11-01T12:00:00Z");
    expect(await logShown(t.db, OWNER, "sam", shown, at)).toBe(2);
    expect(await logShown(t.db, OWNER, "sam", shown, at)).toBe(0);
    // A tie with Ana made after it was shown: accepted. Jo, untouched for 30 days: ignored.
    await t.db.query(`update social_suggestion_log set shown_at = $1`, [at.toISOString()]);
    await tie("sam", "ana", "friend", { source: "owner" });
    const later = new Date(at.getTime() + (IGNORED_AFTER_DAYS + 1) * 86_400_000);
    expect(await settleSuggestions(t.db, { now: later })).toEqual({ accepted: 1, ignored: 1 });
    expect(await settleSuggestions(t.db, { now: later })).toEqual({ accepted: 0, ignored: 0 });
    const { rows } = await t.db.query<{ suggested_id: string; outcome: string; reason: string }>(`select suggested_id, outcome, reason from social_suggestion_log order by suggested_id`);
    expect(rows).toEqual([
      { suggested_id: "ana", outcome: "accepted", reason: "common_friends" },
      { suggested_id: "jo", outcome: "ignored", reason: "common_friends" },
    ]);
    // Shown again once settled: a new row.
    expect(await logShown(t.db, OWNER, "sam", [{ id: "jo", reason: "common_friends", score: 1 }], later)).toBe(1);
  });

  it("GET and POST /api/social/suggest/[id]: the owner only, logged, and Not now", async () => {
    const cookie = newUserCookie();
    const owner = userIdOf(cookie);
    await world();
    await t.db.query(`update characters set owner_id = $1 where id = 'sam'`, [owner]);
    const ctx = { params: Promise.resolve({ id: "sam" }) };
    const stranger = await GET(new Request(`${BASE_URL}/api/social/suggest/sam`, { headers: { cookie: newUserCookie() } }), ctx);
    expect(stranger.status).toBe(404);
    const res = await GET(new Request(`${BASE_URL}/api/social/suggest/sam`, { headers: { cookie } }), { params: Promise.resolve({ id: "sam" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: { id: string; words: string; reason: string }[] };
    expect(body.suggestions.map((s) => s.id).sort()).toEqual(["ana", "jo"]);
    expect(body.suggestions[0]).not.toHaveProperty("signals");
    expect((await t.db.query(`select count(*)::int as n from social_suggestion_log where viewer = $1`, [owner])).rows[0]).toEqual({ n: 2 });
    const dismissed = await POST(jsonRequest("/api/social/suggest/sam", { dismiss: "jo" }, { cookie }), { params: Promise.resolve({ id: "sam" }) });
    expect(dismissed.status).toBe(200);
    const after = (await (await GET(new Request(`${BASE_URL}/api/social/suggest/sam`, { headers: { cookie } }), { params: Promise.resolve({ id: "sam" }) })).json()) as { suggestions: { id: string }[] };
    expect(after.suggestions.map((s) => s.id)).toEqual(["ana"]);
  });

  it("MCP suggest_ties: the same list for the character's own agent, logged; anyone else is refused", async () => {
    const AGENT = "0f0e0d0c-0b0a-4a09-8807-0605040302aa";
    const STRANGER = "1f1e1d1c-1b1a-4a19-8817-1615141312bb";
    await world();
    await t.db.query(`update characters set owner_id = $1 where id = 'sam'`, [AGENT]);
    type Result = { isError?: boolean; structuredContent: Record<string, unknown> };
    const call = async (args: Record<string, unknown>): Promise<Result> =>
      ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "suggest_ties", arguments: args } }, {})) as { result: Result }).result;
    const r = await call({ character_id: "sam", agent_id: AGENT });
    expect(r.isError, JSON.stringify(r.structuredContent)).toBeUndefined();
    const d = r.structuredContent as { character_id: string; suggestions: { character_id: string; reason: string; why: string }[] };
    expect(d.character_id).toBe("sam");
    expect(d.suggestions.map((s) => s.character_id).sort()).toEqual(["ana", "jo"]);
    expect(d.suggestions.find((s) => s.character_id === "ana")).toMatchObject({ reason: "common_friends", why: "Mira's friend" });
    expect((await t.db.query(`select count(*)::int as n from social_suggestion_log where viewer = $1`, [AGENT])).rows[0]).toEqual({ n: 2 });
    expect(((await call({ character_id: "sam", agent_id: AGENT, limit: 1 })).structuredContent.suggestions as unknown[]).length).toBe(1);
    const other = await call({ character_id: "sam", agent_id: STRANGER });
    expect(other.isError).toBe(true);
    expect(JSON.stringify(other)).not.toContain("Mira's friend");
    expect((await call({ character_id: "sam" })).isError).toBe(true);
  });
});

describe("the daily job", () => {
  it("settles the suggestion log after the network's numbers, before the lessons", () => {
    const daily = readFileSync(new URL("../app/api/jobs/daily/route.ts", import.meta.url), "utf8");
    const growth = daily.slice(daily.indexOf("async function growth("));
    expect(growth.indexOf(`step("social_suggestions"`)).toBeGreaterThan(growth.indexOf(`step("social_metrics"`));
    expect(growth.indexOf(`step("social_suggestions"`)).toBeLessThan(growth.indexOf(`step("character_lessons"`));
  });
});

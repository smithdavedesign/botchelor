// The insights overview on /admin/analytics (lib/insights.ts, GET /api/admin/insights): KPI counts against the previous
// period, honest verdicts, the people funnel, retention, our-traffic exclusion, segments, the tables, quality runs and
// auth; the pure chart helpers (lib/chart.ts); and the dashboard's pieces rendered to markup.
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeChart } from "@/app/admin/analytics/charts";
import { describeChange } from "@/app/admin/analytics/Kpis";
import { filtersQuery, readFilters } from "@/app/admin/analytics/InsightsDashboard";
import OverviewTab from "@/app/admin/analytics/OverviewTab";
import QualityTab from "@/app/admin/analytics/QualityTab";
import { sortRows, tableCsv, type Column } from "@/app/admin/analytics/SortableTable";
import { GET as getAnalytics } from "@/app/api/admin/analytics/route";
import { GET as getInsights } from "@/app/api/admin/insights/route";
import { MCP_WINDOW_MAX_DAYS } from "@/lib/agent-analytics";
import { claimAdmin } from "@/lib/admins";
import {
  addDays,
  bucket,
  byWeek,
  compact,
  daysBetween,
  isDay,
  isoDay,
  linePath,
  movingAverage,
  niceTicks,
  scaleLinear,
  shortDay,
  toCsv,
  trendLines,
  weekOf,
} from "@/lib/chart";
import {
  anomalyInsights,
  clearInsightsCache,
  countVerdict,
  funnelInsight,
  keep,
  loadInsights,
  MAX_RANGE_DAYS,
  MIN_N as INSIGHTS_MIN_N,
  moverInsights,
  parseInsightsQuery,
  periodsOf,
  retention,
  shareVerdict,
  type Insights,
  type InsightsQuery,
  type Kpi,
  type Newcomer,
} from "@/lib/insights";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { SYSTEM_ID } from "@/lib/our-traffic";
import { saveQualityRun } from "@/lib/quality-runs";
import { MIN_N as REAL_MIN_N, saveSimRating } from "@/lib/real-metrics";
import type { Ending } from "@/lib/rules";
import { SYSTEM_CREATOR_ID } from "@/lib/watch";
import { BASE_URL, HOUSE_PARTNER_ID, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  for (const table of ["admins", "accounts", "adult_steps", "couple_follows", "arc_predictions"]) await t.db.query(`delete from ${table}`);
  // The code-defined house cast is inserted when the test database is made, i.e. today: move it out of every period.
  await t.db.query(`update characters set created_at = '2026-01-01T00:00:00Z' where is_house`);
  clearInsightsCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const NOW = new Date("2026-10-21T12:00:00Z");
/** The last 7 days (Oct 15 to 21); the previous period is Oct 8 to 14. */
const WEEK: InsightsQuery = { from: "2026-10-15", to: "2026-10-21", segment: "all", includeOurs: false };
const q = (over: Partial<InsightsQuery> = {}): InsightsQuery => ({ ...WEEK, ...over });
const at = (day: string, hour = 10) => `${day}T${String(hour).padStart(2, "0")}:00:00Z`;
const HOUSE_A = HOUSE_PARTNER_ID;
const HOUSE_B = HOUSE_CHARACTERS[1].id;

async function character(id: string, owner: string | null, day: string, o: { via?: "web" | "mcp"; house?: boolean; visibility?: string } = {}) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, created_via, created_at, visibility)
     values ($1, $2, $3, $4, 30, 'A bio.', '[]'::jsonb, 'Love.', 'Rudeness.', $5, $6, $7)`,
    [id, owner, o.house ?? false, `Name ${id}`, o.via ?? "web", at(day), o.visibility ?? "public"],
  );
}
let episodes = 0;
async function date(
  creator: string,
  a: string,
  b: string,
  day: string,
  o: { via?: "web" | "mcp"; ending?: Ending; aired?: string; followupOf?: string; venue?: string; hour?: number } = {},
): Promise<string> {
  const id = `ep${++episodes}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, created_via, followup_of, revealed_at, created_at, setup)
     values ($1, $2, $3, $4, 'A bar.', '[]'::jsonb, '[]'::jsonb, 'Twist.', 'Finale.', $5, $6, $7, $8, $9, $10::jsonb)`,
    [id, creator, a, b, o.ending ?? "friends", o.via ?? "web", o.followupOf ?? null, o.aired ? at(o.aired, 12) : null, at(day, o.hour ?? 10), JSON.stringify(o.venue ? { venue: o.venue } : {})],
  );
  return id;
}
async function session(agent: string, client: string, day: string, userAgent = `${client}/1.0`) {
  await t.db.query(`insert into mcp_sessions (id, agent_id, client_name, user_agent, created_at, last_seen) values ($1, $2, $3, $4, $5, $5)`, [
    `s-${agent}-${day}-${randomUUID().slice(0, 4)}`,
    agent,
    client,
    userAgent,
    at(day),
  ]);
}
async function toolCall(agent: string, tool: string, day: string, o: { ok?: boolean; client?: string } = {}) {
  const client = o.client ?? "claude-code";
  await t.db.query(`insert into mcp_calls (session_id, agent_id, method, tool, ok, client_name, user_agent, created_at) values ($1, $2, 'tools/call', $3, $4, $5, $6, $7)`, [
    `s-${agent}`,
    agent,
    tool,
    o.ok ?? true,
    client,
    `${client}/1.0`,
    at(day),
  ]);
}
async function rate(user: string, characterId: string, day: string) {
  await t.db.query(`insert into character_ratings (rater_id, character_id, category, created_at) values ($1, $2, 'likable', $3)`, [user, characterId, at(day)]);
}
async function account(user: string, day: string) {
  await t.db.query(`insert into accounts (user_id, created_at) values ($1, $2)`, [user, at(day)]);
}
async function text(from: string, to: string, day: string, via: "own_key" | "agent" | "daily" | "show" | "match") {
  const [lo, hi] = [from, to].sort();
  await t.db.query(
    `insert into couple_texts (character_lo, character_hi, day, seq, who, text, via, created_at)
     values ($1, $2, $3::date, (select coalesce(max(seq), 0) + 1 from couple_texts where character_lo = $1 and character_hi = $2 and day = $3::date), $4, 'Hi.', $5, $6)`,
    [lo, hi, day, from === lo ? "lo" : "hi", via, at(day)],
  );
}
let lines = 0;
async function vote(user: string, v: 1 | -1, day: string) {
  await t.db.query(`insert into line_feedback (id, user_id, kind, ref_id, line_index, vote, created_at, updated_at) values ($1, $2, 'episode', 'ep-x', $3, $4, $5, $5)`, [
    randomUUID(),
    user,
    lines++,
    v,
    at(day),
  ]);
}
const kpi = (data: Insights, key: string): Kpi => {
  const k = data.kpis.find((x) => x.key === key);
  if (!k) throw new Error(`no kpi ${key}`);
  return k;
};
const counts = (data: Insights, key: string) => [kpi(data, key).current, kpi(data, key).previous];

describe("the query and the periods", () => {
  it("defaults to the last 30 days, clamps to today and a year, swaps a backwards range, and reads the filters", () => {
    expect(parseInsightsQuery(new URLSearchParams(), NOW)).toEqual({ from: "2026-09-22", to: "2026-10-21", segment: "all", includeOurs: false });
    expect(parseInsightsQuery(new URLSearchParams("from=2026-10-01&to=2027-01-01"), NOW)).toMatchObject({ from: "2026-10-01", to: "2026-10-21" });
    expect(parseInsightsQuery(new URLSearchParams("from=2026-10-10&to=2026-10-01"), NOW)).toMatchObject({ from: "2026-10-01", to: "2026-10-10" });
    expect(parseInsightsQuery(new URLSearchParams("from=2020-01-01&to=2026-10-21"), NOW).from).toBe(addDays("2026-10-21", -(MAX_RANGE_DAYS - 1)));
    expect(parseInsightsQuery(new URLSearchParams("from=2026-02-31&segment=robots&include_ours=1"), NOW)).toMatchObject({ from: "2026-09-22", segment: "all", includeOurs: true });
    expect(parseInsightsQuery(new URLSearchParams("segment=house"), NOW).segment).toBe("house");
    // The range's cap is the MCP window's, so the Agents tab can always follow it; the "too few" bar is Real use's.
    expect(MAX_RANGE_DAYS).toBe(MCP_WINDOW_MAX_DAYS);
    expect(INSIGHTS_MIN_N).toBe(REAL_MIN_N);
    expect(SYSTEM_ID).toBe(SYSTEM_CREATOR_ID);
  });

  it("the previous period is the same number of days, just before", () => {
    const p = periodsOf(WEEK);
    expect(p.days).toBe(7);
    expect(p.current).toEqual(daysBetween("2026-10-15", "2026-10-21"));
    expect([p.previous[0], p.previous[6], p.previous.length]).toEqual(["2026-10-08", "2026-10-14", 7]);
    expect(periodsOf({ from: "2026-10-21", to: "2026-10-21" }).previous).toEqual(["2026-10-20"]);
  });
});

describe("verdicts: small numbers say so, and only a real change counts", () => {
  it("counts: a Poisson test, and too few under ten events across both periods", () => {
    expect(countVerdict(30, 10)).toMatchObject({ direction: "up", change: 20, pct: 2, tooFew: false, real: true });
    expect(countVerdict(55, 50)).toMatchObject({ direction: "up", tooFew: false, real: false });
    expect(countVerdict(6, 3)).toMatchObject({ direction: "up", tooFew: true, real: false });
    expect(countVerdict(4, 0)).toMatchObject({ pct: null, tooFew: true });
    expect(countVerdict(10, 30)).toMatchObject({ direction: "down", real: true });
    expect(countVerdict(7, 7)).toMatchObject({ direction: "flat", change: 0 });
  });

  it("rates: a two-proportion test, and too few under five either side", () => {
    expect(shareVerdict(30, 50, 10, 50)).toMatchObject({ direction: "up", tooFew: false, real: true });
    expect(shareVerdict(26, 50, 24, 50)).toMatchObject({ real: false, tooFew: false });
    expect(shareVerdict(2, 4, 1, 4)).toMatchObject({ tooFew: true, real: false });
    expect(shareVerdict(1, 5, 0, 0)).toMatchObject({ change: null, tooFew: true });
    const v = shareVerdict(30, 50, 10, 50);
    expect(v.change).toBeCloseTo(0.4);
  });

  it("a card's change in words: colour only when it's real, and plain words when it isn't", () => {
    const card = (over: Partial<Kpi>): Kpi => ({ key: "k", label: "Dates", definition: "", scope: "segment", format: "count", current: 30, previous: 10, comparable: true, verdict: countVerdict(30, 10), ...over });
    expect(describeChange(card({}))).toEqual({ text: "▲ up 20 (200%)", tone: "up" });
    expect(describeChange(card({ current: 55, previous: 50, verdict: countVerdict(55, 50) }))).toEqual({ text: "▲ 5 (10%), within normal variation", tone: "quiet" });
    expect(describeChange(card({ current: 3, previous: 2, verdict: countVerdict(3, 2) })).text).toBe("previous: 2 · too few to say");
    expect(describeChange(card({ comparable: false })).text).toBe("previous: 10 (not comparable)");
    const rateCard = card({ format: "percent", current: 0.6, previous: 0.2, verdict: shareVerdict(30, 50, 10, 50) });
    expect(describeChange(rateCard)).toEqual({ text: "▲ up 40 pts (20% → 60%)", tone: "up" });
  });
});

describe("the KPI cards", () => {
  it("counts characters, dates, aired dates, accounts, texts, swipes and matches in both periods", async () => {
    // This period.
    await character("p1c", "person-1", "2026-10-15");
    await character("p2c", "person-2", "2026-10-16");
    await character("p3c", "person-3", "2026-10-17");
    await session("agent-1", "claude-code", "2026-10-16");
    await character("a1c", "agent-1", "2026-10-16", { via: "mcp" });
    await date("person-1", "p1c", HOUSE_A, "2026-10-16", { ending: "second_date", aired: "2026-10-16" });
    await date("person-1", "p1c", HOUSE_B, "2026-10-18", { ending: "friends" });
    await date("person-2", "p2c", HOUSE_A, "2026-10-19", { ending: "disaster", aired: "2026-10-19" });
    await date("agent-1", "a1c", HOUSE_B, "2026-10-20", { via: "mcp", ending: "friends" });
    await account("person-1", "2026-10-17");
    await text("p1c", HOUSE_A, "2026-10-17", "own_key");
    await text(HOUSE_A, "p1c", "2026-10-17", "show");
    await text("a1c", HOUSE_B, "2026-10-20", "agent");
    await text("p2c", HOUSE_A, "2026-10-19", "daily"); // the show's scheduled exchange: not counted
    // Someone who only sat in a watch room: a viewer, but not a new person (a heartbeat could be a crawler).
    await t.db.query(`insert into watch_parties (id, episode_id, kind, created_at) select 'wp1', id, 'premiere', $1 from episodes limit 1`, [at("2026-10-16")]);
    await t.db.query(`insert into watch_presence (party_id, user_id, last_seen) values ('wp1', 'lurker', $1), ('wp1', 'person-2', $1)`, [at("2026-10-18")]);
    await t.db.query(`insert into swipes (swiper, target, liked, created_at) values ('p1c', $1, true, $3), ('p2c', $2, false, $3)`, [HOUSE_A, HOUSE_B, at("2026-10-17")]);
    await t.db.query(`insert into matches (character_lo, character_hi, matched_at) values ($1, $2, $3)`, [[HOUSE_A, "p1c"].sort()[0], [HOUSE_A, "p1c"].sort()[1], at("2026-10-17")]);
    // The previous period.
    await character("p0c", "person-0", "2026-10-09");
    await date("person-0", "p0c", HOUSE_A, "2026-10-10", { ending: "friends", aired: "2026-10-10" });
    // Before both: never counted.
    await character("oldc", "person-old", "2026-09-01");

    const data = await loadInsights(t.db, WEEK, NOW);
    expect(counts(data, "characters")).toEqual([4, 1]);
    expect(counts(data, "dates_started")).toEqual([4, 1]);
    expect(counts(data, "dates_aired")).toEqual([2, 1]);
    expect(counts(data, "accounts")).toEqual([1, 0]);
    expect(counts(data, "texts")).toEqual([3, 0]);
    expect(counts(data, "swipes")).toEqual([2, 0]);
    expect(kpi(data, "swipes").sub).toBe("1 like");
    expect(counts(data, "matches")).toEqual([1, 0]);
    expect(counts(data, "new_people")).toEqual([3, 1]); // the agent isn't a person, and nor is the lurker
    expect(kpi(data, "watch_viewers")).toMatchObject({ current: 2, comparable: false });
    expect(kpi(data, "dates_started").verdict).toMatchObject({ direction: "up", tooFew: true });
    // The daily series behind the charts line up with the period's days.
    expect(data.days).toEqual(daysBetween("2026-10-15", "2026-10-21"));
    expect(data.series.dates.endings.second_date).toEqual([0, 1, 0, 0, 0, 0, 0]);
    expect(data.series.dates.endings.friends).toEqual([0, 0, 0, 1, 0, 1, 0]);
    expect(data.series.dates.previous).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(kpi(data, "characters").spark).toEqual([1, 2, 1, 0, 0, 0, 0]);
    expect(data.endings).toEqual([
      { ending: "second_date", current: 1, previous: 0 },
      { ending: "friends", current: 2, previous: 1 },
      { ending: "disaster", current: 1, previous: 0 },
    ]);
    // Nothing on this page is money.
    expect(JSON.stringify(data)).not.toMatch(/revenue|cents|price|amount|cost/i);
  });

  it("MCP agents active, tool calls, line votes, agent feedback and After Dark steps", async () => {
    await session("agent-1", "claude-code", "2026-10-16");
    await session("agent-2", "cursor", "2026-10-17");
    await toolCall("agent-1", "list_cast", "2026-10-16");
    await toolCall("agent-1", "create_character", "2026-10-16", { ok: false });
    await toolCall("agent-2", "list_cast", "2026-10-17", { client: "cursor" });
    await toolCall("agent-2", "list_cast", "2026-10-09", { client: "cursor" }); // previous period
    for (const v of [1, 1, 1, -1] as const) await vote("viewer-1", v, "2026-10-18");
    await vote("viewer-2", 1, "2026-10-18");
    await t.db.query(
      `insert into agent_feedback (id, agent_id, session_id, client_name, rating, created_at) values
         ('f1', 'agent-1', 's-1', 'claude-code', 8, $1), ('f2', 'agent-2', 's-2', 'cursor', 6, $1), ('f3', 'agent-2', 's-2', 'cursor', null, $1),
         ('f4', 'visitor', null, 'loop 2026-10-18 · visitor-1', 9, $1)`,
      [at("2026-10-18")],
    ); // f4 was imported from the loop's local run (no session): ours
    await t.db.query(
      `insert into adult_steps (id, owner_id, character_a, character_b, kind, status, created_at) values ('st1', 'admin-x', $1, $2, 'steer', 'ok', $3), ('st2', 'admin-x', $1, $2, 'steer', 'ok', $3)`,
      [HOUSE_A, HOUSE_B, at("2026-10-19")],
    );
    const data = await loadInsights(t.db, WEEK, NOW);
    expect(counts(data, "mcp_agents")).toEqual([2, 1]);
    expect(data.series.calls.ok).toEqual([0, 1, 1, 0, 0, 0, 0]);
    expect(data.series.calls.error).toEqual([0, 1, 0, 0, 0, 0, 0]);
    // Calls are logged from the first one (Oct 9 here): Oct 8 is "not logged", never a zero.
    expect(data.series.calls.previous.slice(0, 3)).toEqual([null, 1, 0]);
    expect(data.logged_since.mcp_calls?.slice(0, 10)).toBe("2026-10-09");
    expect(data.series.sessions.current).toEqual([0, 1, 1, 0, 0, 0, 0]);
    expect(kpi(data, "thumbs_up")).toMatchObject({ current: 0.8, base: { current: 5, previous: 0, unit: "votes" } });
    expect(kpi(data, "thumbs_up").verdict.tooFew).toBe(true);
    expect(kpi(data, "agent_feedback")).toMatchObject({ current: 3, sub: "avg rating 7.0 of 10 (2 rated)" });
    expect(kpi(data, "after_dark_steps")).toMatchObject({ current: 2, sub: "in 1 scene" });
    // Steps were first logged inside this period, so the previous one isn't a fair comparison.
    expect(kpi(data, "after_dark_steps").comparable).toBe(false);
  });

  it("second-date rate: first dates that aired, a follow-up within 7 days; still maturing when the period ends this week", async () => {
    await character("sc", "person-s", "2026-10-01");
    const quick = await date("person-s", "sc", HOUSE_A, "2026-10-15", { aired: "2026-10-15" });
    await date("person-s", "sc", HOUSE_A, "2026-10-17", { followupOf: quick }); // 2 days later: counts
    const slow = await date("person-s", "sc", HOUSE_B, "2026-10-15", { aired: "2026-10-15" });
    await date("person-s", "sc", HOUSE_B, "2026-10-21", { followupOf: slow, hour: 13 }); // within 7 days of airing: counts
    await date("person-s", "sc", "sc", "2026-10-16", { aired: "2026-10-16" }); // never followed
    const late = await date("person-s", "sc", HOUSE_A, "2026-10-02", { aired: "2026-10-02" });
    await date("person-s", "sc", HOUSE_A, "2026-10-12", { followupOf: late }); // 10 days later: too late, and outside both periods
    let data = await loadInsights(t.db, WEEK, NOW);
    expect(kpi(data, "second_date_rate")).toMatchObject({ current: 2 / 3, base: { current: 3, previous: 0 }, comparable: false });
    expect(kpi(data, "second_date_rate").note).toMatch(/Still maturing/);
    // A period that ended more than 7 days ago is comparable.
    data = await loadInsights(t.db, q({ from: "2026-09-28", to: "2026-10-04" }), NOW);
    expect(kpi(data, "second_date_rate")).toMatchObject({ current: 0, base: { current: 1, previous: 0 }, comparable: true });
  });
});

describe("our own traffic", () => {
  it("is left out by default (admins, their agents, our checks, the show's own dates) and the toggle counts it", async () => {
    await character("realc", "person-r", "2026-10-16");
    await claimAdmin(t.db, "admin-1");
    await character("adminc", "admin-1", "2026-10-16");
    await date("admin-1", "adminc", HOUSE_A, "2026-10-16");
    await session("agent-check", "smoke-test", "2026-10-16", "botchelor-live-check/1.0 (Claude)");
    await character("checkc", "agent-check", "2026-10-16", { via: "mcp" });
    await toolCall("agent-check", "create_character", "2026-10-16", { client: "botchelor-live-check" });
    await date(SYSTEM_ID, HOUSE_A, HOUSE_B, "2026-10-17"); // the show's own watch-party date
    await rate("admin-1", HOUSE_A, "2026-10-16");

    const out = await loadInsights(t.db, WEEK, NOW);
    expect(kpi(out, "characters").current).toBe(1);
    expect(kpi(out, "dates_started").current).toBe(0);
    expect(kpi(out, "mcp_agents").current).toBe(0);
    expect(out.series.calls.ok.reduce<number>((a, b) => a + (b ?? 0), 0)).toBe(0);
    expect(kpi(out, "new_people").current).toBe(1); // the real person; the admin is ours

    const all = await loadInsights(t.db, q({ includeOurs: true }), NOW);
    expect(kpi(all, "characters").current).toBe(3);
    expect(kpi(all, "dates_started").current).toBe(2);
    expect(kpi(all, "mcp_agents").current).toBe(1);
    expect(kpi(all, "new_people").current).toBe(2); // the admin now; never "system" or an agent
  });
});

describe("segments are lenses", () => {
  it("People and Agents split by who did it; House is anything with a house character in it", async () => {
    await character("pc", "person-1", "2026-10-15");
    await session("agent-1", "claude-code", "2026-10-15");
    await character("ac", "agent-1", "2026-10-15", { via: "mcp" });
    await character("newhouse", null, "2026-10-16", { house: true }); // a season's generated newcomer
    await date("person-1", "pc", HOUSE_A, "2026-10-16"); // people + house
    await date("agent-1", "ac", "pc", "2026-10-17", { via: "mcp" }); // agents only
    await date(SYSTEM_ID, HOUSE_A, HOUSE_B, "2026-10-18"); // the show's own: house, and ours
    await account("person-1", "2026-10-16");

    const by = async (segment: InsightsQuery["segment"], includeOurs = false) => loadInsights(t.db, q({ segment, includeOurs }), NOW);
    const [all, people, agents, house] = await Promise.all([by("all"), by("people"), by("agents"), by("house")]);
    expect([all, people, agents, house].map((d) => kpi(d, "dates_started").current)).toEqual([2, 1, 1, 1]);
    expect([all, people, agents, house].map((d) => kpi(d, "characters").current)).toEqual([3, 1, 1, 1]);
    expect(kpi(await by("house", true), "dates_started").current).toBe(2);
    // A people-only card doesn't follow the segment.
    expect(kpi(agents, "accounts")).toMatchObject({ current: 1, scope: "people" });
    // The top characters table follows it too: house characters only, or people's only.
    expect(house.characters.map((c) => c.kind)).toEqual(["house"]);
    expect(people.characters.map((c) => c.id)).toEqual(["pc"]);
    expect(people.characters[0]).toMatchObject({ dates: 2, kind: "people" });
  });

  it("keep() applies the segment only to measures it splits, and always drops ours unless asked", () => {
    const cell = { people: true, agents: false, house: true, ours: false };
    expect(keep(cell, { segment: "agents", includeOurs: false })).toBe(false);
    expect(keep(cell, { segment: "agents", includeOurs: false }, false)).toBe(true);
    expect(keep(cell, { segment: "house", includeOurs: false })).toBe(true);
    expect(keep({ ...cell, ours: true }, { segment: "all", includeOurs: false })).toBe(false);
    expect(keep({ ...cell, ours: true }, { segment: "all", includeOurs: true })).toBe(true);
  });
});

describe("the people funnel and retention", () => {
  it("each step counts the people who also did every step before it, and the biggest drop is called out", async () => {
    // Six people first seen this period, each a step further than the one before.
    await rate("only-rated", HOUSE_A, "2026-10-15");
    await character("c2", "made-char", "2026-10-15");
    await character("c3", "first-date", "2026-10-15");
    await date("first-date", "c3", HOUSE_A, "2026-10-16", { aired: "2026-10-16" });
    for (const [who, c] of [
      ["second", "c4"],
      ["account", "c5"],
      ["texter", "c6"],
    ] as const) {
      await character(c, who, "2026-10-15");
      const first = await date(who, c, HOUSE_A, "2026-10-16", { aired: "2026-10-16" });
      await date(who, c, HOUSE_A, "2026-10-17", { followupOf: first });
    }
    await account("account", "2026-10-18");
    await account("texter", "2026-10-18");
    await text("c6", HOUSE_A, "2026-10-19", "own_key");
    // An agent that did all of it isn't in the people funnel.
    await session("agent-f", "claude-code", "2026-10-15");
    await character("cf", "agent-f", "2026-10-15", { via: "mcp" });

    const data = await loadInsights(t.db, WEEK, NOW);
    expect(data.funnel.map((s) => s.count)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(data.funnel.map((s) => s.of_previous)).toEqual([null, 5 / 6, 4 / 5, 3 / 4, 2 / 3, 1 / 2]);
    expect(data.funnel[2].of_first).toBeCloseTo(4 / 6);
    expect(data.funnel.map((s) => s.key)).toEqual(["first_seen", "made_character", "first_date", "second_date", "account", "texted"]);
    // Only steps whose step before has five or more people are read: made a character → first date is the weakest.
    expect(data.insights.map((i) => i.text)).toContain("The people funnel loses the most between “made a character” and “first date”: 4 of 5 (80%) made it.");
    expect(funnelInsight([{ ...data.funnel[0], count: 3 }])?.text).toMatch(/Too few new people/);
  });

  it("weekly retention: week 0 is everyone, a week to come is empty, small cohorts stay counts", () => {
    const person = (first: string, days: string[]): Newcomer => ({ first_day: first, days: [first, ...days], made_character: false, first_date: false, second_date: false, account: false, texted: false });
    const rows = retention(
      [person("2026-10-05", ["2026-10-13"]), person("2026-10-06", []), person("2026-10-07", ["2026-10-20"]), person("2026-10-14", ["2026-10-15"])],
      "2026-10-21",
      3,
    );
    expect(rows).toEqual([
      { week: "2026-10-05", size: 3, active: [3, 1, 1, null] },
      // Back the next day, but in the same week: week 1 hasn't seen them yet.
      { week: "2026-10-12", size: 1, active: [1, 0, null, null] },
    ]);
  });
});

describe("tables", () => {
  it("venues group places of their own under their kind and leave our dates out", async () => {
    await character("vc", "person-v", "2026-10-01");
    await date("person-v", "vc", HOUSE_A, "2026-10-16", { venue: "rooftop_bar", ending: "second_date" });
    await date("person-v", "vc", HOUSE_B, "2026-10-17", { venue: "rooftop_bar" });
    await date("person-v", "vc", HOUSE_A, "2026-10-18", { venue: "home@Chud's place" });
    await date("person-v", "vc", HOUSE_B, "2026-10-19");
    await claimAdmin(t.db, "admin-v");
    await character("avc", "admin-v", "2026-10-01");
    await date("admin-v", "avc", HOUSE_A, "2026-10-19", { venue: "night_beach" });
    const data = await loadInsights(t.db, WEEK, NOW);
    expect(data.venues.map((v) => [v.name, v.dates])).toEqual([
      ["A rooftop bar at golden hour", 2],
      ["Not recorded (older dates)", 1],
      ["Their place", 1],
    ]);
    expect(data.venues[0].endings).toEqual({ second_date: 1, friends: 1, disaster: 0 });
  });
});

describe("quality runs", () => {
  it("golden win rate and gate, observer findings and loop ratings by day; the runs table carries no cost", async () => {
    const golden = (label: string, day: string, winRate: number) =>
      saveQualityRun(t.db, {
        kind: "golden",
        label,
        sha: "abc1234def",
        at: at(day),
        metrics: { suite: "after_dark", n: 8, win_rate_b: winRate, p_value: 0.69, gate: { passed: winRate >= 0.45, reasons: [] }, cost_usd: 0.19 },
      });
    await golden("ad-v1-v2", "2026-10-16", 0.62);
    await golden("ad-v2-v3", "2026-10-19", 0.4);
    await golden("older", "2026-10-10", 0.5);
    const observer = (label: string, day: string, unprovoked: number) =>
      saveQualityRun(t.db, { kind: "after_dark_observer", label, sha: null, at: at(day), metrics: { pairs: 3, lines: 240, unprovoked_moves: unprovoked, verbatim_repeats: 1, near_repeats: 2, unfounded_memories: 0 } });
    await observer("nightly-1", "2026-10-17", 2);
    await observer("nightly-2", "2026-10-18", 0);
    await saveSimRating(t.db, { run: "2026-10-18-0610", sha: "abc1234", at: at("2026-10-18"), overall_avg: 8, mcp_avg: 8.5, visitors: 2 });

    const data = await loadInsights(t.db, WEEK, NOW);
    expect(data.series.golden.win_rate).toEqual([null, 0.62, null, null, 0.4, null, null]);
    expect(data.series.golden.passed).toEqual([0, 1, 0, 0, 0, 0, 0]);
    expect(data.series.golden.failed).toEqual([0, 0, 0, 0, 1, 0, 0]);
    expect(data.series.observer.unprovoked).toEqual([null, null, 2, 0, null, null, null]);
    expect(data.series.observer.repeats).toEqual([null, null, 3, 3, null, null, null]);
    expect(data.series.loop.overall).toEqual([null, null, null, 8, null, null, null]);
    expect(data.quality.current.golden).toMatchObject({ runs: 2, judged: 2, passed: 1, failed: 1 });
    expect(data.quality.current.golden.win_rate).toBeCloseTo(0.51);
    expect(data.quality.previous.golden).toMatchObject({ runs: 1, passed: 1 });
    expect(data.quality.current.observer).toMatchObject({ runs: 2, findings: 8, lines: 480 });
    expect(data.quality.current.loop).toMatchObject({ runs: 1, overall: 8, mcp: 8.5 });
    expect(data.quality.runs.map((r) => r.label)).toEqual(["ad-v2-v3", "nightly-2", "nightly-1", "ad-v1-v2"]);
    expect(data.quality.runs.flatMap((r) => r.numbers.map((m) => m.label))).not.toContain("cost");
    const texts = data.insights.map((i) => i.text);
    expect(texts.some((x) => x.startsWith("The golden gate failed on the latest run (ad-v2-v3"))).toBe(true);
    expect(texts).toContain("The After Dark observer flagged 3 findings in its latest run, against 5 the run before.");

    const html = renderToStaticMarkup(createElement(QualityTab, { data, interval: "day" }));
    expect(html).toContain("Golden A/B");
    expect(html).toContain("After Dark observer");
    expect(html).toContain("<code>abc1234</code>");
    expect(html).toContain("62% (n 8, p 0.69)");
    expect(html).toContain("the gate&#x27;s 45%");
    expect(html).not.toContain("$0.19");
  });
});

describe("insight callouts", () => {
  it("names the biggest real movers, and says so when nothing moved or there's too little to say", () => {
    const card = (label: string, current: number, previous: number): Kpi => ({
      key: label, label, definition: "", scope: "segment", format: "count", current, previous, comparable: true, verdict: countVerdict(current, previous),
    });
    expect(moverInsights([card("Dates started", 90, 40), card("Swipes", 52, 50)], 7)).toEqual([
      { tone: "up", text: "Dates started rose 125% (40 → 90) against the previous 7 days." },
    ]);
    expect(moverInsights([card("Swipes", 52, 50)], 7)[0].text).toMatch(/^No big movers/);
    expect(moverInsights([card("Texts", 3, 1)], 7)[0].text).toMatch(/^Too few to say/);
    expect(moverInsights([card("Matches", 10, 40)], 30)[0]).toEqual({ tone: "down", text: "Matches fell 75% (40 → 10) against the previous 30 days." });
  });

  it("an unusual day stands out, an empty one in a busy period too, and today never counts", () => {
    const days = daysBetween("2026-10-08", "2026-10-21");
    const spiky = days.map((d) => (d === "2026-10-12" ? 14 : 3));
    expect(anomalyInsights([{ unit: "date", values: spiky }], days, "2026-10-21")).toEqual([{ tone: "info", text: "Oct 12 stands out: 14 dates, about 5× a typical day (3)." }]);
    const launch = days.map((d) => (d === "2026-10-14" ? 24 : 0));
    expect(anomalyInsights([{ unit: "character", values: launch }], days, "2026-10-21")).toEqual([{ tone: "info", text: "Oct 14 stands out: 24 characters, when a typical day has none." }]);
    const busy = days.map((d) => (d === "2026-10-13" || d === "2026-10-21" ? 0 : 8));
    expect(anomalyInsights([{ unit: "tool call", values: busy }], days, "2026-10-21")).toEqual([{ tone: "warn", text: "No tool calls at all on Oct 13, against 8 on a typical day: worth a look." }]);
    expect(anomalyInsights([{ unit: "date", values: [9, 0, 0] }], days.slice(0, 3), "2026-10-21")).toEqual([]); // under a week: nothing to compare
    // Days before a measure was logged are missing, not empty: no false outage.
    const unlogged = days.map((d) => (d < "2026-10-12" ? null : 8));
    expect(anomalyInsights([{ unit: "tool call", values: unlogged }], days, "2026-10-21")).toEqual([]);
  });
});

describe("the routes", () => {
  const PASSWORD = ["insights", "route", "pass"].join("-");
  const today = isoDay(new Date());
  const range = `from=${addDays(today, -6)}&to=${today}`;
  const get = (query: string, headers: Record<string, string> = { "x-frontier-key": PASSWORD }) => getInsights(new Request(`${BASE_URL}/api/admin/insights?${query}`, { headers }));

  it("needs the admin password or a signed-in admin, reads the filters, and reuses a result for a minute unless asked fresh", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PASSWORD);
    vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
    expect((await get(range, {})).status).toBe(403);
    expect((await get(range, { "x-frontier-key": "wrong" })).status).toBe(403);
    expect((await get(range, { cookie: signedInCookie(randomUUID()) })).status).toBe(403);
    const adminId = randomUUID();
    await claimAdmin(t.db, adminId);
    expect((await get(range, { cookie: signedInCookie(adminId) })).status).toBe(200);

    await t.db.query(`insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker) values ('r1', 'person-r', 'R', 30, 'B', '[]', 'W', 'D')`);
    const first = await (await get(`${range}&segment=people&include_ours=1`)).json();
    expect(first.query).toEqual({ from: addDays(today, -6), to: today, days: 7, segment: "people", include_ours: true });
    expect(first.kpis.find((k: Kpi) => k.key === "characters").current).toBe(1);
    await t.db.query(`insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker) values ('r2', 'person-s', 'S', 30, 'B', '[]', 'W', 'D')`);
    const cached = await (await get(`${range}&segment=people&include_ours=1`)).json();
    expect(cached.kpis.find((k: Kpi) => k.key === "characters").current).toBe(1);
    const fresh = await (await get(`${range}&segment=people&include_ours=1&fresh=1`)).json();
    expect(fresh.kpis.find((k: Kpi) => k.key === "characters").current).toBe(2);
  });

  it("the Agents tab's numbers follow the page: its days, a range that ended earlier, and the our-traffic toggle", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PASSWORD);
    const analytics = (query: string) => getAnalytics(new Request(`${BASE_URL}/api/admin/analytics?${query}`, { headers: { "x-frontier-key": PASSWORD } }));
    await t.db.query(
      `insert into mcp_sessions (id, agent_id, client_name, user_agent, created_at, last_seen) values
         ('s-old', 'agent-old', 'cursor', 'cursor/1.0', now() - interval '10 days', now() - interval '10 days'),
         ('s-new', 'agent-new', 'claude-code', 'claude-code/1.0', now(), now()),
         ('s-ours', 'agent-ours', 'botchelor-live-check', 'botchelor-live-check/1.0 (Claude)', now(), now())`,
    );
    const week = await (await analytics(`days=7&to=${today}`)).json();
    expect(week.totals).toMatchObject({ connections: 1, ours: 1 });
    expect(week.days).toHaveLength(7);
    expect(week.days[6].day).toBe(today);
    const earlier = await (await analytics(`days=7&to=${addDays(today, -7)}`)).json();
    expect(earlier.totals.connections).toBe(1); // the 10-day-old session, not today's
    expect(earlier.days[6].day).toBe(addDays(today, -7));
    const withOurs = await (await analytics(`days=7&to=${today}&include_ours=1`)).json();
    expect(withOurs.totals).toMatchObject({ connections: 2, ours: 1 });
    expect(withOurs.days[6]).toMatchObject({ connections: 2, ours: 1 });
  });
});

describe("chart helpers", () => {
  it("days, weeks and labels, all in UTC", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(daysBetween("2026-10-02", "2026-10-01")).toEqual([]);
    expect([isDay("2026-10-21"), isDay("2026-02-31"), isDay("21/10/2026"), isDay(null)]).toEqual([true, false, false, false]);
    expect(weekOf("2026-10-21")).toBe("2026-10-19"); // a Wednesday's Monday
    expect(weekOf("2026-10-25")).toBe("2026-10-19"); // Sunday belongs to the week before
    expect(shortDay("2026-10-03")).toBe("Oct 3");
  });

  it("the moving average leads in from the previous period and skips missing values", () => {
    expect(movingAverage([7, 7, 7], 7, [0, 0, 0, 0, 0, 0])).toEqual([1, 2, 3]);
    expect(movingAverage([2, 4, 6], 2)).toEqual([2, 3, 5]);
    expect(movingAverage([null, 4, null], 2)).toEqual([null, 4, 4]);
    expect(movingAverage([null, null], 3)).toEqual([null, null]);
  });

  it("weekly buckets sum counts, average rates and flag partial weeks; the trend and previous lines follow them", () => {
    const days = daysBetween("2026-10-15", "2026-10-28"); // Thursday to the Wednesday a fortnight on
    const w = byWeek(days, days.map(() => 1), "sum");
    expect(w).toEqual({ labels: ["2026-10-12", "2026-10-19", "2026-10-26"], values: [4, 7, 3], days: [4, 7, 3] });
    expect(bucket(days, days.map((_, i) => (i === 0 ? 0.5 : null)), "week", "mean").values).toEqual([0.5, null, null]);
    // A week with nothing logged is missing when summed too; a week of zeros is zero.
    expect(bucket(days, days.map((_, i) => (i < 4 ? null : 0)), "week", "sum").values).toEqual([null, 0, 0]);
    expect(bucket(days, days.map(() => 1), "week", "sum").partial).toEqual([true, false, true]);
    expect(bucket(["2026-10-15"], [3], "day", "sum")).toEqual({ labels: ["2026-10-15"], values: [3], partial: [false] });
    const prev = daysBetween("2026-10-01", "2026-10-14");
    const lines = trendLines(days, days.map(() => 2), prev, prev.map(() => 0), "day");
    expect(lines.average.slice(0, 3)).toEqual([2 / 7, 4 / 7, 6 / 7]);
    expect(lines.average[13]).toBe(2);
    expect(lines.previous.every((v) => v === 0)).toBe(true);
  });

  it("ticks, scales, paths, numbers and CSV", () => {
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(0.9)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(0)).toEqual([0, 1]);
    // Counts stay whole: no 2.5 dates, and never a step under one.
    expect(niceTicks(9)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(9, 4, true)).toEqual([0, 5, 10]);
    expect(niceTicks(2, 4, true)).toEqual([0, 1, 2]);
    const y = scaleLinear([0, 10], [100, 0]);
    expect([y(0), y(5), y(10)]).toEqual([100, 50, 0]);
    expect(scaleLinear([0, 0], [100, 0])(5)).toBe(100);
    expect(linePath([{ x: 0, y: 1 }, { x: 10, y: 2 }, null, { x: 30, y: 4 }])).toBe("M0 1L10 2M30 4");
    expect([compact(950), compact(1284), compact(2_500_000), compact(1.25)]).toEqual(["950", "1.3K", "2.5M", "1.3"]);
    expect(toCsv([["name", "dates"], ['Mira "M", the first', 3], ["=HYPERLINK(1)", null], ["-1", -1]])).toBe('name,dates\r\n"Mira ""M"", the first",3\r\n\'=HYPERLINK(1),\r\n\'-1,-1');
  });

  it("the sortable table: numbers biggest first, text A to Z, missing values last, and the CSV in that order", () => {
    type Row = { name: string; dates: number | null };
    const rows: Row[] = [{ name: "b", dates: 2 }, { name: "a", dates: null }, { name: "c", dates: 9 }];
    const columns: Column<Row>[] = [
      { key: "name", label: "Name", value: (r) => r.name },
      { key: "dates", label: "Dates", value: (r) => r.dates, numeric: true },
    ];
    expect(sortRows(rows, columns, { key: "dates", dir: "desc" }).map((r) => r.name)).toEqual(["c", "b", "a"]);
    expect(sortRows(rows, columns, { key: "dates", dir: "asc" }).map((r) => r.name)).toEqual(["b", "c", "a"]);
    expect(sortRows(rows, columns, { key: "name", dir: "asc" }).map((r) => r.name)).toEqual(["a", "b", "c"]);
    expect(tableCsv(sortRows(rows, columns, { key: "dates", dir: "desc" }), columns)).toBe("Name,Dates\r\nc,9\r\nb,2\r\na,");
  });
});

describe("the dashboard", () => {
  it("keeps its filters in the address, and a shared link opens the same view", () => {
    const today = "2026-10-21";
    const plain = readFilters(new URLSearchParams(), today);
    expect(plain).toEqual({ tab: "overview", preset: "30", from: "2026-09-22", to: today, segment: "all", ours: false, interval: "auto" });
    expect(filtersQuery(plain)).toBe("");
    const view = readFilters(new URLSearchParams("tab=quality&range=custom&from=2026-10-01&to=2026-10-10&segment=agents&include_ours=1&interval=week"), today);
    expect(view).toEqual({ tab: "quality", preset: "custom", from: "2026-10-01", to: "2026-10-10", segment: "agents", ours: true, interval: "week" });
    expect(readFilters(new URLSearchParams(filtersQuery(view)), today)).toEqual(view);
    expect(readFilters(new URLSearchParams("range=7&tab=nope&segment=robots"), today)).toMatchObject({ tab: "overview", preset: "7", from: "2026-10-15", segment: "all" });
    expect(readFilters(new URLSearchParams("range=custom&from=2026-10-01"), today).preset).toBe("30"); // half a custom range falls back
  });

  it("renders the overview: callouts, cards, the dates chart with its table, and the funnel", async () => {
    await character("oc", "person-o", "2026-10-15");
    await date("person-o", "oc", HOUSE_A, "2026-10-16", { ending: "second_date" });
    const data = await loadInsights(t.db, WEEK, NOW);
    const html = renderToStaticMarkup(createElement(OverviewTab, { data, interval: "day" }));
    expect(html).toContain("What stands out");
    expect(html).toContain("Dates started, by ending");
    expect(html).toContain('role="img"');
    expect(html).toContain("Show the numbers");
    expect(html).toContain("The people funnel");
    expect(html).toContain("7-day average");
    expect(html).toContain("previous 7 days");
    expect(html).toContain("too few to say");
  });

  it("a chart says what it shows in words, lists every value in its table, and shows a note when there's nothing", () => {
    const html = renderToStaticMarkup(
      createElement(TimeChart, {
        title: "Dates",
        summary: "3 dates in these 2 days.",
        labels: ["2026-10-20", "2026-10-21"],
        bars: [{ key: "n", label: "dates", color: "var(--viz-1)", values: [1, 2] }],
        lines: [{ key: "avg", label: "7-day average", color: "var(--ink)", values: [1, 1.5], kind: "average" }],
      }),
    );
    expect(html).toContain('aria-label="Dates. 3 dates in these 2 days."');
    expect(html).toContain("<td class=\"num\">1.5</td>");
    expect(html).toContain("Oct 21");
    const empty = renderToStaticMarkup(createElement(TimeChart, { title: "Runs", summary: "None.", labels: ["2026-10-21"], lines: [{ key: "x", label: "x", color: "red", values: [null] }], empty: "No runs yet." }));
    expect(empty).toContain("No runs yet.");
    expect(empty).not.toContain("<svg");
  });
});

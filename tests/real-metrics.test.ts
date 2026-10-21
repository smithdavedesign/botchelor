// Real use on /admin/analytics (lib/real-metrics.ts): real people's and agents' numbers, our own traffic left out, and the
// simulated visitors' ratings posted by the loop (POST /api/admin/sim-ratings, scripts/loop/post-ratings.mjs).
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getRealMetrics } from "@/app/api/admin/real-metrics/route";
import { GET as getSimRatings, POST as postSimRating } from "@/app/api/admin/sim-ratings/route";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { MIN_N, percentile, realMetrics, realUse, returnRate, tooSmall, type Metric } from "@/lib/real-metrics";
import { parseReport, runRatings } from "../scripts/loop/post-ratings.mjs";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from admins");
  await t.db.query("delete from couple_texts");
  await t.db.query("delete from swipes");
  await t.db.query("delete from arc_predictions");
  await t.db.query("delete from couple_follows");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const NOW = new Date("2026-10-21T12:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const HOUSE_A = HOUSE_CHARACTERS[0].id;
const HOUSE_B = HOUSE_CHARACTERS[1].id;

async function character(id: string, owner: string, daysAgo: number, via: "web" | "mcp" = "web") {
  await t.db.query(
    `insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker, created_via, created_at)
     values ($1, $2, $3, 30, 'A bio.', '[]'::jsonb, 'Love.', 'Rudeness.', $4, $5)`,
    [id, owner, `Name ${id}`, via, ago(daysAgo)],
  );
}
let episodes = 0;
async function episode(
  creator: string,
  a: string,
  b: string,
  daysAgo: number,
  o: { via?: "web" | "mcp"; performedBy?: "platform" | "agent"; partner?: string; followupOf?: string; airedDaysAgo?: number } = {},
): Promise<string> {
  const id = `ep${++episodes}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, created_via,
                           performed_by, partner_performer, followup_of, revealed_at, created_at)
     values ($1, $2, $3, $4, 'A bar.', '[]'::jsonb, '[]'::jsonb, 'Twist.', 'Finale.', 'friends', $5, $6, $7, $8, $9, $10)`,
    [id, creator, a, b, o.via ?? "web", o.performedBy ?? "platform", o.partner ?? null, o.followupOf ?? null, o.airedDaysAgo === undefined ? null : ago(o.airedDaysAgo), ago(daysAgo)],
  );
  return id;
}
async function session(agentId: string, client: string, userAgent = `${client}/1.0`) {
  await t.db.query(`insert into mcp_sessions (id, agent_id, client_name, user_agent, created_at, last_seen) values ($1, $2, $3, $4, $5, $5)`, [
    `s-${agentId}-${client}`,
    agentId,
    client,
    userAgent,
    ago(3),
  ]);
}
async function order(user: string, session: string, cents: number, status = "paid", daysAgo = 1) {
  await t.db.query(
    `insert into orders (id, user_id, sku, kind, amount_cents, currency, status, stripe_session_id, paid_at)
     values ($1, $2, 'pack-5', 'episode_pack', $3, 'usd', $4, $5, $6)`,
    [`o-${session}`, user, cents, status, session, status === "pending" ? null : ago(daysAgo)],
  );
}
const value = (m: Metric) => (m.kind === "count" ? m.value : m.kind === "usd" ? m.cents : m);

describe("real use: who's left out", () => {
  it("leaves out admins, agents linked to them, house-run bots, the crowd, our checks and the deleted owner, and what they made", async () => {
    // Real: one person and one agent.
    await character("p1c", "person-1", 2);
    await episode("person-1", "p1c", HOUSE_A, 2);
    await session("agent-real", "claude-code", "claude-code/2.0");
    await character("rac", "agent-real", 2, "mcp");
    await episode("agent-real", "rac", HOUSE_B, 1, { via: "mcp" });

    // Ours: an admin (and the agent linked to their account), a house-run bot, the crowd, a live check, a deleted account.
    await claimAdmin(t.db, "admin-1");
    await character("adc", "admin-1", 2);
    await episode("admin-1", "adc", HOUSE_A, 2);
    await order("admin-1", "cs_live_admin", 499);
    await session("agent-linked", "claude-code");
    await t.db.query(`insert into agent_links (agent_id, user_id) values ('agent-linked', 'admin-1')`);
    await character("alc", "agent-linked", 2, "mcp");
    await session("agent-house", "botchelor-loop-swipe-back");
    await character("hbc", "agent-house", 2, "mcp");
    await episode("agent-house", "hbc", HOUSE_A, 1, { via: "mcp" });
    await session("agent-crowd", "botchelor-loop-crowd-lanternfish");
    await character("crc", "agent-crowd", 2, "mcp");
    await session("agent-check", "smoke-test", "botchelor-live-check/1.0 (Claude)");
    await character("chc", "agent-check", 2, "mcp");
    await t.db.query(`insert into mcp_calls (agent_id, method, tool, ok, client_name, created_at) values ('agent-check', 'tools/call', 'create_character', true, 'smoke-test', $1)`, [ago(2)]);
    await character("dlc", "deleted", 2);
    await episode("gone-person", "dlc", HOUSE_B, 2); // a deleted account's date: its own character is the deleted owner's
    await episode("system", HOUSE_A, HOUSE_B, 1); // the show's own always-on watch-party date
    await session("agent-gone", "claude-code"); // an agent whose characters were removed: its date is the deleted owner's too
    await character("dmc", "deleted", 2, "mcp");
    await episode("agent-gone", "dmc", HOUSE_B, 2, { via: "mcp" });

    const w = await realMetrics(t.db, 7, NOW);
    expect(value(w.people.new_creators)).toBe(1);
    expect(value(w.people.active)).toBe(1);
    expect(value(w.agents.new_players)).toBe(1);
    expect(value(w.agents.active)).toBe(1);
    expect(value(w.dates.booked)).toBe(2);
    expect(value(w.money.orders)).toBe(0);
    expect(w.ours_left_out).toBeGreaterThanOrEqual(5); // the admin, the linked agent, the house bot, the crowd, the check
  });
});

describe("real use: the maths", () => {
  it("return rate: only members old enough count, and only activity in the window after their first day", () => {
    const cohort = new Map([
      ["a", 100],
      ["b", 100],
      ["c", 105],
      ["d", 106], // joined today: not yet eligible for next-day return
    ]);
    const active = new Map([
      ["a", new Set([100, 101])], // back the next day
      ["b", new Set([100, 108])], // back, but 8 days later: outside the week
      ["c", new Set([106])],
      ["d", new Set([106])],
    ]);
    expect(returnRate(cohort, active, 106, { from: 1, to: 7, minAge: 1 })).toEqual({ num: 2, den: 3 });
    // Week 2 (days 7 to 13), counted once the member is 14 days in.
    expect(returnRate(cohort, active, 114, { from: 7, to: 13, minAge: 14 })).toEqual({ num: 1, den: 2 }); // b on day 108
    expect(returnRate(new Map(), active, 106, { from: 1, to: 7, minAge: 1 })).toEqual({ num: 0, den: 0 });
  });

  it("percentiles interpolate, and small samples are flagged", () => {
    expect(percentile([0, 1, 2, 3, 10], 0.5)).toBe(2);
    expect(percentile([0, 1, 2, 3, 10], 0.75)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(percentile([], 0.5)).toBeNull();
    expect(tooSmall({ kind: "share", num: 1, den: MIN_N - 1 })).toBe(true);
    expect(tooSmall({ kind: "share", num: 1, den: MIN_N })).toBe(false);
    expect(tooSmall({ kind: "quantiles", median: 1, p75: 2, n: 2 })).toBe(true);
    expect(tooSmall({ kind: "count", value: 1 })).toBe(false);
  });

  it("next-day and week-2 return for people, from the database", async () => {
    // Next day (7-day window): back the day after, never back, joined today.
    await character("retc", "returner", 3);
    await t.db.query(`insert into swipes (swiper, target, liked, created_at) values ('retc', $1, true, $2)`, [HOUSE_A, ago(2)]);
    await character("onec", "one-timer", 3);
    await character("newc", "newcomer", 0.1);
    let w = await realMetrics(t.db, 7, NOW);
    expect(w.people.next_day_return).toEqual({ kind: "share", num: 1, den: 2 });
    expect(w.people.week2_return.kind).toBe("na"); // the 30-day window's

    // Week 2 (30-day window): back in their second week, back only in their first, too new to tell.
    await character("w2c", "week-two", 20);
    await episode("week-two", "w2c", HOUSE_A, 10); // day 10 after their first
    await character("w1c", "week-one", 20);
    await episode("week-one", "w1c", HOUSE_A, 17); // day 3
    await character("tnc", "too-new", 10);
    await episode("too-new", "tnc", HOUSE_A, 2); // day 8, but not 14 days in yet
    w = await realMetrics(t.db, 30, NOW);
    expect(w.people.week2_return).toEqual({ kind: "share", num: 1, den: 2 });
    expect(value(w.people.new_creators)).toBe(6);
  });

  it("second-date rate: aired first dates whose couple booked the follow-up", async () => {
    await character("sdc", "person-sd", 9);
    const followed = await episode("person-sd", "sdc", HOUSE_A, 6, { airedDaysAgo: 5 });
    await episode("person-sd", "sdc", HOUSE_A, 3, { followupOf: followed, airedDaysAgo: 2 }); // the second date (not a first)
    await episode("person-sd", "sdc", HOUSE_B, 6, { airedDaysAgo: 5 });
    await episode("person-sd", "sdc", HOUSE_B, 4, { airedDaysAgo: 4 });
    await episode("person-sd", "sdc", HOUSE_A, 1); // not aired: doesn't count
    await claimAdmin(t.db, "admin-sd");
    await character("asc", "admin-sd", 9);
    const adminFirst = await episode("admin-sd", "asc", HOUSE_A, 6, { airedDaysAgo: 5 });
    await episode("admin-sd", "asc", HOUSE_A, 3, { followupOf: adminFirst }); // ours: out of both sides
    const w = await realMetrics(t.db, 7, NOW);
    expect(w.dates.second_date_rate).toEqual({ kind: "share", num: 1, den: 3 });
  });

  it("dates by performer, dates per active agent and per active person", async () => {
    await session("agent-x", "claude-code");
    await session("agent-y", "cursor");
    await character("xc1", "agent-x", 5, "mcp");
    await character("xc2", "agent-x", 5, "mcp");
    await character("yc", "agent-y", 5, "mcp");
    await episode("agent-x", "xc1", HOUSE_A, 3, { via: "mcp" });
    await episode("agent-x", "xc1", HOUSE_B, 3, { via: "mcp" });
    await episode("agent-x", "xc1", "xc2", 2, { via: "mcp", performedBy: "agent" }); // own-date
    await episode("agent-x", "xc2", "yc", 1, { via: "mcp", performedBy: "agent", partner: "agent-y" }); // two-agent
    await character("pc", "person-d", 5);
    await episode("person-d", "pc", HOUSE_A, 1);
    const w = await realMetrics(t.db, 7, NOW);
    expect([w.dates.booked, w.dates.show_model, w.dates.own_date, w.dates.two_agent].map(value)).toEqual([5, 3, 1, 1]);
    expect(w.agents.dates_per_agent).toEqual({ kind: "quantiles", median: 2.5, p75: 3.25, n: 2 }); // x: 4, y: 1
    expect(w.dates.per_active_person).toEqual({ kind: "per", num: 1, den: 1 });
    expect(w.agents.multi_day).toEqual({ kind: "share", num: 2, den: 2 }); // x on days 5, 3, 2, 1; y on 5 and 1
  });
});

describe("real use: money", () => {
  it("counts live paid orders only: no test mode, no admin buyers, nothing pending or refunded", async () => {
    await character("b1c", "buyer-1", 3);
    await character("b2c", "buyer-2", 3);
    await order("buyer-1", "cs_live_one", 499);
    await order("buyer-1", "cs_live_two", 999);
    await order("buyer-2", "cs_live_three", 1999);
    await order("tester", "cs_test_four", 499); // test mode: our own check
    await claimAdmin(t.db, "admin-m");
    await order("admin-m", "cs_live_five", 499); // an admin buying
    await order("buyer-3", "cs_live_six", 499, "pending");
    await order("buyer-4", "cs_live_seven", 499, "refunded");
    await order("buyer-5", "cs_live_eight", 499, "paid", 20); // outside the 7 days
    const w = await realMetrics(t.db, 7, NOW);
    expect(value(w.money.orders)).toBe(3);
    expect(value(w.money.revenue)).toBe(3497);
    expect(value(w.money.buyers)).toBe(2);
    expect(w.money.conversion).toEqual({ kind: "share", num: 2, den: 2 });
    expect(tooSmall(w.money.conversion)).toBe(true);
    expect(value((await realMetrics(t.db, 30, NOW)).money.orders)).toBe(4);
  });
});

describe("real use: engagement", () => {
  it("predictions, the audience who predict, reviews and owners' texts", async () => {
    await character("ec", "person-e", 3);
    const ep = await episode("person-e", "ec", HOUSE_A, 3);
    await t.db.query(`insert into predictions (episode_id, user_id, pick, created_at) values ($1, 'person-e', 'friends', $2), ($1, 'watcher-p', 'disaster', $2)`, [ep, ago(2)]);
    await t.db.query(
      `insert into arc_predictions (user_id, character_lo, character_hi, target, pick, created_at, deadline) values ('watcher-p', $1, $2, 2, true, $3, $3)`,
      [HOUSE_A, HOUSE_B, ago(2)],
    );
    await t.db.query(`insert into couple_follows (user_id, character_lo, character_hi, created_at) values ('follower', $1, $2, $3)`, [HOUSE_A, HOUSE_B, ago(1)]);
    await claimAdmin(t.db, "admin-e");
    await t.db.query(`insert into predictions (episode_id, user_id, pick, created_at) values ($1, 'admin-e', 'friends', $2)`, [ep, ago(2)]);
    await t.db.query(`insert into character_reviews (reviewer_id, character_id, stars, created_at) values ('person-e', $1, 4, $3), ('admin-e', $2, 5, $3)`, [HOUSE_A, HOUSE_B, ago(1)]);
    await session("agent-t", "claude-code");
    await character("tc", "agent-t", 3, "mcp");
    const lo = ["ec", "tc"].sort();
    await t.db.query(
      `insert into couple_texts (character_lo, character_hi, day, seq, who, text, via, created_at) values
         ($1, $2, $3::date, 1, $4, 'Hi.', 'own_key', $3), ($1, $2, $3::date, 2, $5, 'Hello.', 'agent', $3), ($1, $2, $3::date, 3, $4, 'Daily.', 'daily', $3)`,
      [lo[0], lo[1], ago(1), lo[0] === "ec" ? "lo" : "hi", lo[0] === "ec" ? "hi" : "lo"],
    );
    const w = await realMetrics(t.db, 7, NOW);
    expect(value(w.engagement.predictions)).toBe(3); // two ending predictions and an arc one; the admin's is out
    // The audience: person-e and watcher-p (predicted) and the follower; texting isn't an audience action.
    expect(w.engagement.audience_predicting).toEqual({ kind: "share", num: 2, den: 3 });
    expect(value(w.engagement.reviews)).toBe(1);
    expect(value(w.engagement.texts_people)).toBe(1); // the person's own key; the daily one is the show's
    expect(value(w.engagement.texts_agents)).toBe(1);
  });
});

describe("simulated visitors' ratings", () => {
  const PASSWORD = ["sim", "ratings", "pass"].join("-");
  const post = (body: unknown, headers: Record<string, string> = { "x-frontier-key": PASSWORD }) =>
    postSimRating(new Request(`${BASE_URL}/api/admin/sim-ratings`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const run = (n: number, overall: number | null = 8) => ({
    run: `2026-10-${String(n).padStart(2, "0")}-0610`,
    sha: "abc1234",
    at: new Date(Date.UTC(2026, 9, n, 13)).toISOString(),
    overall_avg: overall,
    mcp_avg: 8.25,
    visitors: 2,
  });

  it("needs the admin password or an admin account, then inserts, replaces and lists", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", PASSWORD);
    vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
    expect((await post(run(1), {})).status).toBe(403);
    expect((await post(run(1), { "x-frontier-key": "wrong" })).status).toBe(403);
    expect((await getSimRatings(new Request(`${BASE_URL}/api/admin/sim-ratings`))).status).toBe(403);
    expect((await getRealMetrics(new Request(`${BASE_URL}/api/admin/real-metrics`))).status).toBe(403);
    expect(await t.count("sim_ratings")).toBe(0);

    expect((await post(run(1, 7.5))).status).toBe(201);
    expect((await post(run(1, 8))).status).toBe(201); // the same run again replaces it
    expect((await post({ ...run(2), overall_avg: 11 })).status).toBe(422);
    // A signed-in admin account works too.
    const adminId = randomUUID();
    await claimAdmin(t.db, adminId);
    expect((await post(run(2), { cookie: signedInCookie(adminId) })).status).toBe(201);
    expect((await post(run(3), { cookie: signedInCookie(randomUUID()) })).status).toBe(403);

    const list = await (await getSimRatings(new Request(`${BASE_URL}/api/admin/sim-ratings`, { headers: { "x-frontier-key": PASSWORD } }))).json();
    expect(list.ratings.map((r: { run: string }) => r.run)).toEqual([run(2).run, run(1).run]); // newest first
    expect(list.ratings[1]).toMatchObject({ overall_avg: 8, mcp_avg: 8.25, visitors: 2, sha: "abc1234" });

    // The page shows the last 10, next to the real numbers.
    for (let n = 3; n <= 13; n++) await post(run(n));
    const page = await getRealMetrics(new Request(`${BASE_URL}/api/admin/real-metrics`, { headers: { "x-frontier-key": PASSWORD } }));
    expect(page.status).toBe(200);
    const body = await page.json();
    expect(body.sims).toHaveLength(10);
    expect(body.sims[0].run).toBe(run(13).run);
    expect(body.windows.map((w: { days: number }) => w.days)).toEqual([7, 30]);
    expect(body.defs.length).toBeGreaterThan(20);
    const direct = await realUse(t.db, NOW);
    expect(direct.min_n).toBe(MIN_N);
  });

  it("post-ratings.mjs reads each visitor's two ratings, however the heading is written", () => {
    expect(parseReport("## 7. Rating: 8/10\nWhy.\n\n## 8. MCP experience: 8.5/10\n")).toEqual({ overall: 8, mcp: 8.5 });
    expect(parseReport("**7. Rating: 7/10**\n\n**8. MCP experience rating: 9/10**")).toEqual({ overall: 7, mcp: 9 });
    expect(parseReport("### 7. Rating\n\n**8/10.** Good.\n\n### 8. MCP experience\n\n**6/10.**")).toEqual({ overall: 8, mcp: 6 });
    // An older report: no MCP section, and "8. Suggestions" isn't one even with a score in it.
    expect(parseReport("## 7. Rating: 7/10\n\n## 8. Suggestions\n- send_feedback (8/10)")).toEqual({ overall: 7, mcp: null });
    // A heading with no score doesn't borrow the next section's.
    expect(parseReport("## 7. Rating\n## 8. MCP experience: 9/10")).toEqual({ overall: null, mcp: 9 });

    const dir = mkdtempSync(join(tmpdir(), "loop-run-"));
    try {
      writeFileSync(join(dir, "summary.json"), JSON.stringify({ sha: "def5678", started_at: "2026-10-21T13:10:03.235Z", finished_at: "2026-10-21T13:48:49.145Z" }));
      writeFileSync(join(dir, "visitor-1.md"), "## 7. Rating: 8/10\n## 8. MCP experience: 8/10\n");
      writeFileSync(join(dir, "visitor-2.md"), "## 7. Rating: 9/10\n## 8. MCP experience: 8.5/10\n");
      writeFileSync(join(dir, "visitor-2-early-1.md"), "## 7. Rating: 1/10\n"); // an early draft, replaced: not counted
      expect(runRatings(dir)).toMatchObject({ sha: "def5678", at: "2026-10-21T13:48:49.145Z", overall_avg: 8.5, mcp_avg: 8.25, visitors: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

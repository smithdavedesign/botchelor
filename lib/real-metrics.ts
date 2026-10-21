/**
 * Real use (David, 2026-10-21): the product is judged by the simulated visitor loop (it stays, as a regression check)
 * AND by what real people and real agents do. This is the second half: the "Real use" section of /admin/analytics,
 * for the last 7 and the last 30 days side by side, computed from the database alone.
 *
 * Our own traffic is left out everywhere, and so is everything it made:
 *  - admin accounts (lib/admins.ts) and any agent linked to one (agent_links);
 *  - the loop's house-run bots and its arena crowd (lib/house-bots.ts: clients named "botchelor-loop-…");
 *  - every agent that ever connected as one of our own checks (lib/agent-analytics.ts OUR_TRAFFIC / isOurs);
 *  - the "deleted" owner (a deleted account's kept characters, lib/account.ts), and dates whose own character is one;
 *  - the show itself: "system" books the always-on watch-party dates (lib/watch.ts SYSTEM_CREATOR_ID).
 * A character or a date made by any of those is theirs, so it's out too.
 *
 * Who is who: an identity is an agent when it has played over MCP (an MCP session, a logged call, or something it
 * made with created_via 'mcp'); everyone else is a person (the anonymous bz_uid a browser keeps). Days are UTC days.
 *
 * Rates over fewer than MIN_N people or agents are marked "n too small" by the page rather than shown as if they meant
 * something. The definitions below are what the page prints next to each number.
 */
import type { Db } from "./db";
import { OUR_TRAFFIC, WRITE_TOOLS } from "./agent-analytics";
import { HOUSE_BOT_CLIENT_PREFIX } from "./house-bots";
import { DELETED_OWNER } from "./rules";
import { SYSTEM_CREATOR_ID } from "./watch";

/** Below this many people or agents, a rate or a median is "n too small". */
export const MIN_N = 5;
/** The windows the page shows side by side. */
export const WINDOWS = [7, 30] as const;

const DAY_MS = 86_400_000;
/** A UTC day as a number (days since 1970-01-01). */
export const dayIndex = (d: Date | string): number => Math.floor(new Date(d).getTime() / DAY_MS);

export type Metric =
  | { kind: "count"; value: number }
  /** num of den, shown as a percentage. */
  | { kind: "share"; num: number; den: number }
  /** num per den, shown as a ratio (dates per active person). */
  | { kind: "per"; num: number; den: number }
  | { kind: "usd"; cents: number }
  | { kind: "quantiles"; median: number | null; p75: number | null; n: number }
  | { kind: "na"; why: string };

/** Whether a metric rests on fewer than MIN_N people or agents. */
export function tooSmall(m: Metric): boolean {
  if (m.kind === "share" || m.kind === "per") return m.den < MIN_N;
  if (m.kind === "quantiles") return m.n < MIN_N;
  return false;
}

/** The p-th percentile (0..1) of the values, linearly interpolated between the nearest ranks; null for none. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Return rate: of a cohort (identity → its first day), the share active again `from` to `to` days after its first day.
 * Only members at least `minAge` days old count (the rest haven't had the chance yet); days after today can't count.
 *  - next-day return: from 1, to 7, minAge 1: active on any later day within a week (a recent joiner can still return,
 *    so it's a floor until they're a week old);
 *  - week-2 return: from 7, to 13, minAge 14: active in their second week, counted only once that week is over.
 */
export function returnRate(
  cohort: Map<string, number>,
  activeDays: Map<string, Set<number>>,
  today: number,
  { from, to, minAge }: { from: number; to: number; minAge: number },
): { num: number; den: number } {
  let num = 0;
  let den = 0;
  for (const [id, first] of cohort) {
    if (today - first < minAge) continue;
    den++;
    const days = activeDays.get(id);
    if (!days) continue;
    const last = Math.min(first + to, today);
    for (let d = first + from; d <= last; d++) {
      if (days.has(d)) {
        num++;
        break;
      }
    }
  }
  return { num, den };
}

/** Something an identity did, and when. Kinds in ACTIVE make it active; kinds in AUDIENCE make it part of the audience. */
type Kind = "create" | "swipe" | "text" | "predict" | "review" | "buy" | "mcp_write" | "watch";
type Event = { id: string; at: Date; kind: Kind; via: "web" | "mcp" | null };
const ACTIVE: ReadonlySet<Kind> = new Set(["create", "swipe", "text", "predict", "review", "buy", "mcp_write"]);
const AUDIENCE: ReadonlySet<Kind> = new Set(["predict", "review", "watch"]);

type DateRow = { creator: string; partner: string | null; performed_by: string; at: Date };
type FirstDate = { creator: string; aired: Date; followed: boolean };
type OrderRow = { user: string; cents: number; at: Date };

/** Everything the windows are computed from, loaded once for the longest window. */
export type Facts = {
  now: Date;
  ours: Set<string>;
  agents: Set<string>;
  events: Event[];
  dates: DateRow[];
  firstDates: FirstDate[];
  orders: OrderRow[];
  /** A person's first character made on the web, ever. */
  firstCreator: Map<string, Date>;
  /** An agent's first write, ever: a write tool that worked, a character it made, a date it booked or played. */
  firstAgentWrite: Map<string, Date>;
};

/** SQL: true when a Stripe session id is a live-mode one (test-mode sessions are cs_test_…: our own checks). */
const LIVE_SESSION = `left(coalesce(stripe_session_id, ''), 8) = 'cs_live_'`;

export async function loadFacts(db: Db, sinceDays: number, now = new Date()): Promise<Facts> {
  const since = new Date(now.getTime() - sinceDays * DAY_MS).toISOString();
  const writes = [...WRITE_TOOLS];
  const ourClient = `(coalesce(client_name, '') ~* $1 or coalesce(user_agent, '') ~* $1 or coalesce(client_name, '') like '${HOUSE_BOT_CLIENT_PREFIX}%')`;

  const ours = new Set(
    (
      await db.query<{ id: string }>(
        `select user_id as id from admins
         union select l.agent_id from agent_links l join admins a on a.user_id = l.user_id
         union select agent_id from mcp_sessions where ${ourClient}
         union select agent_id from mcp_calls where agent_id is not null and ${ourClient}
         union select $2::text
         union select $3::text`,
        [OUR_TRAFFIC.source, DELETED_OWNER, SYSTEM_CREATOR_ID],
      )
    ).rows.map((r) => r.id),
  );

  // A date is out when its own character (character_a) now belongs to the deleted owner: a deleted account's date.
  const notDeleted = `coalesce((select ca.owner_id from characters ca where ca.id = e.character_a), '') <> '${DELETED_OWNER}'`;
  const events = (
    await db.query<{ id: string; at: Date | string; kind: Kind; via: "web" | "mcp" | null }>(
      `select c.owner_id as id, c.created_at as at, 'create' as kind, c.created_via as via
         from characters c where not c.is_house and c.owner_id is not null and c.created_at >= $1
       union all
       select c.owner_id, s.created_at, 'swipe', c.created_via
         from swipes s join characters c on c.id = s.swiper where not c.is_house and c.owner_id is not null and s.created_at >= $1
       union all
       select c.owner_id, t.created_at, 'text', case when t.via = 'agent' then 'mcp' else 'web' end
         from couple_texts t join characters c on c.id = case when t.who = 'lo' then t.character_lo else t.character_hi end
        where t.via in ('agent', 'own_key') and not c.is_house and c.owner_id is not null and t.created_at >= $1
       union all
       select user_id, created_at, 'predict', null from predictions where created_at >= $1
       union all
       select user_id, created_at, 'predict', null from arc_predictions where created_at >= $1
       union all
       select reviewer_id, created_at, 'review', via from character_reviews where created_at >= $1
       union all
       select user_id, paid_at, 'buy', 'web' from orders where status = 'paid' and ${LIVE_SESSION} and paid_at >= $1
       union all
       select agent_id, created_at, 'mcp_write', 'mcp' from mcp_calls where ok and tool = any($2) and agent_id is not null and created_at >= $1
       union all
       select user_id, last_seen, 'watch', null from watch_presence where last_seen >= $1
       union all
       select user_id, created_at, 'watch', null from watch_messages where created_at >= $1
       union all
       select user_id, created_at, 'watch', null from watch_reactions where created_at >= $1
       union all
       select user_id, updated_at, 'watch', null from watch_poll_votes where updated_at >= $1
       union all
       select user_id, created_at, 'watch', null from couple_follows where created_at >= $1
       union all
       select rater_id, created_at, 'watch', null from character_ratings where created_at >= $1`,
      [since, writes],
    )
  ).rows.map((r) => ({ ...r, at: new Date(r.at) }));

  const dates = (
    await db.query<{ creator: string; partner: string | null; performed_by: string; via: string; at: Date | string }>(
      `select e.creator_id as creator, e.partner_performer as partner, e.performed_by, e.created_via as via, e.created_at as at
         from episodes e where e.created_at >= $1 and ${notDeleted}`,
      [since],
    )
  ).rows;

  const firstDates = (
    await db.query<{ creator: string; aired: Date | string; followed: boolean }>(
      `select e.creator_id as creator, e.revealed_at as aired,
              exists (select 1 from episodes f where f.followup_of = e.id) as followed
         from episodes e
        where e.followup_of is null and e.revealed_at is not null and e.revealed_at >= $1 and ${notDeleted}`,
      [since],
    )
  ).rows.map((r) => ({ ...r, aired: new Date(r.aired) }));

  const orders = (
    await db.query<{ user: string; cents: number; at: Date | string }>(
      `select user_id as "user", amount_cents as cents, paid_at as at
         from orders where status = 'paid' and ${LIVE_SESSION} and paid_at >= $1`,
      [since],
    )
  ).rows.map((r) => ({ ...r, at: new Date(r.at) }));

  const firstCreator = new Map(
    (
      await db.query<{ id: string; first: Date | string }>(
        `select owner_id as id, min(created_at) as first from characters
          where not is_house and created_via = 'web' and owner_id is not null
          group by owner_id having min(created_at) >= $1`,
        [since],
      )
    ).rows.map((r) => [r.id, new Date(r.first)]),
  );

  const firstAgentWrite = new Map(
    (
      await db.query<{ id: string; first: Date | string }>(
        `select id, min(at) as first from (
           select agent_id as id, created_at as at from mcp_calls where ok and tool = any($2) and agent_id is not null
           union all select owner_id, created_at from characters where created_via = 'mcp' and not is_house and owner_id is not null
           union all select e.creator_id, e.created_at from episodes e where e.created_via = 'mcp' and ${notDeleted}
           union all select e.partner_performer, e.created_at from episodes e where e.partner_performer is not null and ${notDeleted}
         ) w group by id having min(at) >= $1`,
        [since, writes],
      )
    ).rows.map((r) => [r.id, new Date(r.first)]),
  );

  // Who's an agent: anyone seen over MCP, or anything they made says so.
  const agents = new Set<string>([
    ...events.filter((e) => e.via === "mcp").map((e) => e.id),
    ...dates.filter((d) => d.via === "mcp").map((d) => d.creator),
    ...dates.flatMap((d) => (d.partner ? [d.partner] : [])),
    ...firstAgentWrite.keys(),
  ]);
  const unknown = [...new Set([...events.map((e) => e.id), ...dates.map((d) => d.creator)])].filter((id) => !agents.has(id));
  if (unknown.length) {
    const seen = await db.query<{ id: string }>(
      `select agent_id as id from mcp_sessions where agent_id = any($1)
       union select agent_id from mcp_calls where agent_id = any($1)`,
      [unknown],
    );
    for (const r of seen.rows) agents.add(r.id);
  }

  return {
    now,
    ours,
    agents,
    events,
    dates: dates.map(({ via: _via, ...d }) => ({ ...d, at: new Date(d.at) })),
    firstDates,
    orders,
    firstCreator,
    firstAgentWrite,
  };
}

export type RealWindow = {
  days: number;
  since: string;
  people: { new_creators: Metric; active: Metric; next_day_return: Metric; week2_return: Metric };
  agents: { new_players: Metric; active: Metric; multi_day: Metric; next_day_return: Metric; dates_per_agent: Metric };
  dates: { booked: Metric; show_model: Metric; own_date: Metric; two_agent: Metric; second_date_rate: Metric; per_active_person: Metric };
  money: { orders: Metric; revenue: Metric; buyers: Metric; conversion: Metric };
  engagement: { predictions: Metric; audience_predicting: Metric; reviews: Metric; texts_people: Metric; texts_agents: Metric };
  /** How many of our own identities did something in the window, and were left out. */
  ours_left_out: number;
};

const count = (value: number): Metric => ({ kind: "count", value });
const share = (num: number, den: number): Metric => ({ kind: "share", num, den });

/** One window's numbers, from the facts. */
export function computeWindow(f: Facts, days: number): RealWindow {
  const sinceDate = new Date(f.now.getTime() - days * DAY_MS);
  const today = dayIndex(f.now);
  const inWindow = (d: Date) => d >= sinceDate && d <= f.now;
  const real = (id: string | null | undefined): id is string => Boolean(id) && !f.ours.has(id!);
  const isAgent = (id: string) => f.agents.has(id);

  const events = f.events.filter((e) => inWindow(e.at));
  const dates = f.dates.filter((d) => inWindow(d.at) && real(d.creator));

  // Active: did anything (events, plus booking or playing a date). Per identity, the UTC days it was active.
  const activeDays = new Map<string, Set<number>>();
  const mark = (id: string, at: Date) => {
    const s = activeDays.get(id) ?? new Set<number>();
    s.add(dayIndex(at));
    activeDays.set(id, s);
  };
  for (const e of events) if (ACTIVE.has(e.kind) && real(e.id)) mark(e.id, e.at);
  for (const d of f.dates) {
    if (!inWindow(d.at)) continue;
    if (real(d.creator)) mark(d.creator, d.at);
    if (real(d.partner)) mark(d.partner, d.at);
  }
  const activeIds = [...activeDays.keys()];
  const activePeople = activeIds.filter((id) => !isAgent(id));
  const activeAgents = activeIds.filter(isAgent);

  // People.
  const newCreators = new Map<string, number>();
  for (const [id, first] of f.firstCreator) if (inWindow(first) && real(id) && !isAgent(id)) newCreators.set(id, dayIndex(first));
  const nextDay = returnRate(newCreators, activeDays, today, { from: 1, to: 7, minAge: 1 });
  const week2 = returnRate(newCreators, activeDays, today, { from: 7, to: 13, minAge: 14 });

  // Agents.
  const newAgents = new Map<string, number>();
  for (const [id, first] of f.firstAgentWrite) if (inWindow(first) && real(id) && isAgent(id)) newAgents.set(id, dayIndex(first));
  const agentNextDay = returnRate(newAgents, activeDays, today, { from: 1, to: 7, minAge: 1 });
  const datesOf = new Map<string, number>(activeAgents.map((id) => [id, 0]));
  for (const d of f.dates) {
    if (!inWindow(d.at)) continue;
    for (const id of new Set([d.creator, d.partner])) if (id && datesOf.has(id)) datesOf.set(id, datesOf.get(id)! + 1);
  }
  const perAgent = [...datesOf.values()];

  // Dates.
  const ownDates = dates.filter((d) => d.performed_by === "agent" && !d.partner).length;
  const twoAgent = dates.filter((d) => d.performed_by === "agent" && d.partner).length;
  const firsts = f.firstDates.filter((d) => inWindow(d.aired) && real(d.creator));
  const byPeople = dates.filter((d) => !isAgent(d.creator)).length;

  // Money.
  const orders = f.orders.filter((o) => inWindow(o.at) && real(o.user));
  const buyers = new Set(orders.map((o) => o.user)).size;

  // Engagement.
  const realEvents = events.filter((e) => real(e.id));
  const audience = new Set(realEvents.filter((e) => AUDIENCE.has(e.kind)).map((e) => e.id));
  const predictors = new Set(realEvents.filter((e) => e.kind === "predict").map((e) => e.id));

  const oursSeen = new Set([
    ...events.filter((e) => f.ours.has(e.id)).map((e) => e.id),
    ...f.dates.filter((d) => inWindow(d.at) && f.ours.has(d.creator)).map((d) => d.creator),
  ]);

  return {
    days,
    since: sinceDate.toISOString(),
    people: {
      new_creators: count(newCreators.size),
      active: count(activePeople.length),
      next_day_return: share(nextDay.num, nextDay.den),
      week2_return: days >= 14 ? share(week2.num, week2.den) : { kind: "na", why: "30-day window only" },
    },
    agents: {
      new_players: count(newAgents.size),
      active: count(activeAgents.length),
      multi_day: share(activeAgents.filter((id) => activeDays.get(id)!.size >= 2).length, activeAgents.length),
      next_day_return: share(agentNextDay.num, agentNextDay.den),
      dates_per_agent: { kind: "quantiles", median: percentile(perAgent, 0.5), p75: percentile(perAgent, 0.75), n: perAgent.length },
    },
    dates: {
      booked: count(dates.length),
      show_model: count(dates.length - ownDates - twoAgent),
      own_date: count(ownDates),
      two_agent: count(twoAgent),
      second_date_rate: share(firsts.filter((d) => d.followed).length, firsts.length),
      per_active_person: { kind: "per", num: byPeople, den: activePeople.length },
    },
    money: {
      orders: count(orders.length),
      revenue: { kind: "usd", cents: orders.reduce((s, o) => s + o.cents, 0) },
      buyers: count(buyers),
      conversion: share(buyers, activePeople.length),
    },
    engagement: {
      predictions: count(realEvents.filter((e) => e.kind === "predict").length),
      audience_predicting: share(predictors.size, audience.size),
      reviews: count(realEvents.filter((e) => e.kind === "review").length),
      texts_people: count(realEvents.filter((e) => e.kind === "text" && e.via === "web").length),
      texts_agents: count(realEvents.filter((e) => e.kind === "text" && e.via === "mcp").length),
    },
    ours_left_out: oursSeen.size,
  };
}

/** One window, loaded and computed (tests, and a single-window caller). */
export async function realMetrics(db: Db, days: number, now = new Date()): Promise<RealWindow> {
  return computeWindow(await loadFacts(db, days, now), days);
}

/** A simulated-visitor run's averages, posted by scripts/loop/post-ratings.mjs (POST /api/admin/sim-ratings). */
export type SimRating = { run: string; sha: string | null; at: string; overall_avg: number | null; mcp_avg: number | null; visitors: number };

export async function listSimRatings(db: Db, limit = 10): Promise<SimRating[]> {
  const { rows } = await db.query<{ run: string; sha: string | null; at: Date | string; overall_avg: number | null; mcp_avg: number | null; visitors: number }>(
    `select run, sha, at, overall_avg, mcp_avg, visitors from sim_ratings order by at desc, run desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({ ...r, at: new Date(r.at).toISOString() }));
}

/** Records a run's averages; posting the same run again replaces them. */
export async function saveSimRating(db: Db, r: SimRating): Promise<void> {
  await db.query(
    `insert into sim_ratings (run, sha, at, overall_avg, mcp_avg, visitors) values ($1, $2, $3, $4, $5, $6)
       on conflict (run) do update set sha = excluded.sha, at = excluded.at, overall_avg = excluded.overall_avg,
         mcp_avg = excluded.mcp_avg, visitors = excluded.visitors, posted_at = now()`,
    [r.run, r.sha, r.at, r.overall_avg, r.mcp_avg, r.visitors],
  );
}

/** What each row of the page means: its label, its one-line definition, and where its number lives in a RealWindow. */
export type MetricDef = { section: keyof Omit<RealWindow, "days" | "since" | "ours_left_out">; key: string; label: string; definition: string };

export const METRIC_DEFS: MetricDef[] = [
  { section: "people", key: "new_creators", label: "New creators", definition: "People whose first character made on the web was made in the window." },
  { section: "people", key: "active", label: "Active people", definition: "People (not agents) who did anything: made a character, booked a date, swiped, texted, predicted, reviewed or bought." },
  { section: "people", key: "next_day_return", label: "Next-day return", definition: "New creators, joined before today, active again on a later day within 7 days of their first. Rises as recent ones come back." },
  { section: "people", key: "week2_return", label: "Week-2 return", definition: "New creators at least 14 days in, active again 7 to 13 days after their first day." },
  { section: "agents", key: "new_players", label: "New agents (players)", definition: "Agents whose first write ever (a write tool that worked, a character, a date) came in the window." },
  { section: "agents", key: "active", label: "Active agents", definition: "Agents that wrote something in the window: a write tool that worked, a character, a date, a swipe, a text." },
  { section: "agents", key: "multi_day", label: "Active on 2+ days", definition: "Active agents that wrote something on two or more different days." },
  { section: "agents", key: "next_day_return", label: "Next-day return", definition: "New agents, started before today, writing again on a later day within 7 days of their first." },
  { section: "agents", key: "dates_per_agent", label: "Dates per active agent", definition: "Median and 75th percentile of dates each active agent booked or played its side of." },
  { section: "dates", key: "booked", label: "Dates booked", definition: "Dates booked by real people and agents." },
  { section: "dates", key: "show_model", label: "· show model", definition: "Performed by the show's model." },
  { section: "dates", key: "own_date", label: "· own-date", definition: "An agent performed both of its own characters." },
  { section: "dates", key: "two_agent", label: "· two-agent", definition: "Each side performed by its own agent." },
  { section: "dates", key: "second_date_rate", label: "Second-date rate", definition: "First dates that aired in the window whose couple has booked the second date (followup_of)." },
  { section: "dates", key: "per_active_person", label: "Dates per active person", definition: "Dates people (not agents) booked, divided by active people." },
  { section: "money", key: "orders", label: "Paid orders", definition: "Live Stripe orders (cs_live_ only, no test mode), paid in the window, no admin buyers." },
  { section: "money", key: "revenue", label: "Revenue", definition: "What those orders came to, in dollars, before Stripe's fee." },
  { section: "money", key: "buyers", label: "Buyers", definition: "Distinct people behind those orders." },
  { section: "money", key: "conversion", label: "Conversion", definition: "Buyers divided by active people." },
  { section: "engagement", key: "predictions", label: "Predictions", definition: "Ending and arc predictions made, by people and agents." },
  { section: "engagement", key: "audience_predicting", label: "Audience who predict", definition: "Of everyone with an audience action we store (predicted, reviewed, rated, followed a couple, joined a watch party), the share who predicted. Page views aren't in the database." },
  { section: "engagement", key: "reviews", label: "Reviews", definition: "Character reviews posted, by people and agents." },
  { section: "engagement", key: "texts_people", label: "Texts by people", definition: "Texts a person's own model key wrote for their character." },
  { section: "engagement", key: "texts_agents", label: "Texts by agents", definition: "Texts an agent wrote for its character (send_text)." },
];

export type RealUse = { generated_at: string; min_n: number; windows: RealWindow[]; defs: MetricDef[]; sims: SimRating[] };

/** The whole section: both windows from one load, the definitions, and the last 10 simulated runs. */
export async function realUse(db: Db, now = new Date()): Promise<RealUse> {
  const facts = await loadFacts(db, Math.max(...WINDOWS), now);
  return {
    generated_at: now.toISOString(),
    min_n: MIN_N,
    windows: WINDOWS.map((d) => computeWindow(facts, d)),
    defs: METRIC_DEFS,
    sims: await listSimRatings(db, 10),
  };
}

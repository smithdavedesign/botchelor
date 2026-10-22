/**
 * The insights overview on /admin/analytics (David, 2026-10-22: "make it really give us insights"): KPI cards with their
 * change against the previous period, the daily series behind the charts, the people funnel, weekly retention, the top
 * characters and venues, the quality runs, and plain-sentence callouts. One call (GET /api/admin/insights) for one date
 * range, segment and our-traffic choice.
 *
 * How it counts:
 *  - Days are UTC days, both ends included. The previous period is the same number of days just before.
 *  - Our own traffic is left out unless asked for: the identities lib/our-traffic.ts loadOurIds names (admins and agents
 *    linked to them, the loop's house-run bots and crowd, our checks, the deleted owner, the show's own "system" dates)
 *    and whatever they made. After Dark is admin-only, so its numbers are our own use and are never left out.
 *  - Segments are lenses, not slices: People and Agents split by who did it (on the web or over MCP); House is
 *    everything with a house character in it (a date with one, a swipe on one, their texts). All is everything.
 *  - Each additive measure comes back from one SQL statement as a small grid (measure × day × people × agents × house ×
 *    ours × key), so the segment and our-traffic choices are applied in one place (keep) and every card and chart agrees.
 *  - Small numbers say so: a count over fewer than MIN_EVENTS events across both periods, or a rate over fewer than MIN_N,
 *    is "too few to say", and a change only counts as real past two standard errors (a Poisson test for counts, a
 *    two-proportion test for rates).
 *  - Page views aren't in the database (GA4, Vercel Analytics and RepoHQ's beacon have them), so "first seen" is a
 *    person's first stored action, not their first visit.
 * Read-only. Nothing here touches money: no orders, no prices, no amounts (the owner's rule).
 */
import { addDays, dayDiff, daysBetween, isDay, isoDay, weekOf } from "./chart";
import type { Db } from "./db";
import { loadOurIds, OUR_TRAFFIC, SYSTEM_ID } from "./our-traffic";
import { keyMetrics, type KeyMetric, type QualityRun, type QualityRunKind } from "./quality-runs";
import { DELETED_OWNER, ENDINGS, type Ending } from "./rules";
import { DATE_VENUES, EXTRA_VENUES, placeParts, venueName } from "./venues";

export const SEGMENTS = ["all", "people", "agents", "house"] as const;
export type Segment = (typeof SEGMENTS)[number];

/** The range the page opens on. */
export const DEFAULT_RANGE_DAYS = 30;
/** The longest range: a year, like the MCP window (lib/agent-analytics.ts MCP_WINDOW_MAX_DAYS). */
export const MAX_RANGE_DAYS = 365;
/** Below this many people, dates or votes, a rate is "too few to say" (the same bar as Real use, lib/real-metrics.ts MIN_N). */
export const MIN_N = 5;
/** A change in a count needs at least this many events across both periods before it's read as anything. */
export const MIN_EVENTS = 10;
/** How many standard errors a change has to clear to be called real rather than noise. */
export const REAL_Z = 2;
/** A first date "led to a second date" when the follow-up was booked within this many days of it airing. */
export const SECOND_DATE_DAYS = 7;
/** Weeks after the first one that the retention table follows. */
export const RETENTION_WEEKS = 8;
/** Rows in the top characters table. */
export const TOP_CHARACTERS = 50;
/** How long a computed overview is reused for the same query (it's an admin page; Refresh skips it). */
export const CACHE_MS = 60_000;

export type InsightsQuery = { from: string; to: string; segment: Segment; includeOurs: boolean };

/** The query from a URL's parameters: from/to (YYYY-MM-DD, UTC), segment, include_ours. Bad or missing values fall back. */
export function parseInsightsQuery(params: URLSearchParams, now = new Date()): InsightsQuery {
  const today = isoDay(now);
  const toParam = params.get("to");
  const fromParam = params.get("from");
  let to = isDay(toParam) && toParam < today ? toParam : today;
  let from = isDay(fromParam) ? fromParam : addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (from > to) [from, to] = [to, from];
  if (dayDiff(from, to) + 1 > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  const asked = params.get("segment") ?? "";
  const segment = (SEGMENTS as readonly string[]).includes(asked) ? (asked as Segment) : "all";
  const includeOurs = ["1", "true", "yes"].includes((params.get("include_ours") ?? "").toLowerCase());
  return { from, to, segment, includeOurs };
}

/** The selected period and the one just before it, as lists of days. */
export function periodsOf(q: Pick<InsightsQuery, "from" | "to">): { days: number; current: string[]; previous: string[] } {
  const days = dayDiff(q.from, q.to) + 1;
  return { days, current: daysBetween(q.from, q.to), previous: daysBetween(addDays(q.from, -days), addDays(q.from, -1)) };
}

/** The instants a query reads: from the previous period's first day to the end of the selected one. */
type Window = { start: string; end: string; currentStart: string; firstDay: string; lastDay: string };

function windowOf(q: InsightsQuery): Window {
  const firstDay = addDays(q.from, -periodsOf(q).days);
  return { start: `${firstDay}T00:00:00.000Z`, end: `${addDays(q.to, 1)}T00:00:00.000Z`, currentStart: `${q.from}T00:00:00.000Z`, firstDay, lastDay: q.to };
}

/* ------------------------------------------------- the grids ------------------------------------------------- */

const MEASURES = ["characters", "dates", "aired", "first_dates", "texts", "swipes", "matches", "accounts", "sessions", "calls", "votes", "feedback", "people_feedback", "steps"] as const;
export type Measure = (typeof MEASURES)[number];

/** One day's count of one measure, for one combination of who did it, whether a house character was in it, and whether it was ours. */
export type Cell = { measure: Measure; day: string; people: boolean; agents: boolean; house: boolean; ours: boolean; key: string; n: number };

/** Whether a cell counts for this query. A measure that isn't split by segment (`segmented` false) only drops our traffic. */
export function keep(c: Pick<Cell, "people" | "agents" | "house" | "ours">, q: Pick<InsightsQuery, "segment" | "includeOurs">, segmented = true): boolean {
  if (c.ours && !q.includeOurs) return false;
  if (!segmented || q.segment === "all") return true;
  return c[q.segment];
}

/*
 * The SQL below inlines two fixed ids from code (the show's own and the deleted owner's: plain words, never input), so
 * no query passes a parameter it doesn't use (Postgres can't type an unused one). The grid's parameters: $1 the
 * previous period's first instant, $2 the instant after the selected period, $3 our identities, $4 our checks' client
 * and user-agent pattern, $5 and $6 the first and last day (couple_texts.day is indexed, so texts are pruned by day
 * before the exact instant check).
 */
const SYSTEM = `'${SYSTEM_ID}'`;
const DELETED = `'${DELETED_OWNER}'`;
const DAY = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD')`;
/** A date's lenses: booked on the web by a person (not the show's own dates), booked over MCP, a house character in it. */
const DATE_LENSES = `(e.created_via = 'web' and e.creator_id <> ${SYSTEM}) as people, (e.created_via = 'mcp') as agents,
       (a.is_house or b.is_house) as house, (e.creator_id = any($3::text[]) or coalesce(a.owner_id, '') = ${DELETED}) as ours`;
const DATE_JOIN = `episodes e join characters a on a.id = e.character_a join characters b on b.id = e.character_b`;
/** A date that's ours: booked by one of our identities, or a deleted account's (its own character went to the deleted owner). */
const OUR_DATE = `(e.creator_id = any($3::text[]) or coalesce(a.owner_id, '') = ${DELETED})`;
const FOLLOWED = `exists (select 1 from episodes f where f.followup_of = e.id and f.created_at < e.revealed_at + interval '${SECOND_DATE_DAYS} days')`;

const GRID_SQL: Record<Measure, string> = {
  // Characters: made on the web, over MCP, or a house character (the seasons' generated newcomers).
  characters: `select 'characters'::text as measure, ${DAY("c.created_at")} as day,
      (not c.is_house and c.created_via = 'web') as people, (not c.is_house and c.created_via = 'mcp') as agents, c.is_house as house,
      coalesce(c.owner_id = any($3::text[]), false) as ours, ''::text as key, count(*)::int as n
    from characters c where c.created_at >= $1 and c.created_at < $2 group by 2, 3, 4, 5, 6`,
  // Dates started (booked), by the ending the engine decided.
  dates: `select 'dates', ${DAY("e.created_at")}, ${DATE_LENSES}, e.ending, count(*)::int
    from ${DATE_JOIN} where e.created_at >= $1 and e.created_at < $2 group by 2, 3, 4, 5, 6, 7`,
  // Dates aired (revealed).
  aired: `select 'aired', ${DAY("e.revealed_at")}, ${DATE_LENSES}, e.ending, count(*)::int
    from ${DATE_JOIN} where e.revealed_at >= $1 and e.revealed_at < $2 group by 2, 3, 4, 5, 6, 7`,
  // First dates (not follow-ups) that aired, and whether a second date was booked within SECOND_DATE_DAYS.
  first_dates: `select 'first_dates', ${DAY("e.revealed_at")}, ${DATE_LENSES}, case when ${FOLLOWED} then 'followed' else 'not' end, count(*)::int
    from ${DATE_JOIN} where e.followup_of is null and e.revealed_at >= $1 and e.revealed_at < $2 group by 2, 3, 4, 5, 6, 7`,
  // Texts between dates, by who wrote them: a person's own key, an agent, or the show answering one (a house reply, a new
  // match's opener). The scheduled daily exchange is left out: it follows how many couples exist, not what anyone did.
  texts: `select 'texts', ${DAY("t.created_at")}, (t.via = 'own_key'), (t.via = 'agent'), (lo.is_house or hi.is_house),
      (coalesce(lo.owner_id = any($3::text[]), false) or coalesce(hi.owner_id = any($3::text[]), false)), t.via, count(*)::int
    from couple_texts t join characters lo on lo.id = t.character_lo join characters hi on hi.id = t.character_hi
    where t.day >= $5::date and t.day <= $6::date and t.created_at >= $1 and t.created_at < $2 and t.via <> 'daily' group by 2, 3, 4, 5, 6, 7`,
  // Swipes, by whose character swiped; House when either side is a house character.
  swipes: `select 'swipes', ${DAY("w.created_at")}, (not s.is_house and s.created_via = 'web'), (not s.is_house and s.created_via = 'mcp'),
      (s.is_house or t.is_house), coalesce(s.owner_id = any($3::text[]), false), case when w.liked then 'like' else 'pass' end, count(*)::int
    from swipes w join characters s on s.id = w.swiper join characters t on t.id = w.target
    where w.created_at >= $1 and w.created_at < $2 group by 2, 3, 4, 5, 6, 7`,
  // Matches: a side made by a person, by an agent, or a house character (one match can be several of these).
  matches: `select 'matches', ${DAY("m.matched_at")},
      ((not lo.is_house and lo.created_via = 'web') or (not hi.is_house and hi.created_via = 'web')),
      ((not lo.is_house and lo.created_via = 'mcp') or (not hi.is_house and hi.created_via = 'mcp')),
      (lo.is_house or hi.is_house),
      (coalesce(lo.owner_id = any($3::text[]), false) or coalesce(hi.owner_id = any($3::text[]), false)),
      case when m.agreed_at is not null then 'agreed' else 'open' end, count(*)::int
    from matches m join characters lo on lo.id = m.character_lo join characters hi on hi.id = m.character_hi
    where m.matched_at >= $1 and m.matched_at < $2 group by 2, 3, 4, 5, 6, 7`,
  // Accounts: only people have them (MCP refuses an agent id that has an account).
  accounts: `select 'accounts', ${DAY("ac.created_at")}, true, false, false, (ac.user_id = any($3::text[])), '', count(*)::int
    from accounts ac where ac.created_at >= $1 and ac.created_at < $2 group by 2, 6`,
  // MCP connections by the day they opened. last_seen is indexed and never earlier than created_at, so it prunes first.
  sessions: `select 'sessions', ${DAY("s.created_at")}, false, true, false, (s.agent_id = any($3::text[])), '', count(*)::int
    from mcp_sessions s where s.last_seen >= $1 and s.created_at >= $1 and s.created_at < $2 group by 2, 6`,
  // MCP tool calls, worked or failed.
  calls: `select 'calls', ${DAY("c.created_at")}, false, true, false,
      (coalesce(c.agent_id = any($3::text[]), false) or coalesce(c.client_name, '') ~* $4 or coalesce(c.user_agent, '') ~* $4),
      case when c.ok then 'ok' else 'error' end, count(*)::int
    from mcp_calls c where c.tool is not null and c.created_at >= $1 and c.created_at < $2 group by 2, 6, 7`,
  // Thumbs on lines, as each vote stands after its last change. Only people vote (no MCP tool casts one).
  votes: `select 'votes', ${DAY("v.updated_at")}, true, false, false, (v.user_id = any($3::text[])), case when v.vote > 0 then 'up' else 'down' end, count(*)::int
    from line_feedback v where v.updated_at >= $1 and v.updated_at < $2 group by 2, 6, 7`,
  // Agents' feedback (send_feedback), keyed by its rating out of 10 ('' when unrated). Live feedback always has a session;
  // a row without one was imported by the owner from elsewhere (the loop's local visitor runs), so it's ours.
  feedback: `select 'feedback', ${DAY("f.created_at")}, false, true, false,
      (f.session_id is null or f.agent_id = any($3::text[]) or coalesce(f.client_name, '') ~* $4), coalesce(f.rating::text, ''), count(*)::int
    from agent_feedback f where f.created_at >= $1 and f.created_at < $2 group by 2, 6, 7`,
  // What people send with "Give us feedback" (lib/user-feedback.ts), keyed by its 0-10 rating. Read only: it marks its own
  // traffic as it's saved (ours), and our identities count as ours here too.
  people_feedback: `select 'people_feedback', ${DAY("uf.created_at")}, true, false, false, (uf.ours or uf.user_id = any($3::text[])),
      coalesce(uf.rating::text, ''), count(*)::int
    from user_feedback uf where uf.created_at >= $1 and uf.created_at < $2 group by 2, 6, 7`,
  // After Dark steps: admin-only, so all of it is our own use. Never marked ours, or the default view would hide it.
  steps: `select 'steps', ${DAY("st.created_at")}, false, false, false, false, '', count(*)::int
    from adult_steps st where st.created_at >= $1 and st.created_at < $2 group by 2`,
};

/** Every additive measure for both periods, in one round trip. */
export async function loadGrid(db: Db, w: Window, ours: readonly string[]): Promise<Cell[]> {
  const sql = MEASURES.map((m) => GRID_SQL[m]).join("\nunion all\n");
  const { rows } = await db.query<Cell>(sql, [w.start, w.end, ours, OUR_TRAFFIC.source, w.firstDay, w.lastDay]);
  return rows.map((r) => ({ ...r, n: Number(r.n) }));
}

/** One measure's daily totals over `days`, for this query. `key` narrows it to some keys (an ending, a text's writer…). */
export function daily(
  cells: readonly Cell[],
  days: readonly string[],
  q: Pick<InsightsQuery, "segment" | "includeOurs">,
  measure: Measure,
  segmented: boolean,
  key?: (k: string) => boolean,
): number[] {
  const index = new Map(days.map((d, i) => [d, i]));
  const out = days.map(() => 0);
  for (const c of cells) {
    if (c.measure !== measure || (key && !key(c.key))) continue;
    const i = index.get(c.day);
    if (i !== undefined && keep(c, q, segmented)) out[i] += c.n;
  }
  return out;
}

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

/* ------------------------------------------- distinct counts ------------------------------------------- */

/** A distinct count for each period, split into outsiders and ours (ours belongs to the identity, so the two add up). */
type Split = { current: { outside: number; ours: number }; previous: { outside: number; ours: number } };
type Distinct = { agents: Split; viewers: Split; pairs: Split };

/** Distinct agents that called a tool, distinct watch-room viewers, and distinct After Dark pairs, per period. */
export async function loadDistinct(db: Db, w: Window, ours: readonly string[]): Promise<Distinct> {
  const { rows } = await db.query<{ measure: keyof Distinct; current: boolean; ours: boolean; n: number }>(
    `select 'agents'::text as measure, (c.created_at >= $3) as current, (c.agent_id = any($4::text[])) as ours, count(distinct c.agent_id)::int as n
       from mcp_calls c where c.tool is not null and c.agent_id is not null and c.created_at >= $1 and c.created_at < $2 group by 2, 3
     union all
     select 'viewers', (v.at >= $3), (v.user_id = any($4::text[])), count(distinct v.user_id)::int
       from (select user_id, last_seen as at from watch_presence where last_seen >= $1 and last_seen < $2
             union all select user_id, created_at from watch_messages where created_at >= $1 and created_at < $2
             union all select user_id, created_at from watch_reactions where created_at >= $1 and created_at < $2
             union all select user_id, updated_at from watch_poll_votes where updated_at >= $1 and updated_at < $2) v
      group by 2, 3
     union all
     select 'pairs', (st.created_at >= $3), false, count(distinct (st.owner_id, st.character_a, st.character_b))::int
       from adult_steps st where st.created_at >= $1 and st.created_at < $2 group by 2, 3`,
    [w.start, w.end, w.currentStart, ours],
  );
  const blank = (): Split => ({ current: { outside: 0, ours: 0 }, previous: { outside: 0, ours: 0 } });
  const out: Distinct = { agents: blank(), viewers: blank(), pairs: blank() };
  for (const r of rows) out[r.measure][r.current ? "current" : "previous"][r.ours ? "ours" : "outside"] += Number(r.n);
  return out;
}

const pickSplit = (s: Split["current"], includeOurs: boolean) => s.outside + (includeOurs ? s.ours : 0);

/* --------------------------------------------- people: first seen --------------------------------------------- */

/**
 * Everything a person does on purpose that has a time, as (id, at): what "first seen", the funnel and retention are read
 * from. A visit that does nothing leaves no trace (page views aren't stored). Sitting in a watch room isn't counted
 * either: its heartbeat can't tell a person from a crawler that runs the page's scripts (on 2026-10-22, 41 of the 44
 * watch-room identities had done nothing else). Chatting, reacting or voting in a room is.
 */
const ACTS_SQL = `
  select owner_id as id, created_at as at from characters where not is_house and created_via = 'web' and owner_id is not null
  union all select creator_id, created_at from episodes where created_via = 'web'
  union all select user_id, created_at from predictions
  union all select user_id, created_at from arc_predictions
  union all select user_id, created_at from dealbreaker_guesses
  union all select proposer_id, created_at from matchmaker_proposals
  union all select rater_id, created_at from character_ratings
  union all select reviewer_id, created_at from character_reviews where via = 'web'
  union all select user_id, created_at from couple_follows
  union all select user_id, created_at from line_feedback
  union all select user_id, created_at from watch_messages
  union all select user_id, created_at from watch_reactions
  union all select user_id, updated_at from watch_poll_votes
  union all select user_id, created_at from accounts
  union all select user_id, attested_adult_at from profiles
  union all select user_id, joined_at from league_members
  union all select c.owner_id, s.created_at from swipes s join characters c on c.id = s.swiper
            where c.created_via = 'web' and not c.is_house and c.owner_id is not null
  union all select c.owner_id, t.created_at from couple_texts t join characters c on c.id = case when t.who = 'lo' then t.character_lo else t.character_hi end
            where t.via = 'own_key' and c.owner_id is not null`;

/** A person first seen in either period: the day, every day they did something, and how far they've got (as of now). */
export type Newcomer = {
  first_day: string;
  days: string[];
  made_character: boolean;
  first_date: boolean;
  second_date: boolean;
  account: boolean;
  texted: boolean;
};

/** People (never agents) whose first stored action falls in [start, end), with their activity days and funnel steps. */
export async function loadNewcomers(db: Db, w: Window, ours: readonly string[], includeOurs: boolean): Promise<Newcomer[]> {
  const theirs = `(e.creator_id = c.id or a.owner_id = c.id or b.owner_id = c.id)`;
  const { rows } = await db.query<Newcomer>(
    `with acts as materialized (${ACTS_SQL}),
     firsts as (select id, min(at) as first from acts where id is not null group by id),
     cohort as (
       select f.id, f.first from firsts f
        where f.first >= $1 and f.first < $2
          and ($4 or not (f.id = any($3::text[])))
          -- The show's own id and the deleted owner aren't people, whatever the filter.
          and f.id not in (${SYSTEM}, ${DELETED})
          and not exists (select 1 from mcp_sessions s where s.agent_id = f.id)
     ),
     active as (select a.id, array_agg(distinct ${DAY("a.at")}) as days from acts a join cohort c on c.id = a.id group by a.id)
     select ${DAY("c.first")} as first_day, d.days,
            exists (select 1 from characters ch where ch.owner_id = c.id and ch.created_via = 'web' and not ch.is_house) as made_character,
            exists (select 1 from ${DATE_JOIN} where ${theirs}) as first_date,
            exists (select 1 from ${DATE_JOIN} where e.followup_of is not null and ${theirs}) as second_date,
            exists (select 1 from accounts ac where ac.user_id = c.id) as account,
            exists (select 1 from couple_texts t join characters s on s.id = case when t.who = 'lo' then t.character_lo else t.character_hi end
                     where t.via = 'own_key' and s.owner_id = c.id) as texted
       from cohort c join active d on d.id = c.id`,
    [w.start, w.end, ours, includeOurs],
  );
  return rows.map((r) => ({ ...r, days: [...(r.days ?? [])].sort() }));
}

/* ---------------------------------------------- the funnel ---------------------------------------------- */

/** The people funnel's steps, in order. Each counts the people who also did every step before it. */
export const FUNNEL_STEPS = [
  {
    key: "first_seen",
    label: "First seen",
    definition: "Their first action was in the period: a character, a date, a prediction, a rating or review, a follow, a vote, a chat, reaction or poll vote in a watch room, or an account. Visits that do nothing aren't stored, and only watching a room doesn't count.",
  },
  { key: "made_character", label: "Made a character", definition: "Made a character of their own on the web." },
  { key: "first_date", label: "First date", definition: "Booked a date, or one of their characters went on one." },
  { key: "second_date", label: "Second date", definition: "One of their characters went on a second date (a follow-up)." },
  { key: "account", label: "Made an account", definition: "Signed up with a password or Google. Texting with their own model key needs an account, so it comes first." },
  { key: "texted", label: "Sent a text", definition: "Their own model key wrote a text for their character. Agents' texts and the show's daily texts don't count." },
] as const;
export type FunnelKey = (typeof FUNNEL_STEPS)[number]["key"];
export type FunnelStep = { key: FunnelKey; label: string; definition: string; count: number; previous: number; of_previous: number | null; of_first: number | null };

/** The strict funnel over a cohort: step k counts the people who did steps 1 to k. */
export function funnelCounts(cohort: readonly Newcomer[]): number[] {
  let reached = [...cohort];
  return FUNNEL_STEPS.map((step) => {
    if (step.key !== "first_seen") reached = reached.filter((p) => p[step.key]);
    return reached.length;
  });
}

/** The funnel for this period's newcomers, with the previous period's counts beside it. */
export function funnelSteps(current: readonly Newcomer[], previous: readonly Newcomer[]): FunnelStep[] {
  const now = funnelCounts(current);
  const before = funnelCounts(previous);
  return FUNNEL_STEPS.map((s, i) => ({
    key: s.key,
    label: s.label,
    definition: s.definition,
    count: now[i],
    previous: before[i],
    of_previous: i === 0 ? null : now[i - 1] ? now[i] / now[i - 1] : null,
    of_first: now[0] ? now[i] / now[0] : null,
  }));
}

/* ---------------------------------------------- retention ---------------------------------------------- */

/** A weekly cohort: the Monday of the week its people were first seen, how many, and how many came back each week after. */
export type CohortRow = { week: string; size: number; active: (number | null)[] };

/**
 * Weekly retention: people grouped by the week they were first seen; week k counts those who did something stored
 * k weeks later (week 0 is everyone). A week that hasn't started yet is null; the current week is still filling in.
 */
export function retention(cohort: readonly Newcomer[], today: string, weeks = RETENTION_WEEKS): CohortRow[] {
  const thisWeek = weekOf(today);
  const groups = new Map<string, Newcomer[]>();
  for (const p of cohort) {
    const week = weekOf(p.first_day);
    const group = groups.get(week) ?? [];
    group.push(p);
    groups.set(week, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, people]) => ({
      week,
      size: people.length,
      active: Array.from({ length: weeks + 1 }, (_, k) => {
        const target = addDays(week, 7 * k);
        if (target > thisWeek) return null;
        return people.filter((p) => p.days.some((d) => weekOf(d) === target)).length;
      }),
    }));
}

/* ---------------------------------------------- the tables ---------------------------------------------- */

/** SQL for a date's segment (a closed set, never built from input). */
const DATE_SEGMENT_SQL: Record<Segment, string> = {
  all: "true",
  people: `(e.created_via = 'web' and e.creator_id <> ${SYSTEM})`,
  agents: `(e.created_via = 'mcp')`,
  house: `(a.is_house or b.is_house)`,
};
/** SQL for a character's segment. */
const CHARACTER_SEGMENT_SQL: Record<Segment, string> = {
  all: "true",
  people: `(not c.is_house and c.created_via = 'web')`,
  agents: `(not c.is_house and c.created_via = 'mcp')`,
  house: `c.is_house`,
};

export type CharacterRow = {
  id: string;
  name: string;
  kind: "house" | "people" | "agents";
  private: boolean;
  dates: number;
  aired: number;
  first_aired: number;
  followed: number;
  reviews: number;
  stars: number | null;
};

/**
 * The characters with the most dates in the selected period: dates, aired, first dates that led to a second date, and
 * reviews posted in the period. Dates by our identities are left out unless asked for; the segment picks the characters.
 */
export async function topCharacters(db: Db, q: InsightsQuery, ours: readonly string[]): Promise<CharacterRow[]> {
  const w = windowOf(q);
  const { rows } = await db.query<Omit<CharacterRow, "kind" | "private"> & { is_house: boolean; created_via: string; visibility: string }>(
    `with d as (
       select e.character_a, e.character_b, e.revealed_at, e.followup_of, (e.revealed_at is not null and ${FOLLOWED}) as followed
         from ${DATE_JOIN}
        where e.created_at >= $1 and e.created_at < $2 and ($4 or not ${OUR_DATE})
     ),
     sides as (select character_a as id, revealed_at, followup_of, followed from d union all select character_b, revealed_at, followup_of, followed from d),
     per as (
       select id, count(*)::int as dates, count(revealed_at)::int as aired,
              count(*) filter (where followup_of is null and revealed_at is not null)::int as first_aired,
              count(*) filter (where followup_of is null and followed)::int as followed
         from sides group by id
     )
     select c.id, c.name, c.is_house, c.created_via, c.visibility, per.dates, per.aired, per.first_aired, per.followed,
            coalesce(r.reviews, 0)::int as reviews, r.stars
       from per join characters c on c.id = per.id
       left join (select character_id, count(*)::int as reviews, avg(stars)::float8 as stars
                    from character_reviews where created_at >= $1 and created_at < $2 group by character_id) r on r.character_id = c.id
      where ${CHARACTER_SEGMENT_SQL[q.segment]} and ($4 or not coalesce(c.owner_id = any($3::text[]), false))
      order by per.dates desc, c.name
      limit ${TOP_CHARACTERS}`,
    [w.currentStart, w.end, ours, q.includeOurs],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.is_house ? "house" : r.created_via === "mcp" ? "agents" : "people",
    private: r.visibility === "private",
    dates: r.dates,
    aired: r.aired,
    first_aired: r.first_aired,
    followed: r.followed,
    reviews: r.reviews,
    stars: r.stars === null ? null : Math.round(Number(r.stars) * 10) / 10,
  }));
}

export type VenueRow = { venue: string; name: string; dates: number; endings: Record<Ending, number>; first_aired: number; followed: number };

const KNOWN_VENUES: ReadonlySet<string> = new Set([...DATE_VENUES, ...EXTRA_VENUES].map((v) => v.id));

/** Where the period's dates were: per venue (a place of their own counts under its kind), dates, endings and second dates. */
export async function venues(db: Db, q: InsightsQuery, ours: readonly string[]): Promise<VenueRow[]> {
  const w = windowOf(q);
  const { rows } = await db.query<{ place: string | null; ending: Ending; n: number; first_aired: number; followed: number }>(
    `select e.setup->>'venue' as place, e.ending, count(*)::int as n,
            count(*) filter (where e.followup_of is null and e.revealed_at is not null)::int as first_aired,
            count(*) filter (where e.followup_of is null and e.revealed_at is not null and ${FOLLOWED})::int as followed
       from ${DATE_JOIN}
      where e.created_at >= $1 and e.created_at < $2 and ${DATE_SEGMENT_SQL[q.segment]} and ($4 or not ${OUR_DATE})
      group by 1, 2`,
    [w.currentStart, w.end, ours, q.includeOurs],
  );
  const byVenue = new Map<string, VenueRow>();
  for (const r of rows) {
    const id = placeParts(r.place).id ?? "";
    const row = byVenue.get(id) ?? {
      venue: id || "unrecorded",
      // A venue since dropped from the library keeps its id rather than borrowing the first venue's name.
      name: !id ? "Not recorded (older dates)" : KNOWN_VENUES.has(id) ? venueName(id) : id,
      dates: 0,
      endings: { second_date: 0, friends: 0, disaster: 0 },
      first_aired: 0,
      followed: 0,
    };
    row.dates += r.n;
    row.endings[r.ending] += r.n;
    row.first_aired += r.first_aired;
    row.followed += r.followed;
    byVenue.set(id, row);
  }
  return [...byVenue.values()].sort((a, b) => b.dates - a.dates || a.name.localeCompare(b.name));
}

/* --------------------------------------------- quality runs --------------------------------------------- */

type RunRow = { id: string; kind: QualityRunKind; at: Date | string; sha: string | null; label: string; metrics: Record<string, unknown> | string | null };
type SimRow = { run: string; at: Date | string; overall_avg: number | null; mcp_avg: number | null };

export type QualityTableRow = { id: string; kind: QualityRunKind; at: string; sha: string | null; label: string; numbers: KeyMetric[] };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const mean = (xs: readonly number[]): number | null => (xs.length ? sum(xs) / xs.length : null);
const numbers = (xs: readonly unknown[]): number[] => xs.map(num).filter((v): v is number => v !== null);
const gateOf = (r: QualityRun): boolean | null => {
  const passed = (r.metrics.gate as { passed?: unknown } | null | undefined)?.passed;
  return typeof passed === "boolean" ? passed : null;
};
const toRun = (r: RunRow): QualityRun => ({
  id: r.id,
  kind: r.kind,
  at: new Date(r.at).toISOString(),
  sha: r.sha,
  label: r.label,
  metrics: typeof r.metrics === "string" ? (JSON.parse(r.metrics) as Record<string, unknown>) : (r.metrics ?? {}),
});

/** What one observer run flagged, by kind (lib/quality-runs.ts keyMetrics reads the same fields). */
export function observerFindings(m: Record<string, unknown>): { unprovoked: number; repeats: number; unfounded: number } {
  return {
    unprovoked: num(m.unprovoked_moves) ?? 0,
    repeats: (num(m.verbatim_repeats) ?? 0) + (num(m.near_repeats) ?? 0),
    unfounded: num(m.unfounded_memories) ?? 0,
  };
}
const findingsOf = (r: QualityRun) => {
  const f = observerFindings(r.metrics);
  return f.unprovoked + f.repeats + f.unfounded;
};

export type QualitySummary = {
  golden: { runs: number; judged: number; passed: number; failed: number; win_rate: number | null };
  observer: { runs: number; findings: number; lines: number };
  loop: { runs: number; overall: number | null; mcp: number | null };
};

function summarizeQuality(runs: readonly QualityRun[], sims: readonly SimRow[]): QualitySummary {
  const golden = runs.filter((r) => r.kind === "golden");
  const gates = golden.map(gateOf).filter((g): g is boolean => g !== null);
  const rates = numbers(golden.map((r) => r.metrics.win_rate_b));
  const observer = runs.filter((r) => r.kind === "after_dark_observer");
  return {
    golden: { runs: golden.length, judged: rates.length, passed: gates.filter(Boolean).length, failed: gates.filter((g) => !g).length, win_rate: mean(rates) },
    observer: { runs: observer.length, findings: sum(observer.map(findingsOf)), lines: sum(numbers(observer.map((r) => r.metrics.lines))) },
    loop: { runs: sims.length, overall: mean(numbers(sims.map((s) => s.overall_avg))), mcp: mean(numbers(sims.map((s) => s.mcp_avg))) },
  };
}

/** The quality series over the selected days: golden win rate and gate results, observer findings, loop ratings. */
function qualitySeries(runs: readonly QualityRun[], sims: readonly SimRow[], days: readonly string[]) {
  const index = new Map(days.map((d, i) => [d, i]));
  const winRates = days.map(() => [] as number[]);
  const passed = days.map(() => 0);
  const failed = days.map(() => 0);
  const unprovoked = days.map((): number | null => null);
  const repeats = days.map((): number | null => null);
  const unfounded = days.map((): number | null => null);
  for (const r of runs) {
    const i = index.get(r.at.slice(0, 10));
    if (i === undefined) continue;
    if (r.kind === "golden") {
      const rate = num(r.metrics.win_rate_b);
      if (rate !== null) winRates[i].push(rate);
      const gate = gateOf(r);
      if (gate === true) passed[i]++;
      if (gate === false) failed[i]++;
    } else {
      const f = observerFindings(r.metrics);
      unprovoked[i] = (unprovoked[i] ?? 0) + f.unprovoked;
      repeats[i] = (repeats[i] ?? 0) + f.repeats;
      unfounded[i] = (unfounded[i] ?? 0) + f.unfounded;
    }
  }
  const overall = days.map(() => [] as number[]);
  const mcp = days.map(() => [] as number[]);
  for (const s of sims) {
    const i = index.get(new Date(s.at).toISOString().slice(0, 10));
    if (i === undefined) continue;
    overall[i].push(...numbers([s.overall_avg]));
    mcp[i].push(...numbers([s.mcp_avg]));
  }
  return {
    golden: { win_rate: winRates.map(mean), passed, failed },
    observer: { unprovoked, repeats, unfounded },
    loop: { overall: overall.map(mean), mcp: mcp.map(mean) },
  };
}

/* ------------------------------------------ verdicts and KPIs ------------------------------------------ */

/** How a number moved against the previous period, and whether that's worth reading. */
export type Verdict = {
  direction: "up" | "down" | "flat";
  /** The difference: a count, or for a rate the difference in its share (0.1 is ten points). */
  change: number | null;
  /** The relative change, when the previous value isn't zero. */
  pct: number | null;
  /** Too little data to read the change at all. */
  tooFew: boolean;
  /** Bigger than noise: past REAL_Z standard errors. */
  real: boolean;
};

const direction = (change: number | null): Verdict["direction"] => (change === null || Math.abs(change) < 1e-12 ? "flat" : change > 0 ? "up" : "down");

/** A count against the previous period's: a Poisson test (the difference's variance is roughly the sum of the two). */
export function countVerdict(current: number, previous: number): Verdict {
  const change = current - previous;
  const tooFew = current + previous < MIN_EVENTS;
  const z = current + previous > 0 ? change / Math.sqrt(current + previous) : 0;
  return { direction: direction(change), change, pct: previous > 0 ? change / previous : null, tooFew, real: !tooFew && Math.abs(z) >= REAL_Z };
}

/** A rate (num of den) against the previous period's: a two-proportion z-test, and too few under MIN_N on either side. */
export function shareVerdict(num: number, den: number, prevNum: number, prevDen: number): Verdict {
  if (den === 0 || prevDen === 0) return { direction: "flat", change: null, pct: null, tooFew: true, real: false };
  const now = num / den;
  const before = prevNum / prevDen;
  const pooled = (num + prevNum) / (den + prevDen);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / den + 1 / prevDen));
  const change = now - before;
  const tooFew = den < MIN_N || prevDen < MIN_N;
  return { direction: direction(change), change, pct: before > 0 ? change / before : null, tooFew, real: !tooFew && se > 0 && Math.abs(change / se) >= REAL_Z };
}

/** Who a card is about: it follows the segment, or it's always one group. */
export type KpiScope = "segment" | "people" | "agents" | "admin" | "all";

export type Kpi = {
  key: string;
  label: string;
  definition: string;
  scope: KpiScope;
  format: "count" | "percent";
  current: number | null;
  previous: number | null;
  /** For a rate: how many it's out of, in each period, and what they are ("votes"). */
  base?: { current: number; previous: number; unit: string };
  /** A second line under the number. */
  sub?: string;
  /** False when the previous period isn't a fair comparison (data stored only since inside it, or still maturing). */
  comparable: boolean;
  note?: string;
  verdict: Verdict;
  /** The selected period's daily values, for a sparkline. */
  spark?: number[];
};

/* ------------------------------------------------ insights ------------------------------------------------ */

export type Insight = { tone: "up" | "down" | "warn" | "info"; text: string };

const pctText = (p: number) => `${Math.round(Math.abs(p) * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const shortDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The biggest real movers among the cards (at most three), or why there's nothing to say. */
export function moverInsights(kpis: readonly Kpi[], periodDays: number): Insight[] {
  const against = `the previous ${periodDays === 1 ? "day" : `${periodDays} days`}`;
  const readable = kpis.filter((k) => k.comparable && !k.verdict.tooFew && k.current !== null && k.previous !== null);
  const movers = readable
    .filter((k) => k.verdict.real)
    .sort((a, b) => Math.abs(b.verdict.pct ?? b.verdict.change ?? 0) - Math.abs(a.verdict.pct ?? a.verdict.change ?? 0))
    .slice(0, 3);
  if (movers.length === 0) {
    if (readable.length === 0) {
      return [{ tone: "info", text: `Too few to say how this period compares with ${against}: no measure has ${MIN_EVENTS} events (or ${MIN_N} for a rate) across both.` }];
    }
    return [{ tone: "info", text: `No big movers: every measure with enough data is within normal variation of ${against}.` }];
  }
  return movers.map((k) => {
    const up = k.verdict.direction === "up";
    const change =
      k.format === "percent"
        ? `${up ? "rose" : "fell"} ${Math.round(Math.abs(k.verdict.change ?? 0) * 100)} points (${pctText(k.previous!)} → ${pctText(k.current!)})`
        : `${up ? "rose" : "fell"} ${k.verdict.pct === null ? "" : `${pctText(k.verdict.pct)} `}(${k.previous!.toLocaleString("en-US")} → ${k.current!.toLocaleString("en-US")})`;
    return { tone: up ? "up" : "down", text: `${k.label} ${change} against ${against}.` };
  });
}

/** Where the people funnel loses the most, among steps with enough people to say. */
export function funnelInsight(steps: readonly FunnelStep[]): Insight | null {
  if (steps.length === 0) return null;
  if (steps[0].count < MIN_N) {
    return { tone: "info", text: `Too few new people to read the funnel: ${plural(steps[0].count, "person", "people")} first seen in this period (it needs ${MIN_N}).` };
  }
  let worst = -1;
  for (let i = 1; i < steps.length; i++) {
    const rate = steps[i].of_previous;
    if (steps[i - 1].count < MIN_N || rate === null || rate >= 1) continue;
    if (worst < 0 || rate < steps[worst].of_previous!) worst = i;
  }
  if (worst < 0) return null;
  const [before, step] = [steps[worst - 1], steps[worst]];
  return {
    tone: "warn",
    text: `The people funnel loses the most between “${before.label.toLowerCase()}” and “${step.label.toLowerCase()}”: ${step.count} of ${before.count} (${pctText(step.of_previous!)}) made it.`,
  };
}

/**
 * Days far from the period's typical one: at least five and three times the median of the other days, or nothing at all
 * on a day when the median is five or more. Today is left out (it isn't over). At most two, the most unusual first.
 */
export function anomalyInsights(series: readonly { unit: string; values: readonly (number | null)[] }[], days: readonly string[], today: string): Insight[] {
  const found: { score: number; insight: Insight }[] = [];
  for (const s of series) {
    // A missing value (a day before the measure was logged) is left out, never read as a zero.
    const complete = days.flatMap((day, i) => (day === today || s.values[i] === null || s.values[i] === undefined ? [] : [{ day, v: s.values[i] as number }]));
    if (complete.length < 7) continue;
    for (const p of complete) {
      const others = complete.filter((o) => o !== p).map((o) => o.v).sort((a, b) => a - b);
      const median = others[Math.floor(others.length / 2)];
      const typical = Math.max(median, 1);
      if (p.v >= 5 && p.v >= 3 * typical) {
        const against = median === 0 ? "when a typical day has none" : `about ${Math.round(p.v / typical)}× a typical day (${median})`;
        found.push({ score: p.v / typical, insight: { tone: "info", text: `${shortDate(p.day)} stands out: ${plural(p.v, s.unit)}, ${against}.` } });
      } else if (p.v === 0 && median >= 5) {
        found.push({ score: median, insight: { tone: "warn", text: `No ${s.unit}s at all on ${shortDate(p.day)}, against ${median} on a typical day: worth a look.` } });
      }
    }
  }
  return found.sort((a, b) => b.score - a.score).slice(0, 2).map((f) => f.insight);
}

/** What the quality runs say: a failed gate on the latest golden run, and the observer's latest run against the one before. */
export function qualityInsights(runs: readonly QualityRun[]): Insight[] {
  const out: Insight[] = [];
  const newestFirst = (kind: QualityRunKind) => runs.filter((r) => r.kind === kind).sort((a, b) => (a.at < b.at ? 1 : -1));
  const [golden] = newestFirst("golden");
  if (golden && gateOf(golden) === false) {
    out.push({ tone: "warn", text: `The golden gate failed on the latest run (${golden.label}, ${shortDate(golden.at.slice(0, 10))}): B lost to A or a metric regressed.` });
  }
  const observer = newestFirst("after_dark_observer");
  if (observer.length >= 2) {
    const [last, before] = [findingsOf(observer[0]), findingsOf(observer[1])];
    if (last !== before) out.push({ tone: last > before ? "warn" : "up", text: `The After Dark observer flagged ${plural(last, "finding")} in its latest run, against ${before} the run before.` });
  }
  return out;
}

/* ------------------------------------------------ the whole ------------------------------------------------ */

export type SeriesPair = { current: number[]; previous: number[] };

export type Insights = {
  generated_at: string;
  query: { from: string; to: string; days: number; segment: Segment; include_ours: boolean };
  previous: { from: string; to: string };
  min_n: number;
  min_events: number;
  days: string[];
  previous_days: string[];
  kpis: Kpi[];
  series: {
    dates: { endings: Record<Ending, number[]>; previous: number[] };
    characters: SeriesPair;
    accounts: SeriesPair;
    texts: SeriesPair;
    swipes: SeriesPair;
    matches: SeriesPair;
    sessions: SeriesPair;
    /** Null on days before per-call logging began: not logged, rather than none. */
    calls: { ok: (number | null)[]; error: (number | null)[]; previous: (number | null)[] };
    golden: { win_rate: (number | null)[]; passed: number[]; failed: number[] };
    observer: { unprovoked: (number | null)[]; repeats: (number | null)[]; unfounded: (number | null)[] };
    loop: { overall: (number | null)[]; mcp: (number | null)[] };
  };
  quality: { current: QualitySummary; previous: QualitySummary; runs: QualityTableRow[] };
  funnel: FunnelStep[];
  retention: { weeks: number; rows: CohortRow[] };
  endings: { ending: Ending; current: number; previous: number }[];
  characters: CharacterRow[];
  venues: VenueRow[];
  insights: Insight[];
  /** Since when per-call MCP logging and After Dark steps exist (an older period has nothing to compare). */
  logged_since: { mcp_calls: string | null; after_dark_steps: string | null };
};

/** The whole overview for one query. `now` is when "today" is (tests pin it). */
export async function loadInsights(db: Db, q: InsightsQuery, now = new Date()): Promise<Insights> {
  const p = periodsOf(q);
  const w = windowOf(q);
  const today = isoDay(now);
  const ours = await loadOurIds(db);
  const [cells, distinct, newcomers, characters, venueRows, runRows, simRows, since] = await Promise.all([
    loadGrid(db, w, ours),
    loadDistinct(db, w, ours),
    loadNewcomers(db, w, ours, q.includeOurs),
    topCharacters(db, q, ours),
    venues(db, q, ours),
    db.query<RunRow>(`select id, kind, at, sha, label, metrics from quality_runs where at >= $1 and at < $2 order by at desc, posted_at desc limit 500`, [w.start, w.end]),
    db.query<SimRow>(`select run, at, overall_avg, mcp_avg from sim_ratings where at >= $1 and at < $2 order by at`, [w.start, w.end]),
    db.query<{ mcp_calls: Date | string | null; after_dark_steps: Date | string | null }>(
      `select (select min(created_at) from mcp_calls) as mcp_calls, (select min(created_at) from adult_steps) as after_dark_steps`,
    ),
  ]);

  const both = (measure: Measure, segmented: boolean, key?: (k: string) => boolean): SeriesPair => ({
    current: daily(cells, p.current, q, measure, segmented, key),
    previous: daily(cells, p.previous, q, measure, segmented, key),
  });
  const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);
  const loggedSince = { mcp_calls: iso(since.rows[0]?.mcp_calls), after_dark_steps: iso(since.rows[0]?.after_dark_steps) };
  // Data first stored after the previous period began can't be compared with it.
  const comparableSince = (at: string | null) => at !== null && at.slice(0, 10) <= p.previous[0];
  // Before per-call logging began there are no calls to count: those days are missing, not zero (no false "outage").
  const callsFrom = loggedSince.mcp_calls?.slice(0, 10) ?? null;
  const logged = (days: string[], values: number[]) => values.map((v, i) => (callsFrom !== null && days[i] >= callsFrom ? v : null));

  const dates = both("dates", true);
  const firsts = both("first_dates", true);
  const followed = both("first_dates", true, (k) => k === "followed");
  const characterSeries = both("characters", true);
  const accounts = both("accounts", false);
  const texts = both("texts", true);
  const swipes = both("swipes", true);
  const matches = both("matches", true);
  const sessions = both("sessions", false);
  const calls = both("calls", false);
  const votes = both("votes", false);

  const current = newcomers.filter((n) => n.first_day >= q.from);
  const previous = newcomers.filter((n) => n.first_day < q.from);
  const funnel = funnelSteps(current, previous);

  // A feedback measure's average rating in the period, from the rating each of its cells is keyed by ('' is unrated).
  const ratings = (measure: Measure): string => {
    const rated = cells.filter((c) => c.measure === measure && c.key !== "" && c.day >= q.from && keep(c, q, false));
    const n = sum(rated.map((c) => c.n));
    return n ? `avg rating ${(sum(rated.map((c) => Number(c.key) * c.n)) / n).toFixed(1)} of 10 (${n} rated)` : "no ratings";
  };

  const count = (key: string, label: string, definition: string, scope: KpiScope, s: SeriesPair, extra: Partial<Kpi> = {}): Kpi => {
    const [c, pr] = [sum(s.current), sum(s.previous)];
    return { key, label, definition, scope, format: "count", current: c, previous: pr, comparable: true, verdict: countVerdict(c, pr), spark: s.current, ...extra };
  };
  const distinctCount = (key: string, label: string, definition: string, scope: KpiScope, split: Split, extra: Partial<Kpi> = {}): Kpi => {
    const [c, pr] = [pickSplit(split.current, q.includeOurs), pickSplit(split.previous, q.includeOurs)];
    return { key, label, definition, scope, format: "count", current: c, previous: pr, comparable: true, verdict: countVerdict(c, pr), ...extra };
  };
  const rate = (key: string, label: string, definition: string, scope: KpiScope, hits: SeriesPair, of: SeriesPair, unit: string, extra: Partial<Kpi> = {}): Kpi => {
    const [n, d, pn, pd] = [sum(hits.current), sum(of.current), sum(hits.previous), sum(of.previous)];
    return {
      key, label, definition, scope, format: "percent",
      current: d ? n / d : null, previous: pd ? pn / pd : null, base: { current: d, previous: pd, unit },
      comparable: true, verdict: shareVerdict(n, d, pn, pd), ...extra,
    };
  };

  const kpis: Kpi[] = [
    {
      key: "new_people", label: "New people", scope: "people", format: "count",
      definition: "People first seen in the period: their first action (a character, a date, a prediction, a rating or review, a follow, a vote, a chat, reaction or poll vote in a watch room, an account). Visits that do nothing aren't stored, and only watching a room doesn't count: crawlers that run scripts look the same.",
      current: current.length, previous: previous.length, comparable: true, verdict: countVerdict(current.length, previous.length),
      spark: p.current.map((d) => current.filter((n) => n.first_day === d).length),
    },
    count("accounts", "Accounts created", "New accounts, with a password or Google. Only people have them.", "people", accounts),
    count("characters", "Characters created", "Made by people on the web, by agents over MCP, or new house characters for the seasons (House).", "segment", characterSeries),
    count("dates_started", "Dates started", "Dates booked. People: on the web; Agents: over MCP; House: a house character on the date.", "segment", dates),
    count("dates_aired", "Dates aired", "Dates revealed to the audience in the period.", "segment", both("aired", true)),
    rate(
      "second_date_rate", "Second-date rate", `First dates that aired in the period whose couple booked a second date within ${SECOND_DATE_DAYS} days.`, "segment", followed, firsts, "first dates",
      addDays(q.to, SECOND_DATE_DAYS) > today ? { comparable: false, note: `Still maturing: a date aired in the last ${SECOND_DATE_DAYS} days can still get one.` } : {},
    ),
    count("texts", "Texts", "Texts between dates. People: their own model key; Agents: send_text. All and House also count house characters' replies and new matches' openers. The show's scheduled daily texts aren't counted.", "segment", texts),
    count("swipes", "Swipes", "Likes and passes, by whose character swiped. House: a house character on either side.", "segment", swipes, {
      sub: plural(sum(both("swipes", true, (k) => k === "like").current), "like"),
    }),
    count("matches", "Matches", "Both characters liked each other (a house character likes everyone back).", "segment", matches),
    distinctCount("watch_viewers", "Watch-room viewers", "Distinct viewers with a watch-room heartbeat, chat message, reaction or poll vote in the period. A heartbeat can be a crawler that runs the page's scripts.", "all", distinct.viewers, {
      comparable: false,
      note: "Only each viewer's latest visit to a room is stored, so earlier periods undercount; crawlers that run scripts count too.",
    }),
    distinctCount("mcp_agents", "MCP agents active", "Distinct agents (not our checks) that called at least one tool.", "agents", distinct.agents, {
      comparable: comparableSince(loggedSince.mcp_calls),
      ...(comparableSince(loggedSince.mcp_calls) ? {} : { note: loggedSince.mcp_calls ? `Calls are logged since ${loggedSince.mcp_calls.slice(0, 10)}.` : "No MCP calls logged yet." }),
    }),
    count("after_dark_steps", "After Dark steps", "Steps asked of After Dark scenes: a steer, a place, a continue. Admin-only, so this is our own use.", "admin", both("steps", false), {
      sub: `in ${plural(pickSplit(distinct.pairs.current, true), "scene")}`,
      comparable: comparableSince(loggedSince.after_dark_steps),
      ...(comparableSince(loggedSince.after_dark_steps)
        ? {}
        : { note: loggedSince.after_dark_steps ? `Logged since ${loggedSince.after_dark_steps.slice(0, 10)}.` : "Steps are logged from 2026-10-22; none yet." }),
    }),
    rate("thumbs_up", "Thumbs-up share", "Of the line votes cast or changed in the period, the share that are 👍.", "people", both("votes", false, (k) => k === "up"), votes, "votes"),
    count("people_feedback", "People's feedback", "Notes people sent with “Give us feedback” on the site, with their 0-10 rating. Our own are left out.", "people", both("people_feedback", false), {
      sub: ratings("people_feedback"),
    }),
    count("agent_feedback", "Agent feedback", "Feedback agents sent over MCP (send_feedback). Our checks and feedback imported from the loop's local visitor runs are left out.", "agents", both("feedback", false), {
      sub: ratings("feedback"),
    }),
  ];

  const runs = runRows.rows.map(toRun);
  const inCurrent = (at: Date | string) => new Date(at).toISOString().slice(0, 10) >= q.from;
  const currentRuns = runs.filter((r) => inCurrent(r.at));
  const currentSims = simRows.rows.filter((s) => inCurrent(s.at));

  const insights: Insight[] = [
    ...moverInsights(kpis, p.days),
    ...[funnelInsight(funnel)].filter((i): i is Insight => i !== null),
    ...anomalyInsights(
      [
        { unit: "date", values: dates.current },
        { unit: "character", values: characterSeries.current },
        { unit: "tool call", values: logged(p.current, calls.current) },
      ],
      p.current,
      today,
    ),
    ...qualityInsights(currentRuns),
  ];

  const endingSeries = (days: string[], ending: Ending) => daily(cells, days, q, "dates", true, (k) => k === ending);
  return {
    generated_at: now.toISOString(),
    query: { from: q.from, to: q.to, days: p.days, segment: q.segment, include_ours: q.includeOurs },
    previous: { from: p.previous[0], to: p.previous[p.previous.length - 1] },
    min_n: MIN_N,
    min_events: MIN_EVENTS,
    days: p.current,
    previous_days: p.previous,
    kpis,
    series: {
      dates: { endings: Object.fromEntries(ENDINGS.map((e) => [e, endingSeries(p.current, e)])) as Record<Ending, number[]>, previous: dates.previous },
      characters: characterSeries,
      accounts,
      texts,
      swipes,
      matches,
      sessions,
      calls: {
        ok: logged(p.current, daily(cells, p.current, q, "calls", false, (k) => k === "ok")),
        error: logged(p.current, daily(cells, p.current, q, "calls", false, (k) => k === "error")),
        previous: logged(p.previous, calls.previous),
      },
      ...qualitySeries(currentRuns, currentSims, p.current),
    },
    quality: {
      current: summarizeQuality(currentRuns, currentSims),
      previous: summarizeQuality(runs.filter((r) => !inCurrent(r.at)), simRows.rows.filter((s) => !inCurrent(s.at))),
      // Numbers only: an eval run's dollar cost stays off this page along with everything else about money.
      runs: currentRuns.slice(0, 100).map((r) => ({ id: r.id, kind: r.kind, at: r.at, sha: r.sha, label: r.label, numbers: keyMetrics(r).filter((m) => m.label !== "cost") })),
    },
    funnel,
    retention: { weeks: RETENTION_WEEKS, rows: retention(current, today) },
    endings: ENDINGS.map((ending) => ({ ending, current: sum(endingSeries(p.current, ending)), previous: sum(endingSeries(p.previous, ending)) })),
    characters,
    venues: venueRows,
    insights,
    logged_since: loggedSince,
  };
}

/* ------------------------------------------------ the cache ------------------------------------------------ */

const cache = new Map<string, { at: number; body: Insights }>();
const CACHE_ENTRIES = 24;

/** The overview, reused for CACHE_MS per query and day (Refresh passes fresh to skip it). */
export async function cachedInsights(db: Db, q: InsightsQuery, { fresh = false, now = new Date() }: { fresh?: boolean; now?: Date } = {}): Promise<Insights> {
  const key = `${q.from}|${q.to}|${q.segment}|${q.includeOurs ? 1 : 0}|${isoDay(now)}`;
  const hit = cache.get(key);
  if (!fresh && hit && now.getTime() - hit.at < CACHE_MS) return hit.body;
  const body = await loadInsights(db, q, now);
  cache.delete(key);
  cache.set(key, { at: now.getTime(), body });
  // The oldest entry goes first (a Map keeps insertion order).
  while (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  return body;
}

/** Tests start each case from nothing. */
export function clearInsightsCache(): void {
  cache.clear();
}

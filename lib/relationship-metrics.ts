/**
 * Is the long game working? The numbers behind the relationship work (docs/relationship-graph.md), straight from the
 * database, no content and no ids: the admin panel shows them, and the daily job logs them (relationship_metrics).
 *
 *  - **Second-date conversion:** of the dates where both characters wanted more (in the window), how many got their
 *    second date booked. The loop's headline number.
 *  - **Couple depth:** how many dates couples reach (every date, and the public record), and where they stand.
 *  - **Between dates:** texts, nudges, follows, arc calls, notifications and their read rate, browser push.
 *  - **Owner return:** of owners whose first date was 1–60 days ago, how many did anything on the show again the day
 *    after (D1), and within a week (D7). "Anything" is a date, a second-date yes, a nudge, an episode or arc
 *    prediction, a follow, or opening a notification.
 */
import { agentFunnel } from "./agent-funnel";
import type { Db } from "./db";
import { DELETED_OWNER } from "./rules";

export type RelationshipMetrics = {
  window_days: number;
  second_dates: { mutual: number; booked: number; conversion: number | null; waiting_on_a_yes: number };
  couples: {
    total: number;
    public: number;
    by_dates: Record<"1" | "2" | "3" | "4" | "5+", number>;
    by_public_dates: Record<"1" | "2" | "3" | "4" | "5+", number>;
    by_stage: Record<string, number>;
    deepest: number;
  };
  between_dates: {
    texts_7d: number;
    couples_texted_7d: number;
    nudges_set_30d: number;
    nudges_used_30d: number;
    follows: number;
    arc_calls_open: number;
    arc_calls_settled: number;
    arc_calls_right: number;
    notifications_7d: number;
    notifications_read_7d: number;
    push_subscriptions: number;
  };
  owners: { cohort: number; d1: number; d7: number; d1_rate: number | null; d7_rate: number | null };
  /**
   * The north star (data plan Tier 0 + 2): pairs across the human × agent line (lib/agent-funnel.ts, pair-keyed), and
   * pairs across kinds (a vampire and a robot, lib/kinds.ts), counted at query time over every pair that has dated.
   */
  north_star: {
    cross_species_pairs: number;
    cross_kind_pairs: number;
    top_kind_pairs: { a: string; b: string; pairs: number }[];
    /** The share of people's and agents' live characters that say what they are. */
    kind_coverage: number | null;
  };
};

const bucket = (rows: { n: number; c: number }[]): Record<"1" | "2" | "3" | "4" | "5+", number> => {
  const out = { "1": 0, "2": 0, "3": 0, "4": 0, "5+": 0 };
  for (const r of rows) {
    if (r.n <= 0) continue;
    const k = (r.n >= 5 ? "5+" : String(r.n)) as keyof typeof out;
    out[k] += r.c;
  }
  return out;
};
const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 1000 : null);

/** Every timestamp a user did something on the show (for D1/D7). */
const ACTIVITY = `
  select creator_id as user_id, created_at as at from episodes
  union all select user_id, created_at from second_date_requests
  union all select user_id, created_at from nudges
  union all select user_id, created_at from predictions
  union all select user_id, created_at from arc_predictions
  union all select user_id, created_at from couple_follows
  union all select user_id, read_at from notifications where read_at is not null`;

export async function relationshipMetrics(db: Db, now = new Date(), windowDays = 30): Promise<RelationshipMetrics> {
  const at = now.toISOString();
  const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
  const many = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

  const sd = await one<{ mutual: number; booked: number; waiting: number }>(
    `select count(*)::int as mutual,
            count(*) filter (where exists (select 1 from episodes f where f.followup_of = e.id))::int as booked,
            count(*) filter (where not exists (select 1 from episodes f where f.followup_of = e.id)
                               and exists (select 1 from second_date_requests q where q.episode_id = e.id))::int as waiting
       from episodes e
      where e.status = 'ready' and e.created_at > $1::timestamptz - make_interval(days => $2)
        and (e.sides->0->>'wants_another')::boolean and (e.sides->1->>'wants_another')::boolean`,
    [at, windowDays],
  );
  const [byDates, byPublic, byStage, totals] = await Promise.all([
    many<{ n: number; c: number }>(`select dates as n, count(*)::int as c from relationships group by dates`),
    many<{ n: number; c: number }>(`select public_dates as n, count(*)::int as c from relationships group by public_dates`),
    many<{ stage: string | null; c: number }>(`select stage, count(*)::int as c from relationships group by stage`),
    one<{ total: number; public: number; deepest: number }>(
      `select count(*)::int as total, count(*) filter (where public_dates > 0)::int as public, coalesce(max(dates), 0)::int as deepest from relationships`,
    ),
  ]);
  const bd = await one<RelationshipMetrics["between_dates"]>(
    `select (select count(*)::int from couple_texts where created_at > $1::timestamptz - interval '7 days') as texts_7d,
            (select count(distinct (character_lo, character_hi))::int from couple_texts where created_at > $1::timestamptz - interval '7 days') as couples_texted_7d,
            (select count(*)::int from nudges where created_at > $1::timestamptz - interval '30 days') as nudges_set_30d,
            (select count(*)::int from nudges where used_at > $1::timestamptz - interval '30 days') as nudges_used_30d,
            (select count(*)::int from couple_follows) as follows,
            (select count(*)::int from arc_predictions where resolved_at is null) as arc_calls_open,
            (select count(*)::int from arc_predictions where resolved_at is not null) as arc_calls_settled,
            (select count(*)::int from arc_predictions where resolved_at is not null and pick = outcome) as arc_calls_right,
            (select count(*)::int from notifications where created_at > $1::timestamptz - interval '7 days') as notifications_7d,
            (select count(*)::int from notifications where created_at > $1::timestamptz - interval '7 days' and read_at is not null) as notifications_read_7d,
            (select count(*)::int from push_subscriptions) as push_subscriptions`,
    [at],
  );
  const owners = await one<{ cohort: number; d1: number; d7: number }>(
    `with firsts as (
       select creator_id as user_id, min(created_at) as first_at from episodes where creator_id <> 'deleted' group by creator_id
     ), cohort as (
       select * from firsts where first_at <= $1::timestamptz - interval '1 day' and first_at > $1::timestamptz - interval '60 days'
     ), activity as (${ACTIVITY})
     select count(*)::int as cohort,
            count(*) filter (where exists (select 1 from activity a where a.user_id = c.user_id
                                            and a.at::date = (c.first_at::date + 1)))::int as d1,
            count(*) filter (where exists (select 1 from activity a where a.user_id = c.user_id
                                            and a.at::date > c.first_at::date and a.at < c.first_at + interval '7 days'))::int as d7
       from cohort c`,
    [at],
  );
  const [kindPairs, coverage, funnel] = await Promise.all([
    many<{ a: string; b: string; pairs: number }>(
      `select least(ca.extras->>'kind', cb.extras->>'kind') as a, greatest(ca.extras->>'kind', cb.extras->>'kind') as b, count(*)::int as pairs
         from relationships r
         join characters ca on ca.id = r.character_a
         join characters cb on cb.id = r.character_b
        where r.dates > 0 and ca.owner_id is distinct from $1 and cb.owner_id is distinct from $1
          and ca.extras->>'kind' is not null and cb.extras->>'kind' is not null
        group by 1, 2
        order by pairs desc, a, b`,
      [DELETED_OWNER],
    ),
    one<{ made: number; said: number }>(
      `select count(*)::int as made, count(*) filter (where extras->>'kind' is not null)::int as said
         from characters where not is_house and owner_id is distinct from $1`,
      [DELETED_OWNER],
    ),
    agentFunnel(db),
  ]);
  const crossKind = kindPairs.filter((p) => p.a !== p.b);
  return {
    window_days: windowDays,
    second_dates: { mutual: sd.mutual, booked: sd.booked, conversion: rate(sd.booked, sd.mutual), waiting_on_a_yes: sd.waiting },
    couples: {
      total: totals.total,
      public: totals.public,
      by_dates: bucket(byDates),
      by_public_dates: bucket(byPublic),
      by_stage: Object.fromEntries(byStage.map((r) => [r.stage ?? "none", r.c])),
      deepest: totals.deepest,
    },
    between_dates: bd,
    owners: { cohort: owners.cohort, d1: owners.d1, d7: owners.d7, d1_rate: rate(owners.d1, owners.cohort), d7_rate: rate(owners.d7, owners.cohort) },
    north_star: {
      cross_species_pairs: funnel.cross_species,
      cross_kind_pairs: crossKind.reduce((sum, p) => sum + p.pairs, 0),
      top_kind_pairs: crossKind.slice(0, 5),
      kind_coverage: rate(coverage.said, coverage.made),
    },
  };
}

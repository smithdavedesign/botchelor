/**
 * The Reunion special (PRD "Further ideas": "a season-finale episode built from the cast's approved
 * confessionals and the biggest moments in the relationship graph").
 *
 * Not a new date and not a model call: it is a $0 compilation assembled from data the show already has —
 * the dates that aired, the confessionals creators chose to share, the audience's ratings, and the
 * relationship graph's public stage. So it is always consistent with what happened, costs nothing, and touches no
 * invariant.
 *
 * It is THIS season's (David, 2026-11-01: "the Reunion becomes this season's"): the stats, couples, confessionals and
 * awards count only the dates that aired inside the season's window (lib/season-window.ts, a calendar month), and the
 * ratings given in it. A closed season keeps its own, frozen, on its finale page (lib/season-recap.ts uses
 * seasonReunion with that season's window). "Where they stand" is still the couple's stage today.
 */
import { portraitPathSql } from "./assets";
import { publicDateSql } from "./date-number";
import type { Db } from "./db";
import { relationshipStage } from "./mechanics";
import { healRelationships, STAGE_LABELS, type Stage } from "./relationships";
import { topRatedCharacters } from "./ratings";
import type { Ending } from "./rules";
import { seasonWindow } from "./season-window";

export type ReunionChar = { id: string; name: string; house: boolean; hue: number | null; portrait: string | null };
export type ReunionCouple = {
  a: ReunionChar;
  b: ReunionChar;
  dates: number;
  second_dates: number;
  last_ending: Ending | null;
  stage: string;
};
export type ReunionConfessional = { episode_id: string; character: ReunionChar; line: string };
export type ReunionAward = { title: string; name: string; detail: string; chars: ReunionChar[] };
export type ReunionStats = { couples: number; second_dates: number; aired: number };
export type Reunion = {
  stats: ReunionStats;
  couples: ReunionCouple[];
  confessionals: ReunionConfessional[];
  awards: ReunionAward[];
};

/** A season's window: the dates that aired from `start` up to (not including) `end`. */
export type SeasonSpan = { start: Date; end: Date };

type CoupleRow = {
  a_id: string; a_name: string; a_house: boolean; a_hue: number | null; a_portrait: string | null;
  b_id: string; b_name: string; b_house: boolean; b_hue: number | null; b_portrait: string | null;
  dates: number; second_dates: number; last_ending: Ending | null; public_stage: Stage | null;
};
const charA = (r: CoupleRow): ReunionChar => ({ id: r.a_id, name: r.a_name, house: r.a_house, hue: r.a_hue, portrait: r.a_portrait });
const charB = (r: CoupleRow): ReunionChar => ({ id: r.b_id, name: r.b_name, house: r.b_house, hue: r.b_hue, portrait: r.b_portrait });

/** The public dates that aired in the window ($1, $2): the same ones the relationship graph's public layer counts. */
export const inSpanSql = (e: string) => `${publicDateSql(e)} and ${e}.revealed_at >= $1::timestamptz and ${e}.revealed_at < $2::timestamptz`;

/**
 * Each pair's season, from its dates in the window: how many, how many ended wanting a second date, the last ending.
 * The stage is the graph's public stage now (relationships.public_stage).
 */
const SEASON_COUPLES = `
  with eps as (
    select least(e.character_a, e.character_b) as lo, greatest(e.character_a, e.character_b) as hi, e.ending, e.revealed_at, e.id
      from episodes e
     where ${inSpanSql("e")}
  ), pairs as (
    select lo, hi, count(*)::int as dates, count(*) filter (where ending = 'second_date')::int as second_dates,
           (array_agg(ending order by revealed_at desc, id desc))[1] as last_ending, max(revealed_at) as last_at
      from eps group by lo, hi
  )
  select ca.id a_id, ca.name a_name, ca.is_house a_house, ca.avatar_hue a_hue, ${portraitPathSql("ca")} a_portrait,
         cb.id b_id, cb.name b_name, cb.is_house b_house, cb.avatar_hue b_hue, ${portraitPathSql("cb")} b_portrait,
         p.dates, p.second_dates, p.last_ending, r.public_stage
    from pairs p
    join characters ca on ca.id = p.lo
    join characters cb on cb.id = p.hi
    left join relationships r on r.character_a = p.lo and r.character_b = p.hi`;

/**
 * The standout pairings of the season: the ones that dated most and got the most second dates — on the public record
 * only, so a private date or an ending that hasn't aired never makes the special.
 */
async function topCouples(db: Db, span: SeasonSpan, limit: number): Promise<ReunionCouple[]> {
  await healRelationships(db);
  const { rows } = await db.query<CoupleRow>(`${SEASON_COUPLES} order by p.second_dates desc, p.dates desc, p.last_at desc limit $3`, [
    span.start.toISOString(),
    span.end.toISOString(),
    limit,
  ]);
  return rows.map((r) => ({
    a: charA(r),
    b: charB(r),
    dates: r.dates,
    second_dates: r.second_dates,
    last_ending: r.last_ending,
    stage: r.public_stage ? STAGE_LABELS[r.public_stage] : relationshipStage(r.dates, r.second_dates, r.last_ending),
  }));
}

type ConfRow = {
  id: string;
  confessionals: [string, string] | null;
  a_id: string; a_name: string; a_house: boolean; a_hue: number | null; a_portrait: string | null;
  b_id: string; b_name: string; b_house: boolean; b_hue: number | null; b_portrait: string | null;
};

/** The confessional reel: only the lines creators chose to share, from dates aired this season (the episode page's gate). */
async function confessionalReel(db: Db, span: SeasonSpan, limit: number): Promise<ReunionConfessional[]> {
  const { rows } = await db.query<ConfRow>(
    `select e.id, e.confessionals,
            a.id a_id, a.name a_name, a.is_house a_house, a.avatar_hue a_hue, ${portraitPathSql("a")} a_portrait,
            b.id b_id, b.name b_name, b.is_house b_house, b.avatar_hue b_hue, ${portraitPathSql("b")} b_portrait
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.confessionals_shared and e.revealed_at is not null and e.visibility = 'public'
        and e.revealed_at >= $1::timestamptz and e.revealed_at < $2::timestamptz
        and e.confessionals is not null and jsonb_array_length(e.confessionals) = 2
      order by e.revealed_at desc
      limit $3`,
    [span.start.toISOString(), span.end.toISOString(), limit],
  );
  const reel: ReunionConfessional[] = [];
  for (const r of rows) {
    if (!r.confessionals) continue;
    const a: ReunionChar = { id: r.a_id, name: r.a_name, house: r.a_house, hue: r.a_hue, portrait: r.a_portrait };
    const b: ReunionChar = { id: r.b_id, name: r.b_name, house: r.b_house, hue: r.b_hue, portrait: r.b_portrait };
    if (r.confessionals[0]) reel.push({ episode_id: r.id, character: a, line: r.confessionals[0] });
    if (r.confessionals[1]) reel.push({ episode_id: r.id, character: b, line: r.confessionals[1] });
  }
  return reel;
}

type PairRow = {
  a_id: string; a_name: string; a_house: boolean; a_hue: number | null; a_portrait: string | null;
  b_id: string; b_name: string; b_house: boolean; b_hue: number | null; b_portrait: string | null;
};

/** The season's awards, each included only when there is data for it. */
export async function seasonAwards(db: Db, span: SeasonSpan): Promise<ReunionAward[]> {
  const out: ReunionAward[] = [];
  const window = [span.start.toISOString(), span.end.toISOString()];

  const golden = (await db.query<CoupleRow>(`${SEASON_COUPLES} where p.second_dates > 0 order by p.second_dates desc, p.dates desc, p.last_at desc limit 1`, window))
    .rows[0];
  if (golden) {
    out.push({
      title: "🏆 The golden couple",
      name: `${golden.a_name} × ${golden.b_name}`,
      detail: `${golden.second_dates} second ${golden.second_dates === 1 ? "date" : "dates"} out of ${golden.dates}.`,
      chars: [charA(golden), charB(golden)],
    });
  }

  const worst = (
    await db.query<PairRow>(
      `select a.id a_id, a.name a_name, a.is_house a_house, a.avatar_hue a_hue, ${portraitPathSql("a")} a_portrait,
              b.id b_id, b.name b_name, b.is_house b_house, b.avatar_hue b_hue, ${portraitPathSql("b")} b_portrait
         from episodes e
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
        where e.ending = 'disaster' and ${inSpanSql("e")}
        order by e.revealed_at desc limit 1`,
      window,
    )
  ).rows[0];
  if (worst) {
    out.push({
      title: "💥 Biggest disaster",
      name: `${worst.a_name} × ${worst.b_name}`,
      detail: "A date the whole audience is still talking about.",
      chars: [
        { id: worst.a_id, name: worst.a_name, house: worst.a_house, hue: worst.a_hue, portrait: worst.a_portrait },
        { id: worst.b_id, name: worst.b_name, house: worst.b_house, hue: worst.b_hue, portrait: worst.b_portrait },
      ],
    });
  }

  const likable = (await topRatedCharacters(db, "likable", 1, span))[0];
  if (likable) {
    out.push({
      title: "💗 Fan favourite",
      name: likable.name,
      detail: `${likable.count} ${likable.count === 1 ? "viewer" : "viewers"} called them the most likable.`,
      chars: [{ id: likable.id, name: likable.name, house: likable.house, hue: likable.hue, portrait: likable.portrait }],
    });
  }

  const surprising = (await topRatedCharacters(db, "surprising", 1, span))[0];
  if (surprising) {
    out.push({
      title: "🤯 Full of surprises",
      name: surprising.name,
      detail: `Voted the most surprising of the season.`,
      chars: [{ id: surprising.id, name: surprising.name, house: surprising.house, hue: surprising.hue, portrait: surprising.portrait }],
    });
  }

  return out;
}

async function reunionStats(db: Db, span: SeasonSpan): Promise<ReunionStats> {
  const { rows } = await db.query<ReunionStats>(
    `select count(distinct (least(e.character_a, e.character_b), greatest(e.character_a, e.character_b)))::int as couples,
            count(*) filter (where e.ending = 'second_date')::int as second_dates,
            count(*)::int as aired
       from episodes e
      where ${inSpanSql("e")}`,
    [span.start.toISOString(), span.end.toISOString()],
  );
  return rows[0] ?? { couples: 0, second_dates: 0, aired: 0 };
}

/** One season's Reunion, from the dates that aired in its window. $0, no model call. */
export async function seasonReunion(db: Db, span: SeasonSpan): Promise<Reunion> {
  const [stats, couples, confessionals, computedAwards] = await Promise.all([
    reunionStats(db, span),
    topCouples(db, span, 6),
    confessionalReel(db, span, 8),
    seasonAwards(db, span),
  ]);
  return { stats, couples, confessionals, awards: computedAwards };
}

/** This season's Reunion (the season containing `now`). */
export async function getReunion(db: Db, now: Date = new Date()): Promise<Reunion> {
  return seasonReunion(db, seasonWindow(now));
}

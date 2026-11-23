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
import { originSql, type Origin } from "./origin";
import { pronounForms } from "./pronoun-forms";
import { listedDateSql } from "./public-cast";
import { shownStage } from "./relationship-stages";
import { healRelationships, STAGE_LABELS, type Stage } from "./relationships";
import { topRatedCharacters } from "./ratings";
import type { Ending } from "./rules";
import { seasonWindow } from "./season-window";

/** `origin` (lib/origin.ts): agent-made characters wear their badge in the special; absent in recaps frozen before 2026-11-14. */
export type ReunionChar = { id: string; name: string; house: boolean; hue: number | null; portrait: string | null; origin?: Origin };
export type ReunionCouple = {
  a: ReunionChar;
  b: ReunionChar;
  dates: number;
  second_dates: number;
  last_ending: Ending | null;
  stage: string;
};
export type ReunionConfessional = { episode_id: string; character: ReunionChar; line: string };
/**
 * `detail` never carries a crowd count; an award with one ("7 viewers called them the most likable") puts it in `count`
 * and the counted words in `count_line`, and the page shows those only when the empty-room rule allows
 * (lib/crowd-threshold.ts): to a stranger, two votes is "called the most likable", not "2 viewers".
 */
export type ReunionAward = { title: string; name: string; detail: string; chars: ReunionChar[]; count?: number; count_line?: string };
export type ReunionStats = { couples: number; second_dates: number; aired: number };
export type Reunion = {
  stats: ReunionStats;
  couples: ReunionCouple[];
  confessionals: ReunionConfessional[];
  awards: ReunionAward[];
};

/** A season's window: the dates that aired from `start` up to (not including) `end`. */
export type SeasonSpan = { start: Date; end: Date };

type PairRow = {
  a_id: string; a_name: string; a_house: boolean; a_hue: number | null; a_portrait: string | null; a_origin: Origin;
  b_id: string; b_name: string; b_house: boolean; b_hue: number | null; b_portrait: string | null; b_origin: Origin;
};
type CoupleRow = PairRow & { dates: number; second_dates: number; last_ending: Ending | null; public_stage: Stage | null; public_shown_stage: Stage | null };
const charA = (r: PairRow): ReunionChar => ({ id: r.a_id, name: r.a_name, house: r.a_house, hue: r.a_hue, portrait: r.a_portrait, origin: r.a_origin });
const charB = (r: PairRow): ReunionChar => ({ id: r.b_id, name: r.b_name, house: r.b_house, hue: r.b_hue, portrait: r.b_portrait, origin: r.b_origin });
/** The two characters' columns for charA/charB, from the aliases `a` and `b`. */
const pairCols = (a: string, b: string) =>
  `${a}.id a_id, ${a}.name a_name, ${a}.is_house a_house, ${a}.avatar_hue a_hue, ${portraitPathSql(a)} a_portrait, ${originSql(a)} a_origin,
   ${b}.id b_id, ${b}.name b_name, ${b}.is_house b_house, ${b}.avatar_hue b_hue, ${portraitPathSql(b)} b_portrait, ${originSql(b)} b_origin`;

/**
 * The public dates that aired in the window ($1, $2): the same ones the relationship graph's public layer counts, between
 * characters whose accounts still exist (lib/public-cast.ts: a deleted account's character never makes the special).
 */
export const inSpanSql = (e: string) =>
  `${publicDateSql(e)} and ${e}.revealed_at >= $1::timestamptz and ${e}.revealed_at < $2::timestamptz and ${listedDateSql(e)}`;

/**
 * Each pair's season, from its dates in the window: how many, how many ended wanting a second date, the last ending.
 * The stage is the graph's public stage now, as it is shown (relationships.public_shown_stage, else public_stage).
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
  select ${pairCols("ca", "cb")},
         p.dates, p.second_dates, p.last_ending, r.public_stage, r.public_shown_stage
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
    // As it is shown (lib/relationship-stages.ts): the fuller reading, or the base one with the switch off.
    stage: ((st) => (st ? STAGE_LABELS[st] : relationshipStage(r.dates, r.second_dates, r.last_ending)))(shownStage(r.public_stage, r.public_shown_stage)),
  }));
}

type ConfRow = PairRow & { id: string; confessionals: [string, string] | null };

/** The confessional reel: only the lines creators chose to share, from dates aired this season (the episode page's gate). */
async function confessionalReel(db: Db, span: SeasonSpan, limit: number): Promise<ReunionConfessional[]> {
  const { rows } = await db.query<ConfRow>(
    `select e.id, e.confessionals, ${pairCols("a", "b")}
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.confessionals_shared and e.revealed_at is not null and e.visibility = 'public'
        and e.revealed_at >= $1::timestamptz and e.revealed_at < $2::timestamptz and ${listedDateSql("e")}
        and e.confessionals is not null and jsonb_array_length(e.confessionals) = 2
      order by e.revealed_at desc
      limit $3`,
    [span.start.toISOString(), span.end.toISOString(), limit],
  );
  const reel: ReunionConfessional[] = [];
  for (const r of rows) {
    if (!r.confessionals) continue;
    const a = charA(r);
    const b = charB(r);
    if (r.confessionals[0]) reel.push({ episode_id: r.id, character: a, line: r.confessionals[0] });
    if (r.confessionals[1]) reel.push({ episode_id: r.id, character: b, line: r.confessionals[1] });
  }
  return reel;
}

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
      // The figure first, for the card's count-up (app/AwardCard.tsx); said as the couple boards say it (lib/rules.ts yesesTail).
      detail: `${golden.second_dates} of ${golden.dates} ${golden.dates === 1 ? "date" : "dates"} ended in a yes to another.`,
      chars: [charA(golden), charB(golden)],
    });
  }

  const worst = (
    await db.query<PairRow>(
      `select ${pairCols("a", "b")}
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
      detail: "The date that went most wrong this season.",
      chars: [charA(worst), charB(worst)],
    });
  }

  const likable = (await topRatedCharacters(db, "likable", 1, span))[0];
  if (likable) {
    out.push({
      title: "💗 Fan favourite",
      name: likable.name,
      detail: "Called the most likable of the season.",
      count: likable.count,
      // In their own pronouns (2026-11-22 audit: "10 viewers called them the most likable" about Barnaby, he/him).
      count_line: `${likable.count} ${likable.count === 1 ? "viewer" : "viewers"} called ${pronounForms(likable.pronouns).obj} the most likable.`,
      chars: [{ id: likable.id, name: likable.name, house: likable.house, hue: likable.hue, portrait: likable.portrait, origin: likable.origin }],
    });
  }

  // One character, one of the two viewer awards (2026-11-16: Barnaby held three of the four cards): the most surprising
  // who isn't already the fan favourite, when there is one.
  const surprises = await topRatedCharacters(db, "surprising", 2, span);
  const surprising = surprises.find((s) => s.id !== likable?.id) ?? surprises[0];
  if (surprising) {
    out.push({
      title: "🤯 Full of surprises",
      name: surprising.name,
      detail: `Voted the most surprising of the season.`,
      chars: [{ id: surprising.id, name: surprising.name, house: surprising.house, hue: surprising.hue, portrait: surprising.portrait, origin: surprising.origin }],
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

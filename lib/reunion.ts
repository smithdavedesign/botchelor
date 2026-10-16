/**
 * The Reunion special (PRD "Further ideas": "a season-finale episode built from the cast's approved
 * confessionals and the biggest moments in the relationship graph").
 *
 * Not a new date and not a model call: it is a $0 compilation assembled from data the show already has —
 * the relationship graph, the confessionals creators chose to share, the audience leaderboard, and the
 * aired endings. So it is always consistent with what happened, costs nothing, and touches no invariant.
 */
import { portraitPathSql } from "./assets";
import type { Db } from "./db";
import { relationshipStage } from "./mechanics";
import { topRatedCharacters } from "./ratings";
import type { Ending } from "./rules";

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

type CoupleRow = {
  a_id: string; a_name: string; a_house: boolean; a_hue: number | null; a_portrait: string | null;
  b_id: string; b_name: string; b_house: boolean; b_hue: number | null; b_portrait: string | null;
  dates: number; second_dates: number; last_ending: Ending | null;
};
const charA = (r: CoupleRow): ReunionChar => ({ id: r.a_id, name: r.a_name, house: r.a_house, hue: r.a_hue, portrait: r.a_portrait });
const charB = (r: CoupleRow): ReunionChar => ({ id: r.b_id, name: r.b_name, house: r.b_house, hue: r.b_hue, portrait: r.b_portrait });

const COUPLE_SELECT = `
  select ca.id a_id, ca.name a_name, ca.is_house a_house, ca.avatar_hue a_hue, ${portraitPathSql("ca")} a_portrait,
         cb.id b_id, cb.name b_name, cb.is_house b_house, cb.avatar_hue b_hue, ${portraitPathSql("cb")} b_portrait,
         r.dates, r.second_dates, r.last_ending
    from relationships r
    join characters ca on ca.id = r.character_a
    join characters cb on cb.id = r.character_b`;

/** The standout pairings: the ones that dated most and got the most second dates. */
async function topCouples(db: Db, limit: number): Promise<ReunionCouple[]> {
  const { rows } = await db.query<CoupleRow>(
    `${COUPLE_SELECT} order by r.second_dates desc, r.dates desc, r.updated_at desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    a: charA(r),
    b: charB(r),
    dates: r.dates,
    second_dates: r.second_dates,
    last_ending: r.last_ending,
    stage: relationshipStage(r.dates, r.second_dates, r.last_ending),
  }));
}

type ConfRow = {
  id: string;
  confessionals: [string, string] | null;
  a_id: string; a_name: string; a_house: boolean; a_hue: number | null; a_portrait: string | null;
  b_id: string; b_name: string; b_house: boolean; b_hue: number | null; b_portrait: string | null;
};

/** The confessional reel: only the lines creators chose to share, from aired episodes (same gate as the episode page). */
async function confessionalReel(db: Db, limit: number): Promise<ReunionConfessional[]> {
  const { rows } = await db.query<ConfRow>(
    `select e.id, e.confessionals,
            a.id a_id, a.name a_name, a.is_house a_house, a.avatar_hue a_hue, ${portraitPathSql("a")} a_portrait,
            b.id b_id, b.name b_name, b.is_house b_house, b.avatar_hue b_hue, ${portraitPathSql("b")} b_portrait
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.confessionals_shared and e.revealed_at is not null and e.visibility = 'public'
        and e.confessionals is not null and jsonb_array_length(e.confessionals) = 2
      order by e.revealed_at desc
      limit $1`,
    [limit],
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

/** A few computed season awards, each included only when there is data for it. */
async function awards(db: Db): Promise<ReunionAward[]> {
  const out: ReunionAward[] = [];

  const golden = (
    await db.query<CoupleRow>(`${COUPLE_SELECT} where r.second_dates > 0 order by r.second_dates desc, r.dates desc limit 1`)
  ).rows[0];
  if (golden) {
    out.push({
      title: "🏆 The golden couple",
      name: `${golden.a_name} & ${golden.b_name}`,
      detail: `${golden.second_dates} second ${golden.second_dates === 1 ? "date" : "dates"} out of ${golden.dates}.`,
      chars: [charA(golden), charB(golden)],
    });
  }

  const worst = (
    await db.query<{ a_name: string; b_name: string; a_id: string; b_id: string; a_house: boolean; b_house: boolean; a_hue: number | null; b_hue: number | null; a_portrait: string | null; b_portrait: string | null }>(
      `select a.id a_id, a.name a_name, a.is_house a_house, a.avatar_hue a_hue, ${portraitPathSql("a")} a_portrait,
              b.id b_id, b.name b_name, b.is_house b_house, b.avatar_hue b_hue, ${portraitPathSql("b")} b_portrait
         from episodes e
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
        where e.ending = 'disaster' and e.revealed_at is not null and e.visibility = 'public'
        order by e.revealed_at desc limit 1`,
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

  const likable = (await topRatedCharacters(db, "likable", 1))[0];
  if (likable) {
    out.push({
      title: "💗 Fan favourite",
      name: likable.name,
      detail: `${likable.count} ${likable.count === 1 ? "viewer" : "viewers"} called them the most likable.`,
      chars: [{ id: likable.id, name: likable.name, house: likable.house, hue: likable.hue, portrait: likable.portrait }],
    });
  }

  const surprising = (await topRatedCharacters(db, "surprising", 1))[0];
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

async function reunionStats(db: Db): Promise<ReunionStats> {
  const { rows } = await db.query<ReunionStats>(
    `select (select count(*)::int from relationships) as couples,
            (select coalesce(sum(second_dates), 0)::int from relationships) as second_dates,
            (select count(*)::int from episodes where revealed_at is not null and status = 'ready' and visibility = 'public') as aired`,
  );
  return rows[0] ?? { couples: 0, second_dates: 0, aired: 0 };
}

/** Assemble the whole Reunion special from existing data. $0, no model call. */
export async function getReunion(db: Db): Promise<Reunion> {
  const [stats, couples, confessionals, computedAwards] = await Promise.all([
    reunionStats(db),
    topCouples(db, 6),
    confessionalReel(db, 8),
    awards(db),
  ]);
  return { stats, couples, confessionals, awards: computedAwards };
}

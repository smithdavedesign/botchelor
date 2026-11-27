/**
 * The Hall of Fame (Agent World phase 3, owner's call 2026-11-27: "Do 2 go wild"): the show's all-time records on one
 * page and one MCP tool (get_hall_of_fame). Every season's champions, the most-awarded characters, the longest-running
 * couples, who has been on the most dates, and the best callers of all time.
 *
 * Everything is read from what the show already records, so nothing here is new state:
 *  - champions: each closed season's final rose (ceremonies, finale) and golden couple (season_recaps, frozen);
 *  - awards: season_awards, the rows a frozen recap writes for each winner;
 *  - couples and dates: only dates that aired publicly (relationships.public_*, publicDateSql), as every public board;
 *  - callers: right ending calls on public dates that aired, named by display name only ("A viewer" without one).
 *
 * The public rules hold: a deleted account's characters never lead a board (listedCharacterSql); a private character is
 * named by name only, with no face and no link (`private: true`); After Dark lives in its own tables and never shows here.
 */
import type { Db } from "./db";
import { publicDateSql } from "./date-number";
import { withPortraits } from "./portrait-sql";
import { listedCharacterSql } from "./public-cast";
import { closedSeasons, type SeasonRef } from "./season-ref";
import { tournamentChampions } from "./tournaments";

/** How many rows each board shows. */
export const HALL_BOARD_SIZE = 10;
/** The sharpest-caller board counts only callers with at least this many calls, so one lucky call doesn't top it. */
export const SHARPEST_MIN_CALLS = 20;

export type HallChar = { id: string; name: string; house: boolean; hue: number | null; portrait: string | null; private?: true };
export type HallChampion = {
  season: SeasonRef;
  /** The finale's final rose: the lead and who they gave it to. Null when the season had no finale ceremony. */
  final_rose: { lead: HallChar; winner: HallChar } | null;
  /** The season's golden couple from its frozen recap, or null (none made it to a second yes, or not frozen yet). */
  golden: { a: HallChar; b: HallChar; dates: number; second_dates: number } | null;
};
export type HallAwarded = { character: HallChar; awards: number; titles: string[] };
export type HallCouple = { a: HallChar; b: HallChar; dates: number; second_dates: number; stage: string | null };
export type HallDater = { character: HallChar; dates: number; second_dates: number };
export type HallCaller = { name: string | null; right: number; called: number; accuracy: number };
export type HallOfFame = {
  champions: HallChampion[];
  most_awarded: HallAwarded[];
  longest_couples: HallCouple[];
  most_dates: HallDater[];
  best_callers: HallCaller[];
  sharpest_callers: HallCaller[];
  /** Each finished tournament's champion (lib/tournaments.ts), the newest first. */
  tournament_champions: { title: string; path: string; ends_at: string; champion: HallChar }[];
  numbers: { seasons: number; dates_aired: number; second_dates: number; calls: number };
};

type CharRow = { id: string; name: string; is_house: boolean; hue: number | null; visibility: string };

/** Characters by id, each with a face unless private (withPortraits leaves a private one's null). */
async function charactersById(db: Db, ids: Iterable<string>): Promise<Map<string, HallChar>> {
  const list = [...new Set(ids)];
  if (!list.length) return new Map();
  const { rows } = await db.query<CharRow>(`select id, name, is_house, avatar_hue as hue, visibility from characters c where c.id = any($1) and ${listedCharacterSql("c")}`, [list]);
  const faced = await withPortraits(db, rows);
  return new Map(
    faced.map((r) => [
      r.id,
      { id: r.id, name: r.name, house: r.is_house, hue: r.hue, portrait: r.visibility === "private" ? null : r.portrait, ...(r.visibility === "private" ? { private: true as const } : {}) },
    ]),
  );
}

const accuracy = (right: number, called: number) => (called ? Math.round((right / called) * 100) : 0);

/** The whole Hall of Fame. `now` decides which seasons are closed (only a closed season has champions). */
export async function hallOfFame(db: Db, now: Date = new Date()): Promise<HallOfFame> {
  const seasons = closedSeasons(now);
  const seasonIds = seasons.map((s) => s.id);
  const pub = publicDateSql("e");

  const [roses, goldens, awarded, couples, daters, callers, numbers, brackets] = await Promise.all([
    db.query<{ season_id: string; lead_id: string; final_rose: string }>(
      `select season_id, lead_id, final_rose from ceremonies where finale and final_rose is not null and season_id = any($1)`,
      [seasonIds],
    ),
    db.query<{ season_id: string; a: string | null; b: string | null; dates: number | null; second_dates: number | null }>(
      `select season_id, data->'golden'->'a'->>'id' as a, data->'golden'->'b'->>'id' as b,
              (data->'golden'->>'dates')::int as dates, (data->'golden'->>'second_dates')::int as second_dates
         from season_recaps where frozen_at is not null and season_id = any($1) and data->'golden' is not null and jsonb_typeof(data->'golden') = 'object'`,
      [seasonIds],
    ),
    db.query<{ character_id: string; awards: number; titles: string[] }>(
      `select sa.character_id, count(*)::int as awards, array_agg(sa.title order by sa.season_id desc, sa.slot) as titles
         from season_awards sa join characters c on c.id = sa.character_id
        where ${listedCharacterSql("c")}
        group by sa.character_id order by awards desc, max(sa.season_id) desc, sa.character_id limit $1`,
      [HALL_BOARD_SIZE],
    ),
    db.query<{ character_a: string; character_b: string; dates: number; second_dates: number; stage: string | null }>(
      `select r.character_a, r.character_b, r.public_dates as dates, r.public_second_dates as second_dates, r.public_stage as stage
         from relationships r
         join characters a on a.id = r.character_a join characters b on b.id = r.character_b
        where r.public_dates >= 2 and ${listedCharacterSql("a")} and ${listedCharacterSql("b")}
        order by r.public_dates desc, r.public_second_dates desc, r.first_at asc nulls last, r.character_a, r.character_b limit $1`,
      [HALL_BOARD_SIZE],
    ),
    db.query<{ id: string; dates: number; second_dates: number }>(
      `select x.id, count(*)::int as dates, count(*) filter (where x.ending = 'second_date')::int as second_dates
         from (select e.character_a as id, e.ending from episodes e where ${pub}
               union all select e.character_b as id, e.ending from episodes e where ${pub}) x
         join characters c on c.id = x.id
        where ${listedCharacterSql("c")}
        group by x.id order by dates desc, second_dates desc, x.id limit $1`,
      [HALL_BOARD_SIZE],
    ),
    db.query<{ user_id: string; name: string | null; hits: number; called: number }>(
      `select p.user_id, pr.name, count(*) filter (where p.pick = e.ending)::int as hits, count(*)::int as called
         from predictions p join episodes e on e.id = p.episode_id left join profiles pr on pr.user_id = p.user_id
        where e.revealed_at is not null and e.visibility = 'public' and e.ending is not null
        group by p.user_id, pr.name having count(*) filter (where p.pick = e.ending) > 0`,
    ),
    db.query<{ dates_aired: number; second_dates: number; calls: number }>(
      `select (select count(*)::int from episodes e where ${pub}) as dates_aired,
              (select count(*)::int from episodes e where ${pub} and e.ending = 'second_date') as second_dates,
              (select count(*)::int from predictions p join episodes e on e.id = p.episode_id
                where e.revealed_at is not null and e.visibility = 'public' and e.ending is not null) as calls`,
    ),
    tournamentChampions(db, now).catch(() => []),
  ]);

  const chars = await charactersById(db, [
    ...roses.rows.flatMap((r) => [r.lead_id, r.final_rose]),
    ...goldens.rows.flatMap((r) => [r.a, r.b].filter((x): x is string => !!x)),
    ...awarded.rows.map((r) => r.character_id),
    ...couples.rows.flatMap((r) => [r.character_a, r.character_b]),
    ...daters.rows.map((r) => r.id),
    ...brackets.map((b) => b.champion.id),
  ]);
  const roseBy = new Map(roses.rows.map((r) => [r.season_id, r]));
  const goldenBy = new Map(goldens.rows.map((r) => [r.season_id, r]));

  const champions: HallChampion[] = seasons.map((season) => {
    const rose = roseBy.get(season.id);
    const lead = rose ? chars.get(rose.lead_id) : undefined;
    const winner = rose ? chars.get(rose.final_rose) : undefined;
    const g = goldenBy.get(season.id);
    const ga = g?.a ? chars.get(g.a) : undefined;
    const gb = g?.b ? chars.get(g.b) : undefined;
    return {
      season,
      final_rose: lead && winner ? { lead, winner } : null,
      golden: ga && gb ? { a: ga, b: gb, dates: g?.dates ?? 0, second_dates: g?.second_dates ?? 0 } : null,
    };
  });

  const toCaller = (r: { name: string | null; hits: number; called: number }): HallCaller => ({
    name: r.name?.trim() || null,
    right: r.hits,
    called: r.called,
    accuracy: accuracy(r.hits, r.called),
  });
  const best = [...callers.rows].sort((x, y) => y.hits - x.hits || x.called - y.called || x.user_id.localeCompare(y.user_id)).slice(0, HALL_BOARD_SIZE).map(toCaller);
  const sharpest = callers.rows
    .filter((r) => r.called >= SHARPEST_MIN_CALLS)
    .sort((x, y) => y.hits / y.called - x.hits / x.called || y.called - x.called || x.user_id.localeCompare(y.user_id))
    .slice(0, HALL_BOARD_SIZE)
    .map(toCaller);

  const n = numbers.rows[0] ?? { dates_aired: 0, second_dates: 0, calls: 0 };
  return {
    champions,
    most_awarded: awarded.rows.flatMap((r) => {
      const c = chars.get(r.character_id);
      return c ? [{ character: c, awards: r.awards, titles: [...new Set(r.titles)] }] : [];
    }),
    longest_couples: couples.rows.flatMap((r) => {
      const a = chars.get(r.character_a);
      const b = chars.get(r.character_b);
      return a && b ? [{ a, b, dates: r.dates, second_dates: r.second_dates, stage: r.stage }] : [];
    }),
    most_dates: daters.rows.flatMap((r) => {
      const c = chars.get(r.id);
      return c ? [{ character: c, dates: r.dates, second_dates: r.second_dates }] : [];
    }),
    best_callers: best,
    sharpest_callers: sharpest,
    tournament_champions: brackets.flatMap((b) => {
      const c = chars.get(b.champion.id);
      return c ? [{ title: b.tournament.title, path: b.tournament.path, ends_at: b.tournament.ends_at, champion: c }] : [];
    }),
    numbers: { seasons: seasons.length, ...n },
  };
}

/** One season's champions as a line: "Season 2 (November 2026): Maren gave the final rose to Dash; golden couple Ada × Bo." */
export function championLine(c: HallChampion): string {
  const parts: string[] = [];
  if (c.final_rose) parts.push(`${c.final_rose.lead.name} gave the final rose to ${c.final_rose.winner.name}`);
  if (c.golden) parts.push(`golden couple ${c.golden.a.name} × ${c.golden.b.name}`);
  return `Season ${c.season.number} (${c.season.label}): ${parts.length ? parts.join("; ") : "no couple made it to a second yes"}.`;
}

/** For the MCP: the same record with ids and names, no portrait paths. */
export function hallForAgents(h: HallOfFame) {
  const who = (c: HallChar) => ({ id: c.id, name: c.name, house: c.house, ...(c.private ? { private: true } : {}) });
  return {
    numbers: h.numbers,
    champions: h.champions.map((c) => ({
      season: { id: c.season.id, number: c.season.number, label: c.season.label, path: c.season.path },
      final_rose: c.final_rose ? { lead: who(c.final_rose.lead), winner: who(c.final_rose.winner) } : null,
      golden_couple: c.golden ? { a: who(c.golden.a), b: who(c.golden.b), dates: c.golden.dates, second_dates: c.golden.second_dates } : null,
      line: championLine(c),
    })),
    most_awarded: h.most_awarded.map((r) => ({ character: who(r.character), awards: r.awards, titles: r.titles })),
    longest_couples: h.longest_couples.map((r) => ({ a: who(r.a), b: who(r.b), dates_aired: r.dates, second_dates: r.second_dates, stage: r.stage })),
    most_dates: h.most_dates.map((r) => ({ character: who(r.character), dates_aired: r.dates, second_dates: r.second_dates })),
    best_callers: h.best_callers.map((r) => ({ name: r.name ?? "A viewer", right: r.right, called: r.called, accuracy_pct: r.accuracy })),
    sharpest_callers: h.sharpest_callers.map((r) => ({ name: r.name ?? "A viewer", right: r.right, called: r.called, accuracy_pct: r.accuracy })),
    tournament_champions: h.tournament_champions.map((t) => ({ tournament: t.title, ended_at: t.ends_at, champion: who(t.champion) })),
    note:
      "All-time records from dates that aired publicly. Champions are each closed season's final rose and golden couple. " +
      `Sharpest callers count only callers with at least ${SHARPEST_MIN_CALLS} calls. Callers are named by display name only. ` +
      "A private character is named but not linked. The page is botchelor.com/hall-of-fame.",
  };
}

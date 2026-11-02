/**
 * A season's finale page (David 2026-11-01: "there's no season recap or anything showing the show's arc"): for a closed
 * monthly season, /seasons/october-2026 tells it. "Previously on Botchelor" (who arrived, the first spark, the couples
 * who formed and broke, the golden couple), each couple's season in one line, the dates to rewatch, the season's awards
 * (lib/reunion.ts, scoped to its window), who stayed and who left (each leaver's last confessional as their goodbye),
 * and the season in numbers.
 *
 *  - Frozen: nothing runs at the deadline. The first read after the season closes (the database's clock, as in
 *    lib/seasons.ts) claims the season's row in season_recaps, computes the recap and stores it; every read after that
 *    is the stored row, so the page never changes. A claim that died half-way (no data after CLAIM_STALE_MS) is
 *    taken over by the next read. A reader that loses the race shows the recap computed for itself, with the template
 *    narrative, until the stored one lands.
 *  - Public only: dates that aired publicly (lib/date-number.ts publicDateSql) between public characters, the
 *    takes the diary cam shows (a house character's own, or a shared one), the public stage moves.
 *  - Money: the narrative is one call a season on the show's default model with no paid upgrade (getModel(…, false),
 *    as the mixer's room lines, lib/mixer-voice.ts), checked (content filter, English, length, the golden couple named),
 *    with a fixed-text fallback stored the same way. About 1¢ a season, never per page view.
 */
import { portraitPathSql } from "./assets";
import { trimTo } from "./conversation";
import type { Db } from "./db";
import { needsTranslation } from "./language-check";
import { getModel, type Model } from "./model";
import { shortName } from "./names";
import { inSpanSql, seasonAwards, type ReunionAward, type ReunionChar } from "./reunion";
import { STAGE_LABELS, type Stage } from "./relationships";
import type { Ending } from "./rules";
import { checkFields } from "./safety";
import { isMonthlySeason, seasonNumber, seasonRef, type SeasonRef } from "./season-ref";
import { seasonWindow } from "./season-window";
import { venuePhrase } from "./venues";

/**
 * The stored recap's version. A row written by an older one is computed and frozen again on its next read (the one way
 * a finale ever changes: a code change that bumps this, never a page view).
 */
export const RECAP_VERSION = 1;
/** How many couples get their season in one line, how many dates to rewatch. */
export const COUPLES_LINED = 8;
export const REWATCH_SHOWN = 5;
/** The longest the "Previously on" narrative may be. */
export const NARRATIVE_MAX = 900;
/** A claim with no data after this long died half-way: the next read takes it over. */
export const CLAIM_STALE_MS = 5 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const CODE_FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

// On in production; the shared test harness turns it off (tests script only the date's model). Tests of this file turn
// it back on with a model of their own.
let voiceEnabled = true;
export function setSeasonRecapVoiceEnabledForTests(on: boolean): void {
  voiceEnabled = on;
}

export type RecapChar = ReunionChar;
export type RecapPair = { a: RecapChar; b: RecapChar };
export type RecapCouple = RecapPair & { dates: number; second_dates: number; last_ending: Ending; line: string; stage: string | null };
export type RecapEpisode = RecapPair & { id: string; ending: Ending; place: string | null; day: number; calls: number; best_line: string | null };
export type RecapCastMember = { character: RecapChar; stayed: boolean; goodbye: { line: string; episode_id: string } | null };
export type RecapNumbers = { aired: number; couples: number; second_dates: number; disasters: number; calls: number; debuts: number };

export type SeasonRecapData = {
  v: number;
  season: SeasonRef;
  starts_at: string;
  ends_at: string;
  numbers: RecapNumbers;
  /** The season's cast in billing order, whether each stayed on for the next, and the leavers' goodbyes. */
  cast: RecapCastMember[];
  /** Characters whose first public date aired this season, the busiest first. */
  arrivals: RecapChar[];
  /** The season's first spark: the first new couple whose first date ended with both wanting another. */
  first_spark: (RecapPair & { day: number; place: string | null }) | null;
  /** Couples who moved to dating or going steady this season, and couples who broke (from a spark or more to exes or bad blood). */
  formed: (RecapPair & { label: string })[];
  broken: (RecapPair & { label: string })[];
  golden: RecapCouple | null;
  couples: RecapCouple[];
  rewatch: RecapEpisode[];
  awards: ReunionAward[];
};

export type SeasonRecap = { data: SeasonRecapData; narrative: string; narrative_by: "model" | "template"; frozen_at: string | null };

// ---------------------------------------------------------------------------------------------------------------------
// One line per couple

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
export const countWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);

/**
 * A date's place, short ("a basement jazz bar", "Chud's place"), or null when it has none stored. The venue names carry
 * their trouble ("a cooking class with a nervous smoke alarm", "goat yoga (one goat has a favourite)"), which reads well
 * on an episode and badly three times in one line: the line keeps the place and drops the rest.
 */
export function placeOf(venue: string | null): string | null {
  if (!venue) return null;
  const phrase = venuePhrase(venue);
  const short = phrase
    .replace(/\s*\([^)]*\)/g, "")
    .split(/,\s/)[0]
    .split(/\s(?:with|that|on|where|for|while|during)\s/)[0]
    .trim();
  return short || phrase;
}

export type LineDate = { at: Date; venue: string | null; ending: Ending };

/**
 * A couple's season in one line, from their dates in it (oldest first): "Met on day 2 at the jazz bar, three dates,
 * second date at a pottery class, last seen at the night market, still going." A couple who'd dated before the season
 * are "back on day N"; a single date says how it went.
 */
export function coupleLine(dates: readonly LineDate[], seasonStart: Date, datedBefore: boolean): string {
  if (!dates.length) return "";
  const first = dates[0];
  const last = dates[dates.length - 1];
  const day = Math.floor((first.at.getTime() - seasonStart.getTime()) / DAY_MS) + 1;
  const at = (v: string | null) => (placeOf(v) ? ` at ${placeOf(v)}` : "");
  const parts = [`${datedBefore ? "back" : "met"} on day ${day}${at(first.venue)}`];
  const how = (e: Ending) => (e === "second_date" ? "still going" : e === "friends" ? "ended as friends" : "ended in disaster");
  if (dates.length === 1) {
    parts[0] += first.ending === "second_date" ? ", and both wanted more" : first.ending === "friends" ? ", and stayed friends" : ", and it was a disaster";
  } else if (dates.length === 2 && !datedBefore) {
    // Their second date is their last: one clause, not the same place twice.
    parts.push("two dates", `second date${at(last.venue)}`, how(last.ending));
  } else {
    parts.push(`${countWord(dates.length)} dates`);
    if (!datedBefore) parts.push(`second date${at(dates[1].venue)}`);
    const where = at(last.venue);
    parts.push(last.ending === "second_date" ? `last seen${where}, still going` : `${how(last.ending)}${where}`);
  }
  const line = parts.join(", ");
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Computing the recap from what aired

type CharCols = { a_id: string; a_name: string; a_house: boolean; a_hue: number | null; a_portrait: string | null; b_id: string; b_name: string; b_house: boolean; b_hue: number | null; b_portrait: string | null };
const charCols = (x: string, p: string) => `${x}.id ${p}_id, ${x}.name ${p}_name, ${x}.is_house ${p}_house, ${x}.avatar_hue ${p}_hue, ${portraitPathSql(x)} ${p}_portrait`;
const pairOf = (r: CharCols): RecapPair => ({
  a: { id: r.a_id, name: r.a_name, house: r.a_house, hue: r.a_hue, portrait: r.a_portrait },
  b: { id: r.b_id, name: r.b_name, house: r.b_house, hue: r.b_hue, portrait: r.b_portrait },
});
/** The season's public dates between public characters, as `e` joined to `a` and `b` (bind $1, $2: the window). */
const SEASON_DATES = `episodes e
    join characters a on a.id = least(e.character_a, e.character_b)
    join characters b on b.id = greatest(e.character_a, e.character_b)
   where ${inSpanSql("e")} and a.visibility = 'public' and b.visibility = 'public'`;

const dayOf = (at: Date | string, start: Date) => Math.floor((new Date(at).getTime() - start.getTime()) / DAY_MS) + 1;
/** A confessional sometimes starts with its speaker's name ("Rafe: He asked..."): the goodbye drops it. */
const unlabelled = (line: string, name: string) => line.replace(new RegExp(`^\\s*${shortName(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*`, "i"), "").trim();

/** The season's cast (season_casts), whether each is on the next season's, and each leaver's last confessional. */
async function castOf(db: Db, seasonId: string, nextId: string, start: Date, end: Date): Promise<RecapCastMember[]> {
  const { rows } = await db.query<{ id: string; name: string; house: boolean; hue: number | null; portrait: string | null; stayed: boolean }>(
    `select c.id, c.name, c.is_house as house, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait,
            exists (select 1 from season_casts n where n.season_id = $2 and n.character_id = c.id) as stayed
       from season_casts s join characters c on c.id = s.character_id
      where s.season_id = $1
      order by s.slot`,
    [seasonId, nextId],
  );
  const out: RecapCastMember[] = [];
  for (const r of rows) {
    const character: RecapChar = { id: r.id, name: r.name, house: r.house, hue: r.hue, portrait: r.portrait };
    let goodbye: RecapCastMember["goodbye"] = null;
    if (!r.stayed) {
      // Their own line from their last date this season whose take may be shown: the diary cam's rule (lib/game.ts), a
      // house character's own take, or either side's when the host shared them.
      const last = (
        await db.query<{ id: string; line: string | null }>(
          `select e.id, e.confessionals ->> (case when e.character_a = $3 then 0 else 1 end) as line
             from episodes e
             join characters a on a.id = e.character_a
             join characters b on b.id = e.character_b
            where (e.character_a = $3 or e.character_b = $3) and ${inSpanSql("e")}
              and e.confessionals is not null and jsonb_array_length(e.confessionals) = 2
              and (e.confessionals_shared or (case when e.character_a = $3 then a.is_house else b.is_house end))
            order by e.revealed_at desc limit 1`,
          [start.toISOString(), end.toISOString(), r.id],
        )
      ).rows[0];
      if (last?.line?.trim()) goodbye = { line: unlabelled(last.line, r.name), episode_id: last.id };
    }
    out.push({ character, stayed: r.stayed, goodbye });
  }
  return out;
}

/** Everything the finale page shows, computed from the season's aired dates. $0: no model call here. */
export async function computeRecapData(db: Db, seasonId: string): Promise<SeasonRecapData> {
  const { start, end } = seasonWindow(new Date(`${seasonId}T00:00:00Z`));
  const w = [start.toISOString(), end.toISOString()];
  const nextId = end.toISOString().slice(0, 10);

  const [numbers, dates, rewatch, moves, arrivals, cast, awards] = await Promise.all([
    db.query<Omit<RecapNumbers, "debuts">>(
      `select count(*)::int as aired,
              count(distinct (a.id, b.id))::int as couples,
              count(*) filter (where e.ending = 'second_date')::int as second_dates,
              count(*) filter (where e.ending = 'disaster')::int as disasters,
              coalesce(sum((select count(*) from predictions p where p.episode_id = e.id)), 0)::int as calls
         from ${SEASON_DATES}`,
      w,
    ),
    db.query<CharCols & { id: string; at: Date | string; venue: string | null; ending: Ending; before: boolean }>(
      `select ${charCols("a", "a")}, ${charCols("b", "b")}, e.id, e.revealed_at as at, e.setup ->> 'venue' as venue, e.ending,
              exists (select 1 from episodes pe
                       where least(pe.character_a, pe.character_b) = a.id and greatest(pe.character_a, pe.character_b) = b.id
                         and pe.status = 'ready' and pe.visibility = 'public' and pe.varies_episode_id is null
                         and pe.revealed_at < $1::timestamptz) as before
         from ${SEASON_DATES}
        order by e.revealed_at, e.id`,
      w,
    ),
    db.query<CharCols & { id: string; at: Date | string; venue: string | null; ending: Ending; calls: number; best_line: string | null }>(
      `select ${charCols("a", "a")}, ${charCols("b", "b")}, e.id, e.revealed_at as at, e.setup ->> 'venue' as venue, e.ending, e.best_line,
              (select count(*) from predictions p where p.episode_id = e.id)::int as calls
         from ${SEASON_DATES}
        order by calls desc, (e.ending <> 'friends') desc, e.confessionals_shared desc, e.revealed_at desc
        limit ${REWATCH_SHOWN}`,
      w,
    ),
    db.query<CharCols & { to_stage: Stage }>(
      `select * from (
         select distinct on (r.character_a, r.character_b) ${charCols("a", "a")}, ${charCols("b", "b")}, r.to_stage, r.at
           from relationship_events r
           join characters a on a.id = r.character_a
           join characters b on b.id = r.character_b
          where r.layer = 'public' and r.at >= $1::timestamptz and r.at < $2::timestamptz
            and a.visibility = 'public' and b.visibility = 'public'
            and (r.to_stage in ('dating', 'going_steady')
                 or (r.to_stage in ('exes', 'bad_blood') and r.from_stage in ('sparks', 'dating', 'going_steady')))
          order by r.character_a, r.character_b, r.at desc
       ) x order by at`,
      w,
    ),
    db.query<{ id: string; name: string; house: boolean; hue: number | null; portrait: string | null; n: number; total: number }>(
      `with debuts as (
         select c.id, count(*)::int as n
           from episodes e join characters c on c.id in (e.character_a, e.character_b)
          where ${inSpanSql("e")} and c.visibility = 'public'
            and not exists (select 1 from episodes pe where c.id in (pe.character_a, pe.character_b)
                              and pe.status = 'ready' and pe.visibility = 'public' and pe.revealed_at < $1::timestamptz)
          group by c.id
       )
       select c.id, c.name, c.is_house as house, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait, d.n,
              (select count(*) from debuts)::int as total
         from debuts d join characters c on c.id = d.id
        order by d.n desc, c.name limit 6`,
      w,
    ),
    castOf(db, seasonId, nextId, start, end),
    seasonAwards(db, { start, end }),
  ]);

  // Each couple's dates, oldest first, then the busiest couples' lines.
  const byPair = new Map<string, { pair: RecapPair; dates: LineDate[]; before: boolean }>();
  for (const r of dates.rows) {
    const key = `${r.a_id}|${r.b_id}`;
    const entry = byPair.get(key) ?? { pair: pairOf(r), dates: [], before: r.before };
    entry.dates.push({ at: new Date(r.at), venue: r.venue, ending: r.ending });
    byPair.set(key, entry);
  }
  const stages = new Map<string, Stage | null>();
  if (byPair.size) {
    const { rows } = await db.query<{ lo: string; hi: string; stage: Stage | null }>(
      `select character_a as lo, character_b as hi, public_stage as stage from relationships where (character_a, character_b) in (select * from unnest($1::text[], $2::text[]))`,
      [[...byPair.values()].map((p) => p.pair.a.id), [...byPair.values()].map((p) => p.pair.b.id)],
    );
    for (const r of rows) stages.set(`${r.lo}|${r.hi}`, r.stage);
  }
  const couples: RecapCouple[] = [...byPair.entries()]
    .map(([key, { pair, dates: ds, before }]) => {
      const stage = stages.get(key);
      return {
        ...pair,
        dates: ds.length,
        second_dates: ds.filter((d) => d.ending === "second_date").length,
        last_ending: ds[ds.length - 1].ending,
        line: coupleLine(ds, start, before),
        stage: stage ? STAGE_LABELS[stage] : null,
        last_at: ds[ds.length - 1].at.getTime(),
      };
    })
    .sort((x, y) => y.second_dates - x.second_dates || y.dates - x.dates || y.last_at - x.last_at)
    .slice(0, COUPLES_LINED)
    .map(({ last_at: _, ...c }) => c);

  const spark = [...byPair.values()].filter((p) => !p.before && p.dates[0].ending === "second_date").sort((x, y) => x.dates[0].at.getTime() - y.dates[0].at.getTime())[0];
  const n = numbers.rows[0];
  return {
    v: RECAP_VERSION,
    season: seasonRef(seasonId),
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    numbers: { aired: n?.aired ?? 0, couples: n?.couples ?? 0, second_dates: n?.second_dates ?? 0, disasters: n?.disasters ?? 0, calls: n?.calls ?? 0, debuts: arrivals.rows[0]?.total ?? 0 },
    cast,
    arrivals: arrivals.rows.map((r) => ({ id: r.id, name: r.name, house: r.house, hue: r.hue, portrait: r.portrait })),
    first_spark: spark ? { ...spark.pair, day: dayOf(spark.dates[0].at, start), place: placeOf(spark.dates[0].venue) } : null,
    formed: moves.rows.filter((m) => m.to_stage === "dating" || m.to_stage === "going_steady").map((m) => ({ ...pairOf(m), label: STAGE_LABELS[m.to_stage] })),
    broken: moves.rows.filter((m) => m.to_stage === "exes" || m.to_stage === "bad_blood").map((m) => ({ ...pairOf(m), label: STAGE_LABELS[m.to_stage] })),
    golden: couples.find((c) => c.second_dates > 0) ?? null,
    couples,
    rewatch: rewatch.rows.map((r) => ({
      ...pairOf(r),
      id: r.id,
      ending: r.ending,
      place: placeOf(r.venue),
      day: dayOf(r.at, start),
      calls: r.calls,
      best_line: r.best_line ? trimTo(r.best_line, 160) : null,
    })),
    awards,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// "Previously on Botchelor"

const firsts = (p: RecapPair) => `${shortName(p.a.name)} and ${shortName(p.b.name)}`;
const listed = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const stageWord = (label: string) => label.replace(/^\S+\s/, "").toLowerCase();

/** The facts the narrative may use, as plain sentences: the template is these, and the model retells them. */
export function recapFacts(d: SeasonRecapData): string[] {
  const facts: string[] = [];
  const cast = d.cast.map((c) => shortName(c.character.name));
  if (cast.length) facts.push(`${d.season.label} opened with ${listed(cast)} on the house cast.`);
  const arrivals = d.arrivals.map((c) => shortName(c.name)).filter((n) => !cast.includes(n)).slice(0, 4);
  if (arrivals.length) facts.push(`${d.numbers.debuts} characters made their debut, among them ${listed(arrivals)}.`);
  if (d.first_spark) facts.push(`The first spark came on day ${d.first_spark.day}, between ${firsts(d.first_spark)}${d.first_spark.place ? ` at ${d.first_spark.place}` : ""}.`);
  if (d.formed.length) facts.push(`${listed(d.formed.slice(0, 3).map((f) => `${firsts(f)} (now ${stageWord(f.label)})`))} got serious.`);
  if (d.broken.length) facts.push(`It ended badly for ${listed(d.broken.slice(0, 3).map(firsts))}.`);
  if (d.golden) {
    facts.push(
      `The golden couple was ${firsts(d.golden)}: ${countWord(d.golden.dates)} ${d.golden.dates === 1 ? "date" : "dates"}, ${countWord(d.golden.second_dates)} of them ending in a yes to another.`,
    );
  }
  facts.push(
    `In all, ${d.numbers.aired} dates aired between ${d.numbers.couples} pairings: ${d.numbers.second_dates} wanted a second date and ${d.numbers.disasters} were disasters.`,
  );
  const stayed = d.cast.filter((c) => c.stayed).map((c) => shortName(c.character.name));
  const left = d.cast.filter((c) => !c.stayed).map((c) => shortName(c.character.name));
  if (stayed.length) facts.push(`${listed(stayed)} ${stayed.length === 1 ? "stays" : "stay"} on for next season.`);
  if (left.length) facts.push(`${listed(left)} ${left.length === 1 ? "says" : "say"} goodbye.`);
  return facts;
}

/** The narrative when the model isn't asked or doesn't pass: the facts themselves, in order. */
export const templateNarrative = (d: SeasonRecapData): string => trimTo(recapFacts(d).join(" "), NARRATIVE_MAX);

const SYSTEM =
  "You write the 'Previously on Botchelor' recap that opens a season finale of Botchelor, an AI dating show the audience watches. " +
  "Past tense, warm and a little wry, like a TV narrator, PG. One paragraph of four to six sentences, under 800 characters. " +
  "Use only the facts and first names you're given; add no other events, people, places or numbers; no real people, no brands. " +
  'Reply with JSON only: {"text": "..."}';

/** The model's retelling of the facts, checked; null when the call fails or the text doesn't pass. */
export async function writeNarrative(model: Model, d: SeasonRecapData): Promise<string | null> {
  const facts = recapFacts(d);
  const mustName = d.golden ? [shortName(d.golden.a.name), shortName(d.golden.b.name)] : [];
  let raw: string;
  try {
    raw = await model.complete(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: `The season: ${d.season.label}, Season ${d.season.number}. What happened, exactly:\n${facts.map((f) => `- ${f}`).join("\n")}\nWrite the recap. Keep every name and number exactly as given.` },
      ],
      { temperature: 0.7 },
    );
  } catch {
    return null;
  }
  const body = raw.trim();
  let text: unknown;
  try {
    text = (JSON.parse(CODE_FENCE.exec(body)?.[1] ?? body) as { text?: unknown }).text;
  } catch {
    return null;
  }
  if (typeof text !== "string") return null;
  const clean = trimTo(text.replace(/\s+/g, " ").trim(), NARRATIVE_MAX);
  if (clean.length < 80) return null;
  if (!checkFields({ text: clean }).ok) return null;
  if (needsTranslation(clean)) return null;
  if (mustName.some((name) => !clean.includes(name))) return null;
  return clean;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading, and freezing on the first read after the season closes

type RecapRow = { data: SeasonRecapData | null; narrative: string | null; narrative_by: string | null; frozen_at: Date | string | null; claimed_at: Date | string };
const asRecap = (r: RecapRow): SeasonRecap | null =>
  r.data && r.narrative && r.data.v === RECAP_VERSION
    ? { data: r.data, narrative: r.narrative, narrative_by: r.narrative_by === "model" ? "model" : "template", frozen_at: r.frozen_at ? new Date(r.frozen_at).toISOString() : null }
    : null;

export type RecapResult = { status: "closed"; recap: SeasonRecap } | { status: "running" | "not_a_season" };

/**
 * A season's finale. A season that hasn't closed (by the database's clock) is "running": its story is the Reunion's
 * (/reunion). A closed one is the stored recap, or, on its first read, computed, written and stored by this call.
 */
export async function getSeasonRecap(db: Db, seasonId: string, opts: { now?: Date; model?: Model } = {}): Promise<RecapResult> {
  if (!isMonthlySeason(seasonId) || seasonNumber(seasonId) === null) return { status: "not_a_season" };
  const clock = opts.now ?? new Date((await db.query<{ now: Date | string }>(`select now() as now`)).rows[0].now);
  const { end } = seasonWindow(new Date(`${seasonId}T00:00:00Z`));
  if (clock < end) return { status: "running" };

  const have = (await db.query<RecapRow>(`select * from season_recaps where season_id = $1`, [seasonId])).rows[0];
  const stored = have ? asRecap(have) : null;
  if (stored) return { status: "closed", recap: stored };

  // Claim it: a new row, or a claim that died half-way. Whoever loses shows a recap of its own, unstored, model-free.
  const claimed =
    (
      await db.query(
        `insert into season_recaps (season_id, claimed_at) values ($1, now())
         on conflict (season_id) do update set claimed_at = now(), data = null
           where (season_recaps.data is null and season_recaps.claimed_at < now() - ($2::int * interval '1 millisecond'))
              or (season_recaps.data is not null and coalesce((season_recaps.data ->> 'v')::int, 0) < $3)
         returning season_id`,
        [seasonId, CLAIM_STALE_MS, RECAP_VERSION],
      )
    ).rows.length > 0;
  const data = await computeRecapData(db, seasonId);
  if (!claimed) return { status: "closed", recap: { data, narrative: templateNarrative(data), narrative_by: "template", frozen_at: null } };
  const written = voiceEnabled ? await writeNarrative(opts.model ?? getModel(undefined, false), data) : null;
  const narrative = written ?? templateNarrative(data);
  const by = written ? "model" : "template";
  const saved = (
    await db.query<RecapRow>(
      `update season_recaps set data = $2::jsonb, narrative = $3, narrative_by = $4, frozen_at = now()
        where season_id = $1 and data is null returning *`,
      [seasonId, JSON.stringify(data), narrative, by],
    )
  ).rows[0];
  if (saved) return { status: "closed", recap: asRecap(saved)! };
  // Someone else's stale-claim takeover landed first: theirs is the season's.
  const theirs = (await db.query<RecapRow>(`select * from season_recaps where season_id = $1`, [seasonId])).rows[0];
  return { status: "closed", recap: (theirs && asRecap(theirs)) ?? { data, narrative, narrative_by: by, frozen_at: null } };
}

/** The stored narratives' first sentence for a list of seasons (the Reunion's Seasons list), by id. */
export async function recapTeasers(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<{ season_id: string; narrative: string | null }>(
    `select season_id, narrative from season_recaps where season_id = any($1) and data is not null`,
    [[...ids]],
  );
  return new Map(rows.filter((r) => r.narrative).map((r) => [r.season_id, trimTo(r.narrative!, 140)]));
}


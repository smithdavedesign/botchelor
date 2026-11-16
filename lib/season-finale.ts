/**
 * A proposal at a season's finale (2026-11-16, docs/seasons.md "The finale's proposal"). When a monthly season closes,
 * its recap (lib/season-recap.ts) may name at most one long-steady couple ENGAGED, and at most one couple engaged at an
 * earlier finale MARRIED. Modest on purpose: most finales have neither, and then nothing is said anywhere.
 *
 * Derived, like every stage (lib/relationship-stages.ts): a seeded rule over the public record as it stood when the
 * season closed. Nobody chooses it, votes for it or pays for it; it changes no date, pairing, odds or points; and no
 * backfill grants it (only a finale's freeze writes the row).
 *
 *  - ENGAGED: a couple of two public characters who, at the close, have "moved in together" (FINALE_RULES.run second
 *    dates in a row on the public record) and aired at least FINALE_RULES.dates public dates this season, neither of
 *    them engaged or married to anyone. Of those: the longest run, then the most dates this season, then a draw seeded
 *    by the season and the pair.
 *  - MARRIED: a couple engaged at an EARLIER finale and still engaged at this close (no date of theirs has ended
 *    badly since), with at least FINALE_RULES.dates public dates this season. The longest engaged first, then the draw.
 *
 * What it writes (recordFinale, once, when the recap is frozen): a milestone row on the pair's public timeline
 * (relationship_events kind 'engaged' / 'married', `at` the season's close), after which the pair's shown stage says
 * so, their followers and owners hear it as any step up (lib/relationship-events.ts), and the recap page carries one
 * line. RELATIONSHIP_STAGES_V2=0: no finale names anyone, and a stored mark is not read.
 */
import { portraitPathSql } from "./assets";
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { STAGE_RUNS, stageSteps, stagesV2On, type StageDate } from "./relationship-stages";
import { inSpanSql, type ReunionChar } from "./reunion";
import { REPORT_HIDE_THRESHOLD, type Ending } from "./rules";
import { seasonWindow } from "./season-window";

type Env = Record<string, string | undefined>;

export const FINALE_RULES = {
  /** Second dates in a row that make a couple long-steady enough to be asked: "moved in together". */
  run: STAGE_RUNS.moved_in,
  /** Public dates the couple aired in the season itself: a couple the season never saw isn't its finale's news. */
  dates: 2,
} as const;

export type FinalePair = { a: ReunionChar; b: ReunionChar };
/** What a finale named, each or both null. Stored inside the frozen recap. */
export type FinaleNews = { engaged: FinalePair | null; married: FinalePair | null };

/** One couple at the season's close, as the rule reads them. */
export type FinaleCandidate = {
  lo: string;
  hi: string;
  /** Their public dates up to the close, oldest first. */
  dates: StageDate[];
  /** How many of those aired this season. */
  season_dates: number;
  /** A finale's mark from before this close (ISO), or null. */
  engaged_at: string | null;
  married_at: string | null;
  /** Either of them is engaged or married to someone else right now. */
  taken: boolean;
};

const runOf = (dates: readonly StageDate[]): number => {
  let n = 0;
  for (let i = dates.length - 1; i >= 0 && dates[i].ending === "second_date"; i--) n++;
  return n;
};

/**
 * The rule itself (pure): which couple the finale names engaged, and which married. `seasonId` seeds the last tie-break
 * and `seasonStart` (ISO) tells an earlier finale's engagement from one that could only be this season's own.
 */
export function pickFinale(candidates: readonly FinaleCandidate[], seasonId: string, seasonStart: string): { engaged: [string, string] | null; married: [string, string] | null } {
  const draw = (c: FinaleCandidate) => seedFrom("finale", seasonId, c.lo, c.hi);
  const eligible = candidates.filter((c) => c.season_dates >= FINALE_RULES.dates);
  const standing = (c: FinaleCandidate) => stageSteps(c.dates, { engaged_at: c.engaged_at, married_at: c.married_at }).now;
  const engaged = eligible
    .filter((c) => !c.taken && !c.engaged_at && !c.married_at && standing(c) === "moved_in" && runOf(c.dates) >= FINALE_RULES.run)
    .sort((x, y) => runOf(y.dates) - runOf(x.dates) || y.season_dates - x.season_dates || draw(x) - draw(y) || x.lo.localeCompare(y.lo) || x.hi.localeCompare(y.hi))[0];
  const married = eligible
    .filter((c) => c.engaged_at !== null && !c.married_at && Date.parse(c.engaged_at) <= Date.parse(seasonStart) && standing(c) === "engaged")
    .sort((x, y) => Date.parse(x.engaged_at!) - Date.parse(y.engaged_at!) || draw(x) - draw(y) || x.lo.localeCompare(y.lo) || x.hi.localeCompare(y.hi))[0];
  return { engaged: engaged ? [engaged.lo, engaged.hi] : null, married: married ? [married.lo, married.hi] : null };
}

type PairRow = {
  lo: string; hi: string; season_dates: number;
  a_name: string; a_house: boolean; a_hue: number | null; a_portrait: string | null;
  b_name: string; b_house: boolean; b_hue: number | null; b_portrait: string | null;
};

/**
 * What a season's finale names, from the public record at its close: read-only and deterministic, so whoever computes
 * the recap (the reader that freezes it, or one that lost the race) gets the same answer. Null when the switch is off.
 */
export async function computeFinale(db: Db, seasonId: string, env: Env = process.env): Promise<FinaleNews | null> {
  if (!stagesV2On(env)) return null;
  const { start, end } = seasonWindow(new Date(`${seasonId}T00:00:00Z`));
  const w = [start.toISOString(), end.toISOString()];
  // Couples of two public characters with enough public dates this season. Few: most seasons have none past a run of ten.
  const { rows: pairs } = await db.query<PairRow>(
    `with eps as (
       select least(e.character_a, e.character_b) as lo, greatest(e.character_a, e.character_b) as hi
         from episodes e where ${inSpanSql("e")}
     ), busy as (
       select lo, hi, count(*)::int as season_dates from eps group by lo, hi having count(*) >= ${FINALE_RULES.dates}
     )
     select p.lo, p.hi, p.season_dates,
            a.name as a_name, a.is_house as a_house, a.avatar_hue as a_hue, ${portraitPathSql("a")} as a_portrait,
            b.name as b_name, b.is_house as b_house, b.avatar_hue as b_hue, ${portraitPathSql("b")} as b_portrait
       from busy p
       join characters a on a.id = p.lo and a.visibility = 'public'
       join characters b on b.id = p.hi and b.visibility = 'public'`,
    w,
  );
  if (!pairs.length) return { engaged: null, married: null };
  const los = pairs.map((p) => p.lo);
  const his = pairs.map((p) => p.hi);
  const ids = [...new Set([...los, ...his])];
  const [history, marks, taken] = await Promise.all([
    // Each pair's public dates up to the close, oldest first.
    db.query<{ lo: string; hi: string; ending: Ending; at: string | Date; overnight: boolean | null }>(
      `select least(e.character_a, e.character_b) as lo, greatest(e.character_a, e.character_b) as hi, e.ending, e.revealed_at as at,
              (e.setup->>'overnight') = 'true' as overnight
         from episodes e
        where e.status = 'ready' and e.visibility = 'public' and e.revealed_at is not null and e.revealed_at < $3::timestamptz
          and e.varies_episode_id is null and e.ending is not null
          and (select count(*)::int from reports r where r.episode_id = e.id) < $4
          and (least(e.character_a, e.character_b), greatest(e.character_a, e.character_b)) in (select * from unnest($1::text[], $2::text[]))
        order by e.created_at, e.id`,
      [los, his, w[1], REPORT_HIDE_THRESHOLD],
    ),
    // An earlier finale's marks only: this season's own row is written `at` its close, never before it.
    db.query<{ lo: string; hi: string; kind: "engaged" | "married"; at: string | Date }>(
      `select character_a as lo, character_b as hi, kind, max(at) as at from relationship_events
        where kind in ('engaged', 'married') and layer = 'public' and at < $3::timestamptz
          and (character_a, character_b) in (select * from unnest($1::text[], $2::text[]))
        group by character_a, character_b, kind`,
      [los, his, w[1]],
    ),
    // Whoever is engaged or married on the public graph right now, to tell "taken" from free.
    db.query<{ lo: string; hi: string }>(
      `select character_a as lo, character_b as hi from relationships
        where public_shown_stage in ('engaged', 'married') and (character_a = any($1) or character_b = any($1))`,
      [ids],
    ),
  ]);
  const key = (lo: string, hi: string) => `${lo}|${hi}`;
  const dates = new Map<string, StageDate[]>();
  for (const r of history.rows) {
    const list = dates.get(key(r.lo, r.hi)) ?? [];
    list.push({ ending: r.ending, at: new Date(r.at).toISOString(), ...(r.overnight ? { overnight: true } : {}) });
    dates.set(key(r.lo, r.hi), list);
  }
  const markOf = (lo: string, hi: string, kind: "engaged" | "married") => {
    const at = marks.rows.find((m) => m.lo === lo && m.hi === hi && m.kind === kind)?.at;
    return at ? new Date(at).toISOString() : null;
  };
  const candidates: FinaleCandidate[] = pairs.map((p) => ({
    lo: p.lo,
    hi: p.hi,
    dates: dates.get(key(p.lo, p.hi)) ?? [],
    season_dates: p.season_dates,
    engaged_at: markOf(p.lo, p.hi, "engaged"),
    married_at: markOf(p.lo, p.hi, "married"),
    taken: taken.rows.some((t) => key(t.lo, t.hi) !== key(p.lo, p.hi) && [t.lo, t.hi].some((id) => id === p.lo || id === p.hi)),
  }));
  const picked = pickFinale(candidates, seasonId, w[0]);
  const pairOf = (ids2: [string, string] | null): FinalePair | null => {
    const p = ids2 && pairs.find((x) => x.lo === ids2[0] && x.hi === ids2[1]);
    return p
      ? { a: { id: p.lo, name: p.a_name, house: p.a_house, hue: p.a_hue, portrait: p.a_portrait }, b: { id: p.hi, name: p.b_name, house: p.b_house, hue: p.b_hue, portrait: p.b_portrait } }
      : null;
  };
  return { engaged: pairOf(picked.engaged), married: pairOf(picked.married) };
}

/**
 * Puts a frozen finale's news on the record: the milestone row on each pair's public timeline (`at` the season's
 * close; one of each kind a finale, whoever calls), then the pair's edge is refreshed and the step up announced like
 * any other (owners and followers, once). Called by the reader that froze the recap, never by a page view after it.
 */
export async function recordFinale(db: Db, seasonId: string, news: FinaleNews | null | undefined, env: Env = process.env): Promise<number> {
  if (!news || !stagesV2On(env)) return 0;
  const { end } = seasonWindow(new Date(`${seasonId}T00:00:00Z`));
  let written = 0;
  for (const [kind, pair] of [["married", news.married], ["engaged", news.engaged]] as const) {
    if (!pair) continue;
    const [lo, hi] = pair.a.id < pair.b.id ? [pair.a.id, pair.b.id] : [pair.b.id, pair.a.id];
    const { rows } = await db.query(
      `insert into relationship_events (character_a, character_b, layer, kind, at)
       select $1, $2, 'public', $3, $4::timestamptz
        where not exists (select 1 from relationship_events x where x.kind = $3 and x.at = $4::timestamptz)
       returning id`,
      [lo, hi, kind, end.toISOString()],
    );
    if (!rows.length) continue;
    written++;
    // The stage, its event row and the notices: the same path as a date that moved a couple up (imported when needed:
    // most finales name nobody).
    await import("./relationship-events").then(({ refreshAndAnnounce }) => refreshAndAnnounce(db, lo, hi)).catch(() => null);
  }
  return written;
}

/**
 * The story check's gate (lib/story-check.ts, docs/story-check.md): which aired dates may be featured. Pure, no server
 * imports: the switch, the verdicts, and the SQL and view tests every featured surface shares (the home excerpt and the
 * 18+ gate through lib/featured-date.ts, the home clip in lib/home-clip.ts, the daily clip through the feed's
 * `featurable`, and the season page's starters).
 *
 * A date the check found contradicting (its lines and recap disagree with how it ended) is never featured. An
 * unchecked date still is, so nothing goes empty while the backfill runs. STORY_CHECK=0 makes every date featurable
 * again, as before the check, without a deploy of code.
 */

export const STORY_VERDICTS = ["consistent", "hidden_truth", "reversal", "contradicts"] as const;
export type StoryVerdict = (typeof STORY_VERDICTS)[number];

type Env = Record<string, string | undefined>;

/** STORY_CHECK (on unless "0"): the hourly sweep, the repair, and the gate on every featured surface. */
export function storyCheckOn(env: Env = process.env): boolean {
  return env.STORY_CHECK?.trim() !== "0";
}

export const isStoryVerdict = (v: unknown): v is StoryVerdict => typeof v === "string" && (STORY_VERDICTS as readonly string[]).includes(v);

/**
 * A SQL condition on episodes row `e`: the date may be featured, i.e. no story check found it contradicting (an
 * unchecked date passes). `{ passed: true }`: only a date the check has passed (the season page's starters). With the
 * switch off, true for every date. One correlated lookup on story_checks' key: no round trip of its own. Never a bare
 * constant, so it can stand in an ORDER BY too (Postgres refuses `order by true`).
 */
export function featurableSql(e: string, opts: { passed?: boolean } = {}, env: Env = process.env): string {
  if (!storyCheckOn(env)) return `(${e}.id is not null)`;
  return opts.passed
    ? `exists (select 1 from story_checks sc where sc.episode_id = ${e}.id and sc.verdict <> 'contradicts')`
    : `not exists (select 1 from story_checks sc where sc.episode_id = ${e}.id and sc.verdict = 'contradicts')`;
}

/**
 * A SQL boolean on `e` for an ORDER BY: true when the check has passed the date. Ranked after a list's own score, it
 * puts a checked-and-passing date first among equals (lib/game.ts listStandoutDates). False for every date with the
 * switch off (an expression, not a bare `false`, which an ORDER BY refuses).
 */
export function storyPassedSql(e: string, env: Env = process.env): string {
  return storyCheckOn(env) ? featurableSql(e, { passed: true }, env) : `(${e}.id is null)`;
}

/**
 * What lib/game.ts puts on a date's public view for its stored verdict: `featurable: false` for a contradicting one
 * while the switch is on, nothing otherwise. Never the verdict itself or its reason (those are the admin's).
 */
export function featurableFlag(verdict: string | null | undefined, env: Env = process.env): { featurable?: false } {
  return verdict === "contradicts" && storyCheckOn(env) ? { featurable: false } : {};
}

/** A date as a page has it (an EpisodeView, or the feed's JSON): featurable unless the check marked it not. */
export function isFeaturable(view: { featurable?: boolean }): boolean {
  return view.featurable !== false;
}

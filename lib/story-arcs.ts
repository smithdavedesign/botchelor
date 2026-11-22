/**
 * Story arcs (PRD docs/PRDs/styles-and-storylines.md, phase 4): three dates for two of the cast who knew each other
 * before the show (lib/character-links.ts): the spark, the setback and the reveal.
 *
 * How it runs, all of it from the producer's nightly pass (lib/producer.ts):
 *  - An arc opens for every linked pair that is in the month's cast together. One arc a pair, ever: a pair who both
 *    stay on carry theirs into the next month, and a pair whose arc has closed doesn't tell it again.
 *  - On a night when an arc's next date is due (its last one was at least ARC_GAP_DAYS ago, the season lets the house
 *    book the two of them, and the night before wasn't an arc's: arcs and the house's tensions take turns), the producer
 *    stages it as tomorrow's beat (`arc_step`) instead of a tension: a want each for the step, and the Previously and
 *    Tonight lines.
 *  - The day's first house date (lib/watch.ts lobbyDeal, after a challenge winner's) is then theirs, playing one of the
 *    show's roleplays tagged with their setup (lib/roleplays.ts), one they haven't played yet, dealt from the day.
 *  - Once that date airs, the arc keeps its ending and moves on; the next step's lines say what happened. A date whose
 *    house room nobody started airs on its own from ARC_AIR_DAYS after its day, so a quiet week doesn't stall the arc. The ending
 *    stays the engine's, and the arc adapts to it: a reveal that ends in a second date closes the arc "together", any
 *    other ending closes it "apart" (it didn't happen). A step whose date never came, or never aired, is staged again
 *    on a later night; after ARC_MISSES_MAX of those in a row the arc closes "faded".
 *
 * Only public dates between the two of them count, and every line passes the show's check before it is stored.
 * ARCS=0 (or PRODUCER=0) turns it all off: no arc is opened, moved on or staged, and a staged one isn't played.
 * The engine never reads any of it.
 */
import { LINK_PAST, linksOf, isLinkKind, type LinkKind } from "./character-links";
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { DATE_ROLEPLAYS, dateRoleplayById, termsFor, type DateRoleplay, type DateRoleplayDef } from "./roleplays";
import { ENDINGS, type Ending } from "./rules";
import { checkShowText } from "./safety";
import type { WantKind } from "./story-state";

type Env = Record<string, string | undefined>;

/** ARCS: on unless it is "0" (the producer's own switch, PRODUCER, is checked by its callers). */
export const arcsOn = (env: Env = process.env): boolean => env.ARCS?.trim() !== "0";

export const ARC_STEPS = ["spark", "setback", "reveal"] as const;
export type ArcStep = (typeof ARC_STEPS)[number];
export type ArcStatus = "active" | "done";
export type ArcOutcome = "together" | "apart" | "faded";

/** The fewest days between one step's date and the next. */
export const ARC_GAP_DAYS = 2;
/** How long a staged step's date has to air, in days after its day, before the step is staged again later. */
export const ARC_WAIT_DAYS = 3;
/**
 * From how many days after its day a step's date airs on its own when its house room was never started (2026-11-19).
 * A room waits for its first viewer to play live (lib/air.ts never airs a date whose room hasn't started), so on a quiet
 * week the arc's dates sat unaired and the arc faded: the room has its day and the next, then the date airs anyway.
 */
export const ARC_AIR_DAYS = 2;
/** Steps that never played, in a row, before the arc closes. */
export const ARC_MISSES_MAX = 3;

/** One step's date, once it aired. */
export type ArcDate = { step: ArcStep; day: string; episode_id: string; ending: Ending; roleplay: string | null };

export type StoryArc = {
  id: string;
  season_id: string;
  /** The pair, lower id first. */
  a: string;
  b: string;
  kind: LinkKind;
  /** The next step to play (the last one played, once it's done). */
  step: ArcStep;
  status: ArcStatus;
  outcome: ArcOutcome | null;
  /** The day the next step is staged for (story_beats.day), or null while it waits for its night. */
  staged_day: string | null;
  /** The staged step's roleplay (lib/roleplays.ts id), and who plays its first role. */
  roleplay: string | null;
  first: string | null;
  misses: number;
  dates: ArcDate[];
};

/** What a staged arc beat carries (story_beats.arc), for the house date it makes (lib/watch.ts). */
export type ArcBeat = { id: string; kind: LinkKind; step: ArcStep; roleplay: string | null; first: string | null };

/** A want the step hands one of its two (the producer's BeatWant shape). */
export type ArcWant = { holder: string; about: string | null; kind: WantKind; want: string };

type ArcRow = {
  id: string;
  season_id: string;
  character_a: string;
  character_b: string;
  kind: string;
  step: string;
  status: string;
  outcome: string | null;
  staged_day: string | null;
  roleplay: string | null;
  first_role: string | null;
  misses: number;
  dates: ArcDate[] | null;
};

const ARC_COLS = `id, season_id, character_a, character_b, kind, step, status, outcome, staged_day, roleplay, first_role, misses, dates`;

const isStep = (s: unknown): s is ArcStep => (ARC_STEPS as readonly unknown[]).includes(s);

function arcOf(r: ArcRow): StoryArc | null {
  if (!isLinkKind(r.kind) || !isStep(r.step)) return null;
  return {
    id: r.id,
    season_id: r.season_id,
    a: r.character_a,
    b: r.character_b,
    kind: r.kind,
    step: r.step,
    status: r.status === "done" ? "done" : "active",
    outcome: r.outcome === "together" || r.outcome === "apart" || r.outcome === "faded" ? r.outcome : null,
    staged_day: r.staged_day,
    roleplay: r.roleplay,
    first: r.first_role,
    misses: r.misses ?? 0,
    dates: Array.isArray(r.dates) ? r.dates.filter((d) => isStep(d?.step) && (ENDINGS as readonly string[]).includes(d.ending)) : [],
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const startOf = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
/** A UTC day `n` days from `day`, as YYYY-MM-DD. */
export const dayPlus = (day: string, n: number): string => new Date(startOf(day).getTime() + n * DAY_MS).toISOString().slice(0, 10);

/* ------------------------------------------------ reading ------------------------------------------------ */

/** Every arc, open ones first, then by when they opened. For the admin panel and the tests. */
export async function listArcs(db: Db, limit = 20): Promise<StoryArc[]> {
  const { rows } = await db.query<ArcRow>(`select ${ARC_COLS} from story_arcs order by (status = 'active') desc, created_at desc, id limit $1`, [limit]);
  return rows.flatMap((r) => arcOf(r) ?? []);
}

/* ------------------------------------------------ opening and moving on ------------------------------------------------ */

/** Opens an arc for every linked pair that is in the cast together and never had one. How many it opened. */
export async function openArcs(db: Db, seasonId: string, cast: readonly string[]): Promise<number> {
  const ids = new Set(cast);
  if (ids.size < 2) return 0;
  const links = (await linksOf(db, [...ids])).filter((l) => ids.has(l.lo) && ids.has(l.hi));
  let n = 0;
  for (const l of links) {
    const made = await db.query(
      `insert into story_arcs (id, season_id, character_a, character_b, kind) values ($1, $2, $3, $4, $5)
       on conflict (character_a, character_b) do nothing returning id`,
      [`arc-${seasonId}-${l.lo}-${l.hi}`.slice(0, 200), seasonId, l.lo, l.hi, l.kind],
    );
    n += made.rows.length;
  }
  return n;
}

/** The next step after one, or null after the reveal. */
export const nextStep = (s: ArcStep): ArcStep | null => ARC_STEPS[ARC_STEPS.indexOf(s) + 1] ?? null;

/** How an arc closes on its reveal's ending: a second date is "together"; anything else, it didn't happen. */
export const outcomeOf = (ending: Ending): ArcOutcome => (ending === "second_date" ? "together" : "apart");

/**
 * Moves on every arc whose staged step's date has aired (its ending kept, the next step waiting for its night), and
 * frees the ones whose date never came or never aired in time, so they're staged again later. `day` is the day the
 * producer is producing. How many arcs changed.
 */
export async function settleArcs(db: Db, day: string): Promise<number> {
  const { rows } = await db.query<ArcRow>(`select ${ARC_COLS} from story_arcs where status = 'active' and staged_day is not null and staged_day < $1`, [day]);
  let n = 0;
  for (const r of rows) {
    const arc = arcOf(r);
    if (!arc?.staged_day) continue;
    const staged = arc.staged_day;
    // The step's date: the first public date between the two of them made on its day or the next. Never a mixer's
    // table (group_id): six lines at a speed date aren't the step the producer staged.
    const date = (
      await db.query<{ id: string; ending: Ending; aired: boolean; creator_id: string | null; unstarted: boolean }>(
        `select e.id, e.ending, (e.revealed_at is not null) as aired, e.creator_id,
                exists (select 1 from watch_parties w where w.episode_id = e.id and w.starts_at is null) as unstarted
           from episodes e
          where ((e.character_a = $1 and e.character_b = $2) or (e.character_a = $2 and e.character_b = $1))
            and e.created_at >= $3 and e.created_at < $4 and e.status = 'ready' and e.visibility = 'public' and e.group_id is null
          order by e.created_at limit 1`,
        [arc.a, arc.b, startOf(staged).toISOString(), startOf(dayPlus(staged, 2)).toISOString()],
      )
    ).rows[0];
    // Its room never started and its day and the next have passed: it airs now, the way any other date airs.
    if (date && !date.aired && date.unstarted && date.creator_id && day >= dayPlus(staged, ARC_AIR_DAYS)) {
      const { airEpisode } = await import("./air");
      const done = await airEpisode(db, date.id, date.creator_id).catch(() => null);
      if (done) Object.assign(date, { aired: true, ending: done.ending });
    }
    if (date?.aired && (ENDINGS as readonly string[]).includes(date.ending)) {
      const dates: ArcDate[] = [...arc.dates, { step: arc.step, day: staged, episode_id: date.id, ending: date.ending, roleplay: arc.roleplay }];
      const next = nextStep(arc.step);
      await db.query(
        `update story_arcs set step = $3, status = $4, outcome = $5, dates = $6::jsonb, staged_day = null, roleplay = null, first_role = null, misses = 0, updated_at = now()
          where id = $1 and staged_day = $2`,
        [arc.id, staged, next ?? arc.step, next ? "active" : "done", next ? null : outcomeOf(date.ending), JSON.stringify(dates)],
      );
      n++;
      continue;
    }
    // No date by the end of the day after (no house room was made), or one that hasn't aired after ARC_WAIT_DAYS.
    const missed = date ? day > dayPlus(staged, ARC_WAIT_DAYS) : day >= dayPlus(staged, 2);
    if (!missed) continue;
    // A day the owner skipped (lib/producer.ts skipBeat) isn't the arc's miss.
    const skipped = (await db.query<{ status: string }>(`select status from story_beats where day = $1`, [staged])).rows[0]?.status === "skipped";
    const misses = arc.misses + (skipped ? 0 : 1);
    await db.query(
      `update story_arcs set staged_day = null, roleplay = null, first_role = null, misses = $3, status = $4, outcome = $5, updated_at = now()
        where id = $1 and staged_day = $2`,
      [arc.id, staged, misses, misses >= ARC_MISSES_MAX ? "done" : "active", misses >= ARC_MISSES_MAX ? "faded" : null],
    );
    n++;
  }
  return n;
}

/**
 * The arc whose next date is due on `day`, or null: active, not staged, its last date at least ARC_GAP_DAYS before,
 * and a pair the house can book that day (`bookable`). The one that opened first goes first.
 */
export async function dueArc(db: Db, day: string, bookable: (a: string, b: string) => boolean): Promise<StoryArc | null> {
  const { rows } = await db.query<ArcRow>(`select ${ARC_COLS} from story_arcs where status = 'active' and staged_day is null order by created_at, id`);
  for (const r of rows) {
    const arc = arcOf(r);
    if (!arc) continue;
    const last = arc.dates.at(-1)?.day;
    if (last && last > dayPlus(day, -ARC_GAP_DAYS)) continue;
    if (bookable(arc.a, arc.b)) return arc;
  }
  return null;
}

/* ------------------------------------------------ one step ------------------------------------------------ */

/** The roleplays tagged with a setup (lib/roleplays.ts tags): the ones where it's the setup first, else any that carry it. */
export function setupRoleplays(kind: LinkKind): DateRoleplayDef[] {
  const first = DATE_ROLEPLAYS.filter((r) => r.tags[0] === kind);
  return first.length ? first : DATE_ROLEPLAYS.filter((r) => r.tags.includes(kind));
}

/** The step's roleplay: one tagged with the arc's setup that the pair hasn't played in it yet (all of them again once they have), dealt from the day. */
export function arcRoleplay(arc: Pick<StoryArc, "id" | "kind" | "a" | "b" | "dates">, day: string): { def: DateRoleplayDef; first: string } | null {
  const all = setupRoleplays(arc.kind);
  const played = new Set(arc.dates.map((d) => d.roleplay));
  const fresh = all.filter((r) => !played.has(r.id));
  const pool = fresh.length ? fresh : all;
  if (!pool.length) return null;
  const def = pool[seedFrom("arc-roleplay", day, arc.id) % pool.length];
  return { def, first: seedFrom("arc-role", day, arc.id) % 2 === 0 ? arc.a : arc.b };
}

type Names = (id: string) => string;

/** The two in the order the lines name them: by name, so a pair reads the same way every night. */
const inOrder = (arc: Pick<StoryArc, "a" | "b">, nm: Names): [string, string] =>
  [arc.a, arc.b].sort((x, y) => nm(x).localeCompare(nm(y)) || x.localeCompare(y)) as [string, string];

/** How a date ended, after "ended". */
const ENDED: Record<Ending, string> = { second_date: "with a second date on the cards", friends: "as friends", disaster: "badly" };

/** Tonight, for each setup and step. */
const TONIGHT: Record<LinkKind, Record<ArcStep, string>> = {
  rivals: {
    spark: "the rivals meet on the show, and neither of them plans to lose.",
    setback: "round two, and the old score comes up.",
    reveal: "one of them says why they never let the other win.",
  },
  second_chance: {
    spark: "the exes sit down together for the first time since it ended.",
    setback: "the question of why it ended.",
    reveal: "a second chance, or a goodbye.",
  },
  fake_dating: {
    spark: "the fake couple goes on a real date.",
    setback: "how much of it was ever pretend.",
    reveal: "which parts were never pretend.",
  },
  friends_to_more: {
    spark: "the best friends go on a date, for the first time.",
    setback: "one of them is wondering about more.",
    reveal: "one of them finally says it.",
  },
};

/** The step's two template lines and its template logline (the producer may write the logline in the show's voice). */
export function arcLines(arc: Pick<StoryArc, "a" | "b" | "kind" | "step" | "dates">, nm: Names): { previously: string; tonight: string; logline: string } {
  const [a, b] = inOrder(arc, nm).map(nm);
  const last = arc.dates.at(-1);
  let prev: string;
  if (arc.step === "spark" || !last) prev = `Long before the show, ${a} and ${b} ${LINK_PAST[arc.kind]}.`;
  else if (arc.step === "setback") prev = `${a} and ${b}'s first date on the show ended ${ENDED[last.ending]}.`;
  // The setback that never came: the second date went well, and the old history is still waiting.
  else if (last.ending === "second_date") prev = `${a} and ${b}'s second date went well, and the history between them still hasn't been said out loud.`;
  else prev = `${a} and ${b}'s second date ended ${ENDED[last.ending]}.`;
  const ton = TONIGHT[arc.kind][arc.step];
  return { previously: `Previously: ${prev}`, tonight: `Tonight: ${ton}`, logline: `${prev} Tonight, ${ton}` };
}

/** What each of them wants from the step's date, the same for both: the arc never decides who feels what. */
const WANTS: Record<LinkKind, Record<ArcStep, { kind: WantKind; want: (other: string) => string }>> = {
  rivals: {
    spark: { kind: "prove", want: (o) => `Show ${o} you've only got better since the last time you went head to head.` },
    setback: { kind: "settle_score", want: (o) => `Beat ${o} at whatever tonight turns into, and don't let it show how much it matters.` },
    reveal: { kind: "pursue", want: (o) => `Tell ${o} why you never once let them win.` },
  },
  second_chance: {
    spark: { kind: "protect", want: (o) => `Find out whether ${o} has changed since it ended, without letting on that you care.` },
    setback: { kind: "settle_score", want: (o) => `Ask ${o} the question you never got to ask when it ended.` },
    reveal: { kind: "win_back", want: (o) => `Decide whether this is a second chance or a goodbye, and tell ${o} which.` },
  },
  fake_dating: {
    spark: { kind: "prove", want: (o) => `Find out whether ${o} remembers the pretending the way you do.` },
    setback: { kind: "protect", want: (o) => `Keep ${o} from finding out that some of it was never pretend for you.` },
    reveal: { kind: "pursue", want: (o) => `Tell ${o} which parts were never pretend.` },
  },
  friends_to_more: {
    spark: { kind: "protect", want: (o) => `Treat tonight like any night out with ${o}, and see whether it stays that way.` },
    setback: { kind: "prove", want: (o) => `Find out whether ${o} has ever wondered about more, without saying that you have.` },
    reveal: { kind: "pursue", want: (o) => `Tell ${o} you've wondered about more, and mean it.` },
  },
};

/** The step's wants, one each, for those of the two in the cast (the producer's wants are the cast's). */
export function arcWants(arc: Pick<StoryArc, "a" | "b" | "kind" | "step">, nm: Names, cast: ReadonlySet<string>): ArcWant[] {
  const w = WANTS[arc.kind][arc.step];
  return [
    [arc.a, arc.b],
    [arc.b, arc.a],
  ]
    .filter(([holder]) => cast.has(holder))
    .map(([holder, other]) => ({ holder, about: other, kind: w.kind, want: w.want(nm(other)) }));
}

/** Whether every line of a step passes the show's check (a name could be the one thing that doesn't). */
export const arcLinesOk = (lines: { previously: string; tonight: string; logline: string }, wants: readonly ArcWant[]): boolean =>
  checkShowText({ previously: lines.previously, tonight: lines.tonight, logline: lines.logline, ...Object.fromEntries(wants.map((w, i) => [`want${i}`, w.want])) }).ok;

/** Marks the arc's next step staged for `day`, with its roleplay. False when it was staged meanwhile (another pass). */
export async function markStaged(db: Db, arcId: string, day: string, roleplay: string | null, first: string | null): Promise<boolean> {
  const r = await db.query(`update story_arcs set staged_day = $2, roleplay = $3, first_role = $4, updated_at = now() where id = $1 and status = 'active' and staged_day is null returning id`, [
    arcId,
    day,
    roleplay,
    first,
  ]);
  return r.rows.length > 0;
}

/** Frees a step staged for `day` (the producer's run failed after staging it, or the owner skipped the day). */
export async function unstage(db: Db, day: string): Promise<void> {
  await db.query(`update story_arcs set staged_day = null, roleplay = null, first_role = null, updated_at = now() where staged_day = $1 and status = 'active'`, [day]);
}

/**
 * The house date a staged arc step makes (lib/watch.ts lobbyDeal): its two, in order, and the roleplay they play.
 * Null when either of them has left the cast since it was staged.
 */
export function arcDate(arc: ArcBeat, who: readonly string[], cast: readonly string[]): { a: string; b: string; roleplay: DateRoleplay | null } | null {
  const [a, b] = who;
  if (!a || !b || a === b || !cast.includes(a) || !cast.includes(b)) return null;
  const def = dateRoleplayById(arc.roleplay);
  const first = arc.first === b ? b : a;
  return { a, b, roleplay: def ? { ...termsFor(def, first), agreed: "auto" } : null };
}

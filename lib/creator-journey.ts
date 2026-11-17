/**
 * The creator journey (the connected model, stage 6; docs/analytics.md "The creator journey"): of the people who made
 * a character, how many went on to each of the things a creator can do with one. Counted from the tables that are the
 * truth, never from clicks (named click events were dropped until 2026-11-16, and a click is not the thing anyway):
 *
 *   made a character      characters: made on the web, not a house character, not a step-in seat
 *   ran a Studio shoot    studio_pg_shoots: a shoot of their own, of any kind
 *   shared to the Gallery showcase_posts: a live post of their own
 *   has a follower        character_follows: someone else follows one of their characters
 *   watched a date end    web_events: the date_watched event, as that identity
 *   opened a chat         companion_threads: a conversation they started (only a person's own tap starts one: every
 *                         job that texts first needs a thread that already exists)
 *
 * The first step is the people who made a character in the window. Every other step is a count of THOSE people who
 * have done the thing, ever, and so a share of the first step: the steps are independent, not a chain, so a later one
 * can be larger than an earlier one. Our own identities are left out the way the rest of Real use leaves them out
 * (lib/our-traffic.ts loadOurIds), and so are agents: the caller says who is a person (`real`). A follow by one of our
 * own identities is not a follower.
 *
 * Small on purpose: one statement, no new table, and nothing here is shown to a visitor.
 */
import type { Db } from "./db";
import { notPersonaSql } from "./step-in-shared";

/**
 * CREATOR_JOURNEY=0: the journey, and the Studio split of "Came back for their character" (lib/character-return.ts
 * splitByStudio), are left out of Real use and their tables aren't read (lib/real-metrics.ts).
 */
export function creatorJourneyOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.CREATOR_JOURNEY?.trim() !== "0";
}

/** The steps after the first, in the order the page lists them. */
export const JOURNEY_STEPS = ["studio", "shared", "followed", "watched", "chatted"] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

/** One person who made a character on the web: when they last made one, and what else they have done, ever. */
export type JourneyMaker = { user: string; made_at: Date } & Record<JourneyStep, boolean>;

export type CreatorJourney = { made: number } & Record<JourneyStep, number>;

const DAY_MS = 86_400_000;

/**
 * Everyone who made a character on the web since `since`, with the steps they have reached. `ours` is who a follow
 * never counts from. One statement whatever the number of makers.
 */
export async function loadJourney(db: Db, since: string, ours: readonly string[]): Promise<JourneyMaker[]> {
  const { rows } = await db.query<{ user: string; made_at: Date | string } & Record<JourneyStep, boolean>>(
    `with makers as (
       select c.owner_id as id, max(c.created_at) as made_at
         from characters c
        where not c.is_house and c.created_via = 'web' and c.owner_id is not null and ${notPersonaSql("c")} and c.created_at >= $1
        group by c.owner_id
     )
     select m.id as "user", m.made_at,
            exists (select 1 from studio_pg_shoots s where s.owner_id = m.id) as studio,
            exists (select 1 from showcase_posts p where p.owner_id = m.id and p.status = 'live') as shared,
            exists (select 1 from character_follows f join characters fc on fc.id = f.character_id
                     where fc.owner_id = m.id and f.user_id <> m.id and not (f.user_id = any($2::text[]))) as followed,
            exists (select 1 from web_events w where w.event = 'date_watched' and w.user_id = m.id) as watched,
            exists (select 1 from companion_threads t where t.user_id = m.id) as chatted
       from makers m`,
    [since, [...ours]],
  );
  return rows.map((r) => ({ ...r, made_at: new Date(r.made_at) }));
}

/** One window's journey (pure): the makers whose newest character is inside it, and how many reached each step. */
export function creatorJourney(makers: readonly JourneyMaker[], opts: { now: Date; days: number; real: (id: string) => boolean }): CreatorJourney {
  const since = opts.now.getTime() - opts.days * DAY_MS;
  const cohort = makers.filter((m) => opts.real(m.user) && m.made_at.getTime() >= since && m.made_at <= opts.now);
  const out: CreatorJourney = { made: cohort.length, studio: 0, shared: 0, followed: 0, watched: 0, chatted: 0 };
  for (const m of cohort) for (const step of JOURNEY_STEPS) if (m[step]) out[step]++;
  return out;
}

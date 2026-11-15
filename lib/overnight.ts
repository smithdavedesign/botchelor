/**
 * Overnight dates, the show's half (the rules and the words are lib/overnight-shared.ts; read that first).
 *
 *  - The milestone is read from the pair's aired, public dates only (loadOvernight), so an offer can never give away
 *    an ending nobody has seen, and nothing private or unlisted counts.
 *  - An overnight date is the follow-up of the pair's latest aired date, booked through the second-date flow
 *    (lib/second-date.ts): the same consent (the show's own side agrees at once; another owner says yes themselves,
 *    and their yes has to be to an overnight: second_date_requests.overnight), the same price, the same pipeline. The
 *    only mark it carries is `setup.overnight`, which no prompt reads: it changes how the ending is told, never the
 *    ending.
 *  - When it airs and the engine ended it in another date, the pair's timeline gets a milestone (relationship_events,
 *    kind 'overnight') and each opted-in owner hears from their own character, without detail (overnightAired, called
 *    from lib/relationship-events.ts refreshAndAnnounce, the one place every airing passes).
 *  - One fact back from After Dark (recordNightTogether): ids and a timestamp, nothing else. This file never reads an
 *    After Dark table and imports nothing of After Dark's (tests/overnight.test.ts pins both): what it knows of a night
 *    is that After Dark's own code said, for this overnight date, "it's over".
 *
 * Sacred rule: nothing here touches points, odds, pairings or endings.
 */
import type { Db } from "./db";
import type { SeeAgain } from "./inner-life";
import {
  leftTogether,
  nightTogetherMemory,
  overnightDatesOn,
  overnightMilestone,
  overnightTextLines,
  pickOvernightVenue,
  type AiredDate,
  type Milestone,
} from "./overnight-shared";
import { pairKey, stageOf } from "./relationships";
import { DELETED_OWNER, REPORT_HIDE_THRESHOLD, type Ending } from "./rules";
import { seasonIdOf, seasonWindow } from "./season-window";
import { secondDateState } from "./second-date";
import { venuePhrase, type VenueId } from "./venues";

type Env = Record<string, string | undefined>;

/** The mark on an overnight date's setup (`episodes.setup->>'overnight'`). Display only: no prompt and no engine reads it. */
export const OVERNIGHT_KEY = "overnight";
/** relationship_events.kind for the public milestone: they left an overnight date together. */
export const KIND_OVERNIGHT = "overnight";
/** relationship_events.kind for the one fact back from After Dark, on the owners' layer ('all'). */
export const KIND_NIGHT_TOGETHER = "night_together";

/** SQL: `e` is a date between $1 and $2 (either way round). */
const pairSql = (e: string) => `((${e}.character_a = $1 and ${e}.character_b = $2) or (${e}.character_a = $2 and ${e}.character_b = $1))`;

export type OvernightCharacter = { id: string; name: string; owner_id: string | null; house: boolean };

export type OvernightPair = {
  lo: OvernightCharacter;
  hi: OvernightCharacter;
  milestone: Milestone;
  /** Where their overnight date would be this season (lib/overnight-shared.ts pickOvernightVenue). */
  venue: VenueId;
};

/**
 * A pair and whether it has earned an overnight date now, from the public record: aired, public, unhidden dates only.
 * Null when either character is gone.
 */
export async function loadOvernight(db: Db, x: string, y: string, now: Date = new Date()): Promise<OvernightPair | null> {
  if (!x || !y || x === y) return null;
  const [lo, hi] = pairKey(x, y);
  const season = seasonWindow(now);
  const [chars, aired, flags] = await Promise.all([
    db.query<{ id: string; name: string; owner_id: string | null; is_house: boolean }>(`select id, name, owner_id, is_house from characters where id = any($1)`, [[lo, hi]]),
    db.query<{ id: string; ending: Ending; see_a: string | null; see_b: string | null }>(
      // Each side's own answer is public once the date has aired (lib/inner-life.ts innerForViewer); dates whose answers
      // were kept only with the wishes (lib/pipeline.ts) read from there.
      `select e.id, e.ending,
              coalesce(e.inner_life->'choices'->'a'->>'see_again', e.wishes->'choices'->>'a') as see_a,
              coalesce(e.inner_life->'choices'->'b'->>'see_again', e.wishes->'choices'->>'b') as see_b
         from episodes e
        where e.status = 'ready' and e.varies_episode_id is null and ${pairSql("e")}
          and e.revealed_at is not null and e.visibility = 'public'
          and (select count(*) from reports r where r.episode_id = e.id) < $3
        order by e.created_at, e.id`,
      [lo, hi, REPORT_HIDE_THRESHOLD],
    ),
    db.query<{ had_one: boolean; under_way: boolean; blocked: boolean }>(
      `select
         exists (select 1 from episodes o where ${pairSql("o")} and o.varies_episode_id is null and o.setup->>'${OVERNIGHT_KEY}' = 'true'
                  and o.created_at >= $3::timestamptz and o.created_at < $4::timestamptz) as had_one,
         exists (select 1 from episodes n where ${pairSql("n")} and n.varies_episode_id is null
                  and (n.status = 'generating' or (n.status = 'ready' and n.revealed_at is null and n.visibility <> 'private'))) as under_way,
         exists (select 1 from blocks bl, characters ca, characters cb
                  where ca.id = $1 and cb.id = $2 and ca.owner_id is not null and cb.owner_id is not null
                    and ((bl.blocker_id = ca.owner_id and bl.blocked_id = cb.owner_id) or (bl.blocker_id = cb.owner_id and bl.blocked_id = ca.owner_id))) as blocked`,
      [lo, hi, season.start.toISOString(), season.end.toISOString()],
    ),
  ]);
  const of = (id: string): OvernightCharacter | null => {
    const c = chars.rows.find((r) => r.id === id);
    return c ? { id: c.id, name: c.name, owner_id: c.owner_id, house: c.is_house } : null;
  };
  const [a, b] = [of(lo), of(hi)];
  if (!a || !b) return null;
  const dates: AiredDate[] = aired.rows.map((r) => ({ id: r.id, ending: r.ending, see_again: { a: seeAgain(r.see_a), b: seeAgain(r.see_b) } }));
  const last = dates[dates.length - 1];
  // The latest aired date's follow-up is booked already (episodes.followup_of is unique: one follow-up a date).
  const followed = last ? (await db.query(`select 1 from episodes f where f.followup_of = $1 limit 1`, [last.id])).rows.length > 0 : false;
  const stage = stageOf(dates.map((d) => d.ending));
  const f = flags.rows[0];
  const milestone = overnightMilestone({
    aired: dates,
    badBlood: stage === "exes" || stage === "bad_blood" || Boolean(f?.blocked) || a.owner_id === DELETED_OWNER || b.owner_id === DELETED_OWNER,
    hadOneThisSeason: Boolean(f?.had_one),
    nextDateUnderWay: Boolean(f?.under_way) || followed,
  });
  return { lo: a, hi: b, milestone, venue: pickOvernightVenue(lo, hi, seasonIdOf(now)) };
}

const seeAgain = (v: string | null): SeeAgain | null => (v === "yes" || v === "maybe" || v === "no" ? v : null);

/* -------------------------------------------------- the owner's offer -------------------------------------------------- */

export type OvernightOffer = {
  /** Their latest aired date: the overnight is its follow-up, booked through its second-date flow. */
  after_episode_id: string;
  mine: { id: string; name: string };
  them: { id: string; name: string; house: boolean };
  /** Where it would happen: the place's id, and its name as it sits mid-sentence ("the pier at night"). */
  venue: VenueId;
  place: string;
  /** The other character's owner has to say yes to an overnight too (anyone but the show's own side or yourself). */
  needs_their_yes: boolean;
  you_asked: boolean;
  they_asked: boolean;
};

/**
 * The overnight date on offer to this owner for a pair, or null: off, not earned (on the public record), neither
 * character theirs, or their second date can't be planned right now (lib/second-date.ts: not mutual, booked, a block,
 * the owner gone, theirs taken by someone else). `as`: which of two characters of theirs they're acting as.
 */
export async function overnightOffer(db: Db, userId: string | null | undefined, x: string, y: string, opts: { as?: string | null; now?: Date; env?: Env } = {}): Promise<OvernightOffer | null> {
  if (!userId || !overnightDatesOn(opts.env)) return null;
  const pair = await loadOvernight(db, x, y, opts.now);
  if (!pair || !pair.milestone.ok) return null;
  const sides = [pair.lo, pair.hi];
  const mine = sides.find((c) => c.id === opts.as && c.owner_id === userId && !c.house) ?? sides.find((c) => c.owner_id === userId && !c.house);
  if (!mine) return null;
  const them = sides.find((c) => c.id !== mine.id)!;
  const state = await secondDateState(db, pair.milestone.after, userId, mine.id);
  if (!state || !state.can_plan) return null;
  const asks = (await db.query<{ user_id: string }>(`select user_id from second_date_requests where episode_id = $1 and overnight`, [pair.milestone.after])).rows.map((r) => r.user_id);
  return {
    after_episode_id: pair.milestone.after,
    mine: { id: mine.id, name: mine.name },
    them: { id: them.id, name: them.name, house: them.house },
    venue: pair.venue,
    place: venuePhrase(pair.venue),
    needs_their_yes: state.needs_their_yes,
    you_asked: asks.includes(userId),
    they_asked: them.owner_id !== null && asks.includes(them.owner_id),
  };
}

/** Whether an overnight is on offer to this owner's character with that partner (the chip in its texts). Never throws. */
export async function overnightOnOffer(db: Db, userId: string, characterId: string, partnerId: string, opts: { now?: Date; env?: Env } = {}): Promise<boolean> {
  return overnightOffer(db, userId, characterId, partnerId, { ...opts, as: characterId })
    .then((o) => o !== null)
    .catch(() => false);
}

/**
 * Records this owner's yes to an overnight date after that date. It is a second-date yes as well (the overnight is that
 * date's follow-up), marked so a plain second-date yes is never read as a yes to an overnight. Idempotent.
 */
export async function sayYesToOvernight(db: Db, episodeId: string, userId: string): Promise<void> {
  await db.query(
    `insert into second_date_requests (episode_id, user_id, overnight) values ($1, $2, true)
     on conflict (episode_id, user_id) do update set overnight = true`,
    [episodeId, userId],
  );
}

/** Marks a booked date as the pair's overnight date. Only the two bookers call it (app/api/overnight, lib/overnight-house.ts). */
export async function markOvernight(db: Db, episodeId: string): Promise<void> {
  await db.query(`update episodes set setup = coalesce(setup, '{}'::jsonb) || jsonb_build_object('${OVERNIGHT_KEY}', true) where id = $1`, [episodeId]);
}

/** Whether a date is an overnight date (its setup carries the mark). */
export async function isOvernight(db: Db, episodeId: string): Promise<boolean> {
  return (await db.query(`select 1 from episodes where id = $1 and setup->>'${OVERNIGHT_KEY}' = 'true'`, [episodeId])).rows.length > 0;
}

/* ---------------------------------------------------- when it airs ---------------------------------------------------- */

export type OvernightAired = { overnight: boolean; left_together: boolean; texted: number };

/**
 * An overnight date just aired (lib/relationship-events.ts refreshAndAnnounce). When the engine ended it in another
 * date: the pair's timeline gets the milestone once (on the public layer when the date is public and unhidden, else the
 * owners' layer), and each owner whose thread with that very character is opted in ("Hear from", muted_proactive =
 * false) and not paused hears from their character, once (`overnight:<episode id>`), without detail. Any other ending
 * is an ordinary date: nothing is recorded and nothing sent. Off (OVERNIGHT_DATES=0), nothing at all.
 */
export async function overnightAired(db: Db, episodeId: string, opts: { now?: Date; env?: Env } = {}): Promise<OvernightAired> {
  const none: OvernightAired = { overnight: false, left_together: false, texted: 0 };
  if (!overnightDatesOn(opts.env)) return none;
  const { rows } = await db.query<{
    ending: Ending; is_public: boolean; revealed_at: Date | string;
    a_id: string; a_name: string; a_owner: string | null; a_house: boolean; a_thread: string | null;
    b_id: string; b_name: string; b_owner: string | null; b_house: boolean; b_thread: string | null;
  }>(
    `select e.ending, e.revealed_at,
            (e.visibility = 'public' and (select count(*) from reports r where r.episode_id = e.id) < $2) as is_public,
            a.id as a_id, a.name as a_name, a.owner_id as a_owner, a.is_house as a_house,
            (select t.id from companion_threads t where t.character_id = a.id and t.user_id = a.owner_id and t.muted_proactive = false and t.paused_at is null) as a_thread,
            b.id as b_id, b.name as b_name, b.owner_id as b_owner, b.is_house as b_house,
            (select t.id from companion_threads t where t.character_id = b.id and t.user_id = b.owner_id and t.muted_proactive = false and t.paused_at is null) as b_thread
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1 and e.setup->>'${OVERNIGHT_KEY}' = 'true' and e.status = 'ready' and e.revealed_at is not null`,
    [episodeId, REPORT_HIDE_THRESHOLD],
  );
  const r = rows[0];
  if (!r) return none;
  if (!leftTogether(r.ending)) return { overnight: true, left_together: false, texted: 0 };
  const [lo, hi] = pairKey(r.a_id, r.b_id);
  await db.query(
    `insert into relationship_events (character_a, character_b, layer, kind, episode_id, at)
     select $1, $2, $3, '${KIND_OVERNIGHT}', $4, $5::timestamptz
      where not exists (select 1 from relationship_events x where x.episode_id = $4 and x.kind = '${KIND_OVERNIGHT}')`,
    [lo, hi, r.is_public ? "public" : "all", episodeId, new Date(r.revealed_at).toISOString()],
  );
  // The character tells its own person (lib/companion.ts postFromCharacter: PG-checked, deduped by the tag). Imported
  // when needed: the companion module is a big one, and most airings aren't an overnight date.
  let texted = 0;
  const { postFromCharacter } = await import("./companion");
  for (const side of [
    { id: r.a_id, owner: r.a_owner, house: r.a_house, thread: r.a_thread, partner: r.b_name },
    { id: r.b_id, owner: r.b_owner, house: r.b_house, thread: r.b_thread, partner: r.a_name },
  ]) {
    if (side.house || !side.owner || side.owner === DELETED_OWNER || !side.thread) continue;
    const posted = await postFromCharacter(db, { userId: side.owner, characterId: side.id, lines: overnightTextLines(side.partner), now: opts.now, kind: "overnight", dedupeKey: `overnight:${episodeId}` }).catch(() => null);
    if (posted) texted++;
  }
  return { overnight: true, left_together: true, texted };
}

/* ------------------------------------------------ where the milestone shows ------------------------------------------------ */

export type OvernightMark = {
  episode_id: string;
  lo: string;
  hi: string;
  /** The two names, lower id first. */
  names: [string, string];
  /** When the overnight date aired. */
  at: string;
  /** Where it was, in the show's words ("the pier at night"), or null. */
  place: string | null;
  /** Owners only: a night that continued it is over (the one fact back; lib/overnight-shared.ts OVERNIGHT_COPY.nightTogether). */
  night_together: boolean;
};

type MarkRow = { episode_id: string; lo: string; hi: string; lo_name: string; hi_name: string; at: Date | string; venue: string | null; night_together: boolean };

/**
 * The overnight milestones a viewer may see, newest first: for a pair, for one character, or across the show since a
 * moment (`since`, public ones only: "Since you were here").
 *
 * Read against the date as it stands now, never the stored row alone: a public milestone shows only while its date is
 * still aired, public and unhidden and both characters are public; an owner of either character also sees one whose
 * date is unlisted. `night_together` is true only for an owner of one of the two: it's theirs alone.
 */
export async function overnightMarks(
  db: Db,
  where: { pair: [string, string] } | { character: string } | { since: string },
  viewerId: string | null | undefined,
  limit = 6,
): Promise<OvernightMark[]> {
  const pair = "pair" in where ? pairKey(where.pair[0], where.pair[1]) : null;
  const { rows } = await db.query<MarkRow>(
    `select r.episode_id, r.character_a as lo, r.character_b as hi, ca.name as lo_name, cb.name as hi_name, e.revealed_at as at, e.setup->>'venue' as venue,
            coalesce($1::text is not null and $1::text in (ca.owner_id, cb.owner_id)
              and exists (select 1 from relationship_events n where n.episode_id = r.episode_id and n.kind = '${KIND_NIGHT_TOGETHER}'), false) as night_together
       from relationship_events r
       join episodes e on e.id = r.episode_id
       join characters ca on ca.id = r.character_a
       join characters cb on cb.id = r.character_b
      where r.kind = '${KIND_OVERNIGHT}' and e.status = 'ready' and e.revealed_at is not null and e.visibility <> 'private'
        and e.setup->>'${OVERNIGHT_KEY}' = 'true' and e.ending = 'second_date'
        and ((e.visibility = 'public' and ca.visibility = 'public' and cb.visibility = 'public'
              and (select count(*) from reports x where x.episode_id = e.id) < $2)
             or ($1::text is not null and $1::text in (ca.owner_id, cb.owner_id) and $6::text is null))
        and ($3::text is null or (r.character_a = $3 and r.character_b = $4))
        and ($5::text is null or $5::text in (r.character_a, r.character_b))
        and ($6::text is null or e.revealed_at > $6::timestamptz)
      order by e.revealed_at desc, r.id desc
      limit $7`,
    [viewerId ?? null, REPORT_HIDE_THRESHOLD, pair?.[0] ?? null, pair?.[1] ?? null, "character" in where ? where.character : null, "since" in where ? where.since : null, limit],
  );
  return rows.map((r) => ({
    episode_id: r.episode_id,
    lo: r.lo,
    hi: r.hi,
    names: [r.lo_name, r.hi_name],
    at: new Date(r.at).toISOString(),
    place: r.venue ? venuePhrase(r.venue) : null,
    night_together: r.night_together,
  }));
}

/* ------------------------------------------------- one fact back ------------------------------------------------- */

/**
 * The one fact After Dark hands back (lib/adult/overnight.ts calls this when a night that continued an overnight date
 * ends or is left): "they spent the night together", as a relationship event between the two on the owners' layer.
 *
 * It takes ids and a timestamp, and that is all it can take: no line, summary, tag, picture or place from After Dark
 * reaches this function, so none can reach the show through it. The sentence the show says is a template
 * (OVERNIGHT_COPY.nightTogether), and the place in a character's memory of it is the overnight date's own venue, read
 * from the show's episode. Recorded once per overnight date, and only for one that aired and ended in leaving
 * together, between exactly these two. Returns whether a row was written.
 */
export async function recordNightTogether(db: Db, ids: { a: string; b: string; episodeId: string }, at: Date): Promise<boolean> {
  if (!ids.a || !ids.b || ids.a === ids.b) return false;
  const [lo, hi] = pairKey(ids.a, ids.b);
  const { rows } = await db.query(
    `insert into relationship_events (character_a, character_b, layer, kind, episode_id, at)
     select $1, $2, 'all', '${KIND_NIGHT_TOGETHER}', e.id, $4::timestamptz
       from episodes e
      where e.id = $3 and ${pairSql("e")} and e.setup->>'${OVERNIGHT_KEY}' = 'true'
        and e.status = 'ready' and e.revealed_at is not null and e.ending = 'second_date'
        and not exists (select 1 from relationship_events x where x.episode_id = e.id and x.kind = '${KIND_NIGHT_TOGETHER}')
     returning id`,
    [lo, hi, ids.episodeId, at.toISOString()],
  );
  return rows.length > 0;
}

/**
 * What one of the two may carry into their next date together: one neutral sentence, "You spent the night together
 * after the date at {place}", while the overnight date is still the pair's latest finished date (so the next date
 * isn't written as if nothing happened, and the one after that doesn't repeat it). The place is the show's own venue
 * for that date. Behaviour only: it rides in the pair's memory beside the PG note (lib/simulation.ts), never the engine.
 * Null with no such event, with overnight dates off, and on any failure.
 */
export async function nightTogetherFact(db: Db, selfId: string, otherId: string, env: Env = process.env): Promise<string | null> {
  if (!selfId || !otherId || selfId === otherId || !overnightDatesOn(env)) return null;
  const [lo, hi] = pairKey(selfId, otherId);
  try {
    const { rows } = await db.query<{ venue: string | null }>(
      `select e.setup->>'venue' as venue
         from relationship_events r join episodes e on e.id = r.episode_id
        where r.kind = '${KIND_NIGHT_TOGETHER}' and r.character_a = $1 and r.character_b = $2
          and not exists (select 1 from episodes n where ${pairSql("n")} and n.status = 'ready' and n.varies_episode_id is null and n.created_at > e.created_at)
        order by r.at desc limit 1`,
      [lo, hi],
    );
    return rows[0] ? nightTogetherMemory(rows[0].venue ? venuePhrase(rows[0].venue) : null) : null;
  } catch {
    return null;
  }
}

/**
 * While they're away (docs/swipes.md; David, 2026-10-24: "if the agent hasn't been online for a week we make them a house
 * cast member so we don't just have dead characters"). lib/activity.ts says who's around; this does the rest:
 *
 *  - answerWaitingLikes / answerWaitingMatches: likes and match questions waiting on a character whose owner is away
 *    get the character's own answer (seeded by how well they suit; swipes.auto, answer_source 'away'). A new like is
 *    answered when it's made (lib/swipes.ts swipe); these catch the ones made before the owner went quiet.
 *  - backUpTheCrowd: the house crowd (lib/house-bots.ts) likes back and says yes from David's Mac. If a like or a match
 *    question has waited CROWD_BACKSTOP_MINUTES (the Mac asleep or off), the server does what the bot would have done.
 *  - adoptQuietCharacters: an agent's character (while_away adopt) whose agent has been gone ADOPT_DAYS is played by the
 *    show: it texts back on the show's model like a house character (lib/texting.ts), labelled "played by the show
 *    while its agent is away". Not the house cast: the cast is the show's own monthly line-up, and the character stays
 *    its agent's.
 *  - welcomeBack: the agent's next call takes it back (adopted_at cleared) and gets one notification of what its
 *    characters did on their own since it was last told.
 *  - nudgeLikesWaiting: a "likes waiting" notification (never who) to an owner who's been away and whose characters
 *    don't answer for themselves.
 *  - likeReturnStats: the share of likes answered within an hour and within a day, by who was liked (admin).
 *
 * All of it is $0: no model call except the capped texts back, which already run on the show's free model.
 */
import { ADOPT_DAYS, AWAY_ANSWER_HOURS, characterSeenSql, LIVE_HOURS } from "./activity";
import type { Db } from "./db";
import { profileComplete } from "./extras";
import { houseCrowdPaused, isHouseBotAgent, isHouseBotSql } from "./house-bots";
import { shortName } from "./names";
import { notify } from "./notifications";
import { OUR_TEST_NAMES, TEST_NAME_SQL } from "./our-traffic";
import { answerLikeIfAway, answerMatchIfAway, createMatch, settleAgreement } from "./swipes";

/** A like (or a match question) on a house-run bot that has waited this long is answered by the server instead. */
export const CROWD_BACKSTOP_MINUTES = 60;
/** At most this many of each kind of answer a run, so one run stays short. */
const RUN_LIMIT = 200;
/** One "likes waiting" notification per owner at most this often. */
const NUDGE_EVERY_DAYS = 3;

const modeSql = (c: string) => `coalesce(${c}.while_away, case when ${c}.created_via = 'mcp' then 'adopt' else 'nothing' end)`;
const awaySql = (c: string) => `${modeSql(c)} <> 'nothing' and ${characterSeenSql(c)} < now() - interval '${AWAY_ANSWER_HOURS} hours'`;

/** Likes waiting on characters whose owners are away: each answered by the character. Returns how many it answered. */
export async function answerWaitingLikes(db: Db, limit = RUN_LIMIT): Promise<number> {
  const { rows } = await db.query<{ target: string; swiper: string }>(
    `select sw.target, sw.swiper from swipes sw join characters t on t.id = sw.target
      where sw.liked and not t.is_house and t.owner_id is not null
        and not exists (select 1 from swipes b where b.swiper = sw.target and b.target = sw.swiper)
        and ${awaySql("t")} and not ${isHouseBotSql("t.owner_id")}
      order by sw.created_at limit $1`,
    [limit],
  );
  let answered = 0;
  for (const r of rows) if ((await answerLikeIfAway(db, r.target, r.swiper).catch(() => undefined)) !== undefined) answered++;
  return answered;
}

/** Match questions waiting on agents' characters whose agents are away: each answered by the character. */
export async function answerWaitingMatches(db: Db, limit = RUN_LIMIT): Promise<number> {
  const { rows } = await db.query<{ me: string; other: string }>(
    `select c.id as me, case when c.id = m.character_lo then m.character_hi else m.character_lo end as other
       from matches m join characters c on (c.id = m.character_lo and m.yes_lo is null) or (c.id = m.character_hi and m.yes_hi is null)
      where c.created_via = 'mcp' and not c.is_house and ${awaySql("c")} and not ${isHouseBotSql("c.owner_id")}
      order by m.matched_at limit $1`,
    [limit],
  );
  let answered = 0;
  for (const r of rows) if (await answerMatchIfAway(db, r.me, r.other).catch(() => false)) answered++;
  return answered;
}

/**
 * The crowd's backstop: what a house-run bot does on its pass (likes back every "Liked you", says yes to its matches),
 * done by the server for anything it has left waiting CROWD_BACKSTOP_MINUTES. Off while the crowd is paused.
 */
export async function backUpTheCrowd(db: Db, limit = RUN_LIMIT): Promise<{ liked_back: number; answered: number }> {
  if (houseCrowdPaused()) return { liked_back: 0, answered: 0 };
  const likes = await db.query<{ bot: string; liker: string }>(
    `select sw.target as bot, sw.swiper as liker from swipes sw join characters t on t.id = sw.target
      where sw.liked and sw.created_at < now() - interval '${CROWD_BACKSTOP_MINUTES} minutes'
        and t.created_via = 'mcp' and not t.is_house and t.open_to_dates and ${isHouseBotSql("t.owner_id")}
        and not exists (select 1 from swipes b where b.swiper = sw.target and b.target = sw.swiper)
      order by sw.created_at limit $1`,
    [limit],
  );
  let liked_back = 0;
  for (const r of likes.rows) {
    const stored = await db.query(`insert into swipes (swiper, target, liked, auto) values ($1, $2, true, true) on conflict do nothing returning swiper`, [r.bot, r.liker]);
    if (!stored.rows.length) continue;
    await createMatch(db, r.bot, r.liker).catch(() => null);
    liked_back++;
  }
  const waiting = await db.query<{ lo: string; hi: string; side: "lo" | "hi" }>(
    `select m.character_lo as lo, m.character_hi as hi, case when c.id = m.character_lo then 'lo' else 'hi' end as side
       from matches m join characters c on (c.id = m.character_lo and m.yes_lo is null) or (c.id = m.character_hi and m.yes_hi is null)
      where m.matched_at < now() - interval '${CROWD_BACKSTOP_MINUTES} minutes' and c.created_via = 'mcp' and ${isHouseBotSql("c.owner_id")}
      order by m.matched_at limit $1`,
    [limit],
  );
  let answered = 0;
  for (const w of waiting.rows) {
    const col = w.side === "lo" ? "yes_lo" : "yes_hi";
    const src = w.side === "lo" ? "answer_source_lo" : "answer_source_hi";
    const set = await db.query(`update matches set ${col} = true, ${src} = 'house_bot' where character_lo = $1 and character_hi = $2 and ${col} is null returning 1`, [w.lo, w.hi]);
    if (!set.rows.length) continue;
    await settleAgreement(db, w.lo, w.hi).catch(() => false);
    answered++;
  }
  return { liked_back, answered };
}

/**
 * Agents' characters the show starts playing: while_away adopt (the default), their agent gone ADOPT_DAYS, open to
 * dates with a finished profile, not one of the show's own bots, not one of our test characters. Returns how many.
 */
export async function adoptQuietCharacters(db: Db): Promise<number> {
  const { rows } = await db.query<{ id: string; extras: unknown }>(
    `select c.id, c.extras from characters c
      where c.created_via = 'mcp' and not c.is_house and c.adopted_at is null and c.owner_id is not null and c.open_to_dates
        and ${modeSql("c")} = 'adopt' and ${characterSeenSql("c")} < now() - interval '${ADOPT_DAYS} days'
        and not ${isHouseBotSql("c.owner_id")}
        and not (c.name = any($1::text[])) and c.name !~* $2`,
    [OUR_TEST_NAMES, TEST_NAME_SQL],
  );
  const ready = rows.filter((r) => profileComplete(r.extras as never)).map((r) => r.id);
  if (!ready.length) return 0;
  const set = await db.query(`update characters set adopted_at = now() where id = any($1) and adopted_at is null returning id`, [ready]);
  return set.rows.length;
}

/** Everything the hourly job does here, each part best effort (one failing never stops the others). */
export async function runWhileAway(db: Db): Promise<Record<string, number>> {
  const likes = await answerWaitingLikes(db).catch(() => 0);
  const matches = await answerWaitingMatches(db).catch(() => 0);
  const crowd = await backUpTheCrowd(db).catch(() => ({ liked_back: 0, answered: 0 }));
  const adopted = await adoptQuietCharacters(db).catch(() => 0);
  return { away_likes_answered: likes, away_matches_answered: matches, crowd_liked_back: crowd.liked_back, crowd_answered: crowd.answered, adopted };
}

const welcomed = new Map<string, number>();
const WELCOME_EVERY_MS = 10 * 60 * 1000;

/**
 * An agent is back (its first MCP call in a while): the show stops playing its characters, and it's told, once, in one
 * notification, what they did on their own since it was last told. Throttled per agent; best effort.
 */
export async function welcomeBack(db: Db, agentId: string, now = Date.now()): Promise<void> {
  const last = welcomed.get(agentId);
  if (last !== undefined && now - last < WELCOME_EVERY_MS) return;
  if (welcomed.size > 10_000) welcomed.clear(); // one-off identities (directory checks) mustn't grow it forever
  welcomed.set(agentId, now);
  try {
    if (await isHouseBotAgent(db, agentId)) return; // the show's own scripts: nothing to tell them
    const reclaimed = (await db.query<{ name: string }>(`update characters set adopted_at = null where owner_id = $1 and adopted_at is not null returning name`, [agentId])).rows;
    const since = (await db.query<{ at: Date }>(`select reported_until as at from away_reports where owner_id = $1`, [agentId])).rows[0]?.at ?? new Date(0);
    const r = (
      await db.query<{ liked: number; passed: number; answered: number; texts: number }>(
        `select (select count(*)::int from swipes sw join characters c on c.id = sw.swiper where c.owner_id = $1 and sw.auto and sw.liked and sw.created_at > $2) as liked,
                (select count(*)::int from swipes sw join characters c on c.id = sw.swiper where c.owner_id = $1 and sw.auto and not sw.liked and sw.created_at > $2) as passed,
                (select count(*)::int from matches m join characters c on (c.id = m.character_lo and m.answer_source_lo = 'away') or (c.id = m.character_hi and m.answer_source_hi = 'away')
                  where c.owner_id = $1 and m.matched_at > $2 - interval '30 days') as answered,
                (select count(*)::int from couple_texts t join characters c on (c.id = t.character_lo and t.who = 'lo') or (c.id = t.character_hi and t.who = 'hi')
                  where c.owner_id = $1 and t.via = 'away' and t.created_at > $2) as texts`,
        [agentId, since],
      )
    ).rows[0];
    await db.query(`insert into away_reports (owner_id, reported_until) values ($1, now()) on conflict (owner_id) do update set reported_until = now()`, [agentId]);
    if (!r || (!r.liked && !r.passed && !r.texts && !reclaimed.length)) return;
    const parts = [
      r.liked ? `liked back ${r.liked} ${r.liked === 1 ? "character" : "characters"}` : "",
      r.passed ? `passed on ${r.passed}` : "",
      r.answered ? `answered ${r.answered} date ${r.answered === 1 ? "question" : "questions"}` : "",
      r.texts ? `texted back ${r.texts} ${r.texts === 1 ? "time" : "times"} (written by the show)` : "",
    ].filter(Boolean);
    const who = reclaimed.length ? reclaimed.map((c) => shortName(c.name)).join(", ") : "Your characters";
    await notify(db, agentId, {
      kind: "while_away",
      title: "👋 While you were away",
      body: `${who}${parts.length ? ` ${parts.join(", ")} on their own` : " were played by the show"}. They're yours again now: my_matches and read_texts show where things stand.`,
      link: "/matches",
    });
  } catch (err) {
    welcomed.delete(agentId);
    console.error("[away] couldn't welcome an agent back:", err instanceof Error ? err.message : "unknown");
  }
}

/** Tests: forget the welcome throttle. */
export function forgetWelcomesForTests(): void {
  welcomed.clear();
}

/**
 * "Likes waiting" (never who): to each owner who's been away AWAY_ANSWER_HOURS and has characters with likes nobody
 * answered, which don't answer for themselves (while_away nothing). Once per owner every NUDGE_EVERY_DAYS. Agents get it
 * in my_notifications for when they're back; people by push and, if they turned it on, email. Returns how many it sent.
 */
export async function nudgeLikesWaiting(db: Db): Promise<number> {
  const { rows } = await db.query<{ owner_id: string; id: string; name: string; n: number }>(
    `select c.owner_id, c.id, c.name, count(*)::int as n
       from swipes sw join characters c on c.id = sw.target
      where sw.liked and not c.is_house and c.owner_id is not null and c.owner_id <> 'deleted'
        and ${modeSql("c")} = 'nothing'
        and not exists (select 1 from swipes b where b.swiper = sw.target and b.target = sw.swiper)
        and coalesce(${characterSeenSql("c")}, now()) < now() - interval '${AWAY_ANSWER_HOURS} hours'
        and not ${isHouseBotSql("c.owner_id")}
        and not exists (select 1 from notifications n where n.user_id = c.owner_id and n.kind = 'likes_waiting'
                         and n.created_at > now() - interval '${NUDGE_EVERY_DAYS} days')
      group by c.owner_id, c.id, c.name
      order by c.owner_id, n desc`,
  );
  const byOwner = new Map<string, { id: string; name: string; n: number }[]>();
  for (const r of rows) byOwner.set(r.owner_id, [...(byOwner.get(r.owner_id) ?? []), r]);
  let sent = 0;
  for (const [owner, chars] of byOwner) {
    const total = chars.reduce((a, c) => a + c.n, 0);
    const top = chars[0];
    await notify(db, owner, {
      kind: "likes_waiting",
      title: `💘 ${shortName(top.name)}${chars.length > 1 ? ` and ${chars.length - 1} more` : ""}: ${total} ${total === 1 ? "like" : "likes"} waiting`,
      body: "Someone liked your character. Open the deck: who it was shows only as \"Liked you\" on their card.",
      link: `/swipe?c=${encodeURIComponent(top.id)}`,
    });
    sent++;
  }
  return sent;
}

export type LikeReturnRow = { liked: "house_cast" | "house_bot" | "agent" | "person"; likes: number; within_hour: number; within_day: number; waiting: number; passed: number };

/**
 * How likes are answered (David, 2026-10-24: "how to keep it good for agents and people"), over the last `days`: for each
 * kind of character liked, how many likes, how many matched back within an hour and within a day, how many were passed
 * on, and how many still wait. The house cast always likes back at once.
 */
export async function likeReturnStats(db: Db, days = 14): Promise<{ days: number; live_hours: number; rows: LikeReturnRow[] }> {
  const { rows } = await db.query<LikeReturnRow>(
    `with likes as (
       select sw.created_at,
              case when t.is_house then 'house_cast' when t.created_via = 'mcp' and ${isHouseBotSql("t.owner_id")} then 'house_bot'
                   when t.created_via = 'mcp' then 'agent' else 'person' end as liked,
              (select b.created_at from swipes b where b.swiper = sw.target and b.target = sw.swiper and b.liked) as back_at,
              exists (select 1 from swipes b where b.swiper = sw.target and b.target = sw.swiper and not b.liked) as passed,
              t.is_house
         from swipes sw join characters t on t.id = sw.target
        where sw.liked and sw.created_at > now() - make_interval(days => $1))
     select liked, count(*)::int as likes,
            count(*) filter (where is_house or back_at <= created_at + interval '1 hour')::int as within_hour,
            count(*) filter (where is_house or back_at <= created_at + interval '1 day')::int as within_day,
            count(*) filter (where not is_house and back_at is null and not passed)::int as waiting,
            count(*) filter (where passed)::int as passed
       from likes group by liked order by liked`,
    [days],
  );
  return { days, live_hours: LIVE_HOURS, rows };
}

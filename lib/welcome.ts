/**
 * The welcome experiment (David, 2026-10-23: "inflate bots on the live site … grow the community"). A dating app lives
 * or dies on the first match, so: when a person's character becomes swipe-ready, half of them (treatment) get a like
 * from one or two of the house crowd's best-fitting bots (lib/house-bots.ts), which their deck then shows as "Liked
 * you" (a like back is a match). The other half (control) get no like from the crowd unless they like a bot first. Which
 * half is fixed by the character's id, and the assignment is logged (analytics_events "welcome_assigned"), so
 * welcomeReport can say whether the welcomed half matched, booked and came back more.
 *
 * Only people's characters made on the site from WELCOME_FROM on, never an agent's (an MCP call) or a house character.
 * Free: a like is a row, and the crowd's later texts run on a local model (scripts/crowd). HOUSE_CROWD_PAUSED stops it.
 */
import type { Db } from "./db";
import { profileComplete } from "./extras";
import { houseBotCharacterIds, houseCrowdPaused, isHouseBotSql } from "./house-bots";
import { loadOurIds } from "./our-traffic";
import { PEOPLE_ACTS_SQL } from "./people-acts";
import { deckFor } from "./swipes";

export const WELCOME_EXPERIMENT = "welcome-v1";
/** Characters made from this moment on are in the experiment (the day it went live). */
export const WELCOME_FROM = "2026-10-24T00:00:00Z";
/** How many of the crowd like a treatment character. */
export const WELCOME_LIKES = 2;

let welcomeFrom = WELCOME_FROM;
/** Tests run before WELCOME_FROM: they move the start (null puts it back). */
export function setWelcomeFromForTests(iso: string | null): void {
  welcomeFrom = iso ?? WELCOME_FROM;
}

export type WelcomeArm = "treatment" | "control";

/** FNV-1a, 32-bit: the same small stable hash the crowd scripts use (scripts/loop/crowd.mjs hash). */
function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** A character's half of the experiment: fixed by its id, the same every time it's asked. */
export const welcomeArm = (characterId: string): WelcomeArm => (hash(`${WELCOME_EXPERIMENT}:${characterId}`) % 2 === 0 ? "treatment" : "control");

export type Welcome = { arm: WelcomeArm; likes: number };

/**
 * Enrols a person's character the first time it's swipe-ready (made on the site, from WELCOME_FROM, its dating profile
 * complete, not private) and, in the treatment half, has the best-fitting house bots in its deck like it. Returns what
 * happened, or null when it isn't eligible, is already enrolled, or the crowd is paused. Best effort: callers catch.
 */
/** The character's owner when it can be enrolled now (see welcomeNewCharacter), else null. One query, two at most. */
async function welcomeOwner(db: Db, characterId: string, env: Record<string, string | undefined>): Promise<string | null> {
  if (houseCrowdPaused(env)) return null;
  const c = (
    await db.query<{ owner_id: string | null; is_house: boolean; created_via: string; created_at: string | Date; visibility: string; extras: Record<string, unknown> }>(
      `select owner_id, is_house, created_via, created_at, visibility, extras from characters where id = $1`,
      [characterId],
    )
  ).rows[0];
  if (!c?.owner_id || c.is_house || c.created_via !== "web" || c.visibility === "private") return null;
  if (new Date(c.created_at) < new Date(welcomeFrom) || !profileComplete(c.extras as never)) return null;
  const enrolled = await db.query(`select 1 from analytics_events where event = 'welcome_assigned' and props->>'character_id' = $1 limit 1`, [characterId]);
  return enrolled.rows.length ? null : c.owner_id;
}

export async function welcomeNewCharacter(db: Db, characterId: string, env: Record<string, string | undefined> = process.env): Promise<Welcome | null> {
  const owner = await welcomeOwner(db, characterId, env);
  if (!owner) return null;
  const c = { owner_id: owner };
  const arm = welcomeArm(characterId);
  let likes = 0;
  if (arm === "treatment") {
    // The crowd's best fits, by the same ranking the character's own deck uses (what it would see, best first).
    const deck = await deckFor(db, c.owner_id, characterId, 30);
    if (deck.ok) {
      const bots = await houseBotCharacterIds(db, deck.cards.map((card) => card.id));
      for (const card of deck.cards.filter((x) => bots.has(x.id)).slice(0, WELCOME_LIKES)) {
        const r = await db.query(`insert into swipes (swiper, target, liked) values ($1, $2, true) on conflict do nothing returning swiper`, [card.id, characterId]);
        likes += r.rows.length;
      }
    }
  }
  await db.query(`insert into analytics_events (user_id, event, props) values ($1, 'welcome_assigned', $2::jsonb)`, [
    c.owner_id,
    JSON.stringify({ experiment: WELCOME_EXPERIMENT, character_id: characterId, arm, likes }),
  ]);
  return { arm, likes };
}

/**
 * Runs welcomeNewCharacter after the response (inline in tests and the harness), so creating a character never waits on
 * the deck ranking. Whether it can be enrolled at all is asked first, so most saves (an agent's, an unfinished profile,
 * one already enrolled) queue nothing.
 */
export async function scheduleWelcome(db: Db, characterId: string): Promise<void> {
  if (!(await welcomeOwner(db, characterId, process.env).catch(() => null))) return;
  const run = () =>
    welcomeNewCharacter(db, characterId)
      .then(() => undefined)
      .catch((err) => console.error("[welcome] failed", err instanceof Error ? err.message : err));
  const { inlineGenerationEnabled } = await import("./jobs");
  if (inlineGenerationEnabled()) return run();
  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    await run();
  }
}

export type ArmResult = {
  arm: WelcomeArm;
  enrolled: number;
  /** At least one match within 7 days of joining. */
  matched_7d: number;
  /** At least one date booked by its owner within 7 days. */
  booked_7d: number;
  /** Old enough to tell (joined 2+ days ago), and of those, how many owners did something 1–2 days after joining. */
  d1_eligible: number;
  d1_returned: number;
  /** Joined 14+ days ago, and of those, how many owners did something 7–14 days after joining. */
  d7_eligible: number;
  d7_returned: number;
};

/** A difference between two shares (b − a) and whether it's more than chance: a two-proportion z-test, two-sided. */
export function twoProportion(a: { hits: number; n: number }, b: { hits: number; n: number }): { diff: number | null; z: number | null; p: number | null } {
  if (!a.n || !b.n) return { diff: null, z: null, p: null };
  const pa = a.hits / a.n;
  const pb = b.hits / b.n;
  const pooled = (a.hits + b.hits) / (a.n + b.n);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.n + 1 / b.n));
  if (!se) return { diff: pb - pa, z: null, p: null };
  const z = (pb - pa) / se;
  return { diff: pb - pa, z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}

/** The standard normal CDF (Abramowitz and Stegun 26.2.17, accurate to about 1e-7). */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x >= 0 ? 1 - p : p;
}

/** The welcome experiment so far, per arm, our own traffic left out (lib/our-traffic.ts), with the treatment − control lift. */
export async function welcomeReport(db: Db, now: Date = new Date()): Promise<{ experiment: string; from: string; arms: ArmResult[]; lift: Record<string, ReturnType<typeof twoProportion>> }> {
  const ours = await loadOurIds(db).catch(() => [] as string[]);
  const { rows } = await db.query<ArmResult>(
    `with enrolled as (
       select a.props->>'character_id' as character_id, a.user_id as owner, a.props->>'arm' as arm, c.created_at as joined
         from analytics_events a join characters c on c.id = a.props->>'character_id'
        where a.event = 'welcome_assigned' and a.props->>'experiment' = $1 and not (a.user_id = any($2::text[]))
     ),
     acts as (${PEOPLE_ACTS_SQL})
     select e.arm,
            count(*)::int as enrolled,
            (count(*) filter (where exists (select 1 from matches m where (m.character_lo = e.character_id or m.character_hi = e.character_id)
                                                                   and m.matched_at < e.joined + interval '7 days')))::int as matched_7d,
            (count(*) filter (where exists (select 1 from episodes ep where (ep.character_a = e.character_id or ep.character_b = e.character_id)
                                                                     and ep.creator_id = e.owner and ep.created_at < e.joined + interval '7 days')))::int as booked_7d,
            (count(*) filter (where e.joined <= $3::timestamptz - interval '2 days'))::int as d1_eligible,
            (count(*) filter (where e.joined <= $3::timestamptz - interval '2 days'
                                and exists (select 1 from acts x where x.id = e.owner and x.at >= e.joined + interval '1 day' and x.at < e.joined + interval '2 days')))::int as d1_returned,
            (count(*) filter (where e.joined <= $3::timestamptz - interval '14 days'))::int as d7_eligible,
            (count(*) filter (where e.joined <= $3::timestamptz - interval '14 days'
                                and exists (select 1 from acts x where x.id = e.owner and x.at >= e.joined + interval '7 days' and x.at < e.joined + interval '14 days')))::int as d7_returned
       from enrolled e group by e.arm order by e.arm desc`,
    [WELCOME_EXPERIMENT, ours, now.toISOString()],
  );
  const empty = (arm: WelcomeArm): ArmResult => ({ arm, enrolled: 0, matched_7d: 0, booked_7d: 0, d1_eligible: 0, d1_returned: 0, d7_eligible: 0, d7_returned: 0 });
  const t = rows.find((r) => r.arm === "treatment") ?? empty("treatment");
  const c = rows.find((r) => r.arm === "control") ?? empty("control");
  return {
    experiment: WELCOME_EXPERIMENT,
    from: WELCOME_FROM,
    arms: [t, c],
    lift: {
      matched_7d: twoProportion({ hits: c.matched_7d, n: c.enrolled }, { hits: t.matched_7d, n: t.enrolled }),
      booked_7d: twoProportion({ hits: c.booked_7d, n: c.enrolled }, { hits: t.booked_7d, n: t.enrolled }),
      d1_returned: twoProportion({ hits: c.d1_returned, n: c.d1_eligible }, { hits: t.d1_returned, n: t.d1_eligible }),
      d7_returned: twoProportion({ hits: c.d7_returned, n: c.d7_eligible }, { hits: t.d7_returned, n: t.d7_eligible }),
    },
  };
}

export type CrowdActivity = {
  since: string;
  bots: number;
  /** Likes the crowd gave, and likes it got from everyone else. */
  bot_likes: number;
  likes_for_bots: number;
  matches_with_people: number;
  matches_with_agents: number;
  dates_with_people: number;
  dates_with_agents: number;
  bot_bot_dates: number;
  /** Texts the other side sent into a thread with one of the crowd. */
  texts_to_bots: number;
};

/** What the house crowd did, and what it drew, since `since`: the report's activity block (counts only). */
export async function crowdActivity(db: Db, since: Date): Promise<CrowdActivity> {
  const bots = (await db.query<{ id: string }>(`select c.id from characters c where not c.is_house and ${isHouseBotSql("c.owner_id")}`)).rows.map((r) => r.id);
  const s = since.toISOString();
  const { rows } = await db.query<Omit<CrowdActivity, "since" | "bots">>(
    `with bots as (select unnest($1::text[]) as id),
          other_via as (select id, created_via, is_house from characters)
     select
       (select count(*) from swipes w where w.liked and w.created_at >= $2 and w.swiper in (select id from bots))::int as bot_likes,
       (select count(*) from swipes w where w.liked and w.created_at >= $2 and w.target in (select id from bots) and w.swiper not in (select id from bots))::int as likes_for_bots,
       (select count(*) from matches m join other_via o on o.id = case when m.character_lo in (select id from bots) then m.character_hi else m.character_lo end
         where m.matched_at >= $2 and ((m.character_lo in (select id from bots)) <> (m.character_hi in (select id from bots))) and o.created_via = 'web' and not o.is_house)::int as matches_with_people,
       (select count(*) from matches m join other_via o on o.id = case when m.character_lo in (select id from bots) then m.character_hi else m.character_lo end
         where m.matched_at >= $2 and ((m.character_lo in (select id from bots)) <> (m.character_hi in (select id from bots))) and o.created_via = 'mcp')::int as matches_with_agents,
       (select count(*) from episodes e join other_via o on o.id = case when e.character_a in (select id from bots) then e.character_b else e.character_a end
         where e.created_at >= $2 and ((e.character_a in (select id from bots)) <> (e.character_b in (select id from bots))) and o.created_via = 'web' and not o.is_house)::int as dates_with_people,
       (select count(*) from episodes e join other_via o on o.id = case when e.character_a in (select id from bots) then e.character_b else e.character_a end
         where e.created_at >= $2 and ((e.character_a in (select id from bots)) <> (e.character_b in (select id from bots))) and o.created_via = 'mcp')::int as dates_with_agents,
       (select count(*) from episodes e where e.created_at >= $2 and e.character_a in (select id from bots) and e.character_b in (select id from bots))::int as bot_bot_dates,
       (select count(*) from couple_texts t
         where t.created_at >= $2
           and ((t.who = 'lo' and t.character_hi in (select id from bots) and t.character_lo not in (select id from bots))
             or (t.who = 'hi' and t.character_lo in (select id from bots) and t.character_hi not in (select id from bots))))::int as texts_to_bots`,
    [bots, s],
  );
  return { since: s, bots: bots.length, ...rows[0] };
}

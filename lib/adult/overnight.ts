/**
 * The night continues in After Dark (David, 2026-11-15; the show's half is lib/overnight.ts). On the show an overnight
 * date that ends in another date fades to black: "They left together. The cameras stayed behind." For a viewer After
 * Dark already admits, who owns one of the two, there is one button on that episode: "Continue the night in After
 * Dark". It opens the pair's night through After Dark's own start path, on After Dark's host, and nothing else.
 *
 * What it adds, and what it doesn't:
 *  - **No new way in.** The button shows only when After Dark's existing rules all say yes (continueShows): entitled
 *    today (lib/adult/entitlement.ts: a subscription, a pass, an invite or an admin, age-checked), allowed where they are
 *    (lib/adult/place.ts), 18+ said on this browser, the device not locked (lib/adult/privacy.ts), and BOTH characters
 *    already in this viewer's After Dark (lib/adult/characters.ts eligibleIds: their own switched in, this season's
 *    house cast, the agent cast that passed its checks). There is no consent mechanism for another person's character
 *    to appear in someone's night, and this makes none: such a pair never shows the button. Everyone else sees what
 *    they saw before (the invite line of lib/adult/bridge.ts, where that shows). `public_door` is untouched.
 *  - **No new generation path.** The night starts as any night does (lib/adult/scenes.ts): a fresh scene picks up where
 *    the pair's latest date ended, which After Dark already reads from the show (the date's setting, ending and last
 *    lines, the pair's memory). The start files a night already under way exactly as "Start over" does, and adds one
 *    seed sentence of show facts to what they remember tonight (overnightSeed): that the date was an overnight date,
 *    where they left from, and that this is the night after it. The writer, the checks, the limits and the token
 *    charges are After Dark's own, unchanged: the first chapter is paid for when the first lines are asked for.
 *  - **One fact back.** When that night ends (a chapter closes, or it's filed) or is left (no step for
 *    NIGHT_LEFT_HOURS), the show is told through lib/overnight.ts recordNightTogether, which takes two character ids,
 *    the overnight date's id and a timestamp. Nothing of the night goes with it: this module reads no line to tell it
 *    (only whether the night has any lines, and when it was last touched).
 */
import { afterDarkHref } from "../after-dark-host";
import { track } from "../analytics";
import { detectBot } from "../bots";
import type { Db } from "../db";
import type { AfterDarkMode } from "../jurisdiction";
import { OVERNIGHT_KEY, recordNightTogether } from "../overnight";
import { leftTogether, overnightAfterDarkOn, overnightDatesOn } from "../overnight-shared";
import { pairKey } from "../relationships";
import { shared } from "../shared-cache";
import { venuePhrase } from "../venues";
import { eligibleIds } from "./characters";
import { adultAvailable } from "./mode";
import { accessHere } from "./place";
import { isLocked, UNLOCK_COOKIE } from "./privacy";

type Env = Record<string, string | undefined>;

/** A night nobody has added to for this long has been left: the show is told then (the daily job sweeps them). */
export const NIGHT_LEFT_HOURS = 6;

/** Where the button leads: After Dark's own page for this overnight date (app/after-dark/overnight/[id]). */
export const overnightNightPath = (episodeId: string): string => `/after-dark/overnight/${encodeURIComponent(episodeId)}`;

/* ------------------------------------------------- who sees the button ------------------------------------------------- */

export type ContinueFacts = {
  /** Neither OVERNIGHT_DATES nor OVERNIGHT_AFTER_DARK is 0. */
  on: boolean;
  /** After Dark is switched on at all (lib/adult/mode.ts adultAvailable). */
  available: boolean;
  /** The date is an overnight date, and it has aired. */
  overnight: boolean;
  aired: boolean;
  /** How the engine ended it. */
  ending: string | null;
  /** It's still the pair's latest finished date: tonight is the night after it, not after some later date. */
  latest: boolean;
  /** The viewer has said they're 18 or older on this browser (the gate's cookie). */
  attested: boolean;
  /** What After Dark may be where they are. */
  mode: AfterDarkMode;
  /** After Dark is open to them today (lib/adult/entitlement.ts canAfterDark). */
  entitled: boolean;
  /** This device hasn't entered the account's PIN (lib/adult/privacy.ts): it's shown nothing of After Dark. */
  locked: boolean;
  /** They own one of the two characters. */
  owns: boolean;
  /** Both characters may be in THIS viewer's After Dark (lib/adult/characters.ts eligibleIds). */
  bothIn: boolean;
  /** A crawler or an agent. */
  bot: boolean;
};

/** Whether "Continue the night in After Dark" shows: every one must hold. Pure, so the matrix is tested without a page. */
export function continueShows(f: ContinueFacts): boolean {
  return (
    f.on && f.available && f.overnight && f.aired && leftTogether(f.ending) && f.latest && f.attested && f.mode !== "blocked" && f.entitled && !f.locked && f.owns && f.bothIn && !f.bot
  );
}

type OvernightRow = {
  id: string;
  ending: string | null;
  aired: boolean;
  latest: boolean;
  venue: string | null;
  a_id: string; a_name: string; a_owner: string | null;
  b_id: string; b_name: string; b_owner: string | null;
};

/** An overnight date as After Dark needs it: show facts only (who, how it ended, where, whether it's their latest). */
async function overnightDate(db: Db, episodeId: string): Promise<OvernightRow | null> {
  const { rows } = await db.query<OvernightRow>(
    `select e.id, e.ending, (e.status = 'ready' and e.revealed_at is not null) as aired, e.setup->>'venue' as venue,
            not exists (select 1 from episodes n
                         where n.status = 'ready' and n.varies_episode_id is null and n.created_at > e.created_at
                           and ((n.character_a = e.character_a and n.character_b = e.character_b) or (n.character_a = e.character_b and n.character_b = e.character_a))) as latest,
            a.id as a_id, a.name as a_name, a.owner_id as a_owner, b.id as b_id, b.name as b_name, b.owner_id as b_owner
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1 and e.setup->>'${OVERNIGHT_KEY}' = 'true'`,
    [episodeId],
  );
  return rows[0] ?? null;
}

/** Both switches on: overnight dates at all, and their After Dark half. */
export const overnightNightsOn = (env: Env = process.env): boolean => overnightDatesOn(env) && overnightAfterDarkOn(env);

export type ViewerContinue = { href: string };

/**
 * The button's link for this viewer on this episode, or null. Off, without the 18+ answer, and for a crawler, nothing is
 * read at all; a date that isn't an overnight date costs one read. A failure anywhere is "don't show".
 */
export async function viewerContinue(
  db: Db,
  auth: { userId: string; authenticated: boolean } | null,
  headers: Headers,
  cookies: { get(name: string): { value: string } | undefined },
  attested: boolean,
  episodeId: string,
  env: Env = process.env,
): Promise<ViewerContinue | null> {
  const on = overnightNightsOn(env);
  const bot = Boolean(detectBot(headers.get("user-agent"), headers.get("signature-agent")));
  if (!on || !attested || bot || !auth?.authenticated) return null;
  try {
    const date = await overnightDate(db, episodeId);
    if (!date) return null;
    const owns = date.a_owner === auth.userId || date.b_owner === auth.userId;
    if (!owns) return null;
    const [available, here, mine, locked] = await Promise.all([
      shared("after-dark:available", async () => adultAvailable(db, env)),
      accessHere(db, auth, headers),
      eligibleIds(db, auth.userId),
      isLocked(db, auth.userId, cookies.get(UNLOCK_COOKIE)?.value ?? null),
    ]);
    const shows = continueShows({
      on, available, overnight: true, aired: date.aired, ending: date.ending, latest: date.latest, attested, mode: here.mode, entitled: here.entitled.ok, locked, owns,
      bothIn: mine.has(date.a_id) && mine.has(date.b_id), bot,
    });
    return shows ? { href: afterDarkHref(overnightNightPath(episodeId), env) } : null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------- starting the night --------------------------------------------------- */

export type OvernightNight = {
  episode_id: string;
  /** The pair, lower id first, as After Dark keeps a scene. */
  pair: [string, string];
  names: [string, string];
  /** Where the overnight date was, in the show's words ("the pier at night"), or null. */
  place: string | null;
  /** They pressed Continue already: the night is theirs to go back to. */
  started: boolean;
};

/**
 * The night this viewer may continue from an overnight date, or null. For After Dark's own pages and routes, which have
 * already asked adultViewer (entitlement, place, lock): this adds the date's own rules (an overnight date that aired and
 * ended in leaving together, still the pair's latest), ownership, and that both are in this viewer's After Dark.
 */
export async function overnightNight(db: Db, ownerId: string, episodeId: string, env: Env = process.env): Promise<OvernightNight | null> {
  if (!overnightNightsOn(env)) return null;
  const date = await overnightDate(db, episodeId);
  if (!date || !date.aired || !leftTogether(date.ending) || !date.latest) return null;
  if (date.a_owner !== ownerId && date.b_owner !== ownerId) return null;
  const mine = await eligibleIds(db, ownerId);
  if (!mine.has(date.a_id) || !mine.has(date.b_id)) return null;
  const pair = pairKey(date.a_id, date.b_id);
  const nameOf = (id: string) => (id === date.a_id ? date.a_name : date.b_name);
  const started = (await db.query(`select 1 from adult_overnights where episode_id = $1 and owner_id = $2`, [episodeId, ownerId])).rows.length > 0;
  return { episode_id: date.id, pair, names: [nameOf(pair[0]), nameOf(pair[1])], place: date.venue ? venuePhrase(date.venue) : null, started };
}

/**
 * "Continue the night": the pair's night starts from the overnight date, through the scene's own start path. A night
 * already under way for the pair is filed first, exactly as Start over files it (nothing is lost: it's in Nights), so
 * the fresh scene picks up where the date ended; pressing it again later changes nothing. No line is written and no
 * token is taken here: the first chapter is asked for, checked and paid for on the night's page, as always.
 */
export async function startOvernightNight(db: Db, ownerId: string, episodeId: string, env: Env = process.env): Promise<{ path: string; night: OvernightNight } | null> {
  const night = await overnightNight(db, ownerId, episodeId, env);
  if (!night) return null;
  const path = `/after-dark/${night.pair[0]}/${night.pair[1]}`;
  if (night.started) return { path, night };
  // Imported when needed: the scene module is After Dark's biggest, and the show's episode page loads this file.
  const { openScene, resetScene } = await import("./scenes");
  const scene = await openScene(db, ownerId, night.pair[0], night.pair[1]);
  if (!scene) return null;
  if (scene.lines.length > 0 || scene.chapter > 1) await resetScene(db, ownerId, night.pair[0], night.pair[1]);
  // How many nights the pair had filed when this one started, the one just filed included: a night filed after that is
  // this one ending (tellShowNightsOver). A count, not a time: two statements can share a clock tick.
  await db.query(
    `insert into adult_overnights (episode_id, owner_id, character_a, character_b, nights_before)
     select $1, $2, $3, $4, (select count(*)::int from adult_nights n where n.owner_id = $2 and n.character_a = $3 and n.character_b = $4)
     on conflict (episode_id, owner_id) do nothing`,
    [episodeId, ownerId, night.pair[0], night.pair[1]],
  );
  track("overnight_continued", { episode_id: episodeId });
  return { path, night: { ...night, started: true } };
}

/**
 * The one sentence a continued night adds to what the two remember tonight (lib/adult/scenes.ts sceneMemories): show
 * facts only, in plain words. Null unless this viewer continued the pair's latest date as an overnight date.
 */
export async function overnightSeed(db: Db, ownerId: string, date: { id?: string | null; ending: string | null; venue: string | null } | null): Promise<string | null> {
  if (!date?.id || !leftTogether(date.ending) || !overnightNightsOn()) return null;
  const { rows } = await db
    .query(`select 1 from adult_overnights o join episodes e on e.id = o.episode_id where o.episode_id = $1 and o.owner_id = $2 and e.setup->>'${OVERNIGHT_KEY}' = 'true'`, [date.id, ownerId])
    .catch(() => ({ rows: [] }));
  if (!rows.length) return null;
  return `Their latest date${date.venue ? `, at ${venuePhrase(date.venue)},` : ""} was an overnight date on the show: they left together, and tonight is the rest of that night.`;
}

/* ----------------------------------------------------- one fact back ----------------------------------------------------- */

/**
 * Tells the show about continued nights that are over: one whose pair has had a night filed since it started (a chapter
 * closed, Start over, a scenario: more nights filed than when it began), or one with lines (the scene is empty when it
 * starts, so any line is this night's) that nobody has added to for NIGHT_LEFT_HOURS. Each is told once
 * (adult_overnights.told_at), and the show gets ids and the time, nothing else. `only`: just this viewer's pair (the
 * scene calls it when it files a night); otherwise every one that's due (After Dark's daily job). Returns how many;
 * none while either switch is off.
 */
export async function tellShowNightsOver(db: Db, only: { ownerId: string; pair: [string, string] } | null = null, now: Date = new Date(), env: Env = process.env): Promise<number> {
  // Off, nothing is told: the nights already continued stay ordinary nights until it's on again.
  if (!overnightNightsOn(env)) return 0;
  const pair = only ? pairKey(only.pair[0], only.pair[1]) : null;
  const { rows } = await db.query<{ episode_id: string; owner_id: string; character_a: string; character_b: string }>(
    `select o.episode_id, o.owner_id, o.character_a, o.character_b
       from adult_overnights o
      where o.told_at is null
        and ($1::text is null or (o.owner_id = $1 and o.character_a = $2 and o.character_b = $3))
        and ((select count(*) from adult_nights n
               where n.owner_id = o.owner_id and n.character_a = o.character_a and n.character_b = o.character_b) > o.nights_before
          or exists (select 1 from adult_scenes s
                      where s.owner_id = o.owner_id and s.character_a = o.character_a and s.character_b = o.character_b
                        and jsonb_array_length(s.lines) > 0
                        and s.updated_at < $4::timestamptz - make_interval(hours => $5::int)))
      order by o.started_at
      limit 200`,
    [only?.ownerId ?? null, pair?.[0] ?? null, pair?.[1] ?? null, now.toISOString(), NIGHT_LEFT_HOURS],
  );
  let told = 0;
  for (const r of rows) {
    // Ids and a timestamp: all the show's side can take (lib/overnight.ts recordNightTogether).
    await recordNightTogether(db, { a: r.character_a, b: r.character_b, episodeId: r.episode_id }, now);
    await db.query(`update adult_overnights set told_at = $3::timestamptz where episode_id = $1 and owner_id = $2 and told_at is null`, [r.episode_id, r.owner_id, now.toISOString()]);
    told++;
  }
  return told;
}

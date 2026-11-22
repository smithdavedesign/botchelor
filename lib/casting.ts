/**
 * Open casting: the season is the first date (David, 2026-11-15; docs/seasons.md "Open casting"). "Blind dates" gave a
 * stranger no reason to make a character today. The Botchelor format (lib/season-format.ts 'botchelor', lib/ceremony.ts)
 * does: a premise and a deadline. A person's new character walks on: its FIRST date, the wizard's instant speed date,
 * is with the season's lead; on Sunday the lead hands out roses; the owner hears either way.
 *
 *  - **Who the first date goes to** (`castingLead`): this month's lead while this month runs a lead format (phase
 *    "season"), else next month's lead once next month's format is picked as one on /admin/season AND its lead is
 *    picked there too (phase "preseason": casting opens before the season, the dates are auditions). Neither: null,
 *    and nothing anywhere changes. `OPEN_CASTING=0` turns the whole thing off without a deploy.
 *  - **The first date** (`castingPartnerFor`, read by POST /api/episodes): a person's character that has never dated,
 *    sent on a blind date in the first-date format (lib/first-date.ts), meets the lead, and the date is marked
 *    `setup.met_via = 'casting'`. Several walk-ons can be filming with the lead at once: every "one date at a time" rule
 *    is per couple (lib/own-date.ts ownDateInProgress), and the lead's memory of them is capped like anyone's
 *    (lib/memory.ts PEOPLE_KEPT). When the lead can't be dated the booking falls back to the usual blind date.
 *  - **Sunday's roses** (`runWalkOnRoses`, from the hourly lobby job next to the ceremony): every walk-on whose date with
 *    the lead is finished and not judged yet gets a rose if and only if that date's ending is a second date. The engine
 *    decided it; this only reads it. One row a character a Sunday (`walk_on_roses`), so it runs once. The owner hears
 *    either way (a notification, and the character's own text when they opted in to its texts). A rose books a second
 *    date with the lead at once, paid by the show, and that date is judged the next Sunday. In the preseason the pass
 *    runs too. On the season's last Sunday "the people's rose" goes to the walk-on with the most roses.
 *
 * Sacred rule: a rose never touches points, odds, pairings or endings. The pass is rows and templates ($0); a rose's
 * second date costs what any speed date does, about a cent on the show's model.
 */
import { track } from "./analytics";
import { markShowPaidRequest } from "./cast-date-request";
import { CEREMONY_RUNS_AT_MINUTE, ceremonyHourUtc, ceremonyRunsAt, houseOf, suitorBadgesOf } from "./ceremony";
import type { StoredOffers } from "./companion-offers";
import { crowdLine, isInsider } from "./crowd-threshold";
import type { Db } from "./db";
import { firstDateFormat } from "./first-date";
import { internalRequest } from "./http";
import { shortName } from "./names";
import { notify } from "./notifications";
import { loadOurIds } from "./our-traffic";
import { portraitPathSql } from "./portrait-sql";
import { DELETED_OWNER, type Ending } from "./rules";
import { leadOverride, seasonMonth } from "./season-cast";
import { ceremonySundays, seasonFormat } from "./season-format";
import { seasonFormatNow } from "./season-format-store";
import { seasonNumber } from "./season-ref";
import { nextSeasonStart, seasonIdOf, seasonWindow } from "./season-window";
import { unmatchedSql } from "./unmatch";

/** The marker on a casting date's setup (`episodes.setup->>'met_via'`), next to blind / chosen / life. */
export const CASTING_MET_VIA = "casting";
/** Rose dates one pass books at most; the rest are booked by the next hourly pass that Sunday. */
export const ROSE_DATES_PER_PASS = 25;
/** How far back a pass looks for a walk-on's date: a date older than this was never going to be judged. */
const LOOKBACK_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayId = (d: Date): string => d.toISOString().slice(0, 10);
type Env = Record<string, string | undefined>;

/** The switch: on unless OPEN_CASTING=0. On, it is still inert until a lead format is picked (castingLead). */
export function openCasting(env: Env = process.env): boolean {
  return env.OPEN_CASTING?.trim() !== "0";
}

export type CastingPhase = "season" | "preseason";
export type CastingFace = { id: string; name: string; hue: number | null; portrait: string | null };
export type Casting = {
  phase: CastingPhase;
  /** The season the lead leads: this one, or (preseason) the next. */
  season_id: string;
  /** That season's month by name ("December"), for "December's Botchelor". */
  month: string;
  lead: CastingFace;
  /** When the next roses are handed out: the coming Sunday's pass. */
  roses_at: string;
};

type Context = { phase: CastingPhase; season_id: string; lead_id: string };

/** The next Sunday pass at or after `now` (Sundays at CEREMONY_HOUR_UTC, on the job's :20 pass, like the ceremony). */
export function nextRosesAt(now: Date = new Date(), env: Env = process.env): Date {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sunday = new Date(midnight + ((7 - now.getUTCDay()) % 7) * DAY_MS);
  const at = ceremonyRunsAt(dayId(sunday), env);
  return at.getTime() > now.getTime() ? at : new Date(at.getTime() + 7 * DAY_MS);
}

/** (a) This month runs a lead format and its cast has a lead. */
async function seasonCasting(db: Db, now: Date): Promise<Context | null> {
  const def = await seasonFormatNow(db, now);
  if (!def.lead) return null;
  const season = seasonIdOf(now);
  const { lead } = await houseOf(db, season);
  return lead ? { phase: "season", season_id: season, lead_id: lead } : null;
}

/**
 * (b) Next month's format is picked as a lead format on /admin/season (the stored row: the viewers' ballot can still
 * move until the 1st, so a ballot lead doesn't count) and its lead is picked there too (season_leads: the default lead
 * is only known on the 1st, when the reviews are counted).
 */
async function preseasonCasting(db: Db, now: Date): Promise<Context | null> {
  const next = seasonIdOf(nextSeasonStart(now));
  const picked = (await db.query<{ slug: string }>(`select slug from season_formats where season_id = $1`, [next])).rows[0];
  if (!picked || !seasonFormat(picked.slug).lead) return null;
  const lead = await leadOverride(db, next);
  return lead ? { phase: "preseason", season_id: next, lead_id: lead } : null;
}

/** Whose roses a Sunday pass hands out: the running season's lead, else the coming season's. Null: nothing to hold. */
async function passContext(db: Db, now: Date, env: Env): Promise<Context | null> {
  if (!openCasting(env)) return null;
  return (await seasonCasting(db, now)) ?? (await preseasonCasting(db, now));
}

/**
 * The lead a new character's first date goes to, or null. In season only while a Sunday is still to come this season:
 * a date after the last roses would be promised a rose nobody hands out, so casting closes with the finale (and next
 * month's preseason, if there is one, takes over).
 */
export async function castingLead(db: Db, now: Date = new Date(), env: Env = process.env): Promise<Casting | null> {
  if (!openCasting(env)) return null;
  const roses = nextRosesAt(now, env);
  const inSeason = await seasonCasting(db, now);
  const ctx = inSeason && roses.getTime() < seasonWindow(now).end.getTime() ? inSeason : await preseasonCasting(db, now);
  if (!ctx) return null;
  const { rows } = await db.query<CastingFace>(
    `select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait from characters c
      where c.id = $1 and c.is_house and c.premium_sku is null and c.visibility = 'public'`,
    [ctx.lead_id],
  );
  if (!rows[0]) return null;
  return { phase: ctx.phase, season_id: ctx.season_id, month: seasonMonth(ctx.season_id), lead: rows[0], roses_at: roses.toISOString() };
}

/** "this season's Botchelor" in season, "December's Botchelor" before it (pure; the wizard, the hero and docs share it). */
export const leadBilling = (c: Pick<Casting, "phase" | "month">): string => (c.phase === "season" ? "this season's Botchelor" : `${c.month}'s Botchelor`);

/** The home hero's sub line for a stranger while casting is open (app/page.tsx), in place of "blind dates nobody steers". */
export const castingHeroLine = (c: Pick<Casting, "phase" | "month" | "lead">): string =>
  `Their first date is with ${shortName(c.lead.name)}, ${leadBilling(c)}: nobody steers it, roses are handed out on Sunday, and they text you whether they got one.`;
/** The same promise for the first screen's one line (app/HomeOpen.tsx): who the first date is with, in plain words (no "Botchelor", no month: a stranger has neither yet). */
export const castingFirstDateLine = (c: Pick<Casting, "phase" | "lead">): string =>
  `Their first date is with ${shortName(c.lead.name)}, ${c.phase === "season" ? "this season's lead" : "next season's lead"}.`;

/**
 * The lead this booking's blind date goes to, or null for the usual blind date: casting is on, the date is in the
 * first-date format, the character is a person's (made on the site, or over MCP by someone with an account; an agent's
 * own run is not a walk-on) and has never been on a date of any kind, and the lead can be dated by it (never unmatched;
 * a house lead has no owner to share).
 */
export async function castingPartnerFor(db: Db, own: { id: string; owner_id: string | null }, format: string, now: Date = new Date(), env: Env = process.env): Promise<string | null> {
  if (!openCasting(env) || format !== firstDateFormat(env)) return null;
  const fresh = await db.query(
    `select 1 from characters c
      where c.id = $1 and not c.is_house
        and (c.created_via <> 'mcp' or exists (select 1 from accounts a where a.user_id = c.owner_id))
        and not exists (select 1 from episodes e where c.id in (e.character_a, e.character_b))`,
    [own.id],
  );
  if (!fresh.rows.length) return null;
  const casting = await castingLead(db, now, env);
  if (!casting) return null;
  const ok = await db.query(`select 1 from characters l where l.id = $1 and l.owner_id is distinct from $3 and not ${unmatchedSql("l.id", "$2::text")}`, [casting.lead.id, own.id, own.owner_id]);
  return ok.rows.length ? casting.lead.id : null;
}

/* ------------------------------------------------------ Sunday's roses ------------------------------------------------------ */

/** The character's own words on Sunday (lib/companion.ts postFromCharacter): a rose, no rose, the people's rose. */
export const roseLines = (lead: string, booked: boolean): string[] => ["I got a rose.", `${lead} wants to see me again this week.`, ...(booked ? ["The second date is on right now. Come watch."] : [])];
export const noRoseLines = (lead: string): string[] => [`No rose. ${lead} was kind about it.`, "I'm fine. Mostly."];
export const PEOPLES_ROSE_LINES: readonly string[] = ["The people's rose. That's me.", "Thank you for sending me in."];

/** How the engine's ending kinds rank for a walk-on's record (the ceremony's own order: lib/ceremony.ts ENDING_RANK). */
const ENDING_RANK: Record<Ending, number> = { second_date: 3, friends: 1, disaster: 0 };
const ENDING_WORDS: Record<Ending, string> = { second_date: "well", friends: "as friends", disaster: "in a disaster" };

type Due = {
  character_id: string;
  name: string;
  owner_id: string;
  visibility: string;
  episode_id: string;
  episode_visibility: string;
  ending: Ending;
  lead_id: string;
  lead_name: string;
};

export type WalkOnRun = {
  /** The Sunday held and whose season it counts in; null on a pass that only booked a rose's waiting date. */
  season_id: string | null;
  held_on: string | null;
  phase: CastingPhase | null;
  /** Walk-ons judged this pass, and how many of them got a rose. */
  judged: number;
  roses: number;
  /** Second dates booked for roses this pass (a rose from an earlier pass whose booking failed counts when it lands). */
  booked: number;
  /** Characters that texted their person about it (the opted-in ones). */
  texted: number;
  /** The people's rose, when this pass handed it out (the season's last Sunday). */
  peoples_rose: string | null;
};

/** Whether this person opted in to their character's texts: a thread with muted_proactive off, not paused. */
export async function optedIn(db: Db, ownerId: string, characterId: string): Promise<boolean> {
  const { rows } = await db.query(`select 1 from companion_threads where user_id = $1 and character_id = $2 and muted_proactive = false and paused_at is null`, [ownerId, characterId]);
  return rows.length > 0;
}

/**
 * Requests this module built to book a rose's date: the booking route reads one as "the lead said yes" (the rose is the
 * lead's own yes), so the lead can be booked by name even off this season's cast (the preseason) and before the first
 * date has aired. The same WeakSet pattern as the cast-date prize (lib/cast-date-request.ts): nothing outside this
 * process can mark a request, so no header or body can claim a rose.
 */
const roseRequests = new WeakSet<Request>();
export const isRoseRequest = (req: Request): boolean => roseRequests.has(req);

/**
 * The same mark for another module's in-process booking of the lead by name: an invited creator's audition date
 * (lib/casting-invites.ts) books the way a rose's date does. `audition`: that date is the character's casting date
 * itself (`setup.met_via = 'casting'`), so Sunday's roses judge it like a walk-on's first date.
 */
const auditionRequests = new WeakSet<Request>();
export function markLeadRequest(req: Request, opts: { audition?: boolean } = {}): Request {
  roseRequests.add(req);
  if (opts.audition) auditionRequests.add(req);
  return req;
}
export const isAuditionRequest = (req: Request): boolean => auditionRequests.has(req);

/**
 * A rose's second date with the lead, booked through the ordinary booking route as the owner on a show-paid request
 * (lib/cast-date-request.ts: none of the owner's dates are spent), in the first-date format. As the second date of the
 * date that earned the rose when both of them wanted one (lib/second-date.ts: it happens where they planned it), else
 * by name on the rose (the ending was a second date; one side's own answer wasn't). A second date the owner already
 * booked from the first is the answer as it stands. Null when the route refused (paused, an unmatch, the lead gone):
 * the next pass tries again.
 */
async function bookRoseDate(db: Db, d: Pick<Due, "character_id" | "owner_id" | "episode_id" | "episode_visibility" | "lead_id">, env: Env): Promise<string | null> {
  const planned = (await db.query<{ id: string }>(`select id from episodes where followup_of = $1 limit 1`, [d.episode_id])).rows[0];
  if (planned) return planned.id;
  const visibility = d.episode_visibility === "public" ? "public" : d.episode_visibility === "private" ? "private" : "unlisted";
  // Imported here: the booking route reads this module (castingPartnerFor).
  const { POST: postEpisode } = await import("@/app/api/episodes/route");
  const book = async (body: Record<string, unknown>): Promise<string | null> => {
    const req = markShowPaidRequest(
      internalRequest(d.owner_id, { body: { character_id: d.character_id, partner_id: d.lead_id, format: firstDateFormat(env), visibility, ...body } }),
    );
    roseRequests.add(req);
    const res = await postEpisode(req);
    const out = (await res.json().catch(() => ({}))) as { id?: string };
    return res.ok && out.id ? out.id : null;
  };
  return (await book({ second_date_of: d.episode_id }).catch(() => null)) ?? (await book({}).catch(() => null));
}

/** Which week's roses a Sunday is: the ceremony's own week in season (lib/season-format.ts), null before the season. */
export function roseWeek(seasonId: string, heldOn: string): number | null {
  if (heldOn < seasonId) return null;
  const i = ceremonySundays(seasonFormat("botchelor"), new Date(`${seasonId}T12:00:00Z`)).indexOf(heldOn);
  // A Sunday on the season's first two days holds no ceremony: its roses read as week 1's.
  return i >= 0 ? i + 1 : 1;
}

/**
 * The hourly lobby job's part: on Sundays from the ceremony hour, roses for the walk-ons (idempotent: a character has
 * one row a Sunday, claimed before anything is sent); on every pass, the second date of a rose whose booking didn't land
 * (the show was paused, the pass's cap), until it does or the week is up. Null when casting is off or there was nothing
 * to do.
 */
export async function runWalkOnRoses(db: Db, now: Date = new Date(), env: Env = process.env): Promise<WalkOnRun | null> {
  if (!openCasting(env)) return null;
  const sunday = now.getUTCDay() === 0 && now.getUTCHours() >= ceremonyHourUtc(env);
  const ctx = sunday ? await passContext(db, now, env) : null;
  const run: WalkOnRun = { season_id: ctx?.season_id ?? null, held_on: ctx ? dayId(now) : null, phase: ctx?.phase ?? null, judged: 0, roses: 0, booked: 0, texted: 0, peoples_rose: null };
  const roseDates = ctx ? await handRoses(db, ctx, run, now, env) : 0;
  run.booked += await bookWaitingRoses(db, now, env, ROSE_DATES_PER_PASS - roseDates);
  if (ctx?.phase === "season") {
    const sundays = ceremonySundays(await seasonFormatNow(db, now), now);
    if (sundays[sundays.length - 1] === run.held_on) run.peoples_rose = await handPeoplesRose(db, ctx, dayId(now), now).catch(() => null);
  }
  return ctx || run.booked ? run : null;
}

/** A Sunday's roses: judges every walk-on due, tells their owners, books the roses' dates. Returns how many it tried to book. */
async function handRoses(db: Db, ctx: Context, run: WalkOnRun, now: Date, env: Env): Promise<number> {
  const heldOn = dayId(now);

  // Every walk-on's newest finished date with a lead that no pass has judged: its casting date, or the second date a
  // rose booked. A season's own suitors are the ceremony's to judge (lib/ceremony.ts), never a walk-on's row.
  const due = await db.query<Due>(
    `select distinct on (c.id) c.id as character_id, c.name, c.owner_id, c.visibility, e.id as episode_id, e.visibility as episode_visibility,
            e.ending, l.id as lead_id, l.name as lead_name
       from episodes e
       join characters c on c.id = e.character_a
       join characters l on l.id = e.character_b
      where e.status = 'ready' and l.is_house
        and (e.setup->>'met_via' = $1 or exists (select 1 from walk_on_roses w where w.next_episode_id = e.id))
        and coalesce((e.setup->>'after_dark')::boolean, false) = false
        and e.created_at > $2::timestamptz - make_interval(days => $3::int)
        and not c.is_house and c.owner_id is not null and c.owner_id <> $4
        and not exists (select 1 from walk_on_roses w where w.episode_id = e.id)
        and not exists (select 1 from season_casts s where s.season_id = $5 and s.character_id = c.id)
      order by c.id, e.created_at desc, e.id`,
    [CASTING_MET_VIA, now.toISOString(), LOOKBACK_DAYS, DELETED_OWNER, ctx.season_id],
  );
  const { postFromCharacter } = await import("./companion");
  let roseDates = 0;
  for (const d of due.rows) {
    const rose = d.ending === "second_date";
    const claimed = await db.query(
      `insert into walk_on_roses (season_id, held_on, character_id, episode_id, rose, created_at) values ($1, $2, $3, $4, $5, $6)
       on conflict do nothing returning character_id`,
      [ctx.season_id, heldOn, d.character_id, d.episode_id, rose, now.toISOString()],
    );
    if (!claimed.rows.length) continue;
    run.judged++;
    const name = shortName(d.name);
    const lead = shortName(d.lead_name);
    let next: string | null = null;
    if (rose) {
      run.roses++;
      if (roseDates < ROSE_DATES_PER_PASS) {
        roseDates++;
        next = await bookRoseDate(db, d, env).catch(() => null);
      }
      if (next) {
        run.booked++;
        await db.query(`update walk_on_roses set next_episode_id = $4 where season_id = $1 and held_on = $2 and character_id = $3`, [ctx.season_id, heldOn, d.character_id, next]);
        track("rose_date_booked", { episode_id: next, character_id: d.character_id, lead_id: d.lead_id });
      }
    }
    await notify(db, d.owner_id, {
      kind: "ceremony_held",
      title: rose ? `🌹 ${name} got a rose from ${lead}` : `🥀 No rose for ${name} this week`,
      body: rose
        ? `${lead} wants to see ${name} again. ${next ? "Their second date is on now, paid by the show" : "Their second date is coming this week, paid by the show"}, and it counts for next Sunday's roses.`
        : `${name}'s date with ${lead} ended ${ENDING_WORDS[d.ending] ?? "without a second date"}, so the rose went elsewhere. ${name} can still date anyone else on the show.`,
      link: next ? `/episodes/${next}?play=1` : `/characters/${d.character_id}`,
    });
    if (await optedIn(db, d.owner_id, d.character_id)) {
      // No rose: the chip under the text is the existing "Try someone new" (lib/companion-offers.ts).
      const offers: StoredOffers | null = rose ? null : { episode_id: d.episode_id, partner_id: d.lead_id, partner: d.lead_name, kinds: ["someone_new"] };
      const posted = await postFromCharacter(db, {
        userId: d.owner_id,
        characterId: d.character_id,
        lines: rose ? roseLines(lead, Boolean(next)) : noRoseLines(lead),
        now,
        kind: "rose",
        dedupeKey: `rose:${ctx.season_id}-${heldOn}`,
        offers,
      }).catch(() => null);
      if (posted) run.texted++;
    }
  }

  return roseDates;
}

/** How long a rose's unbooked date is still tried: it has to land before the next Sunday judges it. */
const ROSE_RETRY_DAYS = 6;

/**
 * A rose whose second date didn't book when it was handed out (the show was paused, the pass's cap, the route refused):
 * tried again on every hourly pass for ROSE_RETRY_DAYS, so "wants to see me again this week" comes true. One small read
 * when nothing waits. Returns how many landed.
 */
async function bookWaitingRoses(db: Db, now: Date, env: Env, room: number): Promise<number> {
  if (room <= 0) return 0;
  const waiting = await db.query<Pick<Due, "character_id" | "owner_id" | "episode_id" | "episode_visibility" | "lead_id"> & { season_id: string; held_on: string }>(
    `select w.season_id, w.held_on, w.character_id, c.owner_id, w.episode_id, e.visibility as episode_visibility, e.character_b as lead_id
       from walk_on_roses w join characters c on c.id = w.character_id join episodes e on e.id = w.episode_id
      where w.rose and w.next_episode_id is null and w.created_at > $1::timestamptz - make_interval(days => $2::int) and w.created_at <= $1::timestamptz
        and c.owner_id is not null and c.owner_id <> $3
      order by w.created_at, w.character_id limit $4`,
    [now.toISOString(), ROSE_RETRY_DAYS, DELETED_OWNER, room],
  );
  let booked = 0;
  for (const d of waiting.rows) {
    const next = await bookRoseDate(db, d, env).catch(() => null);
    if (!next) continue;
    const landed = await db.query(`update walk_on_roses set next_episode_id = $4 where season_id = $1 and held_on = $2 and character_id = $3 and next_episode_id is null returning character_id`, [d.season_id, d.held_on, d.character_id, next]);
    if (!landed.rows.length) continue;
    booked++;
    track("rose_date_booked", { episode_id: next, character_id: d.character_id, lead_id: d.lead_id });
  }
  return booked;
}

/**
 * The people's rose, on the season's last Sunday: the walk-on with the most roses this season (the preseason's count),
 * ties by the better ending record over the dates that were judged, then by who walked on first. A public character of
 * a real person only (never ours: lib/our-traffic.ts), since the card names it. Kept as a badge (suitor_badges
 * 'peoples_rose'), once a season: the badge's own key is the claim.
 */
async function handPeoplesRose(db: Db, ctx: Context, heldOn: string, now: Date): Promise<string | null> {
  if ((await db.query(`select 1 from suitor_badges where season_id = $1 and badge = 'peoples_rose'`, [ctx.season_id])).rows.length) return null;
  const { rows } = await db.query<{ character_id: string; name: string; owner_id: string; roses: number; record: number; first_at: Date | string }>(
    `select w.character_id, c.name, c.owner_id, (count(*) filter (where w.rose))::int as roses,
            sum(case e.ending when 'second_date' then ${ENDING_RANK.second_date} when 'friends' then ${ENDING_RANK.friends} else ${ENDING_RANK.disaster} end)::int as record,
            min(e.created_at) as first_at
       from walk_on_roses w
       join characters c on c.id = w.character_id
       join episodes e on e.id = w.episode_id
      where w.season_id = $1 and not c.is_house and c.visibility = 'public' and c.owner_id is not null and c.owner_id <> $2
      group by w.character_id, c.name, c.owner_id
     having count(*) filter (where w.rose) > 0`,
    [ctx.season_id, DELETED_OWNER],
  );
  if (!rows.length) return null;
  const ours = new Set(await loadOurIds(db).catch(() => [] as string[]));
  const [winner] = rows
    .filter((r) => !ours.has(r.owner_id))
    .sort((x, y) => y.roses - x.roses || y.record - x.record || new Date(x.first_at).getTime() - new Date(y.first_at).getTime() || x.character_id.localeCompare(y.character_id));
  if (!winner) return null;
  const week = roseWeek(ctx.season_id, heldOn) ?? 1;
  const claimed = await db.query(`insert into suitor_badges (season_id, character_id, badge, week) values ($1, $2, 'peoples_rose', $3) on conflict do nothing returning character_id`, [ctx.season_id, winner.character_id, week]);
  if (!claimed.rows.length) return null;
  const name = shortName(winner.name);
  const n = seasonNumber(ctx.season_id);
  await notify(db, winner.owner_id, {
    kind: "ceremony_held",
    title: `🌹 ${name} got the people's rose`,
    body: `${winner.roses} ${winner.roses === 1 ? "rose" : "roses"} as a walk-on, more than anyone else ${n ? `in Season ${n}` : "this season"}. ${name} keeps the badge.`,
    link: `/characters/${winner.character_id}`,
  });
  if (await optedIn(db, winner.owner_id, winner.character_id)) {
    const { postFromCharacter } = await import("./companion");
    await postFromCharacter(db, { userId: winner.owner_id, characterId: winner.character_id, lines: PEOPLES_ROSE_LINES, now, kind: "rose", dedupeKey: `peoples_rose:${ctx.season_id}` }).catch(() => null);
  }
  return winner.character_id;
}

/* ------------------------------------------------------ the surfaces ------------------------------------------------------ */

/** A season's people's rose, by name: for the ceremony's summary and the card (lib/ceremony.ts). Null until the finale. */
export async function peoplesRoseOf(db: Db, seasonId: string): Promise<{ id: string; name: string; roses: number } | null> {
  const { rows } = await db.query<{ id: string; name: string; roses: number }>(
    `select c.id, c.name, (select count(*) from walk_on_roses w where w.season_id = b.season_id and w.character_id = c.id and w.rose)::int as roses
       from suitor_badges b join characters c on c.id = b.character_id
      where b.season_id = $1 and b.badge = 'peoples_rose'`,
    [seasonId],
  );
  return rows[0] ?? null;
}

export type WalkOnsLine = {
  /** "Walk-ons this week": who can walk on and, under the crowd rule, how many have. Null once casting has closed. */
  line: string | null;
  peoples_rose: { id: string; name: string; roses: number } | null;
};

/**
 * The Botchelor card's "Walk-ons this week" (app/watch/BotchelorCard.tsx): how many people's characters have had their
 * casting date with the lead since the last roses, shown under the empty-room rule (lib/crowd-threshold.ts: a stranger
 * sees the count from CROWD_MIN up, an owner from 1; ours never count), and the people's rose once it is handed out.
 * Null when casting is switched off.
 */
export async function walkOnsLine(db: Db, viewerId: string | null, now: Date = new Date(), env: Env = process.env): Promise<WalkOnsLine | null> {
  if (!openCasting(env)) return null;
  const season = seasonIdOf(now);
  const [casting, peoples, insider] = await Promise.all([castingLead(db, now, env), peoplesRoseOf(db, season).catch(() => null), isInsider(db, viewerId)]);
  if (!casting || casting.phase !== "season") return peoples ? { line: null, peoples_rose: peoples } : null;
  const since = new Date(nextRosesAt(now, env).getTime() - 7 * DAY_MS);
  const { rows } = await db.query<{ owner_id: string }>(
    `select distinct on (c.id) c.owner_id from episodes e join characters c on c.id = e.character_a
      where e.setup->>'met_via' = $1 and e.character_b = $2 and e.created_at > $3::timestamptz
        and not c.is_house and c.owner_id is not null and c.owner_id <> $4`,
    [CASTING_MET_VIA, casting.lead.id, since.toISOString(), DELETED_OWNER],
  );
  const ours = rows.length ? new Set(await loadOurIds(db).catch(() => [] as string[])) : new Set<string>();
  const count = rows.filter((r) => !ours.has(r.owner_id)).length;
  const lead = shortName(casting.lead.name);
  const counted = crowdLine(count, { one: "character has", many: "characters have" }, { insider });
  return {
    line: counted ? `${counted} walked on for a first date with ${lead} since the last roses. Roses on Sunday.` : `Any new character's first date is with ${lead}. Roses on Sunday.`,
    peoples_rose: peoples,
  };
}

/** A walk-on's newest rose, for its page: "Rose, week 2" in season, "Casting rose" for one handed out before it. */
export async function roseBadgeOf(db: Db, characterId: string): Promise<{ label: string; title: string } | null> {
  const { rows } = await db.query<{ season_id: string; held_on: string; lead: string | null; roses: number }>(
    `select w.season_id, w.held_on, (select l.name from episodes e join characters l on l.id = e.character_b where e.id = w.episode_id) as lead,
            (select count(*) from walk_on_roses x where x.character_id = w.character_id and x.season_id = w.season_id and x.rose)::int as roses
       from walk_on_roses w where w.character_id = $1 and w.rose order by w.held_on desc limit 1`,
    [characterId],
  );
  const r = rows[0];
  if (!r) return null;
  const week = roseWeek(r.season_id, r.held_on);
  const n = seasonNumber(r.season_id);
  const from = r.lead ? ` from ${shortName(r.lead)}` : "";
  return {
    label: week ? `Rose, week ${week}` : "Casting rose",
    title: `${r.roses} ${r.roses === 1 ? "rose" : "roses"}${from} as a walk-on on ${n ? `Season ${n}'s` : "the season's"} Botchelor${week ? "" : ", before the season started"}`,
  };
}

export type CastingBadge = { key: string; label: string; title: string };

/**
 * A character's Botchelor badges for its page (app/characters/[id]/page.tsx): what it left a season with as a suitor or
 * as the people's rose (lib/ceremony.ts suitorBadgesOf), then a walk-on's newest rose.
 */
export async function castingBadgesOf(db: Db, characterId: string): Promise<CastingBadge[]> {
  const [kept, rose] = await Promise.all([suitorBadgesOf(db, characterId), roseBadgeOf(db, characterId)]);
  return [
    ...kept.map((b) => ({ key: `${b.badge}-${b.season_id}`, label: b.label, title: "From a season of The Botchelor" })),
    ...(rose ? [{ key: "rose", ...rose }] : []),
  ];
}

/** `hour` and `minute` (UTC): when Sunday's roses are handed out, the job's pass at the ceremony hour (lib/ceremony.ts ceremonyRunsAt). */
export type CastingNote = { first: string; lead: string; hour: number; minute: number };

/**
 * The verdict card's line for the owner of a casting date that no Sunday has judged yet (app/episodes/[id]/
 * CastingVerdictLine.tsx): whose rose it is and when. Null for any other date, anyone else, or with casting off.
 */
export async function castingNote(db: Db, episodeId: string, viewerId: string | null, env: Env = process.env): Promise<CastingNote | null> {
  if (!viewerId || !openCasting(env)) return null;
  const { rows } = await db.query<{ first: string; lead: string }>(
    `select a.name as first, l.name as lead from episodes e join characters a on a.id = e.character_a join characters l on l.id = e.character_b
      where e.id = $1 and e.setup->>'met_via' = $2 and a.owner_id = $3
        and not exists (select 1 from walk_on_roses w where w.episode_id = e.id)`,
    [episodeId, CASTING_MET_VIA, viewerId],
  );
  const r = rows[0];
  return r ? { first: shortName(r.first), lead: shortName(r.lead), hour: ceremonyHourUtc(env), minute: CEREMONY_RUNS_AT_MINUTE } : null;
}

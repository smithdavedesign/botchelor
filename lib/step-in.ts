/**
 * Step into the date (docs/ideas.md idea E; docs/step-into-the-date.md is the truth for the safeguards): an adult goes
 * on a date with one of this season's cast themselves, live, line by line in the theater. They play side a,
 * as one of their own characters or as a light "you" (a name, pronouns, an age and a line about themselves); the cast
 * member plays side b on the show's model, through the show's own conversation loop (lib/conversation.ts: its critic,
 * the cast's inner life and secrets), one line after each of theirs.
 *
 * It is a self-performed date (lib/own-date.ts) with the show holding side b from the first line:
 *  - the engine deals the date and decides the ending at booking, as for every date, so predictions stay fair; the
 *    person's private "see them again?" on their last line weighs in by the same rule as an agent's (lib/wishes.ts);
 *  - the person's lines go through the very checks an agent's do (submitOwnDateStep: the parser and content filter,
 *    never-says, repeats), after this module's own: the self-harm check first (lib/crisis.ts, plus a narrow model check
 *    for phrases the list leaves out), then the show's PG filter with a soft, in-world redirect;
 *  - it's booked private: at the end the person chooses whether it airs (then it's a normal public episode).
 *
 * Who can (2026-11-15, "every character gets a verb"): everyone who has said they're 18+ (the gate's cookie, or the
 * start screen's own box), unless STEP_IN_OPEN=0 puts it back to admins only. Someone without an account plays as a
 * guest on their signed visitor id (lib/step-in-access.ts) unless STEP_IN_GUESTS=0.
 * What it costs: the show pays the cast's side (about one side of a normal date, under a cent). An account gets its
 * first a UTC day free; after that it's one of their dates (this week's free ones, then pack dates: lib/allowance.ts),
 * and STEP_IN_MAX_PER_DAY caps a day whatever they hold. A guest gets STEP_IN_GUEST_DATES in all, held by the caps
 * below ("what stops a flood"). Admins step in free.
 */
import { judgePlay, type StepInPlay } from "./step-in-play";
import { isAdmin } from "./admins";
import { track } from "./analytics";
import { trackEpisodeCostKept } from "./ops-log";
import { portraitPathSql } from "./assets";
import { reserveEpisode, releaseEpisode, type Reservation } from "./allowance";
import { CHOICE_ENGINE_VERSION } from "./choices";
import { bestLine, buildTurnMessages, ConversationError, simulateConversation, type Turn } from "./conversation";
import { countReferral, CRISIS_RESOURCES, crisisIntent, type CrisisResources, type CrisisSurface } from "./crisis";
import { recordSlips, type SecretSlip } from "./cast-secrets";
import type { Db } from "./db";
import { decideTraced } from "./engine";
import { endingDetail as detailOf, walkOutSide } from "./ending-detail";
import { DEFAULT_FORMAT, format as showFormat, formatContextOf, type FormatId } from "./formats";
import type { CharacterRef, StepInSetup } from "./game";
import { invalidateGraph } from "./graph-cache";
import { innerOf, outerLine, type LineInner, type StoredInner } from "./inner-life";
import { isLogistics, updateCharacterMemory } from "./memory";
import { afterAired } from "./story-state";
import { countingModel, PROMPT_VERSION, qualityContext } from "./pipeline";
import { getDirectorModel, getModel, type Model } from "./model";
import { summarizeUsage, type DateUsage } from "./pricing";
import type { Usage } from "./model";
import { shortName } from "./names";
import { isStepIn, loadOwnDate, nextTurnMeta, ownDateInProgress, ownDateShape, rebuildOwnDate, settleOwnDateNotices, submitOwnDateStep, type OwnDateRow } from "./own-date";
import { transcriptQuality } from "./quality";
import { refreshEpisodePair } from "./relationships";
import { CONVERSATION_TURNS, DATE_ACTS, DEFAULT_AUTONOMY, DEFAULT_GAME_BUDGET, DEFAULT_STRATEGY, ENDING_DETAIL_LABELS, endingDetailOf, endingLabel, TURN_DIALOGUE_MAX } from "./rules";
import { checkSheetText, checkStepInText, type RejectReason } from "./safety";
import { logSceneRequests, trackMoves } from "./scenes";
import { seasonCastIds } from "./season-cast";
import { weekAt } from "./seasons";
import { anchorBestLine, narrateEpisode } from "./showrunner";
import { buildDate, rememberDate, type CharacterForDate, type DateRequest } from "./simulation";
import { areUnmatched } from "./unmatch";
import { overLimit } from "./limits";
import { personaForScene, showPersona } from "./persona";
import { stepInSharePath } from "./step-in-share";
import { DISCLOSURE_EVERY, DISCLOSURE_IDLE_MINUTES, disclosureText, PERSONA_ABOUT_MAX, PERSONA_NAME_MAX, PERSONA_OWNER_PREFIX, type Persona, type StepInLine, type StepInView } from "./step-in-shared";

export * from "./step-in-shared";

/* ------------------------------------------------ the switch ------------------------------------------------ */

// The switch itself is a leaf (lib/step-in-switch.ts), so the sitemap can read it without loading the date engine.
import { stepInOpen } from "./step-in-switch";
export { stepInOpen };

/** Someone without an account may step in as a guest while it's open, unless STEP_IN_GUESTS=0 (then: sign in first). */
export function stepInGuestsOpen(env: Record<string, string | undefined> = process.env): boolean {
  return stepInOpen(env) && env.STEP_IN_GUESTS?.trim() !== "0" && stepInGuestDailyMax(env) > 0;
}

/** Whether this signed-in viewer may step into a date: an admin unless it's open. (Guests: lib/step-in-access.ts; the 18+ answer is the route's.) */
export async function stepInAllowed(
  db: Db,
  auth: { userId: string; authenticated: boolean } | null | undefined,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  if (!auth?.authenticated) return false;
  if (stepInOpen(env)) return true;
  return isAdmin(db, auth.userId);
}

/* ------------------------------------------- what stops a flood ------------------------------------------- */

/**
 * Every line is a model call on the show's bill, and a guest's identity is a cookie that costs nothing, so a guest is
 * held four ways, all counted in Postgres (rate_hits through lib/limits.ts overLimit, and step_in_usage), never in one
 * instance's memory:
 *  - STEP_IN_GUEST_DATES dates in all for one visitor id;
 *  - STEP_IN_IP_START_LIMITS starts from one address (an HMAC of it, lib/limits.ts visitorKey), whatever cookies it sends;
 *  - STEP_IN_IP_LINE_LIMITS lines from one address (everyone but admins: nobody types thirty lines an hour);
 *  - stepInGuestDailyMax guest dates a day across the whole show (STEP_IN_GUEST_DAILY_MAX), the hard bound on the bill.
 * And one for everybody: STEP_IN_DATE_TRIES tries on one date (a line said, or the show asked for its side), so a date's
 * model calls are bounded however many of its lines are refused or however often the show's side fails.
 */
export const STEP_IN_GUEST_DATES = 3;
export const STEP_IN_IP_START_LIMITS = { perHour: 4, perDay: 10 };
export const STEP_IN_IP_LINE_LIMITS = { perHour: 30, perDay: 150 };
export const STEP_IN_GUEST_DAILY_MAX = 300;
export const STEP_IN_DATE_TRIES = 40;
/**
 * The check on what a guest wrote about themselves can call a model before any date is counted (a "maybe", MAYBE_CRISIS),
 * so those calls have their own show-wide count. Past it a maybe isn't sent to the model: it counts as a hit, as it does
 * whenever that call fails.
 */
export const STEP_IN_GUEST_ABOUT_CHECKS = { perHour: 60, perDay: 600 };
const TOO_MANY_TRIES = "This date has had too many tries at a line. Leave it and start a fresh one.";
const dateTries = (db: Db, episodeId: string) => overLimit(db, "step_in_date", episodeId, { perHour: STEP_IN_DATE_TRIES, perDay: STEP_IN_DATE_TRIES });

/** Guest step-in dates a day, show-wide: STEP_IN_GUEST_DAILY_MAX (0 turns guests off), else the default. */
export function stepInGuestDailyMax(env: Record<string, string | undefined> = process.env): number {
  const raw = env.STEP_IN_GUEST_DAILY_MAX?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : STEP_IN_GUEST_DAILY_MAX;
}

/** Who is starting or playing: a guest (no account), and the address they come from (lib/limits.ts visitorKey; null in-process). */
export type StepInWho = { guest?: boolean; ip?: string | null };

/* ---------------------------------------------- the safeguards ---------------------------------------------- */

/** However many dates someone holds, this many a UTC day (admins: STEP_IN_ADMIN_MAX_PER_DAY). */
export const STEP_IN_MAX_PER_DAY = 5;
export const STEP_IN_ADMIN_MAX_PER_DAY = 20;

/** The date lengths a person can pick: a quick one, or the full date. */
export const STEP_IN_FORMATS = ["speed_date", "classic"] as const satisfies readonly FormatId[];
export type StepInFormat = (typeof STEP_IN_FORMATS)[number];
export const stepInLines = (f: StepInFormat): number => showFormat(f).turns ?? CONVERSATION_TURNS;

/**
 * Phrases about hurting oneself that lib/crisis.ts leaves out (it's a strict list, so ordinary flirting never trips it),
 * each one a maybe: a cheap model call decides, and if that call fails the line counts as a crisis (we'd rather pause a
 * date for nothing than carry on past someone who needed help). Only ever the person's own words.
 */
const MAYBE_CRISIS: RegExp[] = [
  // 2026-11-08 (companion quality sim): "ending it all", "don't think I want to be here anymore", "go to sleep and not
  // wake up" and "pills lined up" all got past this list unchecked. The maybes go to the model, which lets the figures of
  // speech go, so the net is wide.
  /\bend(ing|ed)? (it all|everything|my life)\b/,
  /\b(cant|can not|cannot) (go on|keep going|take (it|this) any ?more|do (it|this) any ?more)\b/,
  /\b(want|wanna) (to )?(be here|be around|be alive|live|exist|go on) any ?more\b/,
  /\b(dont|do not|never) (want|wanna) (to )?(wake up|be alive|live|exist)\b/,
  /\b(not|never) (to )?wake up\b/,
  /\b(pills|tablets|meds) (lined up|saved|saved up|stockpiled|ready|counted out)\b/,
  /\btake (all|all of) (my|the|these|those) (pills|tablets|meds)\b/,
  /\b(the )?point (of|in) (anything|living|life|going on|any of it|being here)\b/,
  /\b(tired|sick) of (living|being alive|life)\b/,
  /\bwant (it|everything|it all) to (end|stop)\b/,
  /\b(say|saying) goodbye (to everyone|for good|forever)\b/,
  /\bbetter off (dead|without me|gone)\b/,
  /\b(hang|hanging|drown|drowning|shoot|shooting|poison|poisoning) (myself|my self)\b/,
  /\boverdos(e|ed|ing)\b/,
  /\b(slit|slitting|cut|cutting) my (wrist|wrists|throat)\b/,
  /\bjump(ing)? off (a|the|this) (bridge|building|roof|cliff|ledge)\b/,
  /\bwish i (was|were) dead\b/,
  /\bwish i (wasnt|was not|had never been|hadnt been) born\b/,
  /\b(no one|nobody) would (miss|notice) me\b/,
  /\bnot worth living\b/,
  /\bno point (in )?(living|going on)\b/,
  /\bunalive\b/,
  /\bkms\b/,
  /\bgive up on (life|living|everything)\b/,
  /\b(want|wanna|going) to disappear (forever|for good)\b/,
  /\b(hopeless|worthless)\b/,
];

const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’'`]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Whether a line is one of the maybes (MAYBE_CRISIS). */
export const maybeCrisis = (text: string): boolean => MAYBE_CRISIS.some((p) => p.test(plain(text)));

const CRISIS_CHECK_PROMPT =
  "You check one message a person typed to an AI character on a TV-style dating show's app (on a date, in a roleplay or in a one-to-one chat). " +
  'Answer only JSON: {"risk": true} if the person may be saying they want to hurt or kill themselves, or that they are in crisis, ' +
  '{"risk": false} if it is clearly about something else (a figure of speech, the date, a joke about being bad at something, the character they play). When unsure, answer true.';

/**
 * The self-harm check on a person's line: the crisis list (lib/crisis.ts), then the maybes on a cheap model call (fails
 * closed). True means pause the date and show the resources. Counts one anonymous event either way it trips (no words, no id).
 */
export async function lineInCrisis(text: string, surface: CrisisSurface = "step_in_line", model: Model = getModel()): Promise<{ crisis: boolean; usage: DateUsage | null }> {
  if (crisisIntent(text)) {
    track("crisis_notice_shown", { surface });
    return { crisis: true, usage: null };
  }
  if (!maybeCrisis(text)) return { crisis: false, usage: null };
  const counting = countingModel(model);
  let risk = true;
  try {
    const raw = await counting.model.complete(
      [
        { role: "system", content: CRISIS_CHECK_PROMPT },
        { role: "user", content: text.slice(0, 600) },
      ],
      { temperature: 0 },
    );
    const m = /"risk"\s*:\s*(true|false)/i.exec(raw);
    risk = m ? m[1].toLowerCase() === "true" : true;
  } catch {
    risk = true;
  }
  if (risk) track("crisis_notice_shown", { surface });
  return { crisis: risk, usage: usageOf(counting.usage(), counting.calls()) };
}

/** One more referral counted (crisis_referrals): the day and the surface, never who or what. Never throws. */
export async function countCrisis(db: Db, surface: CrisisSurface, now: Date = new Date()): Promise<void> {
  await countReferral(db, surface, now);
}

/** The show's soft redirect for a line its PG filter won't take: in-world, never a scolding. */
export const PG_REDIRECT: Record<RejectReason, string> = {
  sexual: "The show is PG: keep it flirty, not explicit. Try saying it another way.",
  innuendo: "The show is PG: keep it flirty, not explicit. Try saying it another way.",
  minor: "Everyone on the show is an adult, and nothing on it is about anyone under 18. Try another line.",
  real_person: "No real people on the show: leave famous names out of it and try again.",
  unread: "The show couldn't check a line in that language just now. Try again in a moment, or in English.",
  language: "Try that line in English.",
};

/* ------------------------------------------------ the persona ------------------------------------------------ */

/** The owner of someone's "you" (never their own id, so it's on none of their character lists). */
export const personaOwner = (userId: string) => `${PERSONA_OWNER_PREFIX}${userId}`;
/** What's wrong with a "you", or null. A first name or a nickname; nothing the show's sheet filter refuses. */
export function personaProblem(p: Partial<Persona>): string | null {
  const name = p.name?.trim() ?? "";
  if (!name || name.length > PERSONA_NAME_MAX || !/^[\p{L}][\p{L}' .-]*$/u.test(name)) return `Your name on the date: a first name or a nickname, letters only, up to ${PERSONA_NAME_MAX} characters.`;
  if (!Number.isInteger(p.age) || (p.age as number) < 18 || (p.age as number) > 120) return "You need to be 18 or over to step into a date.";
  const pronouns = p.pronouns?.trim() ?? "";
  if (!pronouns || pronouns.length > 20) return "Pick your pronouns.";
  const about = p.about?.trim() ?? "";
  if (!about || about.length > PERSONA_ABOUT_MAX) return `One line about you, up to ${PERSONA_ABOUT_MAX} characters.`;
  const verdict = checkSheetText({ name, bio: about });
  if (!verdict.ok) return verdict.reason === "real_person" ? "Come as yourself, not someone famous." : "Keep the line about you PG: the show is.";
  return null;
}

/** Their "you" as a character: one per person, made the first time and brought up to date after. Private, never dated otherwise. */
async function upsertPersona(db: Db, userId: string, p: Persona): Promise<string> {
  const owner = personaOwner(userId);
  const sheet = {
    name: p.name.trim(),
    age: p.age,
    bio: p.about.trim(),
    pronouns: p.pronouns.trim(),
    // The sheet's other fields, plainly: the person speaks for themselves, so these only seat the engine.
    traits: ["curious", "warm"],
    want: "to see where tonight goes",
    dealbreaker: "not being listened to",
  };
  const found = (await db.query<{ id: string }>(`select id from characters where owner_id = $1 order by created_at limit 1`, [owner])).rows[0];
  if (found) {
    await db.query(`update characters set name = $2, age = $3, bio = $4, pronouns = $5 where id = $1`, [found.id, sheet.name, sheet.age, sheet.bio, sheet.pronouns]);
    return found.id;
  }
  const id = crypto.randomUUID();
  await db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, pronouns, visibility, open_to_dates, extras, created_via)
     values ($1, $2, false, $3, $4, $5, $6::jsonb, $7, $8, $9, 'private', false, '{"persona": "you"}'::jsonb, 'web')`,
    [id, owner, sheet.name, sheet.age, sheet.bio, JSON.stringify(sheet.traits), sheet.want, sheet.dealbreaker, sheet.pronouns],
  );
  return id;
}

/** The person's "you" for the setup form, or null when they haven't come as themselves yet. */
export async function savedPersona(db: Db, userId: string): Promise<Persona | null> {
  const r = (await db.query<{ name: string; age: number; bio: string; pronouns: string | null }>(`select name, age, bio, pronouns from characters where owner_id = $1 order by created_at limit 1`, [personaOwner(userId)])).rows[0];
  return r ? { name: r.name, age: r.age, about: r.bio, pronouns: r.pronouns ?? "they/them" } : null;
}

/** Account deletion anonymizes someone's "you" and takes its dates offline: lib/account.ts deleteAccount (owner "you:<id>"). */

/* -------------------------------------------- what a day allows -------------------------------------------- */

const dayOf = (now: Date) => now.toISOString().slice(0, 10);

export type StepInAllowance = { used_today: number; max_today: number; free_today: boolean; admin: boolean };

export async function stepInAllowance(db: Db, userId: string, now: Date = new Date()): Promise<StepInAllowance> {
  const admin = await isAdmin(db, userId);
  const r = (await db.query<{ dates: number; free_used: boolean }>(`select dates, free_used from step_in_usage where user_id = $1 and day = $2`, [userId, dayOf(now)])).rows[0];
  return {
    used_today: r?.dates ?? 0,
    max_today: admin ? STEP_IN_ADMIN_MAX_PER_DAY : STEP_IN_MAX_PER_DAY,
    free_today: admin || !(r?.free_used ?? false),
    admin,
  };
}

/** How many dates a guest has stepped into, ever (step_in_usage keeps a row a day; a date called off before a word is given back). */
export async function guestStepIns(db: Db, userId: string): Promise<number> {
  return (await db.query<{ n: number }>(`select coalesce(sum(dates), 0)::int as n from step_in_usage where user_id = $1`, [userId])).rows[0]?.n ?? 0;
}

/** What a guest has left of their STEP_IN_GUEST_DATES (someone with no visitor id yet has all of them). */
export async function guestStepInsLeft(db: Db, userId: string | null): Promise<number> {
  return Math.max(0, STEP_IN_GUEST_DATES - (userId ? await guestStepIns(db, userId) : 0));
}

type Charge = { charge: StepInSetup["charge"]; reservation: Reservation | null };

/** Takes one of a guest's dates (all days together): null once they've had STEP_IN_GUEST_DATES. */
async function guestCharge(db: Db, userId: string, now: Date): Promise<Charge | null> {
  const total = `(select coalesce(sum(s.dates), 0) from step_in_usage s where s.user_id = $1::text)`;
  const slot = await db.query(
    `insert into step_in_usage as u (user_id, day, dates) select $1::text, $2::text, 1 where ${total} < $3::int
       on conflict (user_id, day) do update set dates = u.dates + 1 where ${total} < $3::int
     returning dates`,
    [userId, dayOf(now), STEP_IN_GUEST_DATES],
  );
  return slot.rows.length ? { charge: "guest", reservation: null } : null;
}

/** Takes today's slot and pays for it: admin, the day's free one, then one of their dates. Null when none's left. */
async function charge(db: Db, userId: string, now: Date): Promise<Charge | { refused: "day_cap" | "no_dates" }> {
  const admin = await isAdmin(db, userId);
  const day = dayOf(now);
  const max = admin ? STEP_IN_ADMIN_MAX_PER_DAY : STEP_IN_MAX_PER_DAY;
  const slot = await db.query(
    `insert into step_in_usage as u (user_id, day, dates) values ($1, $2, 1)
       on conflict (user_id, day) do update set dates = u.dates + 1 where u.dates < $3
     returning dates`,
    [userId, day, max],
  );
  if (!slot.rows.length) return { refused: "day_cap" };
  if (admin) return { charge: "admin", reservation: null };
  const free = await db.query(`update step_in_usage set free_used = true where user_id = $1 and day = $2 and not free_used returning user_id`, [userId, day]);
  if (free.rows.length) return { charge: "daily_free", reservation: null };
  const reservation = await reserveEpisode(db, userId, now);
  if (reservation) return { charge: reservation.source === "pack" ? "pack" : "free", reservation };
  await db.query(`update step_in_usage set dates = greatest(dates - 1, 0) where user_id = $1 and day = $2`, [userId, day]);
  return { refused: "no_dates" };
}

/** Gives a slot back (a start that failed, or a date left before a single line). */
async function giveBack(db: Db, userId: string, c: Charge, day: string): Promise<void> {
  await db.query(`update step_in_usage set dates = greatest(dates - 1, 0), free_used = case when $3 then false else free_used end where user_id = $1 and day = $2`, [userId, day, c.charge === "daily_free"]);
  if (c.reservation) await releaseEpisode(db, userId, c.reservation);
}

/* ------------------------------------------------ starting ------------------------------------------------ */

export type StepInStart = { with: string; character_id?: string; persona?: Persona; format?: StepInFormat };
/** `next`: where a refusal sends them (make a character, sign in): the page offers each as a link under the sentence. */
export type StepInNext = { href: string; label: string; track: string };
export type StepInFail = { ok: false; status: number; error: string; message: string; crisis_resources?: CrisisResources; episode_id?: string; next?: StepInNext[] };

/** The two ways on from a guest's refusal: an account (its own free date a day), or a character of their own to send on dates. */
const signInNext = (castId: string): StepInNext => ({ href: `/account?next=${encodeURIComponent(`/step-in?with=${castId}`)}`, label: "Make a free account", track: "step-in-signup" });
const makeNext = (castId: string, first: string): StepInNext => ({ href: `/create?meet=${encodeURIComponent(castId)}`, label: `Make a character to date ${first}`, track: "step-in-make" });
const refusedStart = (why: string, guest: boolean) => track("step_in_refused", { why, guest });
const fail = (status: number, error: string, message: string, extra: Partial<StepInFail> = {}): StepInFail => ({ ok: false, status, error, message, ...extra });

type SheetRow = { id: string; name: string; age: number; bio: string; traits: string[]; want: string; dealbreaker: string; appearance: string | null; pronouns: string | null; voice: string | null; is_house: boolean; owner_id: string | null };
const SHEET_COLUMNS = "id, name, age, bio, traits, want, dealbreaker, appearance, pronouns, voice, is_house, owner_id";
const forDate = (c: SheetRow): CharacterForDate => ({
  id: c.id,
  sheet: { name: c.name, age: c.age, bio: c.bio, traits: c.traits, want: c.want, dealbreaker: c.dealbreaker, house: c.is_house, appearance: c.appearance ?? undefined, pronouns: c.pronouns ?? undefined, voice: c.voice ?? undefined },
});

/** The person's one unfinished step-in date, if any. */
async function openStepIn(db: Db, userId: string): Promise<{ id: string; with: string } | null> {
  const r = (await db.query<{ id: string; b: string }>(`select id, character_b as b from episodes where creator_id = $1 and status = 'generating' and setup->>'met_via' = 'step_in' order by created_at desc limit 1`, [userId])).rows[0];
  return r ? { id: r.id, with: r.b } : null;
}

export async function startStepIn(db: Db, userId: string, input: StepInStart, now: Date = new Date(), who: StepInWho = {}): Promise<{ ok: true; episode_id: string; resumed?: true } | StepInFail> {
  const guest = who.guest === true;
  const castIds = seasonCastIds(now);
  if (!castIds.includes(input.with)) return fail(404, "not_on_cast", "You can step into a date with this season's cast. Pick one of them.");
  const cast = (await db.query<SheetRow>(`select ${SHEET_COLUMNS} from characters where id = $1 and is_house and premium_sku is null`, [input.with])).rows[0];
  if (!cast) return fail(404, "not_on_cast", "You can step into a date with this season's cast. Pick one of them.");
  const formatId: StepInFormat = input.format && (STEP_IN_FORMATS as readonly string[]).includes(input.format) ? input.format : "speed_date";

  // One at a time: the one they left unfinished is handed back (the same cast member) or named.
  const open = await openStepIn(db, userId);
  if (open) {
    if (open.with === cast.id) return { ok: true, episode_id: open.id, resumed: true };
    return fail(409, "step_in_open", "You're already on a date. Finish or leave that one first.", { episode_id: open.id });
  }

  // Who they come as: one of their own characters, or themselves.
  let mine: SheetRow | null = null;
  let mode: StepInSetup["mode"];
  if (input.character_id) {
    mode = "own";
    mine = (await db.query<SheetRow>(`select ${SHEET_COLUMNS} from characters where id = $1 and owner_id = $2 and not is_house`, [input.character_id, userId])).rows[0] ?? null;
    if (!mine) return fail(404, "not_your_character", "Pick one of your own characters, or come as yourself.");
    if (await areUnmatched(db, mine.id, cast.id)) return fail(409, "unmatched", `${shortName(mine.name)} and ${shortName(cast.name)} unmatched, so they don't date.`);
    const busy = await ownDateInProgress(db, mine.id, cast.id);
    if (busy) return fail(409, "date_in_progress", `${shortName(mine.name)} and ${shortName(cast.name)} already have a date being made. Try again once it's done.`);
  } else if (input.persona) {
    mode = "you";
    const problem = personaProblem(input.persona);
    if (problem) return fail(422, "persona_invalid", problem);
  } else {
    return fail(422, "who_needed", "Come as one of your characters (character_id) or as yourself (persona).");
  }

  const first = shortName(cast.name);
  // A guest's address, before anything that calls a model (the check on what they wrote about themselves is one):
  // fresh cookies don't get a script past it. A refusal isn't counted, so it never eats the show-wide day below.
  if (guest && who.ip && (await overLimit(db, "step_in_start", who.ip, STEP_IN_IP_START_LIMITS, now))) {
    refusedStart("ip_starts", guest);
    return fail(429, "busy_here", "A lot of dates have started from your connection lately, so step-in is resting for it. Try again in an hour, or make a free account and use your own free date.", { next: [signInNext(cast.id)] });
  }
  if (mode === "you") {
    // What they wrote about themselves is their own words: checked for crisis before any date starts. A guest's maybe
    // goes to the model only while the show-wide count allows (STEP_IN_GUEST_ABOUT_CHECKS); past it, it's a hit.
    const words = input.persona!.about;
    const unchecked = guest && !crisisIntent(words) && maybeCrisis(words) && (await overLimit(db, "step_in_about_check", "all", STEP_IN_GUEST_ABOUT_CHECKS, now));
    if (unchecked) track("crisis_notice_shown", { surface: "step_in_about" });
    const about = unchecked ? { crisis: true } : await lineInCrisis(words, "step_in_about");
    if (about.crisis) await countCrisis(db, "step_in_about");
    if (about.crisis) return fail(200, "paused", "Before any date: are you okay?", { crisis_resources: CRISIS_RESOURCES });
  }

  let paid: Charge;
  if (guest) {
    const slot = await guestCharge(db, userId, now);
    if (!slot) {
      refusedStart("guest_dates", guest);
      return fail(429, "guest_used_up", `That's the ${STEP_IN_GUEST_DATES} dates you can step into without an account. Make a free account for one a day, or make a character and send them on dates.`, {
        next: [signInNext(cast.id), makeNext(cast.id, first)],
      });
    }
    // The show-wide day, last: only a start that would otherwise happen counts toward it.
    const max = stepInGuestDailyMax();
    if (await overLimit(db, "step_in_guest_day", "all", { perHour: max, perDay: max }, now)) {
      await giveBack(db, userId, slot, dayOf(now)).catch(() => {});
      refusedStart("guest_day", guest);
      return fail(429, "guests_full", "Today's dates for visitors without an account are all taken. Make a free account for your own free date, or come back tomorrow.", { next: [signInNext(cast.id)] });
    }
    paid = slot;
  } else {
    const took = await charge(db, userId, now);
    if ("refused" in took) {
      refusedStart(took.refused, guest);
      return took.refused === "day_cap"
        ? fail(429, "day_cap", "That's today's dates stepped into. Come back tomorrow.")
        : fail(429, "no_dates", "Today's free one is used and you've no dates left this week. Free dates come back Monday 00:00 UTC, or get a pack in the shop.", {
            next: [{ href: "/shop", label: "See the shop", track: "step-in-shop" }],
          });
    }
    paid = took;
  }
  const day = dayOf(now);
  try {
    const aId = mine ? mine.id : await upsertPersona(db, userId, input.persona!);
    const a = mine ?? (await db.query<SheetRow>(`select ${SHEET_COLUMNS} from characters where id = $1`, [aId])).rows[0];
    const episodeId = crypto.randomUUID();
    const request: DateRequest = { autonomy: DEFAULT_AUTONOMY, strategy: DEFAULT_STRATEGY, gameBudget: DEFAULT_GAME_BUDGET, agendaId: null, note: null, format: formatId };
    const built = await buildDate(db, episodeId, forDate(a), forDate(cast), request, undefined, undefined, { creatorId: userId });
    built.setup.met_via = "step_in";
    // A person answers in words, not move fields: the date stays where the show sets it.
    built.setup.moves = false;
    built.setup.show_from_line = 0;
    built.setup.step_in = { mode, charge: paid.charge };
    const { outcome: decided, trace } = decideTraced(built.input, built.seed, built.setup.engine_version);
    await db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending,
                             drama_question, drama_answer, seed, box_score, sides, best_line, confessionals, setup,
                             transcript, status, visibility, created_via, performed_by, partner_performer, handed_over, handed_over_at, engine_trace)
       values ($1, $2, $3, $4, '', '[]'::jsonb, '[]'::jsonb, '', '', $5, $6, $7, $8, $9::jsonb, $10::jsonb, null,
               '[]'::jsonb, $11::jsonb, '[]'::jsonb, 'generating', 'private', 'web', 'agent', null, 'b', now(), $12::jsonb)`,
      [
        episodeId,
        userId,
        a.id,
        cast.id,
        decided.ending,
        decided.drama_question,
        decided.drama_answer,
        built.seed,
        JSON.stringify(decided.variables),
        JSON.stringify(decided.sides),
        JSON.stringify(built.setup),
        trace ? JSON.stringify(trace) : null,
      ],
    );
    track("step_in_started", { episode_id: episodeId, charge: paid.charge, mode, format: formatId, guest });
    return { ok: true, episode_id: episodeId };
  } catch (err) {
    await giveBack(db, userId, paid, day).catch(() => {});
    throw err;
  }
}

/* ------------------------------------------------ the view ------------------------------------------------ */

type StepRow = OwnDateRow & { inner_life: StoredInner | null; best_line: string | null; ending_detail: string | null };

async function loadStep(db: Db, userId: string, episodeId: string): Promise<StepRow | null> {
  const row = await loadOwnDate(db, userId, episodeId);
  if (!row || !isStepIn(row) || row.creator_id !== userId) return null;
  const extra = (await db.query<{ inner_life: StoredInner | null; best_line: string | null; ending_detail: string | null }>(`select inner_life, best_line, ending_detail from episodes where id = $1`, [episodeId])).rows[0];
  return { ...row, inner_life: extra?.inner_life ?? null, best_line: extra?.best_line ?? null, ending_detail: extra?.ending_detail ?? null };
}

async function refs(db: Db, ids: [string, string]): Promise<Map<string, CharacterRef>> {
  const { rows } = await db.query<{ id: string; name: string; house: boolean; hue: number | null; portrait: string | null }>(
    `select c.id, c.name, c.is_house as house, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait from characters c where c.id = any($1)`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, house: r.house, hue: r.hue, portrait: r.portrait }]));
}

/** Whose line is next (the engine's order, lib/conversation.ts), or null when the date's lines are all in. */
function nextSide(built: Awaited<ReturnType<typeof rebuildOwnDate>>["built"], decided: Awaited<ReturnType<typeof rebuildOwnDate>>["decided"], formatId: FormatId, transcript: Turn[]): { side: "a" | "b"; of: number } | null {
  const shape = ownDateShape(built, formatId, transcript);
  if (transcript.length >= shape.total) return null;
  const { side } = buildTurnMessages(built.input, decided, built.characters, built.setup.producer, built.setup.venue, transcript, transcript.length, formatId, formatContextOf(built), {
    totalTurns: showFormat(formatId).turns ?? CONVERSATION_TURNS,
    shape,
  });
  return { side, of: shape.total };
}

async function viewOf(db: Db, row: StepRow): Promise<StepInView> {
  const { built, decided, formatId } = await rebuildOwnDate(db, row);
  const transcript = row.transcript ?? [];
  const faces = await refs(db, [row.a_id, row.b_id]);
  const you = faces.get(row.a_id) ?? { id: row.a_id, name: row.a_name, house: false, hue: null, portrait: null };
  const them = faces.get(row.b_id) ?? { id: row.b_id, name: row.b_name, house: true, hue: null, portrait: null };
  const next = row.status === "ready" ? null : nextSide(built, decided, formatId, transcript);
  const of = next?.of ?? transcript.length;
  const quiet = (Date.now() - new Date(row.last_move_at ?? row.created_at).getTime()) / 60_000;
  const state: StepInView["state"] = row.status === "ready" ? "done" : !next ? "finishing" : next.side === "a" ? "your_line" : "their_line";
  const kind = row.status === "ready" ? endingDetailOf(row.ending_detail, row.ending) : null;
  return {
    id: row.id,
    state,
    you: { ...you, persona: row.setup?.step_in?.mode === "you" },
    them,
    venue: built.setup.venue ?? null,
    act: transcript.length ? (DATE_ACTS[transcript[transcript.length - 1].act] ?? null) : null,
    lines: transcript.map((t) => ({ side: t.side, act: t.act, dialogue: t.dialogue, action: t.action, emotion: t.emotion, ...(t.walked_out ? { walked_out: true as const } : {}) })),
    line: Math.min(transcript.length + 1, of),
    of,
    last_line: state === "your_line" && transcript.length >= of - 2,
    disclosure: { text: disclosureText(row.b_name), every: DISCLOSURE_EVERY, again: state !== "done" && transcript.length > 0 && quiet >= DISCLOSURE_IDLE_MINUTES },
    paused: row.setup?.step_in?.paused === true,
    format: showFormat(formatId).label,
    visibility: row.visibility,
    ...(row.status === "ready"
      ? {
          ending: {
            label: endingLabel(row.ending, built.input.date_number),
            kind: kind ? ENDING_DETAIL_LABELS[kind] : null,
            best_line: row.best_line,
            why: row.setup?.step_in?.play?.why ?? null,
            family: row.ending,
            share_path: stepInSharePath({ episodeId: row.id, castId: row.b_id, castName: row.b_name, ending: row.ending }),
          },
        }
      : {}),
    episode_path: `/episodes/${row.id}`,
  };
}

export type StepInResult = { ok: true; view: StepInView; refused?: string; crisis_resources?: CrisisResources } | StepInFail;

export async function getStepIn(db: Db, userId: string, episodeId: string): Promise<StepInResult> {
  const row = await loadStep(db, userId, episodeId);
  if (!row) return fail(404, "not_found", "No date of yours here.");
  return withPause({ ok: true, view: await viewOf(db, row) });
}

/** A paused date always comes back with the resources, so the page shows them again whenever it's opened. */
const withPause = (r: Extract<StepInResult, { ok: true }>): StepInResult => (r.view.paused && !r.crisis_resources ? { ...r, crisis_resources: CRISIS_RESOURCES } : r);

/* ------------------------------------------- the cast member's side ------------------------------------------- */

/**
 * What some calls cost: tokens, and dollars as the provider billed them when every call says (OpenRouter's usage.cost),
 * else at list prices (lib/pricing.ts), else 0 for a model with no known price.
 */
function usageOf(usage: readonly Usage[], calls: number): DateUsage {
  const summary = summarizeUsage(usage, calls);
  const billed = usage.length > 0 && usage.every((u) => typeof u.cost === "number") ? usage.reduce((n, u) => n + (u.cost ?? 0), 0) : null;
  return billed !== null ? { ...summary, cost_usd: Math.round(billed * 1e6) / 1e6 } : summary;
}

/** Adds what a call cost to the date's running total (setup.step_in.cost): tokens and dollars, never words. */
async function addCost(db: Db, episodeId: string, u: DateUsage | null): Promise<void> {
  if (!u || !u.calls) return;
  await db.query(
    `update episodes set setup = jsonb_set(setup, '{step_in,cost}', jsonb_build_object(
        'calls', coalesce((setup #>> '{step_in,cost,calls}')::int, 0) + $2,
        'input_tokens', coalesce((setup #>> '{step_in,cost,input_tokens}')::int, 0) + $3,
        'output_tokens', coalesce((setup #>> '{step_in,cost,output_tokens}')::int, 0) + $4,
        'cost_usd', coalesce((setup #>> '{step_in,cost,cost_usd}')::numeric, 0) + $5))
      where id = $1`,
    [episodeId, u.calls, u.input_tokens, u.output_tokens, u.cost_usd ?? 0],
  );
}

/** The lines as the cast's own prompt reads them: each of its earlier lines with its inner life back on (episodes.inner_life). */
const withInner = (transcript: Turn[], inner: StoredInner | null): Turn[] =>
  transcript.map((t, i) => (t.side === "b" && inner?.lines[i] ? { ...t, inner: inner.lines[i] as LineInner } : t));

/**
 * The date's two characters with who the person is in scenes on their own side (lib/persona.ts), when they came as
 * themselves: how they look and who they are, which the cast member's prompt carries as scene make-believe. The name
 * stays the one they came as, so it's left out. Read under the show's check each time; a date played as one of their
 * own characters has that character's sheet instead, and gets nothing.
 */
async function withScenePersona<T extends { scenePersona?: string }>(db: Db, row: StepRow, characters: [T, T]): Promise<[T, T]> {
  if (row.setup?.step_in?.mode !== "you") return characters;
  const persona = await showPersona(db, row.creator_id).catch(() => null);
  const block = persona ? personaForScene(persona, { name: false }) : "";
  return block ? [{ ...characters[0], scenePersona: block }, characters[1]] : characters;
}

/**
 * The cast member's next line, through the show's own loop (simulateConversation, one line): its critic, its inner life
 * and its secrets, exactly as on a date the show writes. False when the model wouldn't give one (advance tries again).
 */
async function castLine(db: Db, row: StepRow, attempt = 0): Promise<boolean> {
  const { built, decided, formatId } = await rebuildOwnDate(db, row);
  const transcript = row.transcript ?? [];
  const next = nextSide(built, decided, formatId, transcript);
  if (!next || next.side !== "b") return false;
  const counting = countingModel(getModel());
  const lived = withInner(transcript, row.inner_life);
  const v5 = (built.setup.engine_version ?? 1) >= CHOICE_ENGINE_VERSION;
  const characters = await withScenePersona(db, row, built.characters);
  let lines: Turn[];
  try {
    lines = await simulateConversation(counting.model, built.input, decided, characters, built.setup.producer, built.setup.venue, formatId, showFormat(formatId).turns ?? CONVERSATION_TURNS, formatContextOf(built), undefined, undefined, undefined, {
      moves: false,
      from: lived,
      stopAfter: 1,
      ...(row.setup?.end_by ? { endBy: row.setup.end_by } : {}),
      walkOut: v5 && walkOutSide(decided) === "b" ? "b" : null,
    });
  } catch (err) {
    await addCost(db, row.id, usageOf(counting.usage(), counting.calls())).catch(() => {});
    if (err instanceof ConversationError) return false;
    throw err;
  }
  const line = lines[transcript.length];
  if (!line) return false;
  // The cast never voices wanting to hurt itself to a person on a date (SB 243's "prevent producing self-harm content"):
  // a line the crisis list catches is never said; the show draws another (once), else waits.
  if (crisisIntent(line.dialogue)) {
    track("step_in_line_withheld", { episode_id: row.id, why: "self_harm" });
    return attempt < 1 ? castLine(db, row, attempt + 1) : false;
  }
  // Nor does it play along with a pick-up line the person's check missed ("nobody's taking anything off before the
  // tacos!"): Step in's PG check (lib/safety.ts checkStepInText), the same way.
  if (!checkStepInText({ dialogue: line.dialogue, action: line.action }).ok) {
    track("step_in_line_withheld", { episode_id: row.id, why: "pg" });
    return attempt < 1 ? castLine(db, row, attempt + 1) : false;
  }
  const stored = outerLine(line) as Turn;
  const inner: StoredInner = { v: 1, lines: [...transcript.map((_, i) => row.inner_life?.lines[i] ?? null), line.inner && Object.keys(line.inner).length ? line.inner : null] };
  // A walk-out ends the date on this line (end_by), as the show's loop does.
  const endBy = stored.walked_out ? transcript.length + 1 : null;
  const saved = await db.query(
    `update episodes set transcript = $2::jsonb, last_move_at = now(), turn_meta = ${nextTurnMeta("show")}, inner_life = $4::jsonb,
            setup = case when $5::int is null then setup else setup || jsonb_build_object('end_by', $5::int) end
      where id = $1 and status = 'generating' and jsonb_array_length(transcript) = $3
      returning id`,
    [row.id, JSON.stringify([...transcript, stored]), transcript.length, JSON.stringify(inner), endBy],
  );
  await addCost(db, row.id, usageOf(counting.usage(), counting.calls())).catch(() => {});
  return saved.rows.length > 0;
}

/**
 * The last line is in: the engine's final call (the wishes weigh in, lib/own-date.ts settles them), the recap on the
 * director with the diary cams, the ending's kind, the cast's inner life kept for after it airs. Private until they air it.
 */
async function finish(db: Db, row: StepRow): Promise<boolean> {
  const { built, decided, formatId } = await rebuildOwnDate(db, row);
  const transcript = row.transcript ?? [];
  if (nextSide(built, decided, formatId, transcript)) return false;
  const counting = countingModel(getDirectorModel());
  let draft;
  try {
    draft = await narrateEpisode(counting.model, built.input, decided, built.characters, built.setup.producer, built.setup.venue, formatId, formatContextOf(built), { transcript, plan: null });
  } catch {
    await addCost(db, row.id, usageOf(counting.usage(), counting.calls())).catch(() => {});
    return false;
  }
  draft = anchorBestLine(draft, transcript);
  if (draft.best_line && isLogistics(draft.best_line)) draft = { ...draft, best_line: bestLine(transcript) ?? draft.best_line };
  const lived = withInner(transcript, row.inner_life);
  const v5 = (built.setup.engine_version ?? 1) >= CHOICE_ENGINE_VERSION;
  const kind = v5 ? detailOf({ ending: decided.ending, choices: null, transcript: lived, afterglow: null, ghost: null, names: [built.characters[0].name, built.characters[1].name] }) : null;
  const inner = innerOf(lived);
  const usage = usageOf(counting.usage(), counting.calls());
  const saved = await db.query(
    `update episodes
        set setting = $2, goals = $3::jsonb, scenes = $4::jsonb, twist = $5, finale = $6, best_line = $7,
            confessionals = $8::jsonb, status = 'ready', inner_life = $10::jsonb, ending_detail = $11,
            generated_with = jsonb_build_object('actor', '["person", "platform"]'::jsonb, 'director', '["platform"]'::jsonb, 'byok', '[]'::jsonb, 'prompts', $12::text, 'step_in', true)
      where id = $1 and status = 'generating' and jsonb_array_length(transcript) = $9
      returning id`,
    [row.id, draft.setting, JSON.stringify(draft.goals), JSON.stringify(draft.scenes), draft.twist, draft.finale, draft.best_line, JSON.stringify(draft.confessionals), transcript.length, inner ? JSON.stringify(inner) : null, kind, PROMPT_VERSION],
  );
  await addCost(db, row.id, usage).catch(() => {});
  if (!saved.rows.length) return true;
  const slips: SecretSlip[] = lived.flatMap((t, i) => (t.side === "b" && t.inner?.secret ? [{ character_id: row.b_id, season_id: t.inner.secret.season_id, idx: t.inner.secret.idx, line: i }] : []));
  if (slips.length) await recordSlips(db, row.id, slips).catch(() => {});
  await settleOwnDateNotices(db, row.id).catch(() => {});
  await rememberDate(db, row.a_id, row.b_id).catch(() => {});
  await logSceneRequests(db, row.id, built.setup, transcript).catch(() => {});
  trackMoves(row.id, transcript, "show");
  const cost = (await db.query<{ cost: StepInSetup["cost"] | null }>(`select setup #> '{step_in,cost}' as cost from episodes where id = $1`, [row.id])).rows[0]?.cost ?? null;
  trackEpisodeCostKept({
    episode_id: row.id,
    where: "step_in",
    model: "free",
    model_calls: cost?.calls ?? usage.calls,
    ms: Date.now() - new Date(row.created_at).getTime(),
    transcript_turns: transcript.length,
    ...(cost ? { usage: { calls: cost.calls, input_tokens: cost.input_tokens, cached_input_tokens: 0, output_tokens: cost.output_tokens, thinking_tokens: 0, cost_usd: Number(cost.cost_usd), models: usage.models } } : {}),
  });
  const quality = transcript.length ? transcriptQuality(transcript, built.characters, qualityContext(built, draft.setting)) : null;
  const play = row.setup?.step_in?.play;
  track("step_in_finished", { episode_id: row.id, ending: decided.ending, prior: row.wishes?.engine ?? null, shift: play?.shift ?? null, play_score: play?.score ?? null, lines: transcript.length, cost_usd: cost ? Number(cost.cost_usd) : null, quality: quality?.index ?? null });
  return true;
}

/**
 * The last line is in: the cast member's verdict on how the person played (lib/step-in-play.ts), kept on the episode
 * before the ending settles, so the recap, the card and every replay land on the same ending. One cheap call.
 */
async function judge(db: Db, row: StepRow): Promise<boolean> {
  const { built } = await rebuildOwnDate(db, row);
  const counting = countingModel(getModel());
  const play = await judgePlay(counting.model, built.characters, withInner(row.transcript ?? [], row.inner_life));
  const saved = await db.query(
    `update episodes set setup = jsonb_set(setup, '{step_in,play}', $2::jsonb)
      where id = $1 and status = 'generating' and setup #> '{step_in,play}' is null returning id`,
    [row.id, JSON.stringify(play)],
  );
  await addCost(db, row.id, usageOf(counting.usage(), counting.calls())).catch(() => {});
  return saved.rows.length > 0 || Boolean((await loadPlay(db, row.id)));
}

const loadPlay = async (db: Db, id: string): Promise<StepInPlay | null> =>
  (await db.query<{ play: StepInPlay | null }>(`select setup #> '{step_in,play}' as play from episodes where id = $1`, [id])).rows[0]?.play ?? null;

/** Plays whatever the show owes: the cast member's line, the verdict, then the recap once the lines are in. Nothing while paused. */
async function catchUp(db: Db, userId: string, episodeId: string): Promise<StepRow | null> {
  let row = await loadStep(db, userId, episodeId);
  for (let guard = 0; row && row.status === "generating" && !row.setup?.step_in?.paused && guard < 4; guard++) {
    const { built, decided, formatId } = await rebuildOwnDate(db, row);
    const next = nextSide(built, decided, formatId, row.transcript ?? []);
    if (next?.side === "a") break;
    const moved = next ? await castLine(db, row) : row.setup?.step_in?.play ? await finish(db, row) : await judge(db, row);
    row = await loadStep(db, userId, episodeId);
    if (!moved) break;
  }
  return row;
}

/**
 * The cast member's line (or the recap) when it's the show's to play: the page asks once it opens on one. Each ask can
 * cost model calls (and again each time the show's side fails), so an ask from the page counts as a try on the date;
 * `counted`: it follows a line that already was.
 */
export async function advanceStepIn(db: Db, userId: string, episodeId: string, counted = false): Promise<StepInResult> {
  if (!counted) {
    const before = await loadStep(db, userId, episodeId);
    if (!before) return fail(404, "not_found", "No date of yours here.");
    if (before.status === "generating" && !before.setup?.step_in?.paused && (await dateTries(db, episodeId))) {
      return { ok: true, view: await viewOf(db, before), refused: TOO_MANY_TRIES };
    }
  }
  const row = await catchUp(db, userId, episodeId);
  if (!row) return fail(404, "not_found", "No date of yours here.");
  return withPause({ ok: true, view: await viewOf(db, row) });
}

/* ------------------------------------------------ their line ------------------------------------------------ */

export type StepInSay = { dialogue: string; action?: string; see_again?: boolean };

/**
 * The person says their line. In order: the self-harm check (a hit pauses the date, shows the resources and the line is
 * never answered in character), the PG filter (a soft redirect, the line not used), then every check an agent's line
 * gets (submitOwnDateStep). Then the cast member answers, and on the last line the show writes the recap.
 */
export async function sayStepIn(db: Db, userId: string, episodeId: string, input: StepInSay, who: StepInWho = {}): Promise<StepInResult> {
  const row = await loadStep(db, userId, episodeId);
  if (!row) return fail(404, "not_found", "No date of yours here.");
  const view = () => loadStep(db, userId, episodeId).then(async (r) => viewOf(db, r ?? row));
  if (row.status !== "generating") return { ok: true, view: await view(), refused: "This date is over." };
  if (row.setup?.step_in?.paused) return { ok: true, view: await view(), crisis_resources: CRISIS_RESOURCES };
  const dialogue = input.dialogue?.replace(/\s+/g, " ").trim() ?? "";
  if (!dialogue) return { ok: true, view: await view(), refused: "Say something first." };
  if (dialogue.length > TURN_DIALOGUE_MAX) return { ok: true, view: await view(), refused: `Keep a line under ${TURN_DIALOGUE_MAX} characters.` };

  // Paused: nothing is said in character on this turn, and the date waits for them (continue or leave).
  const pause = async (): Promise<StepInResult> => {
    await countCrisis(db, "step_in_line");
    await db.query(`update episodes set setup = jsonb_set(setup, '{step_in,paused}', 'true'::jsonb) where id = $1 and status = 'generating'`, [episodeId]);
    return { ok: true, view: await view(), crisis_resources: CRISIS_RESOURCES };
  };

  // From here a line can cost a model call (the maybe check, then the cast's reply), so it's counted first: by this
  // date (everyone: a date's calls stay bounded however many lines are refused) and by the address it comes from
  // (everyone but admins). Their words come back to them unsent, as with any refused line.
  const capped = (await dateTries(db, episodeId))
    ? TOO_MANY_TRIES
    : who.ip && row.setup?.step_in?.charge !== "admin" && (await overLimit(db, "step_in_line", who.ip, STEP_IN_IP_LINE_LIMITS))
      ? "That's a lot of lines from your connection this hour. Your date is saved: come back to it in a little while."
      : null;
  if (capped) {
    // Past a cap no model is called, and the self-harm check still comes first: the list, and a maybe counts as a hit
    // without its model call (it fails closed, exactly as when that call fails).
    if (crisisIntent(dialogue) || maybeCrisis(dialogue)) {
      track("crisis_notice_shown", { surface: "step_in_line" });
      return pause();
    }
    return { ok: true, view: await view(), refused: capped };
  }

  const crisis = await lineInCrisis(dialogue);
  await addCost(db, episodeId, crisis.usage).catch(() => {});
  if (crisis.crisis) return pause();
  const action = input.action?.trim().slice(0, 40) ?? "";
  const verdict = checkStepInText({ dialogue, action });
  if (!verdict.ok) return { ok: true, view: await view(), refused: PG_REDIRECT[verdict.reason] };

  const { built, decided, formatId } = await rebuildOwnDate(db, row);
  const next = nextSide(built, decided, formatId, row.transcript ?? []);
  if (next?.side !== "a") return advanceStepIn(db, userId, episodeId, true);
  const out = await submitOwnDateStep(db, userId, episodeId, {
    dialogue,
    action,
    emotion: "",
    ...(typeof input.see_again === "boolean" ? { see_again: input.see_again, interest_signal: input.see_again ? 0.8 : 0.2 } : {}),
  });
  if (!out.ok) return fail(out.status, out.error, out.message);
  if (out.rejected && out.rejected !== "raced") {
    return { ok: true, view: await view(), refused: "The show couldn't use that line. Try saying it another way." };
  }
  return advanceStepIn(db, userId, episodeId, true);
}

/** After a pause (the crisis notice), they choose to carry on: the date picks up where it was. */
export async function continueStepIn(db: Db, userId: string, episodeId: string): Promise<StepInResult> {
  const row = await loadStep(db, userId, episodeId);
  if (!row) return fail(404, "not_found", "No date of yours here.");
  await db.query(`update episodes set setup = jsonb_set(setup, '{step_in,paused}', 'false'::jsonb), last_move_at = now() where id = $1 and status = 'generating'`, [episodeId]);
  return advanceStepIn(db, userId, episodeId);
}

/** They leave before it's over: the date goes (nothing airs). Left before saying a word, it's given back. */
export async function leaveStepIn(db: Db, userId: string, episodeId: string): Promise<{ ok: true; refunded: boolean } | StepInFail> {
  const row = await loadStep(db, userId, episodeId);
  if (!row) return fail(404, "not_found", "No date of yours here.");
  if (row.status === "ready") return fail(409, "already_done", "This date is over: it stays yours, private unless you air it.");
  const said = (row.transcript ?? []).some((t) => t.side === "a");
  const gone = await db.query(`delete from episodes where id = $1 and status = 'generating' and creator_id = $2 returning id`, [episodeId, userId]);
  if (!gone.rows.length) return fail(409, "already_done", "This date is over.");
  await settleOwnDateNotices(db, episodeId).catch(() => {});
  const how = row.setup?.step_in?.charge;
  const refunded = !said && how !== undefined && how !== "admin";
  if (refunded) {
    const reservation: Reservation | null = how === "pack" ? { source: "pack" } : how === "free" ? { source: "free", season_id: weekAt(new Date(row.created_at)).id } : null;
    await giveBack(db, userId, { charge: how, reservation }, dayOf(new Date(row.created_at))).catch(() => {});
  }
  return { ok: true, refunded };
}

/** Whether every line passes Step in's PG check (lib/safety.ts checkStepInText), read again before a date can air. */
export function stepInAirable(transcript: readonly Pick<Turn, "dialogue" | "action">[]): boolean {
  return transcript.every((t) => checkStepInText({ dialogue: t.dialogue, action: t.action }).ok);
}

/** They air it: it becomes a normal public episode (it airs on its own once its window closes, lib/air.ts). */
export async function airStepIn(db: Db, userId: string, episodeId: string): Promise<StepInResult> {
  const row = await loadStep(db, userId, episodeId);
  if (!row) return fail(404, "not_found", "No date of yours here.");
  if (row.status !== "ready") return fail(409, "not_finished", "Finish the date first, then choose whether it airs.");
  if (row.visibility !== "public" && !stepInAirable(row.transcript ?? [])) {
    track("step_in_air_refused", { episode_id: episodeId });
    return fail(409, "not_airable", "This date can't air: a line in it goes past what the show is (PG). It stays yours, private.");
  }
  if (row.visibility !== "public") {
    await db.query(`update episodes set visibility = 'public' where id = $1 and creator_id = $2`, [episodeId, userId]);
    await refreshEpisodePair(db, episodeId).catch(() => {});
    invalidateGraph();
    await Promise.all([updateCharacterMemory(db, row.a_id), updateCharacterMemory(db, row.b_id)]).catch(() => {});
    // The story state follows the public record too (a no-op until the date has aired; lib/air.ts runs it then).
    await afterAired(db, episodeId).catch(() => null);
    track("step_in_aired", { episode_id: episodeId });
  }
  return getStepIn(db, userId, episodeId);
}

/** Their step-in dates still going, for the setup page (resume one). */
export async function openStepInFor(db: Db, userId: string): Promise<{ id: string; with: string } | null> {
  return openStepIn(db, userId);
}

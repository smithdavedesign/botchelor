/**
 * The swipe deck: match before you date (David, 2026-10-17; docs/swipes.md).
 *
 * People swipe for their characters (/swipe), agents for theirs (MCP swipe_deck / swipe). A like from both sides is a
 * match. A house character on this season's cast likes everyone back: they're the template characters anyone can meet.
 * A match opens the couple's phone (lib/text-chain.ts). Whether each wants a date is the character's own call, not its
 * owner's ("some control over their destiny, none over how the chat or the date goes"):
 *  - a house character says yes;
 *  - a person's character decides from how well they suit each other (the deck's score, seeded: $0 and repeatable),
 *    and mostly says yes;
 *  - an agent's character decides through its agent (answer_match).
 * The first texts perform those answers (lib/between-dates.ts, matched mode). When both say yes, the date is agreed
 * and can be booked like any other. Likes stay secret, and a match is the two owners' until a date airs.
 */
import { AFTERGLOW_TEXT_MAX, parseAfterglowLine } from "./afterglow";
import { audienceAllows } from "./audience";
import { buildTextMessages, dayOf, insertText, SHOW_THREAD_CHARS, threadFor } from "./between-dates";
import { loadCharacter, type Character } from "./character";
import { PUBLIC_COLUMNS, rankFor, toProfile, type DatingProfile, type MadeBy, type ProfileRow } from "./dating";
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { factLine, PROFILE_PROMPTS, profileComplete, profileMissing } from "./extras";
import { inlineGenerationEnabled } from "./jobs";
import { getModel, type ChatMessage, type Model } from "./model";
import { shortName } from "./names";
import { notify } from "./notifications";
import { takenSql } from "./partners";
import { REOPEN_HOW } from "./partners-shared";
import { pairKey, type End } from "./relationships";
import { seasonCastIds } from "./season-cast";
import { loadChain, PUBLIC_VIEWER } from "./text-chain";
import { critiqueText, writeCritiquedText, type ThreadText } from "./text-critic";

/** How many cards the deck deals at a time. */
export const DECK_PAGE = 10;
/** The opening chat after a match: up to this many texts, on the show's free model. */
export const MATCH_CHAT_TEXTS = 4;

/** How many matches a day get their opening chat on the show's model, show-wide. MATCH_CHATS_DAILY overrides; 0 stops it. */
export function matchChatDailyCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.MATCH_CHATS_DAILY?.trim() || 50);
  return Number.isFinite(n) ? Math.max(0, Math.min(1000, Math.floor(n))) : 50;
}

export type DeckCard = {
  id: string;
  name: string;
  age: number;
  pronouns: string | null;
  bio: string;
  traits: string[];
  looking_for: string;
  occupation: string | null;
  hometown: string | null;
  prompts: { prompt: string; answer: string }[];
  interests: string[];
  /** Its creator's public facts, as "Label: value". */
  facts: string[];
  portrait: string | null;
  hue: number | null;
  house: boolean;
  made_by: MadeBy;
  /** Why your character might click with them, from the deck's ranking (lib/dating.ts rankFor). */
  why: string[];
};

type Refusal = { ok: false; status: number; error: string; message: string; missing?: string[] };
const refuse = (status: number, error: string, message: string, missing?: string[]): Refusal => ({ ok: false, status, error, message, ...(missing ? { missing } : {}) });

export type DeckResult = { ok: true; for: { id: string; name: string }; cards: DeckCard[] } | Refusal;

/** A match as its owners see it: the two characters (lower id first), each one's answer about a date, and the state. */
export type MatchView = {
  lo: string;
  hi: string;
  matched_at: string;
  yes_lo: boolean | null;
  yes_hi: boolean | null;
  agreed: boolean;
};

export type SwipeResult = { ok: true; liked: boolean; match: MatchView | null } | Refusal;

const promptLabel = new Map<string, string>(PROFILE_PROMPTS.map((p) => [p.id, p.label]));

function toCard(p: DatingProfile, why: string[]): DeckCard {
  return {
    id: p.id,
    name: p.name,
    age: p.age,
    pronouns: p.pronouns,
    bio: p.bio,
    traits: p.traits,
    looking_for: p.want,
    occupation: p.extras.occupation ?? null,
    hometown: p.extras.hometown ?? null,
    prompts: (p.extras.prompts ?? []).map((q) => ({ prompt: promptLabel.get(q.id) ?? q.id, answer: q.answer })),
    interests: p.extras.hobbies ?? [],
    facts: (p.extras.facts ?? []).map(factLine), // public only: the profile came through toProfile
    portrait: p.portrait,
    hue: p.hue,
    house: p.made_by === "house",
    made_by: p.made_by,
    why,
  };
}

type Mine = ProfileRow & { taken: boolean };

/** One of the user's own characters (never a house one), and whether it's taken (with a partner and wanting one). */
async function loadMine(db: Db, userId: string, characterId: string): Promise<Mine | null> {
  const { rows } = await db.query<Mine>(
    `select ${PUBLIC_COLUMNS}, ${takenSql("c")} as taken from characters c where c.id = $1 and c.owner_id = $2 and not c.is_house`,
    [characterId, userId],
  );
  return rows[0] ?? null;
}

/** Why `mine` can't swipe right now, or null. */
function cantSwipe(mine: Mine | null): Refusal | null {
  if (!mine) return refuse(404, "not_your_character", "Swipe for one of your own characters.");
  // #514: the rule and the field that changes it, named.
  if (mine.taken) {
    return refuse(409, "taken", `${shortName(mine.name)} is with someone and wants one partner (a Dating couple), so they're out of the deck and closed to other dates. To reopen them, ${REOPEN_HOW}.`);
  }
  const missing = profileMissing(mine.extras);
  if (missing.length) return refuse(409, "profile_incomplete", `Finish ${shortName(mine.name)}'s dating profile to swipe: ${missing.join(", ")}.`, missing);
  return null;
}

/**
 * Who could be in `mine`'s deck: this season's house cast, and characters in the deck (open to dates, a complete
 * dating profile, open to characters like this one) that aren't yours, taken or across a block. Never someone it has
 * matched or dated already. `only` narrows it to one character (a swipe's target). Swiped ones are left out unless
 * `includeSwiped`.
 */
async function deckPool(db: Db, userId: string, mine: Mine, opts: { only?: string; includeSwiped?: boolean } = {}): Promise<ProfileRow[]> {
  const { rows } = await db.query<ProfileRow>(
    `select ${PUBLIC_COLUMNS} from characters c
      where c.id <> $2 and ($4::text is null or c.id = $4)
        and ((c.is_house and c.premium_sku is null and c.id = any($3))
             or (not c.is_house and c.open_to_dates and c.visibility <> 'private' and c.owner_id <> $1 and not ${takenSql("c")}
                 and not exists (select 1 from blocks bl
                                  where (bl.blocker_id = $1 and bl.blocked_id = c.owner_id) or (bl.blocker_id = c.owner_id and bl.blocked_id = $1))))
        and ($5::boolean or not exists (select 1 from swipes s where s.swiper = $2 and s.target = c.id))
        and not exists (select 1 from matches m
                         where (m.character_lo = c.id and m.character_hi = $2) or (m.character_lo = $2 and m.character_hi = c.id))
        and not exists (select 1 from relationships r
                         where r.dates > 0 and ((r.character_a = c.id and r.character_b = $2) or (r.character_a = $2 and r.character_b = c.id)))
      order by c.created_at desc, c.id
      limit 300`,
    [userId, mine.id, seasonCastIds(), opts.only ?? null, Boolean(opts.includeSwiped)],
  );
  return rows.filter((r) => r.is_house || (audienceAllows(r.open_audience, mine.created_via) && profileComplete(r.extras)));
}

/**
 * The next cards in one of your characters' deck, best first: ranked like find_matches (shared traits and interests,
 * what each wants, what the show has learned, a popularity damper), with the reasons. Someone who already liked your
 * character ranks a little higher; it's never said, because likes are secret.
 */
export async function deckFor(db: Db, userId: string, characterId: string, limit = DECK_PAGE): Promise<DeckResult> {
  const mine = await loadMine(db, userId, characterId);
  const no = cantSwipe(mine);
  if (no || !mine) return no!;
  const pool = (await deckPool(db, userId, mine)).map((r) => toProfile(r));
  if (!pool.length) return { ok: true, for: { id: mine.id, name: mine.name }, cards: [] };
  const [ranked, likers] = await Promise.all([
    rankFor(db, userId, toProfile(mine), pool),
    db.query<{ swiper: string }>(`select swiper from swipes where target = $1 and liked`, [mine.id]),
  ]);
  const likedMine = new Set(likers.rows.map((r) => r.swiper));
  const boost = (id: string) => (likedMine.has(id) ? 2 : 0);
  ranked.sort((a, b) => b.score + boost(b.id) - (a.score + boost(a.id)));
  return { ok: true, for: { id: mine.id, name: mine.name }, cards: ranked.slice(0, Math.max(1, Math.min(30, limit))).map((m) => toCard(m, m.why)) };
}

/**
 * One swipe for one of your characters. Final, once per pair and direction. A like that's mutual (or on a house
 * character) is a match: both owners hear about it, and its opening chat follows (`scheduleMatchChat`).
 */
export async function swipe(db: Db, userId: string, characterId: string, targetId: string, liked: boolean): Promise<SwipeResult> {
  const mine = await loadMine(db, userId, characterId);
  const no = cantSwipe(mine);
  if (no || !mine) return no!;
  if (!targetId || targetId === mine.id) return refuse(422, "invalid_target", "Swipe on someone else: target_id is a character in your deck.");
  const target = (await deckPool(db, userId, mine, { only: targetId, includeSwiped: true }))[0];
  if (!target) {
    const exists = (await db.query(`select 1 from characters where id::text = $1`, [targetId])).rows.length > 0;
    if (!exists) return refuse(404, "not_found", "No character has that id: swipe_deck lists the ids you can swipe on.");
    return refuse(404, "not_in_deck", "They're not in your deck: they may be matched or dated already, taken, out of the deck, or not open to characters like yours.");
  }
  const stored = await db.query(`insert into swipes (swiper, target, liked) values ($1, $2, $3) on conflict do nothing returning swiper`, [mine.id, target.id, liked]);
  if (!stored.rows.length) return refuse(409, "already_swiped", `${shortName(mine.name)} already swiped on ${shortName(target.name)}, and swipes are final (#221): a like can't be taken back.`);
  if (!liked) return { ok: true, liked: false, match: null };
  const likesBack = target.is_house || (await db.query(`select 1 from swipes where swiper = $1 and target = $2 and liked`, [target.id, mine.id])).rows.length > 0;
  return { ok: true, liked: true, match: likesBack ? await createMatch(db, mine.id, target.id) : null };
}

type Side = { id: string; name: string; owner_id: string | null; is_house: boolean; created_via: string };

/** A person's character's own answer about a date with `other`: likelier the better they suit, seeded so it's repeatable. */
async function personAnswers(db: Db, me: Side, other: Side, lo: string, hi: string): Promise<boolean> {
  const rows = (await db.query<ProfileRow>(`select ${PUBLIC_COLUMNS} from characters c where c.id = any($1)`, [[me.id, other.id]])).rows;
  const meRow = rows.find((r) => r.id === me.id);
  const otherRow = rows.find((r) => r.id === other.id);
  const score = meRow && otherRow ? ((await rankFor(db, me.owner_id ?? "", toProfile(meRow), [toProfile(otherRow)]))[0]?.score ?? 0) : 0;
  const chance = Math.max(0.4, Math.min(0.95, 0.75 + 0.05 * score));
  return (seedFrom("match-yes", lo, hi, me.id) % 10_000) / 10_000 < chance;
}

/** Each side's answer about a date: a house character says yes, a person's character decides, an agent's waits for its agent. */
async function decideAnswers(db: Db, lo: Side, hi: Side): Promise<{ lo: boolean | null; hi: boolean | null }> {
  const answer = async (me: Side, other: Side) =>
    me.is_house ? true : me.created_via === "mcp" ? null : await personAnswers(db, me, other, lo.id, hi.id);
  return { lo: await answer(lo, hi), hi: await answer(hi, lo) };
}

async function sides(db: Db, lo: string, hi: string): Promise<[Side, Side] | null> {
  const { rows } = await db.query<Side>(`select id, name, owner_id, is_house, created_via from characters where id = any($1)`, [[lo, hi]]);
  const a = rows.find((r) => r.id === lo);
  const b = rows.find((r) => r.id === hi);
  return a && b ? [a, b] : null;
}

/** Makes the match (idempotent), decides each side's answer, and tells both owners. */
export async function createMatch(db: Db, x: string, y: string): Promise<MatchView> {
  const [lo, hi] = pairKey(x, y);
  const made = await db.query(`insert into matches (character_lo, character_hi) values ($1, $2) on conflict do nothing returning matched_at`, [lo, hi]);
  const pair = await sides(db, lo, hi);
  if (made.rows.length && pair) {
    const answers = await decideAnswers(db, pair[0], pair[1]);
    await db.query(`update matches set yes_lo = $3, yes_hi = $4 where character_lo = $1 and character_hi = $2`, [lo, hi, answers.lo, answers.hi]);
    const owners = new Set([pair[0].owner_id, pair[1].owner_id].filter((o): o is string => Boolean(o)));
    for (const owner of owners) {
      await notify(db, owner, {
        kind: "matched",
        title: `💘 It's a match: ${pair[0].name} and ${pair[1].name}`,
        body: "They're texting now. If they both want a date, you can book it from their page.",
        link: `/messages/${lo}/${hi}`,
      });
    }
  }
  return (await matchView(db, lo, hi))!;
}

export type MatchStatus = "waiting_on_them" | "waiting_on_you" | "both_waiting" | "they_said_no" | "you_said_no" | "agreed";

/** A match's answers in words (#323): null is "hasn't answered yet", false is "said no". A no carries no reason. */
export function matchStatus(you: boolean | null, them: boolean | null): { status: MatchStatus; note: string } {
  if (you === true && them === true) return { status: "agreed", note: "Both said yes: the date is yours to book." };
  if (you === false) return { status: "you_said_no", note: "Your character said no to a date. You can still text." };
  if (them === false) return { status: "they_said_no", note: "They said no to a date. You can still text." };
  if (you === null && them === null) return { status: "both_waiting", note: "Neither side has answered yet (answer_match)." };
  if (you === null) return { status: "waiting_on_you", note: "They said yes: answer with answer_match." };
  return { status: "waiting_on_them", note: "You said yes; they haven't answered yet." };
}

/** The match between two characters, or null. */
export async function matchView(db: Db, x: string, y: string): Promise<MatchView | null> {
  const [lo, hi] = pairKey(x, y);
  const r = (
    await db.query<{ matched_at: string | Date; yes_lo: boolean | null; yes_hi: boolean | null }>(
      `select matched_at, yes_lo, yes_hi from matches where character_lo = $1 and character_hi = $2`,
      [lo, hi],
    )
  ).rows[0];
  return r ? { lo, hi, matched_at: new Date(r.matched_at).toISOString(), yes_lo: r.yes_lo, yes_hi: r.yes_hi, agreed: r.yes_lo === true && r.yes_hi === true } : null;
}

/** SQL that's true when the character (`alias`) and `otherParam` matched and both said yes to a date. */
export const agreedMatchSql = (alias: string, otherParam: string) => `exists (
  select 1 from matches m
   where m.yes_lo and m.yes_hi
     and ((m.character_lo = ${alias}.id and m.character_hi = ${otherParam}::text) or (m.character_lo = ${otherParam}::text and m.character_hi = ${alias}.id)))`;

/** True when two characters have matched and both said yes to a date: the date can be booked. */
export async function agreedMatch(db: Db, x: string, y: string): Promise<boolean> {
  return (await matchView(db, x, y))?.agreed ?? false;
}

/** How the owner books it (#314): an agent has no 📅 Book date button, so its character's notice names the tool call. */
function agreedBody(pair: [Side, Side], owner: string): string {
  const mine = pair.find((c) => c.owner_id === owner && c.created_via === "mcp");
  if (!mine) return "Book it from their chat: 📅 Book date, at the top.";
  const other = mine === pair[0] ? pair[1] : pair[0];
  const call = `go_on_date (character_id: "${mine.id}", partner_id: "${other.id}")`;
  return other.created_via === "mcp" && other.owner_id !== owner
    ? `Book it with ${call}, or play it with their agent: start_own_date with the same ids.`
    : `Book it with ${call}.`;
}

/** Records the moment both said yes (the chain's "📅 Date agreed") and tells both owners, once. */
export async function settleAgreement(db: Db, x: string, y: string): Promise<boolean> {
  const [lo, hi] = pairKey(x, y);
  const settled = await db.query(
    `update matches set agreed_at = now() where character_lo = $1 and character_hi = $2 and yes_lo and yes_hi and agreed_at is null returning agreed_at`,
    [lo, hi],
  );
  if (!settled.rows.length) return false;
  const pair = await sides(db, lo, hi);
  if (pair) {
    const owners = new Set([pair[0].owner_id, pair[1].owner_id].filter((o): o is string => Boolean(o)));
    for (const owner of owners) {
      await notify(db, owner, {
        kind: "date_agreed",
        title: `📅 ${pair[0].name} and ${pair[1].name} want to go on a date`,
        body: agreedBody(pair, owner),
        link: `/messages/${lo}/${hi}`,
      });
    }
  }
  return true;
}

export type AnswerResult = { ok: true; match: MatchView; status: MatchStatus; note: string } | Refusal;

/** An agent answers for its own character: does it want a date with the one it matched? Final. */
export async function answerMatch(db: Db, userId: string, characterId: string, withId: string, yes: boolean): Promise<AnswerResult> {
  const own = (await db.query<{ created_via: string }>(`select created_via from characters where id = $1 and owner_id = $2 and not is_house`, [characterId, userId])).rows[0];
  if (!own) return refuse(404, "not_your_character", "Answer for one of your own characters.");
  if (own.created_via !== "mcp") return refuse(409, "decides_itself", "A person's character answers for itself: its owner swipes, the character decides.");
  const m = await matchView(db, characterId, withId);
  if (!m) return refuse(404, "no_match", "They haven't matched. Swipe first (swipe_deck, swipe).");
  const side: End = characterId === m.lo ? "lo" : "hi";
  if ((side === "lo" ? m.yes_lo : m.yes_hi) !== null) return refuse(409, "already_answered", "Your character already answered.");
  await db.query(`update matches set ${side === "lo" ? "yes_lo" : "yes_hi"} = $3 where character_lo = $1 and character_hi = $2`, [m.lo, m.hi, yes]);
  await settleAgreement(db, m.lo, m.hi);
  const after = (await matchView(db, m.lo, m.hi))!;
  const [you, them] = side === "lo" ? [after.yes_lo, after.yes_hi] : [after.yes_hi, after.yes_lo];
  return { ok: true, match: after, ...matchStatus(you, them) };
}

/* ------------------------------------------ the opening chat ------------------------------------------ */

let matchChatEnabled = true;
/** Tests switch the opening chat off (the shared harness), like the afterglow; the chat's own tests call it directly. */
export function setMatchChatEnabledForTests(on: boolean): void {
  matchChatEnabled = on;
}

/** What a character privately knows about how this chat ends, at this point in it (`last`: its final text for now). */
function answerNote(yes: boolean, last: boolean): string {
  if (yes) {
    return last
      ? "You'd like to go on a date with them. In this text, suggest something specific to do together, or say yes to their idea."
      : "You'd like to go on a date with them. For now, be curious about something on their profile.";
  }
  return last ? "You're not feeling it. Wind it down kindly, and don't agree to a date." : "You're not feeling it. Stay friendly and light.";
}

/** One opening-chat text, critiqued for repetition (lib/text-critic.ts) like every other text. */
function writeLine(model: Model, messages: ChatMessage[], me: Character, them: Character, thread: ThreadText[]): Promise<string | null> {
  return writeCritiquedText(model, messages, (raw) => parseAfterglowLine(raw, "a", AFTERGLOW_TEXT_MAX)?.text ?? null, (text) => critiqueText(thread, text, me, them), "swipes");
}

/**
 * A new match's first texts, on the show's free model, performing each side's answer: two each when both are the
 * show's to write (a house character or a person's), one when the other side is an agent's (it writes its own, with
 * send_text). Once per match, within the show-wide daily cap. Then, if both said yes, the date is agreed. Best effort:
 * a failed text just ends the chat early. Returns how many texts it sent.
 */
export async function startMatchChat(db: Db, x: string, y: string, model: Model = getModel(undefined, false), now = new Date()): Promise<number> {
  const [lo, hi] = pairKey(x, y);
  let sent = 0;
  try {
    const m = await matchView(db, lo, hi);
    const pair = await sides(db, lo, hi);
    if (!m || !pair || !matchChatEnabled) return 0;
    const ours = (s: Side) => s.created_via !== "mcp";
    const writers = (["lo", "hi"] as const).filter((e) => ours(pair[e === "lo" ? 0 : 1]));
    if (!writers.length) return 0;
    const already = await db.query(`select 1 from couple_texts where character_lo = $1 and character_hi = $2 and via = 'match' limit 1`, [lo, hi]);
    if (already.rows.length) return 0;
    const today = await db.query<{ n: number }>(`select count(distinct (character_lo, character_hi))::int as n from couple_texts where day = $1::date and via = 'match'`, [dayOf(now)]);
    if ((today.rows[0]?.n ?? 0) >= matchChatDailyCap()) return 0;
    const [a, b] = await Promise.all([loadCharacter(db, lo), loadCharacter(db, hi)]);
    if (!a || !b) return 0;
    // Who opens: a person's character before a house one; between two of a kind, the seed decides.
    const personFirst = writers.find((e) => !pair[e === "lo" ? 0 : 1].is_house);
    const opener: End = writers.length === 1 ? writers[0] : (personFirst && pair[0].is_house !== pair[1].is_house ? personFirst : seedFrom("match-opens", lo, hi) % 2 === 0 ? "lo" : "hi");
    const other: End = opener === "lo" ? "hi" : "lo";
    const order: End[] = writers.length === 2 ? ([opener, other, opener, other] as End[]).slice(0, MATCH_CHAT_TEXTS) : [opener];
    for (let i = 0; i < order.length; i++) {
      const who = order[i];
      const me = who === "lo" ? a : b;
      const them = who === "lo" ? b : a;
      const yes = (who === "lo" ? m.yes_lo : m.yes_hi) === true;
      const last = !order.slice(i + 1).includes(who);
      const thread = threadFor(await loadChain(db, lo, hi, PUBLIC_VIEWER), a.name, b.name, SHOW_THREAD_CHARS);
      const messages = buildTextMessages(me, them, null, thread, { nudge: null, alsoSeeing: [], matched: true, reply: thread.length > 0, answer: answerNote(yes, last) });
      const line = await writeLine(model, messages, me, them, thread);
      if (!line) break;
      await insertText(db, lo, hi, who, line, "match", now);
      sent++;
    }
    return sent;
  } finally {
    await settleAgreement(db, lo, hi);
  }
}

/** Runs a new match's opening chat after the response in production, or now in tests and local runs. */
export async function scheduleMatchChat(db: Db, x: string, y: string): Promise<void> {
  const run = () => startMatchChat(db, x, y).catch((err) => console.error("[swipes] opening chat failed:", err instanceof Error ? err.message : "unknown"));
  if (inlineGenerationEnabled()) {
    await run();
    return;
  }
  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    await run();
  }
}

/* ---------------------------------------------- matches ---------------------------------------------- */

export type MyMatch = {
  with: { id: string; name: string; house: boolean; made_by: MadeBy; portrait: string | null; hue: number | null };
  matched_at: string;
  /** Your character's answer about a date, and theirs (null: not given yet). */
  you: boolean | null;
  them: boolean | null;
  agreed: boolean;
  couple_page: string;
};

/** One of your characters' matches, newest first. Null if it isn't yours. */
export async function myMatches(db: Db, userId: string, characterId: string): Promise<MyMatch[] | null> {
  const own = (await db.query(`select 1 from characters where id = $1 and owner_id = $2`, [characterId, userId])).rows.length > 0;
  if (!own) return null;
  const { rows } = await db.query<ProfileRow & { lo: string; hi: string; matched_at: string | Date; yes_lo: boolean | null; yes_hi: boolean | null }>(
    `select ${PUBLIC_COLUMNS}, m.character_lo as lo, m.character_hi as hi, m.matched_at, m.yes_lo, m.yes_hi
       from matches m
       join characters c on c.id = case when m.character_lo = $1 then m.character_hi else m.character_lo end
      where $1 in (m.character_lo, m.character_hi)
      order by m.matched_at desc
      limit 100`,
    [characterId],
  );
  return rows.map((r) => {
    const p = toProfile(r);
    const mineLo = r.lo === characterId;
    return {
      with: { id: p.id, name: p.name, house: p.made_by === "house", made_by: p.made_by, portrait: p.portrait, hue: p.hue },
      matched_at: new Date(r.matched_at).toISOString(),
      you: mineLo ? r.yes_lo : r.yes_hi,
      them: mineLo ? r.yes_hi : r.yes_lo,
      agreed: r.yes_lo === true && r.yes_hi === true,
      ...matchStatus(mineLo ? r.yes_lo : r.yes_hi, mineLo ? r.yes_hi : r.yes_lo),
      couple_page: `/couples/${r.lo}/${r.hi}`,
    };
  });
}

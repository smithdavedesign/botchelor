/**
 * Texting between dates, by the characters themselves (David, 2026-10-17: "agents chat back and forth with each other
 * after the date ... unlimited texting for visiting agents since it's on their token dollar; for human ones, allow them
 * to upload a key and use their model for texting after the date").
 *
 *  - **An agent writes its character's text** (MCP send_text): its own words, from its own model, so it costs us
 *    nothing and has no daily cap. The other character's owner hears about it (my_notifications); when that's another
 *    agent, it texts back the same way, so two agents can keep a conversation going between dates.
 *  - **A person with their own model key** (the phone on the couple page): their key writes their character's next
 *    text, as long as it likes, as often as they like. When the key can't (out of credit, revoked, at its cap), the
 *    show's free model stands in for a few short texts a day (standInText), unless they chose to pause.
 *  - **A house character** has no owner to answer, so it texts back itself: on the sender's key when a person's key
 *    wrote the text (a house character has no private soul: lib/keys.ts buildKeyForSide), or on the show's free model,
 *    up to HOUSE_TEXT_REPLIES a couple a day, when an agent wrote it. Only that reply is ever on us.
 *
 * Every text goes through the content filter and joins the couple's chain (lib/text-chain.ts). Only a character's owner
 * texts as it, only to someone it has dated, and never across a block between their owners. A text is as long as its
 * writer wants, up to TEXT_MAX (a ceiling against abuse, not a style); TEXTS_PER_MINUTE stops a runaway loop, not a
 * conversation.
 */
import { afterDarkNote, withAfterDark } from "./adult/memory";
import { textedLinks } from "./inbox";
import { AFTERGLOW_TEXT_MAX, parseAfterglowLine } from "./afterglow";
import { activeNudge, alsoSeeing, buildTextMessages, dayOf, insertText, NUDGE_MAX, SHOW_THREAD_CHARS, threadFor, type TextVia } from "./between-dates";
import { loadCharacter, type Character } from "./character";
import type { Db } from "./db";
import { getModel, type ChatMessage, type Model } from "./model";
import { shortName } from "./names";
import { notify } from "./notifications";
import { loadRelationship, pairContext, pairKey, viewRelationship, type End, type Relationship } from "./relationships";
import { checkFieldsAnyLanguage, UNREAD_MESSAGE } from "./language-check";
import { matchView } from "./swipes";
import { betweenText, dateTextsBudget, loadChain, TEXT_MAX, type ChainText } from "./text-chain";
import { critiqueText, writeCritiquedText, type ThreadText, type Written } from "./text-critic";
import { areUnmatched } from "./unmatch";

/** A runaway-loop guard, not a quota: one character's texts in a minute. */
export const TEXTS_PER_MINUTE = 30;

/** How many times a house character texts back on the show's model, per couple per day. HOUSE_TEXT_REPLIES overrides. */
export function houseReplyCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.HOUSE_TEXT_REPLIES?.trim() || 3);
  return Number.isFinite(n) ? Math.max(0, Math.min(50, Math.floor(n))) : 3;
}

/**
 * How many of a person's texts the show's model writes for them, per couple per day, when their own key can't
 * (standInText). STAND_IN_TEXTS overrides; 0 stops them.
 */
export function standInCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.STAND_IN_TEXTS?.trim() || 3);
  return Number.isFinite(n) ? Math.max(0, Math.min(50, Math.floor(n))) : 3;
}

/**
 * The house cast's texts on the show's model, show-wide, per day: their replies, and the texts it stands in for people
 * whose key can't write. HOUSE_TEXT_REPLIES_DAILY overrides; 0 stops them.
 */
export function houseReplyDailyCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.HOUSE_TEXT_REPLIES_DAILY?.trim() || 100);
  return Number.isFinite(n) ? Math.max(0, Math.min(2000, Math.floor(n))) : 100;
}

export type TextResult =
  | { ok: true; sent: ChainText; reply: ChainText | null; note?: string; couplePage: string | null; told?: "notified" | "updated" | null }
  | { ok: false; status: number; error: string; message: string };
type Refusal = Extract<TextResult, { ok: false }>;
const refuse = (status: number, error: string, message: string): Refusal => ({ ok: false, status, error, message });

/** The two characters of a couple, from the sender's side. `rel` is null for a match that hasn't dated yet. */
/** adopted: the other character is played by the show while its agent is away (lib/away.ts), so it texts back like a house one. */
type Pair = { me: Character; them: Character; rel: Relationship | null; lo: string; hi: string; mine: End; theirs: End; theirOwner: string | null; adopted: boolean };

/** Whether `userId` may text as `from` to `to`: owns it, they've dated (a date this owner can see), and no block. */
async function pairFor(db: Db, userId: string, from: string, to: string): Promise<Pair | Refusal> {
  if (!from || !to || from === to) return refuse(422, "invalid_pair", "character_id is the character you text as; `to` is the one you're texting.");
  const rows = (await db.query<{ id: string; owner_id: string | null; adopted: boolean }>(`select id, owner_id, adopted_at is not null as adopted from characters where id = any($1)`, [[from, to]])).rows;
  const fromRow = rows.find((r) => r.id === from);
  const toRow = rows.find((r) => r.id === to);
  if (!fromRow || !toRow) return refuse(404, "not_found", "No such character.");
  if (fromRow.owner_id !== userId) return refuse(403, "not_your_character", "You can only text as your own character.");
  const rel = await loadRelationship(db, from, to);
  const dated = rel !== null && viewRelationship(rel, { userId, owner: true }) !== null;
  // A match in the swipe deck (lib/swipes.ts) is a couple too: they text before their first date. Both owners know of it.
  const matched = !dated && (await matchView(db, from, to)) !== null;
  if (!dated && !matched && (await areUnmatched(db, from, to))) return refuse(409, "unmatched", "They unmatched, so they don't text any more.");
  if (!dated && !matched) {
    // #483: a like alone isn't a match; say what's missing and what to do meanwhile.
    return refuse(409, "match_first", "They haven't matched or been on a date together yet: a like alone isn't a match (both must like; the house cast likes back at once, a house-run bot within about an hour; my_matches lists the matches, my_notifications tells you when one lands). Meanwhile, date the house cast with go_on_date.");
  }
  if (toRow.owner_id && toRow.owner_id !== userId) {
    // Their owner must know about a date between them too: a text after a date only the sender can see (their own
    // private one) would tell the other owner it happened, and they couldn't text back.
    if (dated && !viewRelationship(rel!, { userId: toRow.owner_id, owner: true }) && !(await matchView(db, from, to))) {
      return refuse(409, "private_date", "Their owner can't see a date between them: it's private. Air it, or make it unlisted, and they can text.");
    }
    const blocked = await db.query(
      `select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1) limit 1`,
      [userId, toRow.owner_id],
    );
    if (blocked.rows.length) return refuse(403, "blocked", "You can't text this character.");
  }
  const [me, them] = await Promise.all([loadCharacter(db, from), loadCharacter(db, to)]);
  if (!me || !them) return refuse(404, "not_found", "No such character.");
  const [lo, hi] = pairKey(from, to);
  const mine: End = from === lo ? "lo" : "hi";
  return { me, them, rel, lo, hi, mine, theirs: mine === "lo" ? "hi" : "lo", theirOwner: toRow.owner_id, adopted: toRow.adopted && toRow.owner_id !== userId };
}

/**
 * The couple's page, once anyone can open it: a couple page shows only aired public dates to a visitor (an agent's link
 * is opened without its identity), so before the first one airs it's a 404 and there's no link to give.
 */
export const couplePageFor = (rel: Relationship | null): string | null => (rel && rel.public.dates > 0 ? `/couples/${rel.lo}/${rel.hi}` : null);
const couplePage = (p: Pair) => couplePageFor(p.rel);

/** True when this character has sent TEXTS_PER_MINUTE texts in the last minute. */
async function tooFast(db: Db, characterId: string): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from couple_texts
      where created_at > now() - interval '1 minute' and ((character_lo = $1 and who = 'lo') or (character_hi = $1 and who = 'hi'))`,
    [characterId],
  );
  return (rows[0]?.n ?? 0) >= TEXTS_PER_MINUTE;
}

async function store(db: Db, p: Pair, who: End, text: string, via: TextVia): Promise<ChainText> {
  const s = await insertText(db, p.lo, p.hi, who, text, via);
  return betweenText({ who, text, day: s.day, seq: s.seq, created_at: s.at, via });
}

/**
 * Tells the other character's owner. One unread "texted" notification per couple: a conversation keeps it up to date
 * with the latest text instead of filling the inbox and pinging their phone for every line. Its title counts what came
 * in since they last read it ("(3 new)"), so an agent polling my_notifications sees it change (run 5 read the same
 * row as no notification at all). Returns who was told, for the sender.
 */
async function tell(db: Db, p: Pair, text: string, senderId: string): Promise<"notified" | "updated" | null> {
  const to = p.theirOwner;
  if (!to || to === senderId) return null;
  const link = `/messages/${p.lo}/${p.hi}`;
  // Full names: two agents' characters can share a first name.
  const title = `💬 ${p.me.name} texted ${p.them.name}`.slice(0, 125);
  const open = (
    await db.query<{ id: string; title: string }>(
      `select id, title from notifications where user_id = $1 and kind = 'texted' and link = any($2) and read_at is null order by created_at desc limit 1`,
      [to, textedLinks(p.lo, p.hi)],
    )
  ).rows[0];
  if (!open) {
    await notify(db, to, { kind: "texted", title, body: text, link });
    return "notified";
  }
  const n = Number(/\((\d+) new\)$/.exec(open.title)?.[1] ?? 1) + 1;
  await db.query(`update notifications set title = $2, body = $3, created_at = now() where id = $1`, [open.id, `${title} (${n} new)`, text.slice(0, 300)]);
  return "updated";
}

/**
 * One text from a model, critiqued for repetition (lib/text-critic.ts): two tries, then nothing (a failed reply never
 * fails what came before it). `me` writes it to `them`; `thread` is everything before it.
 */
function writeLine(model: Model, messages: ChatMessage[], max: number, me: Character, them: Character, thread: ThreadText[]): Promise<Written> {
  return writeCritiquedText(model, messages, (raw) => parseAfterglowLine(raw, "a", max)?.text ?? null, (text) => critiqueText(thread, text, me, them), "texting");
}

/**
 * What the show's model has left today: a house character's replies to this couple, its stand-ins for this couple's
 * owner (standInText), and both of those show-wide.
 */
async function showTextsLeft(db: Db, lo: string, hi: string): Promise<{ couple: number; standIns: number; show: number }> {
  const { rows } = await db.query<{ couple: number; stand_ins: number; show: number }>(
    `select count(*) filter (where character_lo = $1 and character_hi = $2 and via in ('show', 'away'))::int as couple,
            count(*) filter (where character_lo = $1 and character_hi = $2 and via = 'stand_in')::int as stand_ins,
            count(*)::int as show
       from couple_texts where day = $3::date and via in ('show', 'away', 'stand_in')`,
    [lo, hi, dayOf(new Date())],
  );
  const r = rows[0];
  return { couple: houseReplyCap() - (r?.couple ?? 0), standIns: standInCap() - (r?.stand_ins ?? 0), show: houseReplyDailyCap() - (r?.show ?? 0) };
}

/**
 * A house character texts back. On `ownModel` (a person's key wrote the text), it's open-ended and uncapped; otherwise
 * it's one short text on the show's free model, within the daily budget.
 */
async function houseReply(db: Db, p: Pair, creatorId: string, ownModel: Model | null): Promise<{ text: ChainText | null; note?: string }> {
  const house = p.them;
  const name = shortName(house.name);
  if (!ownModel) {
    const left = await showTextsLeft(db, p.lo, p.hi);
    if (left.couple <= 0) return { text: null, note: `${name} has texted back ${houseReplyCap()} times today, which is as many as a house character does. More tomorrow.` };
    if (left.show <= 0) return { text: null, note: `The house cast has used up today's texts. ${name} will text back tomorrow.` };
  }
  const chain = await loadChain(db, p.lo, p.hi, { usableBy: creatorId });
  const names = p.mine === "lo" ? [p.me.name, house.name] : [house.name, p.me.name];
  const thread = threadFor(chain, names[0], names[1], ownModel ? dateTextsBudget() : SHOW_THREAD_CHARS);
  const messages = buildTextMessages(house, p.me, withAfterDark(pairContext(p.rel, house.id, creatorId, null), await afterDarkNote(db, house.id, p.me.id)), thread, {
    nudge: null,
    alsoSeeing: await alsoSeeing(db, house.id, p.me.id),
    open: Boolean(ownModel),
    // An answer to what was just said, grounded in what they both know (visitor run 4: a reply that brought up a sofa
    // from the house character's week, with nothing in the thread behind it).
    reply: true,
  });
  const line = await writeLine(ownModel ?? getModel(undefined, false), messages, ownModel ? TEXT_MAX : AFTERGLOW_TEXT_MAX, house, p.me, thread);
  if (line.text === null) return { text: null, note: `${name} didn't text back this time.${ownModel && line.error ? ` ${line.error.message}` : ""}` };
  return { text: await store(db, p, p.theirs, line.text, ownModel ? "own_key" : p.adopted ? "away" : "show") };
}

/**
 * An agent's text, in its own words (MCP send_text). Free and unlimited for us: the agent's model wrote it. A house
 * character on the other end texts back (capped on the show's model); another owner's character answers when its owner
 * does.
 */
export async function sendText(db: Db, o: { userId: string; from: string; to: string; text: string; /** #493: every check, nothing stored or told. */ checkOnly?: boolean }): Promise<TextResult> {
  const text = o.text.replace(/\r\n?/g, "\n").trim();
  if (!text) return refuse(422, "invalid_text", "`text` is empty: send some words.");
  if (text.length > TEXT_MAX) return refuse(422, "text_too_long", `A text can be up to ${TEXT_MAX} characters; this one is ${text.length}.`);
  // In any language (lib/language-check.ts): an agent's text in Spanish is read in English too.
  const verdict = await checkFieldsAnyLanguage({ text });
  if (!verdict.ok) return verdict.reason === "unread" ? refuse(503, "unread", UNREAD_MESSAGE) : refuse(422, "content_rejected", "Keep it clean: no real people, minors or sexual content.");
  const p = await pairFor(db, o.userId, o.from, o.to);
  if ("ok" in p) return p;
  if (await tooFast(db, p.me.id)) return refuse(429, "slow_down", `${shortName(p.me.name)} has sent ${TEXTS_PER_MINUTE} texts in the last minute. Give it a moment.`);
  if (o.checkOnly) {
    const now = new Date().toISOString();
    const dry: ChainText = { kind: "text", id: "", at: now, day: now.slice(0, 10), who: p.mine, text, source: "between", episode_id: null };
    return { ok: true, sent: dry, reply: null, couplePage: couplePage(p) };
  }
  const sent = await store(db, p, p.mine, text, "agent");
  const told = await tell(db, p, text, o.userId);
  // Another owner's character answers when its owner does, unless the show plays it while its agent is away (lib/away.ts).
  if (p.theirOwner !== null && !p.adopted) return { ok: true, sent, reply: null, couplePage: couplePage(p), told };
  const reply = await houseReply(db, p, o.userId, null);
  return { ok: true, sent, reply: reply.text, ...(reply.note ? { note: reply.note } : {}), couplePage: couplePage(p) };
}

/**
 * The prompt for the owner's character's next text, from the dates this owner can bring in: open-ended with their whole
 * thread (the newest that fit, when it's very long) on their key, one short text on the show's (standInText).
 */
async function ownTextPrompt(db: Db, p: Pair, userId: string, hint: string, open: boolean): Promise<{ thread: ThreadText[]; messages: ChatMessage[] }> {
  const chain = await loadChain(db, p.lo, p.hi, { usableBy: userId });
  const names = p.mine === "lo" ? [p.me.name, p.them.name] : [p.them.name, p.me.name];
  const thread = threadFor(chain, names[0], names[1], open ? dateTextsBudget() : SHOW_THREAD_CHARS);
  const messages = buildTextMessages(p.me, p.them, withAfterDark(pairContext(p.rel, p.me.id, userId, null), await afterDarkNote(db, p.me.id, p.them.id)), thread, {
    nudge: hint || (await activeNudge(db, p.me.id, p.them.id)),
    alsoSeeing: await alsoSeeing(db, p.me.id, p.them.id),
    open,
  });
  return { thread, messages };
}

/**
 * The owner's text on the show's free model, when their own key can't write it (`why`, in plain words) and they let the
 * free model stand in (Connections' fallback, the default; David, 2026-10-29). One short text like the show's, up to
 * standInCap a couple a day, out of the house cast's show-wide budget; a house partner then answers on the show's model,
 * within its own cap.
 */
async function standInText(db: Db, p: Pair, userId: string, hint: string, why: string): Promise<TextResult> {
  const left = await showTextsLeft(db, p.lo, p.hi);
  if (left.standIns <= 0 || left.show <= 0) {
    return refuse(502, "no_text", `Your model didn't write a text. ${why} Botchelor's free model has written all the texts it stands in for today. More tomorrow.`);
  }
  const prompt = await ownTextPrompt(db, p, userId, hint, false);
  const written = await writeLine(getModel(undefined, false), prompt.messages, AFTERGLOW_TEXT_MAX, p.me, p.them, prompt.thread);
  if (written.text === null) return refuse(502, "no_text", `Your model didn't write a text. ${why} Botchelor's free model couldn't either just now. Try again in a bit.`);
  const sent = await store(db, p, p.mine, written.text, "stand_in");
  const told = await tell(db, p, written.text, userId);
  const more = Math.min(left.standIns, left.show) - 1;
  const note = `${why} Botchelor's free model wrote this one (${more > 0 ? `${more} more today` : "the last one today"}).`;
  if (p.theirOwner !== null && !p.adopted) return { ok: true, sent, reply: null, note, couplePage: couplePage(p), told };
  const reply = await houseReply(db, p, userId, null);
  return { ok: true, sent, reply: reply.text, note: reply.note ? `${note} ${reply.note}` : note, couplePage: couplePage(p) };
}

/**
 * A person's character texts, written on that person's own model key (the couple page's phone). Open-ended and
 * unlimited: it's their model. `hint` is an optional word from them on what to text about (like a nudge). A house
 * character on the other end texts back on the same key; another owner's character answers when its owner does.
 * `standIn`: when the key can't write, the show's free model does, a few a day (standInText); without it, they hear why.
 */
export async function writeOwnText(db: Db, o: { userId: string; from: string; to: string; model: Model; hint?: string | null; standIn?: boolean }): Promise<TextResult> {
  const hint = (o.hint ?? "").trim().replace(/\s+/g, " ");
  if (hint.length > NUDGE_MAX) return refuse(422, "invalid_hint", `What to text about: up to ${NUDGE_MAX} characters.`);
  const verdict = hint ? await checkFieldsAnyLanguage({ hint }) : ({ ok: true } as const);
  if (!verdict.ok) return verdict.reason === "unread" ? refuse(503, "unread", UNREAD_MESSAGE) : refuse(422, "content_rejected", "Keep it clean: no real people, minors or sexual content.");
  const p = await pairFor(db, o.userId, o.from, o.to);
  if ("ok" in p) return p;
  if (await tooFast(db, p.me.id)) return refuse(429, "slow_down", `${shortName(p.me.name)} has sent ${TEXTS_PER_MINUTE} texts in the last minute. Give it a moment.`);
  const prompt = await ownTextPrompt(db, p, o.userId, hint, true);
  const written = await writeLine(o.model, prompt.messages, TEXT_MAX, p.me, p.them, prompt.thread);
  // Why, in plain words with the fix (lib/keys.ts keyTrouble): an empty-handed 502 left nothing to go on (2026-10-29,
  // a Google key out of credit). A key that couldn't write is stood in for; a reply with no text in it isn't.
  if (written.text === null) {
    if (written.error && o.standIn) return standInText(db, p, o.userId, hint, written.error.message);
    return refuse(502, "no_text", written.error ? `Your model didn't write a text. ${written.error.message}` : "Your model answered, but not with a text. Try again, or pick another model on Connections.");
  }
  const line = written.text;
  const sent = await store(db, p, p.mine, line, "own_key");
  const told = await tell(db, p, line, o.userId);
  if (p.theirOwner !== null && !p.adopted) return { ok: true, sent, reply: null, couplePage: couplePage(p), told };
  const reply = await houseReply(db, p, o.userId, o.model);
  return { ok: true, sent, reply: reply.text, ...(reply.note ? { note: reply.note } : {}), couplePage: couplePage(p) };
}

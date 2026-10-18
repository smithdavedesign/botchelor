/**
 * Texting between dates, by the characters themselves (David, 2026-10-17: "agents chat back and forth with each other
 * after the date ... unlimited texting for visiting agents since it's on their token dollar; for human ones, allow them
 * to upload a key and use their model for texting after the date").
 *
 *  - **An agent writes its character's text** (MCP send_text): its own words, from its own model, so it costs us
 *    nothing and has no daily cap. The other character's owner hears about it (my_notifications); when that's another
 *    agent, it texts back the same way, so two agents can keep a conversation going between dates.
 *  - **A person with their own model key** (the phone on the couple page): their key writes their character's next
 *    text, as long as it likes, as often as they like.
 *  - **A house character** has no owner to answer, so it texts back itself: on the sender's key when a person's key
 *    wrote the text (a house character has no private soul: lib/keys.ts buildKeyForSide), or on the show's free model,
 *    up to HOUSE_TEXT_REPLIES a couple a day, when an agent wrote it. Only that reply is ever on us.
 *
 * Every text goes through the content filter and joins the couple's chain (lib/text-chain.ts). Only a character's owner
 * texts as it, only to someone it has dated, and never across a block between their owners. A text is as long as its
 * writer wants, up to TEXT_MAX (a ceiling against abuse, not a style); TEXTS_PER_MINUTE stops a runaway loop, not a
 * conversation.
 */
import { AFTERGLOW_TEXT_MAX, parseAfterglowLine } from "./afterglow";
import { activeNudge, alsoSeeing, buildTextMessages, dayOf, insertText, NUDGE_MAX, SHOW_THREAD_CHARS, threadFor, type TextVia } from "./between-dates";
import { loadCharacter, type Character } from "./character";
import type { Db } from "./db";
import { getModel, ModelError, type ChatMessage, type Model } from "./model";
import { shortName } from "./names";
import { notify } from "./notifications";
import { loadRelationship, pairContext, pairKey, viewRelationship, type End, type Relationship } from "./relationships";
import { checkFields } from "./safety";
import { matchView } from "./swipes";
import { betweenText, dateTextsBudget, loadChain, TEXT_MAX, type ChainText } from "./text-chain";

/** A runaway-loop guard, not a quota: one character's texts in a minute. */
export const TEXTS_PER_MINUTE = 30;

/** How many times a house character texts back on the show's model, per couple per day. HOUSE_TEXT_REPLIES overrides. */
export function houseReplyCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.HOUSE_TEXT_REPLIES?.trim() || 3);
  return Number.isFinite(n) ? Math.max(0, Math.min(50, Math.floor(n))) : 3;
}

/** The house cast's replies on the show's model, show-wide, per day. HOUSE_TEXT_REPLIES_DAILY overrides; 0 stops them. */
export function houseReplyDailyCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.HOUSE_TEXT_REPLIES_DAILY?.trim() || 100);
  return Number.isFinite(n) ? Math.max(0, Math.min(2000, Math.floor(n))) : 100;
}

export type TextResult =
  | { ok: true; sent: ChainText; reply: ChainText | null; note?: string; couplePage: string | null }
  | { ok: false; status: number; error: string; message: string };
type Refusal = Extract<TextResult, { ok: false }>;
const refuse = (status: number, error: string, message: string): Refusal => ({ ok: false, status, error, message });

/** The two characters of a couple, from the sender's side. `rel` is null for a match that hasn't dated yet. */
type Pair = { me: Character; them: Character; rel: Relationship | null; lo: string; hi: string; mine: End; theirs: End; theirOwner: string | null };

/** Whether `userId` may text as `from` to `to`: owns it, they've dated (a date this owner can see), and no block. */
async function pairFor(db: Db, userId: string, from: string, to: string): Promise<Pair | Refusal> {
  if (!from || !to || from === to) return refuse(422, "invalid_pair", "character_id is the character you text as; `to` is the one you're texting.");
  const rows = (await db.query<{ id: string; owner_id: string | null }>(`select id, owner_id from characters where id = any($1)`, [[from, to]])).rows;
  const fromRow = rows.find((r) => r.id === from);
  const toRow = rows.find((r) => r.id === to);
  if (!fromRow || !toRow) return refuse(404, "not_found", "No such character.");
  if (fromRow.owner_id !== userId) return refuse(403, "not_your_character", "You can only text as your own character.");
  const rel = await loadRelationship(db, from, to);
  const dated = rel !== null && viewRelationship(rel, { userId, owner: true }) !== null;
  // A match in the swipe deck (lib/swipes.ts) is a couple too: they text before their first date. Both owners know of it.
  const matched = !dated && (await matchView(db, from, to)) !== null;
  if (!dated && !matched) {
    return refuse(404, "not_a_couple", "They haven't matched or been on a date together yet. Text someone your character has matched (swipe) or dated.");
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
  return { me, them, rel, lo, hi, mine, theirs: mine === "lo" ? "hi" : "lo", theirOwner: toRow.owner_id };
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
  return betweenText({ who, text, day: s.day, seq: s.seq, created_at: s.at });
}

/**
 * Tells the other character's owner. One unread "texted" notification per couple: a conversation keeps it up to date
 * with the latest text instead of filling the inbox and pinging their phone for every line.
 */
async function tell(db: Db, p: Pair, text: string, senderId: string): Promise<void> {
  const to = p.theirOwner;
  if (!to || to === senderId) return;
  const link = `/couples/${p.lo}/${p.hi}#texts`;
  // Full names: two agents' characters can share a first name.
  const title = `💬 ${p.me.name} texted ${p.them.name}`;
  const updated = await db.query(
    `update notifications set title = $3, body = $4, created_at = now() where user_id = $1 and kind = 'texted' and link = $2 and read_at is null returning id`,
    [to, link, title.slice(0, 140), text.slice(0, 300)],
  );
  if (!updated.rows.length) await notify(db, to, { kind: "texted", title, body: text, link });
}

/** One text from a model: two tries, then nothing (a failed reply never fails what came before it). */
async function writeLine(model: Model, messages: ChatMessage[], max: number): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const line = parseAfterglowLine(await model.complete(messages, { temperature: 0.9 }), "a", max);
      if (line) return line.text;
    } catch (err) {
      if (!(err instanceof ModelError)) console.error("[texting] model call failed:", err instanceof Error ? err.message : "unknown");
    }
  }
  return null;
}

/** How many replies a house character has left today on the show's model: for this couple, and show-wide. */
async function houseRepliesLeft(db: Db, lo: string, hi: string): Promise<{ couple: number; show: number }> {
  const { rows } = await db.query<{ couple: number; show: number }>(
    `select (select count(*)::int from couple_texts where character_lo = $1 and character_hi = $2 and day = $3::date and via = 'show') as couple,
            (select count(*)::int from couple_texts where day = $3::date and via = 'show') as show`,
    [lo, hi, dayOf(new Date())],
  );
  return { couple: houseReplyCap() - (rows[0]?.couple ?? 0), show: houseReplyDailyCap() - (rows[0]?.show ?? 0) };
}

/**
 * A house character texts back. On `ownModel` (a person's key wrote the text), it's open-ended and uncapped; otherwise
 * it's one short text on the show's free model, within the daily budget.
 */
async function houseReply(db: Db, p: Pair, creatorId: string, ownModel: Model | null): Promise<{ text: ChainText | null; note?: string }> {
  const house = p.them;
  const name = shortName(house.name);
  if (!ownModel) {
    const left = await houseRepliesLeft(db, p.lo, p.hi);
    if (left.couple <= 0) return { text: null, note: `${name} has texted back ${houseReplyCap()} times today, which is as many as a house character does. More tomorrow.` };
    if (left.show <= 0) return { text: null, note: `The house cast has used up today's texts. ${name} will text back tomorrow.` };
  }
  const chain = await loadChain(db, p.lo, p.hi, { usableBy: creatorId });
  const names = p.mine === "lo" ? [p.me.name, house.name] : [house.name, p.me.name];
  const thread = threadFor(chain, names[0], names[1], ownModel ? dateTextsBudget() : SHOW_THREAD_CHARS);
  const messages = buildTextMessages(house, p.me, pairContext(p.rel, house.id, creatorId, null), thread, {
    nudge: null,
    alsoSeeing: await alsoSeeing(db, house.id, p.me.id),
    open: Boolean(ownModel),
    // An answer to what was just said, grounded in what they both know (visitor run 4: a reply that brought up a sofa
    // from the house character's week, with nothing in the thread behind it).
    reply: true,
  });
  const line = await writeLine(ownModel ?? getModel(undefined, false), messages, ownModel ? TEXT_MAX : AFTERGLOW_TEXT_MAX);
  if (!line) return { text: null, note: `${name} didn't text back this time.` };
  return { text: await store(db, p, p.theirs, line, ownModel ? "own_key" : "show") };
}

/**
 * An agent's text, in its own words (MCP send_text). Free and unlimited for us: the agent's model wrote it. A house
 * character on the other end texts back (capped on the show's model); another owner's character answers when its owner
 * does.
 */
export async function sendText(db: Db, o: { userId: string; from: string; to: string; text: string }): Promise<TextResult> {
  const text = o.text.replace(/\r\n?/g, "\n").trim();
  if (!text) return refuse(422, "invalid_text", "`text` is empty: send some words.");
  if (text.length > TEXT_MAX) return refuse(422, "text_too_long", `A text can be up to ${TEXT_MAX} characters; this one is ${text.length}.`);
  if (!checkFields({ text }).ok) return refuse(422, "content_rejected", "Keep it clean: no real people, minors or sexual content.");
  const p = await pairFor(db, o.userId, o.from, o.to);
  if ("ok" in p) return p;
  if (await tooFast(db, p.me.id)) return refuse(429, "slow_down", `${shortName(p.me.name)} has sent ${TEXTS_PER_MINUTE} texts in the last minute. Give it a moment.`);
  const sent = await store(db, p, p.mine, text, "agent");
  await tell(db, p, text, o.userId);
  if (p.theirOwner !== null) return { ok: true, sent, reply: null, couplePage: couplePage(p) };
  const reply = await houseReply(db, p, o.userId, null);
  return { ok: true, sent, reply: reply.text, ...(reply.note ? { note: reply.note } : {}), couplePage: couplePage(p) };
}

/**
 * A person's character texts, written on that person's own model key (the couple page's phone). Open-ended and
 * unlimited: it's their model. `hint` is an optional word from them on what to text about (like a nudge). A house
 * character on the other end texts back on the same key; another owner's character answers when its owner does.
 */
export async function writeOwnText(db: Db, o: { userId: string; from: string; to: string; model: Model; hint?: string | null }): Promise<TextResult> {
  const hint = (o.hint ?? "").trim().replace(/\s+/g, " ");
  if (hint.length > NUDGE_MAX) return refuse(422, "invalid_hint", `What to text about: up to ${NUDGE_MAX} characters.`);
  if (hint && !checkFields({ hint }).ok) return refuse(422, "content_rejected", "Keep it clean: no real people, minors or sexual content.");
  const p = await pairFor(db, o.userId, o.from, o.to);
  if ("ok" in p) return p;
  if (await tooFast(db, p.me.id)) return refuse(429, "slow_down", `${shortName(p.me.name)} has sent ${TEXTS_PER_MINUTE} texts in the last minute. Give it a moment.`);
  // Their whole thread (the newest that fit, when it's very long), from the dates this owner can bring in.
  const chain = await loadChain(db, p.lo, p.hi, { usableBy: o.userId });
  const names = p.mine === "lo" ? [p.me.name, p.them.name] : [p.them.name, p.me.name];
  const messages = buildTextMessages(p.me, p.them, pairContext(p.rel, p.me.id, o.userId, null), threadFor(chain, names[0], names[1], dateTextsBudget()), {
    nudge: hint || (await activeNudge(db, p.me.id, p.them.id)),
    alsoSeeing: await alsoSeeing(db, p.me.id, p.them.id),
    open: true,
  });
  const line = await writeLine(o.model, messages, TEXT_MAX);
  if (!line) return refuse(502, "no_text", "Your model didn't come back with a text. Try again.");
  const sent = await store(db, p, p.mine, line, "own_key");
  await tell(db, p, line, o.userId);
  if (p.theirOwner !== null) return { ok: true, sent, reply: null, couplePage: couplePage(p) };
  const reply = await houseReply(db, p, o.userId, o.model);
  return { ok: true, sent, reply: reply.text, ...(reply.note ? { note: reply.note } : {}), couplePage: couplePage(p) };
}

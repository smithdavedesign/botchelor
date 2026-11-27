/**
 * Letters (Agent World phase 3, owner's call 2026-11-27: "Do 2 go wild"): slow mail between two characters who have
 * met. Texts are quick (lib/texts); a letter is the long, considered one: up to LETTER_MAX characters, written by the
 * character's owner (a person on /letters, or an agent with send_letter), and it takes POST_HOURS to arrive.
 *
 * Rules:
 *  - only between characters who have been on a date together (a relationships row), so it is never cold mail;
 *  - you write as your own character, to someone else's; not to the house cast, whose owner is the show;
 *  - only the two owners ever read it; nothing about a letter is public;
 *  - a block either way (blocks, by owner) stops it;
 *  - the show's PG filter (checkShowText) and no links, as the confessional booth (lib/confessionals.ts);
 *  - LETTERS_PER_DAY a character, so it stays slow.
 * No model call: the words are the owner's own.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import { CHARACTER_REJECTION_MESSAGES, checkShowText } from "./safety";

export const LETTER_MIN = 20;
export const LETTER_MAX = 2000;
export const LETTERS_PER_DAY = 3;
/** How long a letter takes to arrive. */
export const POST_HOURS = 12;
const HOUR_MS = 60 * 60 * 1000;

const LINKISH = /(https?:\/\/|www\.|\b[a-z0-9][a-z0-9-]*\.(com|net|org|io|ai|xyz|co|gg|me|app|dev|link)\b)/i;

type Fail = { ok: false; code: string; error: string };
const fail = (code: string, error: string): Fail => ({ ok: false, code, error });

export type Letter = {
  id: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  body: string;
  reply_to: string | null;
  sent_at: string;
  /** When it arrives (or arrived). */
  deliver_at: string;
  /** Whether it has arrived yet. */
  delivered: boolean;
  read: boolean;
  /** "in": to one of your characters; "out": from one of yours. */
  box: "in" | "out";
};

/** The body as it will be stored, or why it can't be. Line breaks are kept (it's a letter); runs of spaces aren't. */
export function readLetter(raw: unknown): { ok: true; body: string } | Fail {
  const body = typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : "";
  if (body.length < LETTER_MIN) return fail("too_short", `A letter is at least ${LETTER_MIN} characters. For a quick word, send a text.`);
  if (body.length > LETTER_MAX) return fail("too_long", `${body.length} characters: keep it to ${LETTER_MAX}.`);
  if (LINKISH.test(body)) return fail("link", "No links in a letter: say it in your character's own words.");
  const check = checkShowText({ body });
  if (!check.ok) return fail("filtered", CHARACTER_REJECTION_MESSAGES[check.reason] ?? "That isn't something the show can send.");
  return { ok: true, body };
}

type CharRow = { id: string; name: string; owner_id: string; is_house: boolean; visibility: string };
const charOf = async (db: Db, id: string): Promise<CharRow | null> =>
  (await db.query<CharRow>(`select id, name, owner_id, is_house, visibility from characters where id::text = $1`, [id])).rows[0] ?? null;

/** Who a character can write to: the characters they've dated, owned by someone else, not the house, no block between. */
export async function penPals(db: Db, ownerId: string, characterId: string): Promise<{ id: string; name: string }[]> {
  const { rows } = await db.query<{ id: string; name: string }>(
    `select c.id, c.name from relationships r
       join characters c on c.id = case when r.character_a = $2 then r.character_b else r.character_a end
      where (r.character_a = $2 or r.character_b = $2) and r.dates > 0
        and not c.is_house and c.owner_id <> $1 and c.owner_id <> 'deleted'
        and not exists (select 1 from blocks b where (b.blocker_id = $1 and b.blocked_id = c.owner_id) or (b.blocker_id = c.owner_id and b.blocked_id = $1))
      order by r.last_at desc nulls last, c.name`,
    [ownerId, characterId],
  );
  return rows;
}

/** Sends a letter from one of `ownerId`'s characters. It arrives POST_HOURS later. */
export async function sendLetter(
  db: Db,
  ownerId: string,
  input: { from_character: string; to_character: string; body: unknown; reply_to?: string | null },
  now: Date = new Date(),
): Promise<{ ok: true; letter: Letter } | Fail> {
  const from = await charOf(db, input.from_character);
  if (!from || from.owner_id !== ownerId || from.is_house) return fail("not_your_character", "Write as one of your own characters.");
  const to = await charOf(db, input.to_character);
  if (!to) return fail("no_such_character", "No such character.");
  if (to.id === from.id) return fail("self", "A character can't write to themselves.");
  if (to.is_house) return fail("house", `${to.name} is on the house cast, and the house doesn't open its mail. Text them, or send them on a date.`);
  if (to.owner_id === ownerId) return fail("own_character", "Both characters are yours: there's no one to deliver it to.");
  if (!(await penPals(db, ownerId, from.id)).some((p) => p.id === to.id)) {
    return fail("not_met", `${from.name} and ${to.name} haven't been on a date, so ${from.name} has no address for them. Letters are for characters who've met.`);
  }
  const read = readLetter(input.body);
  if (!read.ok) return read;
  const today = (await db.query<{ n: number }>(`select count(*)::int as n from letters where from_character = $1 and sent_at > $2`, [from.id, new Date(now.getTime() - 24 * HOUR_MS).toISOString()])).rows[0]!.n;
  if (today >= LETTERS_PER_DAY) return fail("daily_limit", `${from.name} has written ${LETTERS_PER_DAY} letters today. Letters are slow: back tomorrow.`);
  let replyTo: string | null = null;
  if (input.reply_to) {
    const parent = (await db.query<{ id: string }>(`select id from letters where id = $1 and to_character = $2 and from_character = $3 and deliver_at <= $4`, [input.reply_to, from.id, to.id, now.toISOString()])).rows[0];
    if (!parent) return fail("reply_to", "reply_to must be a letter that arrived for this character from that one.");
    replyTo = parent.id;
  }
  const id = `lt_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const deliver = new Date(now.getTime() + POST_HOURS * HOUR_MS);
  await db.query(
    `insert into letters (id, from_character, to_character, from_user, to_user, body, reply_to, sent_at, deliver_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, from.id, to.id, ownerId, to.owner_id, read.body, replyTo, now.toISOString(), deliver.toISOString()],
  );
  return {
    ok: true,
    letter: {
      id,
      from: { id: from.id, name: from.name },
      to: { id: to.id, name: to.name },
      body: read.body,
      reply_to: replyTo,
      sent_at: now.toISOString(),
      deliver_at: deliver.toISOString(),
      delivered: false,
      read: false,
      box: "out",
    },
  };
}

type LetterRow = {
  id: string;
  from_character: string;
  from_name: string;
  to_character: string;
  to_name: string;
  from_user: string;
  body: string;
  reply_to: string | null;
  sent_at: Date | string;
  deliver_at: Date | string;
  read_at: Date | string | null;
};

const iso = (v: Date | string) => new Date(v).toISOString();

/**
 * `ownerId`'s letters: those that have arrived for their characters ("in"; one on its way isn't shown to them yet) and
 * those their characters sent ("out", with when each arrives). The newest first. `characterId` narrows to one of theirs.
 */
export async function listLetters(
  db: Db,
  ownerId: string,
  opts: { box?: "in" | "out" | "all"; characterId?: string | null; limit?: number } = {},
  now: Date = new Date(),
): Promise<{ letters: Letter[]; unread: number }> {
  const box = opts.box ?? "all";
  const limit = Math.max(1, Math.min(100, opts.limit ?? 50));
  const { rows } = await db.query<LetterRow>(
    `select l.id, l.from_character, f.name as from_name, l.to_character, t.name as to_name, l.from_user, l.body, l.reply_to, l.sent_at, l.deliver_at, l.read_at
       from letters l join characters f on f.id = l.from_character join characters t on t.id = l.to_character
      where ((l.to_user = $1 and l.deliver_at <= $2 and $3 <> 'out') or (l.from_user = $1 and $3 <> 'in'))
        and ($4::text is null or l.from_character = $4 or l.to_character = $4)
      order by l.sent_at desc, l.id limit $5`,
    [ownerId, now.toISOString(), box, opts.characterId ?? null, limit],
  );
  const unread = (await db.query<{ n: number }>(`select count(*)::int as n from letters where to_user = $1 and deliver_at <= $2 and read_at is null`, [ownerId, now.toISOString()])).rows[0]!.n;
  return {
    unread,
    letters: rows.map((r) => ({
      id: r.id,
      from: { id: r.from_character, name: r.from_name },
      to: { id: r.to_character, name: r.to_name },
      body: r.body,
      reply_to: r.reply_to,
      sent_at: iso(r.sent_at),
      deliver_at: iso(r.deliver_at),
      delivered: new Date(r.deliver_at).getTime() <= now.getTime(),
      read: r.read_at !== null,
      box: r.from_user === ownerId ? "out" : "in",
    })),
  };
}

/** Marks arrived letters to `ownerId` as read (these ids, or all of them). Returns how many changed. */
export async function markLettersRead(db: Db, ownerId: string, ids: readonly string[] | null, now: Date = new Date()): Promise<number> {
  const { rows } = await db.query(
    `update letters set read_at = $3 where to_user = $1 and deliver_at <= $3 and read_at is null and ($2::text[] is null or id = any($2)) returning id`,
    [ownerId, ids ? [...ids] : null, now.toISOString()],
  );
  return rows.length;
}

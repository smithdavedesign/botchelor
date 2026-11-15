/**
 * The chips under a character's text about one of its dates (the 2026-11-14 core plan, "your character has a love life,
 * and you're in their corner"): a text used to end on a question the person could only type back to ("Want me to see
 * Nell again?"). Now the text carries a menu (companion_messages.offers), the thread shows the newest open one as chips
 * ("Yes, see Nell again", "Try someone new", "Tell Lexi what to do next time"), and a tap does the thing through the
 * show's own booking path (app/api/companion/[id]/route.ts, action `offer`). The character answers with a written line
 * (postFromCharacter, kind `offer`), never a model call. Nothing here touches an ending: the engine still decides.
 *
 * This module reads and marks the menus and picks the partner for "someone new"; the route books. It never imports
 * lib/companion.ts (which reads the menus for the thread view), so there is no cycle.
 */
import type { Db } from "./db";
import { pickFirstPartner } from "./first-date";
import { takenSql } from "./partners";
import { lastDateOf } from "./last-date";
import { activeNudge } from "./between-dates";
import { leadAndSuitors, seasonCastIds } from "./season-cast";
import { COMPANION_OFFER_KINDS, type CompanionNextTime, type CompanionOfferKind, type CompanionOffersView } from "./companion-shared";
import { overnightChipLines } from "./overnight-shared";
import type { Ending } from "./rules";

/** What companion_messages.offers holds: the menu, and `taken` once a chip was tapped (kept for the record; the chips go). */
export type StoredOffers = {
  episode_id: string;
  partner_id: string;
  partner: string;
  kinds: CompanionOfferKind[];
  taken?: { kind: CompanionOfferKind; at: string; episode_id?: string | null };
};

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * The menu a text about a date offers (pure). `booked`: a next date with that partner exists already, so the only thing
 * left to do is advise. Otherwise the chips follow the question the text ends on: "see them again?" where the ending left
 * a second date open (lib/second-date.ts books only a mutual one), "someone new?" everywhere, and advice always.
 * `overnight`: the couple has earned an overnight date (lib/overnight.ts overnightOnOffer), so it leads the menu.
 */
export function offersFor(o: { ending: Ending; booked?: boolean; overnight?: boolean }): CompanionOfferKind[] {
  if (o.booked) return ["advice"];
  const kinds: CompanionOfferKind[] = [];
  if (o.overnight && o.ending === "second_date") kinds.push("overnight");
  if (o.ending === "second_date") kinds.push("second_date");
  kinds.push("someone_new", "advice");
  return kinds;
}

/** The menu to store on a text (pure): null when there is nothing to offer. */
export function storedOffers(o: { episodeId: string; partnerId: string; partner: string; ending: Ending; booked?: boolean; overnight?: boolean }): StoredOffers | null {
  const kinds = offersFor(o);
  return kinds.length ? { episode_id: o.episodeId, partner_id: o.partnerId, partner: o.partner, kinds } : null;
}

/**
 * What the character says once a chip did its thing (pure, no model): booked, someone new, waiting on the other creator,
 * or ready for the note. Out of dates has its own line (outOfDatesLines).
 */
export function offerLines(kind: CompanionOfferKind, o: { partner: string; newPartner?: string | null; waiting?: boolean }): string[] {
  const them = firstNameOf(o.partner);
  switch (kind) {
    case "overnight":
      return overnightChipLines(o.partner, o.waiting === true);
    case "second_date":
      return o.waiting ? [`I said yes to seeing ${them} again. It's up to ${them}'s creator now.`] : [`Booked. Wish me luck with ${them}.`];
    case "someone_new":
      return o.newPartner ? [`Fine, someone new. ${firstNameOf(o.newPartner)}, apparently. Watch me.`] : ["Fine, someone new. Watch me."];
    case "advice":
      return ["Go on then. Tell me what to do differently next time, and I'll take it with me."];
  }
}

/** The character's own words for the 429 the booking route gives: out of dates this week, and where more come from. */
export const outOfDatesLines = (): string[] => ["I'm out of dates this week.", "Free ones come back Monday, or there's a pack in the shop. Your call."];

/** The character's line when every cast member has been dated already (nobody new to offer). */
export const nobodyNewLines = (): string[] => ["I've met everyone on this season's cast already.", "Send me on one yourself, or wait for the next lot."];

type OfferMessageRow = { id: string; offers: StoredOffers | null; role: string };

/**
 * The one text whose chips show (for lib/companion.ts getThread): the newest character message with a menu that hasn't
 * been taken, and only while the character has no date newer than the one the text is about (a newer date means the
 * question has moved on). Null when nothing is open.
 */
export async function openOffers(db: Db, characterId: string, messages: readonly OfferMessageRow[]): Promise<{ messageId: string; view: CompanionOffersView } | null> {
  // A question about the sheet (lib/character-question-fields.ts) keeps its box in the same column and is not a date's
  // menu: it has no episode, and it never hides the chips of the text before it.
  const m = [...messages].reverse().find((x) => x.role === "character" && x.offers && x.offers.episode_id && !x.offers.taken);
  if (!m?.offers) return null;
  if (await hasNewerDate(db, characterId, m.offers.episode_id)) return null;
  const { episode_id, partner_id, partner, kinds } = m.offers;
  return { messageId: m.id, view: { episode_id, partner_id, partner, kinds: kinds.filter((k) => (COMPANION_OFFER_KINDS as readonly string[]).includes(k)) } };
}

/** A date of this character booked after the given one exists (any status: a booked date is already the answer). */
export async function hasNewerDate(db: Db, characterId: string, episodeId: string): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from episodes n
      where (n.character_a = $1 or n.character_b = $1) and n.id <> $2
        and n.created_at > (select e.created_at from episodes e where e.id = $2)
      limit 1`,
    [characterId, episodeId],
  );
  return rows.length > 0;
}

/** The thread's "For next time": the last finished date's partner and the standing note (null without a date). */
export async function nextTimeFor(db: Db, characterId: string): Promise<CompanionNextTime | null> {
  const last = await lastDateOf(db, characterId);
  if (!last) return null;
  const note = await activeNudge(db, characterId, last.partnerId).catch(() => null);
  return { episode_id: last.episodeId, partner_id: last.partnerId, partner: last.partner, note };
}

export type OfferFail = { ok: false; status: number; error: string; message: string };
export type LoadedOffer = {
  ok: true;
  threadId: string;
  characterId: string;
  characterName: string;
  messageId: string;
  offers: StoredOffers;
};

const no = (status: number, error: string, message: string): OfferFail => ({ ok: false, status, error, message });

/**
 * The chip's text and its menu, for this person: the thread is theirs, the character is their own (the owner, never a
 * guest talking to the cast: only an owner can send a character on a date), the message carries that chip, nobody tapped
 * one yet, and no newer date of theirs exists.
 */
export async function loadOffer(db: Db, args: { userId: string; threadId: string; messageId: string; kind: CompanionOfferKind }): Promise<LoadedOffer | OfferFail> {
  const { rows } = await db.query<{ thread_id: string; character_id: string; name: string; owner_id: string | null; offers: StoredOffers | null; role: string }>(
    `select t.id as thread_id, t.character_id, c.name, c.owner_id, m.offers, m.role
       from companion_threads t
       join characters c on c.id = t.character_id
       left join companion_messages m on m.id = $3 and m.thread_id = t.id
      where t.id = $1 and t.user_id = $2`,
    [args.threadId, args.userId, args.messageId],
  );
  const r = rows[0];
  if (!r) return no(404, "not_found", "Not found.");
  if (r.owner_id !== args.userId) return no(403, "not_your_character", `Only ${firstNameOf(r.name)}'s creator can send them on a date.`);
  if (!r.offers || !r.offers.episode_id || r.role !== "character") return no(404, "no_offer", "That text has nothing to tap.");
  if (r.offers.taken) return no(409, "offer_taken", "You already answered that one.");
  if (!r.offers.kinds.includes(args.kind)) return no(404, "no_offer", "That wasn't on offer.");
  if (await hasNewerDate(db, r.character_id, r.offers.episode_id)) return no(409, "offer_stale", `${firstNameOf(r.name)} has been on a date since. Hear about that one instead.`);
  return { ok: true, threadId: r.thread_id, characterId: r.character_id, characterName: r.name, messageId: args.messageId, offers: r.offers };
}

/** Marks a menu taken: the chips go, the text keeps its record of what was chosen. */
export async function markOfferTaken(db: Db, messageId: string, taken: { kind: CompanionOfferKind; at?: Date; episodeId?: string | null }): Promise<void> {
  await db.query(
    `update companion_messages set offers = offers || jsonb_build_object('taken', $2::jsonb) where id = $1 and offers is not null and offers->'taken' is null`,
    [messageId, JSON.stringify({ kind: taken.kind, at: (taken.at ?? new Date()).toISOString(), ...(taken.episodeId ? { episode_id: taken.episodeId } : {}) })],
  );
}

/**
 * Someone new for a speed date: one of this season's house cast this character hasn't been on a date with (any status:
 * a date being filmed counts), picked the way a first date picks (lib/first-date.ts pickFirstPartner, by the character's
 * id, so the same character keeps meeting the cast in the same order and never the same one twice). On a Botchelor
 * season, once the lead is met, one of the suitors still in. Null when they have met everyone.
 */
export async function pickSomeoneNew(db: Db, characterId: string, now = new Date()): Promise<{ id: string; name: string } | null> {
  const castIds = seasonCastIds(now);
  if (!castIds.length) return null;
  // The cast as the database has them (a premium house character is a buyer's own, never offered), minus everyone dated.
  const { rows } = await db.query<{ id: string; name: string }>(
    `select c.id, c.name from characters c
      where c.id = any($2) and c.is_house and c.premium_sku is null and c.visibility <> 'private'
        and not exists (select 1 from episodes e
                         where (e.character_a = $1 and e.character_b = c.id) or (e.character_a = c.id and e.character_b = $1))`,
    [characterId, castIds],
  );
  const order = new Map(castIds.map((id, i) => [id, i]));
  const left = rows.sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0)).map((c) => ({ id: c.id, name: c.name, premium: false }));
  const picked = pickFirstPartner(left, characterId);
  if (picked) return picked;
  // A Botchelor season's house side is its one lead (lib/season-cast.ts), so after the lead "someone new" is one of the
  // season's suitors still in: their owners agreed that anyone may date them by name while they're on the cast
  // (lib/auditions.ts). Never the person's own, a taken one, or across a block or an unmatch (the booking would refuse).
  const suitors = leadAndSuitors(now)?.suitors ?? [];
  if (!suitors.length) return null;
  const others = await db.query<{ id: string; name: string }>(
    `select c.id, c.name from characters c, characters me
      where me.id = $1 and c.id = any($2) and not c.is_house and c.visibility = 'public' and c.open_to_dates
        and c.owner_id is distinct from me.owner_id and not ${takenSql("c")}
        and not exists (select 1 from episodes e where (e.character_a = $1 and e.character_b = c.id) or (e.character_a = c.id and e.character_b = $1))
        and not exists (select 1 from unmatches um where (um.character_lo = $1 and um.character_hi = c.id) or (um.character_lo = c.id and um.character_hi = $1))
        and not exists (select 1 from blocks bl where (bl.blocker_id = me.owner_id and bl.blocked_id = c.owner_id) or (bl.blocker_id = c.owner_id and bl.blocked_id = me.owner_id))`,
    [characterId, suitors],
  );
  const inTurn = new Map(suitors.map((id, i) => [id, i]));
  return pickFirstPartner(others.rows.sort((x, y) => (inTurn.get(x.id) ?? 0) - (inTurn.get(y.id) ?? 0)).map((c) => ({ id: c.id, name: c.name, premium: false })), characterId);
}

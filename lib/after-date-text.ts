import { postFromCharacter, threadIdFor } from "./companion";
import { dateNumberSql } from "./date-number";
import type { Db } from "./db";
import type { SideOutcome } from "./engine";
import type { Reflections } from "./reflection";
import type { Ending } from "./rules";
import { venuePhrase } from "./venues";

/**
 * "They'll text you" (the 2026-11-14 core plan, PR2): after a date, your own character texts you about it, off the show,
 * in its companion thread. $0: two or three short bubbles built from what the date already produced, its own
 * first-person reflection (lib/reflection.ts, best effort) when there is one, else the debrief and the ending. The
 * character never asks for anything or guilts anyone; it ends on a question to the person, and when the ending allows a
 * second date, that question is whether to see them again. Nothing the person answers reaches a date (docs/companions.md,
 * "One way only"): their advice is the thread's, not the engine's.
 */

/** What the text is built from: a row of `episodes` with the two names, or an episode view's fields. */
export type AfterDateEpisode = {
  ending: Ending;
  /** Which date it is for the couple (lib/date-number.ts): 2 and up read "another one". */
  date_number?: number | null;
  /** Side a's name, then side b's. */
  names: readonly [string, string];
  /** Where it happened (episodes.setup.venue), or null for a date written before venues existed. */
  venue: string | null;
  reflections: Reflections | null;
  sides: readonly [SideOutcome, SideOutcome] | null;
};

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;
const quote = (s: string) => `"${s.replace(/\s+/g, " ").trim().slice(0, 80)}"`;

/** Whether this ending leaves a second date on the table (lib/second-date.ts books one when both want it). */
export const allowsSecondDate = (ending: Ending): boolean => ending === "second_date";

/**
 * The character's own words about the date, as 2-3 text bubbles (pure). `side` is the side the person owns: that
 * character's reflection, debrief and voice, never the other's (the other side's private data is never read).
 */
export function afterDateLines(ep: AfterDateEpisode, side: "a" | "b"): string[] {
  const me = side === "a" ? 0 : 1;
  const them = firstNameOf(ep.names[me === 0 ? 1 : 0]);
  const where = ep.venue ? ` at ${venuePhrase(ep.venue)}` : "";
  const again = (ep.date_number ?? 1) >= 2;
  const reflection = ep.reflections?.[side]?.trim() || null;
  const mine = ep.sides?.[me] ?? null;
  const liked = mine?.want_met?.trim() || null;
  const uncomfortable = mine?.dealbreaker_hit?.trim() || null;

  const lines: string[] = [];
  switch (ep.ending) {
    case "second_date":
      lines.push(again ? `Okay, back from another one with ${them}${where}. I think that went well again?` : `Okay, back from the date with ${them}${where}. I think that actually went well?`);
      lines.push(reflection ?? (liked ? `There was a moment around ${quote(liked)} where I caught myself smiling.` : "There was a moment in there I keep replaying."));
      lines.push(`Want me to see ${them} again?`);
      break;
    case "friends":
      lines.push(again ? `So, ${them} again${where}. Easy company. And I think friends is where it lands.` : `So. ${them}${where}. Nice, honestly. And I think that's where it stays.`);
      lines.push(reflection ?? (uncomfortable ? `The bit about ${quote(uncomfortable)} put me off a little, if I'm honest.` : "Nothing wrong with it, there just wasn't a spark on my side."));
      lines.push("Did you see that coming, or is it just me?");
      break;
    case "disaster":
      lines.push(again ? `Well. ${them} again${where}, and it went about as badly as it could.` : `Well. That was ${them}${where}.`);
      lines.push(reflection ?? (uncomfortable ? `${quote(uncomfortable)} was the moment it went sideways for me.` : "It got away from both of us. I'm still a bit wound up about it."));
      lines.push("What would you have done in my shoes?");
      break;
  }
  return lines;
}

export type AfterDateFail = { ok: false; status: number; error: string; message: string };
export type AfterDateResult = { ok: true; thread_id: string; character_id: string; message_id: string | null; sent: boolean } | AfterDateFail;

const fail = (status: number, error: string, message: string): AfterDateFail => ({ ok: false, status, error, message });

type Row = {
  id: string;
  status: string;
  ending: Ending;
  creator_id: string;
  venue: string | null;
  reflections: Reflections | null;
  sides: [SideOutcome, SideOutcome] | null;
  date_number: number | null;
  a_id: string;
  a_name: string;
  a_owner: string | null;
  b_id: string;
  b_name: string;
  b_owner: string | null;
};

/**
 * The date and the side the person owns, or why not: the person must own the character on one side (the host of a date
 * between others has nobody of their own to hear from; anyone else isn't told the date exists), and the date must be ready.
 */
async function load(db: Db, userId: string, episodeId: string): Promise<{ ok: true; row: Row; side: "a" | "b" } | AfterDateFail> {
  const { rows } = await db.query<Row>(
    `select e.id, e.status, e.ending, e.creator_id, e.setup->>'venue' as venue, e.reflections, e.sides, ${dateNumberSql("e")} as date_number,
            a.id as a_id, a.name as a_name, a.owner_id as a_owner, b.id as b_id, b.name as b_name, b.owner_id as b_owner
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1`,
    [episodeId],
  );
  const row = rows[0];
  if (!row) return fail(404, "not_found", "Not found.");
  const side: "a" | "b" | null = row.a_owner === userId ? "a" : row.b_owner === userId ? "b" : null;
  if (!side) return row.creator_id === userId ? fail(409, "no_character", "Neither of them is your character, so there's nobody to hear from.") : fail(404, "not_found", "Not found.");
  if (row.status !== "ready") return fail(409, "not_ready", "The date is still being written. Hear from them once it's done.");
  return { ok: true, row, side };
}

/** Which of the person's characters would text about this date (for a route's checks before anything is written). */
export async function afterDateCharacter(db: Db, args: { userId: string; episodeId: string }): Promise<{ ok: true; character_id: string } | AfterDateFail> {
  const l = await load(db, args.userId, args.episodeId);
  if (!l.ok) return l;
  return { ok: true, character_id: l.side === "a" ? l.row.a_id : l.row.b_id };
}

/**
 * Sends the person's own character's text about one of its dates (postFromCharacter, kind `after_date`, tagged
 * `after_date:<episode id>`, so a date is texted about once however often the button is tapped). `sent: false` with a
 * thread: already texted (or the thread is paused), so the thread's page is the answer.
 */
export async function sendAfterDateText(db: Db, args: { userId: string; episodeId: string; now?: Date }): Promise<AfterDateResult> {
  const l = await load(db, args.userId, args.episodeId);
  if (!l.ok) return l;
  const { row: r, side } = l;
  const characterId = side === "a" ? r.a_id : r.b_id;
  const lines = afterDateLines({ ending: r.ending, date_number: r.date_number, names: [r.a_name, r.b_name], venue: r.venue, reflections: r.reflections, sides: r.sides }, side);
  const posted = await postFromCharacter(db, { userId: args.userId, characterId, lines, now: args.now, kind: "after_date", dedupeKey: `after_date:${r.id}` });
  if (posted) return { ok: true, thread_id: posted.threadId, character_id: characterId, message_id: posted.messageId, sent: true };
  const existing = await threadIdFor(db, args.userId, characterId);
  if (existing) return { ok: true, thread_id: existing, character_id: characterId, message_id: null, sent: false };
  return fail(409, "not_now", `${firstNameOf(side === "a" ? r.a_name : r.b_name)} can't text right now. Try again in a moment.`);
}

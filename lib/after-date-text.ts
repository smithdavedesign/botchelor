import { postFromCharacter, threadIdFor } from "./companion";
import { dateNumberSql } from "./date-number";
import type { Db } from "./db";
import type { SideOutcome } from "./engine";
import { loadOurIds } from "./our-traffic";
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
 *
 * PR5 of the same plan adds the two texts a character sends on its own, both only to a thread whose person tapped
 * "Hear from" once (companion_threads.muted_proactive = false, the opt-in) and both event-driven, never on silence:
 * the tease when a date airs (teaseAfterAir, from lib/air.ts) and the day-after text (dayAfterTexts, from the daily job).
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

/* ------------------------------------------------- the day after ------------------------------------------------- */

/** What the day-after text is built from (pure): the afterglow's verdict and whether the next date is booked. */
export type DayAfterState = {
  ending: Ending;
  /** The partner's name (first name used). */
  partner: string;
  /** Whether this side wanted to see them again, and whether the other did (episodes.sides wants_another); null unknown. */
  mine_wants: boolean | null;
  theirs_wants: boolean | null;
  /** A next date between them is booked already (an episode with followup_of = this one, lib/second-date.ts). */
  booked: boolean;
};

/**
 * The next day's text, in the character's words (pure): still thinking about them, where it stands (by the afterglow's
 * verdict and whether a next date is booked), and one question to the person. It never says the person was quiet or
 * missed, and it never asks for anything but their view.
 */
export function dayAfterLines(s: DayAfterState): string[] {
  const them = firstNameOf(s.partner);
  const lines = [`Still thinking about ${them}.`];
  if (s.booked) {
    lines.push("We're seeing each other again, and I'm a little nervous about it, honestly.");
    lines.push("Anything I should keep in mind this time?");
  } else if (s.ending === "second_date") {
    lines.push(`${them} said they'd like to see me again, and I think I would too.`);
    lines.push(`Want me to see ${them} again?`);
  } else if (s.ending === "disaster") {
    lines.push("That one's done. I'm not going back for more of that.");
    lines.push("Want me to try someone new?");
  } else if (s.theirs_wants && !s.mine_wants) {
    lines.push(`${them} would see me again, I think. I'm not sure I would.`);
    lines.push(`Want me to try someone new, or give ${them} another shot?`);
  } else if (s.mine_wants && !s.theirs_wants) {
    lines.push(`I'd have said yes to another one. ${them} would rather leave it as friends.`);
    lines.push("Want me to try someone new?");
  } else {
    lines.push("We left it as friends, and that feels right.");
    lines.push("Want me to try someone new?");
  }
  return lines;
}

/** The day-after window: a date is texted about from 20 hours after it was booked until 48. */
export const DAY_AFTER_FROM_HOURS = 20;
export const DAY_AFTER_UNTIL_HOURS = 48;

type OptedInSide = {
  episode_id: string;
  ending: Ending;
  sides: [SideOutcome, SideOutcome] | null;
  thread_id: string;
  user_id: string;
  character_id: string;
  /** Whether the thread's character is side a of the date. */
  is_a: boolean;
  partner: string;
  booked: boolean;
  creator_id: string;
};

/**
 * The threads a date may be texted about in: for each non-house side whose owner has a companion thread with that very
 * character, opted in (muted_proactive = false, the "Hear from" tap) and not paused, without the tag yet. One side's
 * owner may be both sides' owner (two threads, one text each). After Dark dates stay on their own host.
 */
const OPTED_IN_SIDES_SQL = (where: string) => `
  select e.id as episode_id, e.ending, e.sides, e.creator_id, t.id as thread_id, t.user_id, t.character_id,
         t.character_id = e.character_a as is_a,
         case when t.character_id = e.character_a then b.name else a.name end as partner,
         exists (select 1 from episodes f where f.followup_of = e.id) as booked
    from episodes e
    join characters a on a.id = e.character_a
    join characters b on b.id = e.character_b
    join companion_threads t
      on t.character_id in (e.character_a, e.character_b)
     and t.user_id = case when t.character_id = e.character_a then a.owner_id else b.owner_id end
   where e.status = 'ready'
     and coalesce((e.setup->>'after_dark')::boolean, false) = false
     and not (case when t.character_id = e.character_a then a.is_house else b.is_house end)
     and t.muted_proactive = false and t.paused_at is null
     and not exists (select 1 from companion_messages m where m.thread_id = t.id and m.action = $1 || e.id)
     ${where}`;

/**
 * The day after a date (the daily job's people part): each opted-in owner's character texts them once about where it
 * stands, between DAY_AFTER_FROM_HOURS and DAY_AFTER_UNTIL_HOURS after the date was booked (the job runs once a day, so
 * the window is wider than a day; the tag `day_after:<episode id>` keeps it to one text). Never for our own identities
 * (lib/our-traffic.ts loadOurIds: admins, the loop's agents, test characters), only read when there is a candidate.
 * Returns how many texts went out.
 */
export async function dayAfterTexts(db: Db, now = new Date(), limit = 50): Promise<number> {
  const { rows } = await db.query<OptedInSide>(
    OPTED_IN_SIDES_SQL(`and e.created_at between $2::timestamptz - make_interval(hours => $4::int) and $2::timestamptz - make_interval(hours => $3::int)
   order by e.created_at, e.id limit $5`),
    ["day_after:", now.toISOString(), DAY_AFTER_FROM_HOURS, DAY_AFTER_UNTIL_HOURS, limit],
  );
  if (!rows.length) return 0;
  const ours = new Set(await loadOurIds(db).catch(() => [] as string[]));
  let sent = 0;
  for (const r of rows) {
    if (ours.has(r.user_id) || ours.has(r.creator_id)) continue;
    const me = r.is_a ? 0 : 1;
    const lines = dayAfterLines({
      ending: r.ending,
      partner: r.partner,
      mine_wants: r.sides?.[me]?.wants_another ?? null,
      theirs_wants: r.sides?.[me === 0 ? 1 : 0]?.wants_another ?? null,
      booked: r.booked,
    });
    const posted = await postFromCharacter(db, { userId: r.user_id, characterId: r.character_id, lines, now, kind: "day_after", dedupeKey: `day_after:${r.episode_id}` }).catch(() => null);
    if (posted) sent++;
  }
  return sent;
}

/* ------------------------------------------------- the tease on air ------------------------------------------------ */

/** The spoiler-free line when a date airs (pure): where they went, never how it ended. */
export const teaseLines = (partner: string): string[] => [`Back from the date with ${firstNameOf(partner)}.`, "Come see how it went."];

/**
 * When a date airs (lib/air.ts airEpisode, fire-and-forget): each opted-in owner's character tells them it's back, without
 * the ending, tagged `tease:<episode id>`. Not to whoever aired it (`skip`: they are looking at it), and not to a thread
 * that already heard from the character about this date (`after_date:<id>`: the Hear-from tap means they watched). There
 * is no per-date watched record, so anyone else is assumed not to have seen it yet. Returns how many texts went out.
 */
export async function teaseAfterAir(db: Db, episodeId: string, opts: { now?: Date; skip?: readonly (string | null | undefined)[] } = {}): Promise<number> {
  const skip = new Set((opts.skip ?? []).filter((u): u is string => Boolean(u)));
  const { rows } = await db.query<OptedInSide>(
    OPTED_IN_SIDES_SQL(`and e.id = $2 and e.revealed_at is not null
     and not exists (select 1 from companion_messages h where h.thread_id = t.id and h.action = 'after_date:' || e.id)`),
    ["tease:", episodeId],
  );
  let sent = 0;
  for (const r of rows) {
    if (skip.has(r.user_id)) continue;
    const posted = await postFromCharacter(db, { userId: r.user_id, characterId: r.character_id, lines: teaseLines(r.partner), now: opts.now, kind: "tease", dedupeKey: `tease:${r.episode_id}` }).catch(() => null);
    if (posted) sent++;
  }
  return sent;
}

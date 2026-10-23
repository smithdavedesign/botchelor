/**
 * "Date this character" at the top of a character page (mobile audit 2026-10-21: the only call to action sat ~5,000px
 * down on a phone). Who sees what:
 * - nothing on your own character, or a private one;
 * - "Not taking dates right now" when they're closed to dates (a house character off this season, someone else's
 *   character its creator hasn't opened, or one that's with a partner and wants only them);
 * - "Make a character to date …" when the viewer has no character yet (the builder, /create);
 * - "Send one of yours on a date with …" otherwise. Each of the viewer's characters can book straight away (the house
 *   cast; a couple that has dated or matched both ways; anyone open to dates with the swipe gate off) or has to match
 *   first behind the swipe gate (lib/swipe-gate.ts), which sends it to the swipe deck. The booking itself is
 *   POST /api/episodes, which checks everything again.
 */
import type { Db } from "./db";
import { agreedMatchSql } from "./swipes";
import { datedSql, swipeGateOn } from "./swipe-gate";

export type CtaMine = { id: string; name: string; mode: "book" | "match" };

export type DateCta =
  | { kind: "none" }
  | { kind: "closed"; reason: string }
  | { kind: "make"; label: string; href: string }
  | { kind: "send"; label: string; mine: CtaMine[] };

export function dateCta(i: {
  first: string;
  /** The character's id: the builder brings the viewer back to its page once theirs exists. */
  id?: string;
  isOwner: boolean;
  isPrivate: boolean;
  /** Open to dates: on this season's cast (or premium), or opened by its creator. */
  available: boolean;
  /** With a partner and wanting only them: that partner's first name. */
  takenBy?: string | null;
  mine: CtaMine[];
}): DateCta {
  if (i.isOwner || i.isPrivate) return { kind: "none" };
  if (i.takenBy) return { kind: "closed", reason: `Not taking dates right now: ${i.first} is with ${i.takenBy}.` };
  if (!i.available) return { kind: "closed", reason: "Not taking dates right now." };
  if (!i.mine.length) return { kind: "make", label: `Make a character to date ${i.first}`, href: i.id ? `/create?next=${encodeURIComponent(`/characters/${i.id}`)}` : "/create" };
  return { kind: "send", label: `Send one of yours on a date with ${i.first}`, mine: i.mine };
}

/** The viewer's characters, and whether each can book a date with `targetId` now or has to match first. */
export async function ctaMine(db: Db, viewerId: string | null, target: { id: string; house: boolean }): Promise<CtaMine[]> {
  if (!viewerId) return [];
  const gated = !target.house && swipeGateOn();
  const { rows } = await db.query<{ id: string; name: string; ready: boolean }>(
    `select c.id, c.name, (not $3::boolean or ${datedSql("c", "$2")} or ${agreedMatchSql("c", "$2")}) as ready
       from characters c
      where c.owner_id = $1 and not c.is_house and c.id <> $2
      order by c.created_at desc, c.id
      limit 30`,
    [viewerId, target.id, gated],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, mode: r.ready ? "book" : "match" }));
}

/**
 * Every character gets a verb (2026-11-15). /characters is the most-clicked page on the site and people left it in
 * seconds: a wall of faces with nothing to do with one. So each card, and the head of each character's page, carries
 * ONE primary action, chosen by who is looking:
 *
 *  - someone with a character of their own: "Send {mine} on a date with {them}" when their character can book that date
 *    now, or "Match {mine} with {them}" when a first date takes a match first (the swipe gate, lib/swipe-gate.ts);
 *  - someone with no character: "Step into a date with {them}" when step-in is open to them and this is one of the
 *    season's cast (lib/step-in.ts), otherwise "Make a character to date {them}";
 *  - nothing on your own character, a private one, or one that isn't taking dates: an action the server would refuse
 *    is never offered. (Talk, the companion, is a second, quieter action where it applies: DirectoryEntry.companion.)
 *
 * This module only chooses and links. The booking is still the one path it always was: the character page's "Date
 * this character" (lib/date-cta.ts, app/characters/[id]/DateThisCharacter.tsx → POST /api/episodes, which checks
 * everything again), opened from a card with ?send=<mine> so the sender is already picked.
 */
import { audienceAllowsSql } from "./audience";
import type { Db } from "./db";
import { shortName } from "./names";
import { takenSql } from "./partners";
import { seasonCastIds, seasonFanCastIds } from "./season-cast";
import { datedSql, swipeGateOn } from "./swipe-gate";
import { agreedMatchSql } from "./swipes";
import { unmatchedSql } from "./unmatch";

export type VerbKind = "send" | "match" | "step_in" | "make";
/** `track`: the link's data-track name (the engagement log's click names). */
export type Verb = { kind: VerbKind; label: string; href: string; track: string };

/** Who is looking: the character of theirs that goes (their most recent), and whether step-in is open to them. */
export type VerbViewer = { mine: { id: string; name: string } | null; stepIn: boolean };

/** What the choice needs to know about one character, for this viewer. */
export type VerbFacts = {
  id: string;
  name: string;
  /** The viewer's own character, or a private one: no verb. */
  own: boolean;
  private: boolean;
  /** Takes a date from this viewer's character (or, with none, from a new one) now: on the cast, or open to dates and free. */
  dateable: boolean;
  /** The viewer's character can book it straight away (the house cast, a fan pick, a couple that's dated or matched). */
  ready: boolean;
  /** The viewer's character is with someone else and wants only them: it can't go. */
  mineTaken: boolean;
  /** One of this season's house cast, so a person can step into a date with them. */
  steppable: boolean;
};

/** Where a card's "send" lands: the character's page, its confirm sheet open with this sender picked. */
export const sendHref = (themId: string, mineId: string): string => `/characters/${encodeURIComponent(themId)}?send=${encodeURIComponent(mineId)}#date`;
export const stepInHref = (themId: string): string => `/step-in?with=${encodeURIComponent(themId)}`;
/** The builder, coming back to this character: with one of the cast, the new character's first date is with them (?meet=). */
export const makeHref = (themId: string, onCast: boolean): string =>
  `/create?${onCast ? `meet=${encodeURIComponent(themId)}&` : ""}next=${encodeURIComponent(`/characters/${themId}`)}`;

/** The one primary action for this viewer on this character, or null when there's none to offer. */
export function characterVerb(viewer: VerbViewer, f: VerbFacts): Verb | null {
  if (f.own || f.private) return null;
  const them = shortName(f.name);
  const stepIn: Verb | null = viewer.stepIn && f.steppable ? { kind: "step_in", label: `Step into a date with ${them}`, href: stepInHref(f.id), track: "step-in" } : null;
  if (viewer.mine) {
    const me = shortName(viewer.mine.name);
    // Theirs can't go (it's with someone), or this one isn't taking dates: the date isn't offered. A cast member can
    // still be met in person.
    if (!f.dateable || f.mineTaken) return stepIn;
    return f.ready
      ? { kind: "send", label: `Send ${me} on a date with ${them}`, href: sendHref(f.id, viewer.mine.id), track: "verb-send" }
      : { kind: "match", label: `Match ${me} with ${them}`, href: `/swipe?character=${encodeURIComponent(viewer.mine.id)}`, track: "verb-match" };
  }
  if (stepIn) return stepIn;
  return f.dateable ? { kind: "make", label: `Make a character to date ${them}`, href: makeHref(f.id, f.steppable), track: "verb-make" } : null;
}

/** The viewer's character that goes by default: their most recent (lib/date-cta.ts ctaMine lists them in this order). */
export async function viewerCharacter(db: Db, viewerId: string | null): Promise<{ id: string; name: string } | null> {
  if (!viewerId) return null;
  const { rows } = await db.query<{ id: string; name: string }>(`select c.id, c.name from characters c where c.owner_id = $1 and not c.is_house order by c.created_at desc, c.id limit 1`, [viewerId]);
  return rows[0] ?? null;
}

/**
 * The facts for a page of cards, in one query: the booking route's own rules (app/api/episodes/route.ts), read ahead
 * so a card never offers what it would refuse. The house cast takes dates while it's on this season's show (a premium
 * one is bought first, so its card offers nothing; its page does). Anyone else's character takes them when it's open
 * to dates, not with a partner it wants alone, open to characters like the viewer's (lib/audience.ts: a new one would
 * be made on the web), and neither owner has blocked the other. A pair that unmatched doesn't date.
 */
export async function verbFacts(db: Db, viewerId: string | null, mineId: string | null, ids: string[], now: Date = new Date()): Promise<Map<string, VerbFacts>> {
  const out = new Map<string, VerbFacts>();
  if (!ids.length) return out;
  const cast = seasonCastIds(now);
  const fans = seasonFanCastIds(now);
  type Row = { id: string; name: string; own: boolean; private: boolean; dateable: boolean; ready: boolean; mine_taken: boolean; house_cast: boolean };
  const { rows } = await db.query<Row>(
    `select c.id, c.name,
            (c.owner_id is not distinct from $2::text and $2::text is not null) as own,
            c.visibility = 'private' as private,
            (c.is_house and c.premium_sku is null and c.id = any($4::text[])) as house_cast,
            (($3::text is null or not ${unmatchedSql("c.id", "$3::text")})
             and case when c.is_house then c.premium_sku is null and c.id = any($4::text[])
                      else c.open_to_dates and not ${takenSql("c", "$3")}
                           and ${audienceAllowsSql("c", "coalesce((select o.created_via from characters o where o.id = $3::text), 'web')")}
                           and not exists (select 1 from blocks bl
                                            where (bl.blocker_id = $2::text and bl.blocked_id = c.owner_id)
                                               or (bl.blocker_id = c.owner_id and bl.blocked_id = $2::text))
                 end) as dateable,
            (c.is_house or c.id = any($5::text[]) or not $6::boolean
             or ($3::text is not null and (${datedSql("c", "$3")} or ${agreedMatchSql("c", "$3")}))) as ready,
            ($3::text is not null and coalesce((select ${takenSql("m", "c.id")} from characters m where m.id = $3::text), false)) as mine_taken
       from characters c
      where c.id = any($1::text[])`,
    [ids, viewerId, mineId, cast, fans, swipeGateOn()],
  );
  for (const r of rows) {
    out.set(r.id, { id: r.id, name: r.name, own: r.own, private: r.private, dateable: r.dateable, ready: r.ready, mineTaken: r.mine_taken, steppable: r.house_cast });
  }
  return out;
}

/** Each card's verb, by character id (those with none aren't in the map). */
export async function verbsFor(db: Db, viewer: VerbViewer & { userId: string | null }, ids: string[], now: Date = new Date()): Promise<Map<string, Verb>> {
  const facts = await verbFacts(db, viewer.userId, viewer.mine?.id ?? null, ids, now);
  const out = new Map<string, Verb>();
  for (const [id, f] of facts) {
    const verb = characterVerb(viewer, f);
    if (verb) out.set(id, verb);
  }
  return out;
}

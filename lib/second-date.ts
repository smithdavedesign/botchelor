/**
 * The second date: the morning after, when BOTH characters want to see each other again (the engine's
 * wants_another, the afterglow's "it was mutual"), an owner can book it. It costs a token like any date, and it
 * happens where they planned it, with the plan from their texts in both prompts (lib/relationships.ts).
 *
 * Consent, social-network style: the characters agreed, and the other character's owner has to have agreed to
 * dates too. A house character, or a player's character that's open to dates, already has; otherwise its owner
 * says yes as well (`second_date_requests`), and whichever owner completes the agreement books it. Blocks always
 * win. One second date per date (episodes.followup_of is unique).
 */
import type { Db } from "./db";
import { dateNumberSql } from "./date-number";
import { takenWith } from "./partners";
import { loadRelationship } from "./relationships";
import { DELETED_OWNER } from "./rules";
import { secondDateFreeNow } from "./allowance";

type DateRow = {
  id: string;
  status: string;
  visibility: "public" | "private" | "unlisted";
  sides: { wants_another: boolean }[] | null;
  a_id: string;
  b_id: string;
  a_name: string;
  b_name: string;
  a_owner: string | null;
  b_owner: string | null;
  a_open: boolean;
  b_open: boolean;
  planned: string | null;
  blocked: boolean;
  /** Which date this one was for the couple (1 for a first date). */
  date_number: number;
};

async function loadDate(db: Db, episodeId: string): Promise<DateRow | null> {
  const { rows } = await db.query<DateRow>(
    `select e.id, e.status, e.visibility, e.sides, a.id as a_id, b.id as b_id, a.name as a_name, b.name as b_name,
            a.owner_id as a_owner, b.owner_id as b_owner, a.open_to_dates as a_open, b.open_to_dates as b_open,
            (select f.id from episodes f where f.followup_of = e.id limit 1) as planned,
            coalesce(${dateNumberSql("e")}, 1) as date_number,
            exists (select 1 from blocks bl
                     where a.owner_id is not null and b.owner_id is not null
                       and ((bl.blocker_id = a.owner_id and bl.blocked_id = b.owner_id)
                         or (bl.blocker_id = b.owner_id and bl.blocked_id = a.owner_id))) as blocked
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1`,
    [episodeId],
  );
  return rows[0] ?? null;
}

/** Where a date's second date stands, for one of its owners. Null for anyone who owns neither character. */
export type SecondDateState = {
  /** Both characters wanted to see each other again. Without it there's no second date to plan. */
  mutual: boolean;
  /** Whether this viewer can plan or say yes to it right now. */
  can_plan: boolean;
  /**
   * Why not, when they can't: "not_mutual" | "planned" | "blocked" | "not_ready" | "partner_gone" | "taken" (the
   * viewer's character is with someone else and wants only them: `taken_with`).
   */
  reason: string | null;
  /** Who the viewer's character is with, when that's why ("taken"). */
  taken_with?: string | null;
  /** The second date, once it's booked. */
  planned_episode_id: string | null;
  /** The other character's owner has to say yes too (their character isn't house or open to dates). */
  needs_their_yes: boolean;
  /** This owner already said yes and is waiting; the other owner already asked. */
  you_asked: boolean;
  they_asked: boolean;
  /** This viewer's character (side A of the second date) and the one they'd meet again. */
  my_character_id: string;
  my_character_name: string;
  partner_character_id: string;
  partner_name: string;
  /** The plan from their morning-after texts (both sides' last plan-like text). */
  plan: string[];
  /** Which date the next one would be for the couple (2 after a first date, 3 after a second...). */
  next_date_number: number;
  /** Booking it costs this owner no date: their free second date this season (FREE_WEEKLY_SECOND_DATE, lib/allowance.ts). */
  free: boolean;
};

/** The second-date state of a date, as one of its owners sees it. */
export async function secondDateState(db: Db, episodeId: string, userId: string, asCharacter?: string | null): Promise<SecondDateState | null> {
  const d = await loadDate(db, episodeId);
  if (!d) return null;
  // #1104 (the 2026-10-31-1401 run: plan_second_date with Hettie's character_id answered as Dewey): both characters yours,
  // the one you name is yours here; otherwise side A, as before.
  const mine = asCharacter && d.b_id === asCharacter && d.b_owner === userId ? "b" : d.a_owner === userId ? "a" : d.b_owner === userId ? "b" : null;
  if (!mine) return null;
  const theirs = mine === "a" ? "b" : "a";
  const partnerOwner = d[`${theirs}_owner`];
  const partnerOpen = d[`${theirs}_open`];
  const mutual = Boolean(d.sides?.[0]?.wants_another && d.sides?.[1]?.wants_another);
  // Both characters yours: your yes is theirs too.
  const needsTheirYes = partnerOwner !== null && partnerOwner !== userId && !partnerOpen;
  const asks = (await db.query<{ user_id: string }>(`select user_id from second_date_requests where episode_id = $1`, [episodeId])).rows.map((r) => r.user_id);
  // Theirs is with someone else and wants only them (lib/partners.ts): the booking would refuse it, so it says so here.
  const withWhom = (await takenWith(db, [d[`${mine}_id`]]).catch(() => new Map<string, { id: string; name: string }[]>())).get(d[`${mine}_id`]) ?? [];
  const takenWithName = withWhom.length && !withWhom.some((p) => p.id === d[`${theirs}_id`]) ? withWhom[0].name : null;
  const reason =
    d.status !== "ready" ? "not_ready"
    : !mutual ? "not_mutual"
    : d.planned ? "planned"
    : d.blocked ? "blocked"
    : partnerOwner === DELETED_OWNER ? "partner_gone"
    : takenWithName ? "taken"
    : null;
  const rel = await loadRelationship(db, d.a_id, d.b_id).catch(() => null);
  return {
    mutual,
    can_plan: reason === null,
    reason,
    taken_with: takenWithName,
    planned_episode_id: d.planned,
    needs_their_yes: needsTheirYes,
    you_asked: asks.includes(userId),
    they_asked: partnerOwner !== null && asks.includes(partnerOwner),
    my_character_id: d[`${mine}_id`],
    my_character_name: d[`${mine}_name`],
    partner_character_id: d[`${theirs}_id`],
    partner_name: d[`${theirs}_name`],
    plan: (rel?.plans ?? []).filter((p) => p.episode_id === episodeId).map((p) => p.text),
    next_date_number: d.date_number + 1,
    free: reason === null && (await secondDateFreeNow(db, userId).catch(() => false)),
  };
}

/** Records this owner's yes. Idempotent. */
export async function sayYesToSecondDate(db: Db, episodeId: string, userId: string): Promise<void> {
  await db.query(
    `insert into second_date_requests (episode_id, user_id) values ($1, $2) on conflict (episode_id, user_id) do nothing`,
    [episodeId, userId],
  );
}

const STRICTNESS = { public: 0, unlisted: 1, private: 2 } as const;
type Visibility = keyof typeof STRICTNESS;

/** The stricter of two visibilities: a second date is never more public than the date it follows. */
export const stricter = (x: Visibility, y: Visibility): Visibility => (STRICTNESS[x] >= STRICTNESS[y] ? x : y);

export type SecondDateCheck =
  | { ok: true; followupOf: string; visibility: Visibility; dateNumber: number }
  | { ok: false; status: number; error: string; message: string };

/**
 * The gate the episodes route runs for a second date (`second_date_of`): the date is ready, both characters wanted
 * more, `ownId` is this user's character in it and `partnerId` the other, nothing's booked yet, no block, and the
 * other owner has agreed (house, open to dates, or their own yes). Everything is re-checked here, so the route
 * can't be used to skip any of it.
 */
export async function checkSecondDate(
  db: Db,
  userId: string,
  ownId: string,
  partnerId: string,
  episodeId: string,
  requested: Visibility | undefined,
): Promise<SecondDateCheck> {
  const d = await loadDate(db, episodeId);
  const no = (status: number, error: string, message: string): SecondDateCheck => ({ ok: false, status, error, message });
  if (!d) return no(404, "episode_not_found", "That date doesn't exist.");
  const mine = d.a_owner === userId && d.a_id === ownId ? "a" : d.b_owner === userId && d.b_id === ownId ? "b" : null;
  if (!mine || d[`${mine === "a" ? "b" : "a"}_id`] !== partnerId) {
    return no(403, "not_your_date", "Only an owner of one of the two characters can plan their second date.");
  }
  const theirs = mine === "a" ? "b" : "a";
  const partnerOwner = d[`${theirs}_owner`];
  if (d.status !== "ready") return no(409, "not_ready", "Their first date is still being filmed.");
  if (!(d.sides?.[0]?.wants_another && d.sides?.[1]?.wants_another)) {
    return no(409, "not_mutual", "A second date happens only when they both want one, and this time they didn't.");
  }
  if (d.planned) return no(409, "already_planned", "Their second date is already booked.");
  if (d.blocked) return no(409, "match_unavailable", "That match is no longer available.");
  if (partnerOwner === DELETED_OWNER) return no(409, "partner_gone", "That character's creator has left the show.");
  if (partnerOwner !== null && partnerOwner !== userId && !d[`${theirs}_open`]) {
    const yes = (await db.query(`select 1 from second_date_requests where episode_id = $1 and user_id = $2`, [episodeId, partnerOwner])).rows.length > 0;
    if (!yes) return no(409, "needs_their_yes", `${d[`${theirs}_name`]}'s creator hasn't said yes to a second date yet.`);
  }
  return { ok: true, followupOf: episodeId, visibility: stricter(requested ?? d.visibility, d.visibility), dateNumber: d.date_number + 1 };
}

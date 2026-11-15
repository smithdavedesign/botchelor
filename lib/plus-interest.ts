/**
 * "Botchelor Plus", the intent tile (2026-11-14, docs/ideas.md's parked table): a $4.99-a-month plan that does not exist
 * yet. Before building a plan nobody has asked for, the shop and the out-of-dates wall show what it would be and one
 * button, "Tell me when it opens". This records who tapped it, where, and whether they left an email; nothing is sold or
 * charged. The gate that reopens the plan: 10 taps, or the first outside purchase of anything.
 *
 * The email itself never lands here: it goes on the Sunday letter's list (lib/newsletter.ts addSignUp, confirmed by a
 * click, one unsubscribe link in every email), the one list the show already has consent, export and delete coverage
 * for, and the letter is how "we'll tell you" would reach them. A row goes with the account (lib/account.ts) and after
 * 400 days (lib/retention.ts).
 */
import type { Db } from "./db";

/** Where the tile was tapped. */
export const PLUS_PLACES = ["shop", "out_of_dates"] as const;
export type PlusPlace = (typeof PLUS_PLACES)[number];

/** Taps one connection may make (lib/limits.ts): a tap is one row, so there's no reason for many. */
export const PLUS_INTEREST_LIMITS = { perHour: 10, perDay: 30 };

/** What the tile promises, in one place, so the shop, the wall and the docs say the same thing. */
export const PLUS_PITCH = {
  name: "Botchelor Plus",
  price: "$4.99 a month",
  gives: ["your character goes out every day", "texts you first", "unlimited speed dates", "a frame on the boards"],
  /** Honest about what it is: nothing to buy yet, and the button only counts. */
  honest: "It doesn't exist yet and nothing is charged. The button only counts who'd want it.",
} as const;

/**
 * Records one person's interest from one place: a second tap from the same place changes nothing, except that an
 * email left later is remembered. Returns whether the row was new.
 */
export async function recordPlusInterest(db: Db, userId: string, place: PlusPlace, withEmail: boolean): Promise<boolean> {
  const { rows } = await db.query<{ created: boolean }>(
    `insert into plus_interest (user_id, place, with_email) values ($1, $2, $3)
     on conflict (user_id, place) do update set with_email = plus_interest.with_email or excluded.with_email
     returning (xmax = 0) as created`,
    [userId, place, withEmail],
  );
  return rows[0]?.created === true;
}

export type PlusInterestCount = { people: number; with_email: number; taps: number };

/** How many people have asked (once each, however many places they tapped), how many left an email, and every tap. */
export async function plusInterestCount(db: Db): Promise<PlusInterestCount> {
  const { rows } = await db.query<{ people: number; with_email: number; taps: number }>(
    `select count(distinct user_id)::int as people,
            count(distinct user_id) filter (where with_email)::int as with_email,
            count(*)::int as taps
       from plus_interest`,
  );
  return rows[0] ?? { people: 0, with_email: 0, taps: 0 };
}

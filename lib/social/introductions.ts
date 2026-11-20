/**
 * Introductions (docs/PRDs/social-network.md section 7; Phase 4, SOCIAL_DYNAMICS): some of the dates the show arranges
 * go to two of this season's cast who share a friend, set up by that friend. The lobby's house dates (lib/watch.ts
 * lobbyDeal), one deal in INTRODUCTION_EVERY by the day's seed, and only when such a pair exists; otherwise the deal is
 * dealt as before. The date records `met_via: "introduced"` and who set it up (setup.introduced_by), and each actor is
 * told who set them up, in its own words (lib/simulation.ts `who_set_you_up`). The engine never reads it.
 *
 * Public ties only: the friend's ties to both are public, active and warm (valence above 0, on the friendship, kin or work
 * layer), and the friend is a public character whose account still exists. Two who have dated, are family or are at odds
 * (a romance, kin or conflict tie, or any `dated` one) aren't set up.
 */
import type { Db } from "../db";
import { seedFrom } from "../engine";
import { shortName } from "../names";
import { DELETED_OWNER } from "../rules";
import { socialDynamicsOn } from "./dynamics";
import { isTieKind, TIE_KINDS, type TieKindId } from "./kinds";

type Env = Record<string, string | undefined>;

/** One lobby deal in this many tries an introduction (by the day's seed). */
export const INTRODUCTION_EVERY = 4;
/** The layers a friend of both is a friend on. */
export const FRIEND_LAYERS = ["friendship", "kin", "work"] as const;
/** The layers that mean two have met already in a way a setup would ignore: they've dated, they're family, or at odds. */
const ALREADY = ["romance", "kin", "conflict"] as const;
/** The deal picks among this many of the strongest pairs, by the day's seed. */
const TOP = 3;

/** A setup: the two, who set them up (a character id) and the friend's short name, and what each actor is told (its own side's line). */
export type Introduction = { a: string; b: string; by: string; byName: string; lines: { a: string; b: string } };

/** One tie as the friend of both has it to one side: its kind, and whether it runs from that side to the friend. */
export type FriendTie = { kind: TieKindId; fromSide: boolean };

/** What the friend is to one side, in the kind's words: "coworker", "close friend", "parent". */
export function roleOf(t: FriendTie): string {
  const words = TIE_KINDS[t.kind].words;
  // A directed tie from X to Y reads "Y is X's <to>": the friend is the side's `to` when the tie runs from the side.
  return t.fromSide ? words.to : words.from;
}

/** The line one actor is told (pure): who set them up, and what that friend is to each of them. */
export function introductionLine(by: string, mine: FriendTie, other: string, theirs: FriendTie): string {
  const who = shortName(by);
  return `${who} set the two of you up: ${who} is your ${roleOf(mine)}, and ${shortName(other)}'s ${roleOf(theirs)}.`;
}

type Row = { a: string; b: string; by: string; a_kind: string; a_from: boolean; b_kind: string; b_from: boolean; strength: number; a_name: string; b_name: string; by_name: string };

/**
 * The introduction for a lobby deal, or null: switched off, not this deal's turn (`seedFrom("lobby-intro", day, n)`), or
 * no two of the cast share a friend. Deterministic for a day and a deal while the ties stand, so the night's plan and
 * the day's room deal the same date (lib/night-plans.ts).
 */
export async function introductionFor(db: Db, cast: readonly string[], day: string, n: number, env: Env = process.env): Promise<Introduction | null> {
  if (!socialDynamicsOn(env) || cast.length < 2 || seedFrom("lobby-intro", day, n) % INTRODUCTION_EVERY !== 0) return null;
  const { rows } = await db.query<Row>(
    `with friendly as (
       select t.from_id as x, t.to_id as y, t.kind, t.closeness, true as from_side from social_ties t
        where t.status = 'active' and t.visibility = 'public' and t.to_id is not null and t.valence > 0 and t.layer = any($2::text[])
       union all
       select t.to_id as x, t.from_id as y, t.kind, t.closeness, false as from_side from social_ties t
        where t.status = 'active' and t.visibility = 'public' and t.to_id is not null and t.valence > 0 and t.layer = any($2::text[])
     )
     select f1.x as a, f2.x as b, f1.y as by, f1.kind as a_kind, f1.from_side as a_from, f2.kind as b_kind, f2.from_side as b_from,
            (f1.closeness * f2.closeness)::float8 as strength, ca.name as a_name, cb.name as b_name, i.name as by_name
       from friendly f1
       join friendly f2 on f2.y = f1.y and f2.x > f1.x
       join characters i on i.id = f1.y and i.visibility = 'public' and i.owner_id is distinct from $3
       join characters ca on ca.id = f1.x
       join characters cb on cb.id = f2.x
      where f1.x = any($1::text[]) and f2.x = any($1::text[])
        and not exists (
          select 1 from social_ties s
           where s.to_id is not null and (s.layer = any($4::text[]) or s.kind = 'dated')
             and ((s.from_id = f1.x and s.to_id = f2.x) or (s.from_id = f2.x and s.to_id = f1.x)))
      order by strength desc, a, b, by
      limit 50`,
    [[...cast], [...FRIEND_LAYERS], DELETED_OWNER, [...ALREADY]],
  );
  // One friend a pair (the strongest), then one of the strongest few pairs by the day's seed.
  const seen = new Set<string>();
  const pairs = rows.filter((r) => isTieKind(r.a_kind) && isTieKind(r.b_kind) && !seen.has(`${r.a}|${r.b}`) && seen.add(`${r.a}|${r.b}`));
  if (!pairs.length) return null;
  const r = pairs[seedFrom("lobby-intro-pick", day, n) % Math.min(TOP, pairs.length)];
  const mine: FriendTie = { kind: r.a_kind as TieKindId, fromSide: r.a_from };
  const theirs: FriendTie = { kind: r.b_kind as TieKindId, fromSide: r.b_from };
  // Who goes first is the day's deal too, as the lobby's seeded pairs are.
  const swap = seedFrom("lobby-intro-side", day, n) % 2 === 1;
  const lines = { a: introductionLine(r.by_name, mine, r.b_name, theirs), b: introductionLine(r.by_name, theirs, r.a_name, mine) };
  const byName = shortName(r.by_name);
  return swap ? { a: r.b, b: r.a, by: r.by, byName, lines: { a: lines.b, b: lines.a } } : { a: r.a, b: r.b, by: r.by, byName, lines };
}

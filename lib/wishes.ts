/**
 * Mutual wishes weigh in on how a date ends (David, 2026-10-20). The engine decides the ending when the date is booked
 * (lib/engine.ts) and the lines are steered there; once the last line is in, each side's private "want to see them
 * again?" gets a say:
 *  - both yes: one step better (a disaster ends as friends, friends as a second date) WISH_TIP_CHANCE of the time;
 *  - both no: one step worse as often;
 *  - mixed, or a side with no wish either way: the engine's ending stands.
 * A nudge, never an override: the roll is seeded by the date (so a replay lands the same way), and nobody sees the seed,
 * so two yeses make a good ending likelier without guaranteeing it.
 *
 * Where a wish comes from: an agent performing a side may send "see_again" (true or false) with that side's last line
 * (lib/own-date.ts); a side it didn't say it for, or the show's model played (go_on_date, a handed-over side), is read
 * from that character's own last interest_signal (WISH_YES_AT and above is yes, WISH_NO_AT and below no).
 *
 * Private until the ending: a wish is kept on the episode (episodes.wishes), never in a view, and a date still being
 * written shows its lines without interest (lib/game.ts). Only a tip says, with the ending, that both wanted it.
 */
import type { Turn } from "./conversation";
import { getEngine, seedFrom, type Outcome, type SideOutcome } from "./engine";
import { ENDINGS, WISH_NO_AT, WISH_TIP_CHANCE, WISH_YES_AT, type DramaAnswer, type DramaQuestion, type Ending } from "./rules";

/** true: wants to see them again; false: doesn't; null: no wish either way. */
export type Wish = boolean | null;
export type Wishes = { a: Wish; b: Wish };
/**
 * What an episode keeps (episodes.wishes). While the date is played: only what a performer said (see_again). Once the
 * last line is in: both sides' wishes as they counted, and the engine's own ending (`engine`), so a tip can be told.
 */
export type StoredWishes = { a?: Wish; b?: Wish; engine?: Ending };

/** A side's interest_signal read as a wish. */
export function interestWish(interest: number | undefined): Wish {
  if (typeof interest !== "number" || !Number.isFinite(interest)) return null;
  return interest >= WISH_YES_AT ? true : interest <= WISH_NO_AT ? false : null;
}

/** Each side's wish: what its performer said, or else its own last line's interest. */
export function resolveWishes(stored: StoredWishes | null | undefined, transcript: readonly Turn[]): Wishes {
  const side = (s: "a" | "b"): Wish => {
    const said = stored?.[s];
    if (typeof said === "boolean") return said;
    if (stored?.engine) return null; // settled: it counted as no wish
    return interestWish([...transcript].reverse().find((t) => t.side === s)?.interest);
  };
  return { a: side("a"), b: side("b") };
}

/** The ending once the wishes weigh in: at most one step, and only when both sides agree. */
export function weighEnding(ending: Ending, wishes: Wishes, seed: number): Ending {
  if (wishes.a === null || wishes.a !== wishes.b) return ending;
  const at = ENDINGS.indexOf(ending);
  // ENDINGS runs best to worst: a step better is one index down.
  const to = wishes.a ? at - 1 : at + 1;
  if (to < 0 || to >= ENDINGS.length) return ending;
  const roll = seedFrom("wishes", String(seed), wishes.a ? "yes" : "no") / 4294967296;
  return roll < WISH_TIP_CHANCE ? ENDINGS[to] : ending;
}

/**
 * The outcome with the wishes weighed in. Unchanged unless they tip it; when they do, both sides' wants_another follow
 * the wish they shared (the afterglow's verdict), and a second date isn't anyone's rejection.
 */
export function applyWishes(outcome: Outcome, wishes: Wishes, seed: number): Outcome {
  // A test that forced its outcome gets exactly that outcome (lib/engine.ts fixedEngine).
  if (getEngine().exact) return outcome;
  const ending = weighEnding(outcome.ending, wishes, seed);
  if (ending === outcome.ending) return outcome;
  const both = wishes.a === true;
  const sides = outcome.sides.map((s): SideOutcome => ({ ...s, wants_another: both })) as [SideOutcome, SideOutcome];
  const drama: { drama_question?: DramaQuestion; drama_answer?: DramaAnswer } =
    ending === "second_date" && outcome.drama_question === "rejected" ? { drama_question: "leaves_first", drama_answer: "neither" } : {};
  return { ...outcome, ending, sides, ...drama };
}

/** What to keep on the episode once the wishes have counted. */
export const settledWishes = (wishes: Wishes, engineEnding: Ending): StoredWishes => ({ a: wishes.a, b: wishes.b, engine: engineEnding });

/** One line beside the ending's "why", only when the wishes tipped it (and so only ever after the ending). */
export function wishLine(stored: StoredWishes | null | undefined, ending: Ending): string | null {
  if (!stored?.engine || stored.engine === ending) return null;
  return stored.a
    ? "Both of them wanted to see each other again, and that tipped it one step better than the numbers alone."
    : "Neither of them wanted to see the other again, and that tipped it one step worse than the numbers alone.";
}

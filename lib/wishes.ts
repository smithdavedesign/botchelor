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
 * `sent` (MCP 2.10.0): which sides' wishes were a see_again their performer sent, the rest read from that side's last
 * interest_signal, so the finished date can tell its owner which (wishReport). Dates settled before it have none.
 */
export type StoredWishes = { a?: Wish; b?: Wish; engine?: Ending; sent?: { a: boolean; b: boolean } };

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

/** What to keep on the episode once the wishes have counted (and, on an agent's date, which sides sent theirs). */
export const settledWishes = (wishes: Wishes, engineEnding: Ending, sent?: { a: boolean; b: boolean }): StoredWishes => ({
  a: wishes.a,
  b: wishes.b,
  engine: engineEnding,
  ...(sent ? { sent } : {}),
});

/** A wish in words. */
const wishWord = (w: Wish): string => (w === true ? "yes" : w === false ? "no" : "no wish either way");

/** What a side's last interest_signal read as, standing in for a see_again it didn't send, with the bars. */
function standIn(interest: number | undefined): string {
  if (typeof interest !== "number" || !Number.isFinite(interest)) return "it counted as no wish either way";
  const w = interestWish(interest);
  return `its interest_signal (${interest}) stood in: ${w === null ? "no wish either way" : `a ${wishWord(w)}`} (${WISH_YES_AT} or more counts as yes, ${WISH_NO_AT} or less as no)`;
}

/** One side's wish on a finished date, as that side's own owner reads it (wishReport). */
export type SeenWish = {
  character: string;
  see_again: Wish;
  /** The see_again its performer sent, its last line's interest_signal standing in, the show's model's line, or unknown (settled before 2.10.0). */
  from: "see_again" | "interest_signal" | "the_show" | "unknown";
  interest_signal?: number;
};

/**
 * How the wishes counted on a finished date, for one owner (MCP 2.10.0, the 2026-10-22-0800 run: all three visitors wrote
 * "friends" into the dialogue, never sent see_again, and the engine said second_date). Each side this owner's characters
 * are on is told: its wish, and whether it was the see_again its performer sent or that side's last interest_signal standing
 * in (with how to steer next time). The other side's wish stays private, as it always has (lib/game.ts: never which way a
 * lone wish went), unless the two agreed and tipped the ending, which the ending's why tells anyone. Null until they count.
 */
export function wishReport(o: {
  stored: StoredWishes | null | undefined;
  transcript: readonly Turn[];
  ending: Ending;
  names: readonly [string, string];
  /** The sides this owner's characters are on: both on a date between its own two. */
  mine: readonly ("a" | "b")[];
  /** Sides whose lines the show's model played at the end (a hand-over, autoplay). */
  showPlayed?: readonly ("a" | "b")[];
}): { tipped: boolean; engine_ending?: Ending; yours: SeenWish[]; theirs?: "private" | { character: string; see_again: Wish }; note: string } | null {
  const s = o.stored;
  if (!s?.engine || !o.mine.length) return null;
  const tipped = s.engine !== o.ending;
  const wish = (x: "a" | "b"): Wish => (typeof s[x] === "boolean" ? (s[x] as boolean) : null);
  const name = (x: "a" | "b") => o.names[x === "a" ? 0 : 1];
  const first = (x: "a" | "b") => name(x).split(" ")[0];
  const seen = (x: "a" | "b"): SeenWish => {
    const from: SeenWish["from"] = !s.sent ? "unknown" : s.sent[x] ? "see_again" : o.showPlayed?.includes(x) ? "the_show" : "interest_signal";
    const interest = [...o.transcript].reverse().find((t) => t.side === x)?.interest;
    return { character: name(x), see_again: wish(x), from, ...(from !== "see_again" && typeof interest === "number" ? { interest_signal: interest } : {}) };
  };
  const yours = o.mine.map(seen);
  const said = yours.map((y, i) => {
    const who = first(o.mine[i]);
    if (y.from === "see_again") return `${who} said ${wishWord(y.see_again)} (see_again: ${String(y.see_again)}).`;
    if (y.from === "the_show") return `The show's model played ${who}'s last line, so ${standIn(y.interest_signal)}.`;
    if (y.from === "interest_signal") return `No see_again on ${who}'s last line, so ${standIn(y.interest_signal)}. Next time, send see_again: true or false with that line: it's how you steer.`;
    return `${who}'s wish counted as ${wishWord(y.see_again)}.`;
  });
  const solo = o.mine.length === 2;
  const other = solo ? null : o.mine[0] === "a" ? "b" : "a";
  const edge = (w: Wish) => (w === true && o.ending === "second_date") || (w === false && o.ending === "disaster");
  const own = `${o.ending} is the engine's own ending`;
  let outcome: string;
  if (tipped) {
    outcome = `Both said ${wishWord(s.a ?? null)}: it tipped toward ${s.a ? "a better ending" : "a parting"}: ${o.ending}, where the engine alone had ${s.engine}.`;
  } else if (solo) {
    const [wa, wb] = [wish("a"), wish("b")];
    outcome =
      wa !== null && wa === wb
        ? edge(wa)
          ? `Both said ${wishWord(wa)}, but ${o.ending} is already the ${wa ? "best" : "worst"} ending: nothing to tip.`
          : `Both said ${wishWord(wa)}, but the engine kept ${o.ending} this time (a tip comes only some of the time).`
        : wa === null || wb === null
          ? `With no wish either way on one side, nothing could tip it: ${own}.`
          : `${first("a")} said ${wishWord(wa)}, ${first("b")} ${wishWord(wb)}: mixed, so no tip; ${own}.`;
  } else {
    const mine = wish(o.mine[0]);
    outcome = edge(mine)
      ? `${o.ending} is already the ${mine ? "best" : "worst"} ending, so ${first(o.mine[0])}'s ${wishWord(mine)} had nothing to tip.`
      : `${first(other!)}'s wish stays private (only an agreement that tips the ending is told). The wishes tip an ending only when both agree, and then only some of the time: they didn't tip this one, so ${own}.`;
  }
  return {
    tipped,
    ...(tipped ? { engine_ending: s.engine } : {}),
    yours,
    ...(other ? { theirs: tipped ? { character: name(other), see_again: wish(other) } : ("private" as const) } : {}),
    note: [...said, outcome].join(" "),
  };
}

/** One line beside the ending's "why", only when the wishes tipped it (and so only ever after the ending). */
export function wishLine(stored: StoredWishes | null | undefined, ending: Ending): string | null {
  if (!stored?.engine || stored.engine === ending) return null;
  return stored.a
    ? "Both of them wanted to see each other again, and that tipped it one step better than the numbers alone."
    : "Neither of them wanted to see the other again, and that tipped it one step worse than the numbers alone.";
}

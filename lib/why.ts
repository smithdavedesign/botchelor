/**
 * One line on why a date ended the way it did, from what the engine decided it on (lib/engine.ts): where the four
 * box-score numbers finished, which of them the date's strategy weighs most, and whether a dealbreaker tripped.
 * Both uninstructed agent runs asked for it ("disaster, while every number rose"): the ending reads where the numbers
 * finished, not how far they moved. Deterministic, free, and no spoiler beyond the ending it explains (it never says
 * which side wanted more, or whose dealbreaker it was).
 */
import { DEALBREAKER_PENALTY, endingScore, type SideOutcome } from "./engine";
import { DATE_VARIABLES, STRATEGY_LABELS, type DateVariable, type Ending, type Strategy } from "./rules";

type Box = Partial<Record<DateVariable, { final: number }>>;

/** Which number each strategy leans on hardest (lib/engine.ts STRATEGY_WEIGHTS, largest weight first). */
const LEANS_ON: Record<Strategy, DateVariable> = {
  genuine_chemistry: "chemistry",
  fun_adventure: "awkwardness",
  long_term: "trust",
  unexpected: "chemistry",
};

const GOOD: DateVariable[] = ["chemistry", "attraction", "trust"];
const at = (box: Box, v: DateVariable) => Math.round(box[v]?.final ?? 50);
const say = (box: Box, v: DateVariable) => `${v} ${at(box, v)}`;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

/**
 * The arithmetic behind the ending (run 5: "chemistry 62 was a disaster and 68 was friends?"): how the date's strategy
 * weighs the four numbers, what the date came to against an ordinary one, and the marks for friends and a second date.
 * Only where it can be reproduced exactly: an engine v2+ date, its strategy known, and its sides (for the dealbreakers).
 */
export function endingNumbers(box: Box | null | undefined, sides: readonly SideOutcome[] | null | undefined, strategy: Strategy | null | undefined, version: number | null | undefined): string | null {
  if (!box || !sides || !strategy || (version ?? 1) < 2 || !DATE_VARIABLES.every((v) => box[v])) return null;
  const dealbreakers = sides.filter((s) => s.dealbreaker_hit).length;
  const finals = Object.fromEntries(DATE_VARIABLES.map((v) => [v, box[v]!.final])) as Record<DateVariable, number>;
  const s = endingScore(strategy, finals, dealbreakers);
  const w = s.weights;
  return (
    `By the numbers: a date played for ${STRATEGY_LABELS[strategy].toLowerCase()} counts chemistry ${pct(w.chemistry)}, attraction ` +
    `${pct(w.attraction)} and trust ${pct(w.trust)}, minus ${pct(w.awkwardness)} of awkwardness` +
    `${dealbreakers ? ` and ${DEALBREAKER_PENALTY} for ${dealbreakers === 1 ? "the tripped dealbreaker" : "each tripped dealbreaker"}` : ""}. ` +
    `This one came out ${signed(s.rel)} against an ordinary date: friends needs ${signed(s.friendsAt)}, a second date ${signed(s.secondDateAt)}.`
  );
}

export function endingWhy(
  ending: Ending,
  box: Box | null | undefined,
  sides: readonly SideOutcome[] | null | undefined,
  strategy: Strategy | null | undefined,
  version?: number | null,
  /** The two characters' names, in side order: says whose dealbreaker tripped (#337), never what it was. */
  names?: readonly [string, string],
): string | null {
  if (!box || !GOOD.some((v) => box[v])) return null;
  const goods = [...GOOD].sort((x, y) => at(box, y) - at(box, x));
  const [best, , worst] = goods;
  const awkward = at(box, "awkwardness");
  const dealbreaker = Boolean(sides?.some((s) => s.dealbreaker_hit));
  // #337: "a dealbreaker tripped" alone left an agent unsure which side's. Whose, by first name; never its text
  // (that's the guess_dealbreaker game).
  const tripped = (sides ?? []).flatMap((s, i) => (s.dealbreaker_hit && names?.[i] ? [names[i].split(/\s+/)[0]] : []));
  const dealbreakerWords = tripped.length === 2 ? "both their dealbreakers tripped" : tripped.length === 1 ? `${tripped[0]}'s dealbreaker tripped` : "a dealbreaker tripped";
  const wantMet = Boolean(sides?.some((s) => s.want_met));
  // Run 3: "scored for genuine chemistry, which leans on chemistry" next to a disaster with chemistry at 72 read as
  // nonsense. Say what outweighed what instead, and name the strategy only when its lean explains the result.
  const leans = strategy ? LEANS_ON[strategy] : null;
  const leanNote = (v: DateVariable | null) =>
    strategy && leans && leans !== "awkwardness" && v === leans ? ` (a date played for ${STRATEGY_LABELS[strategy].toLowerCase()} counts ${leans} most)` : "";

  let line: string;
  if (ending === "second_date") {
    line = `A second date: ${say(box, best)} and ${say(box, goods[1])} carried it${leanNote(best)}${wantMet ? ", and someone's want was met" : ""}${awkward >= 55 ? `, awkwardness (${awkward}) and all` : ""}.`;
  } else if (ending === "friends") {
    line = `Just friends: warm enough (${say(box, best)}), but ${say(box, worst)} never got there${leanNote(worst)}${dealbreaker ? `, and ${dealbreakerWords}` : ""}.`;
  } else {
    const lows = goods.filter((v) => at(box, v) < 50).reverse().slice(0, 2);
    const reasons = [
      ...(dealbreaker ? [dealbreakerWords] : []),
      ...(lows.length ? [`${lows.map((v) => say(box, v)).join(" and ")} finished low${leanNote(lows[0])}`] : []),
      ...(awkward >= 50 ? [`awkwardness finished at ${awkward}`] : []),
    ];
    const despite = at(box, best) >= 60 ? `, and that outweighed ${say(box, best)}` : "";
    line = `A disaster: ${reasons.length ? `${reasons.join(", ")}${despite}` : `nothing landed hard enough (best was ${say(box, best)})`}.`;
  }
  const numbers = endingNumbers(box, sides, strategy, version);
  return `${line} Endings read where the numbers finished, not how far they moved.${numbers ? ` ${numbers}` : ""}`;
}

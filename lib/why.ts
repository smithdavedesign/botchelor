/**
 * One line on why a date ended the way it did, from what the engine decided it on (lib/engine.ts): where the four
 * box-score numbers finished, which of them the date's strategy weighs most, and whether a dealbreaker tripped.
 * Both uninstructed agent runs asked for it ("disaster, while every number rose"): the ending reads where the numbers
 * finished, not how far they moved. Deterministic, free, and no spoiler beyond the ending it explains (it never says
 * which side wanted more, or whose dealbreaker it was).
 */
import type { SideOutcome } from "./engine";
import { STRATEGY_LABELS, type DateVariable, type Ending, type Strategy } from "./rules";

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

export function endingWhy(ending: Ending, box: Box | null | undefined, sides: readonly SideOutcome[] | null | undefined, strategy: Strategy | null | undefined): string | null {
  if (!box || !GOOD.some((v) => box[v])) return null;
  const goods = [...GOOD].sort((x, y) => at(box, y) - at(box, x));
  const [best, , worst] = goods;
  const awkward = at(box, "awkwardness");
  const dealbreaker = Boolean(sides?.some((s) => s.dealbreaker_hit));
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
    line = `Just friends: warm enough (${say(box, best)}), but ${say(box, worst)} never got there${leanNote(worst)}${dealbreaker ? ", and a dealbreaker tripped" : ""}.`;
  } else {
    const lows = goods.filter((v) => at(box, v) < 50).reverse().slice(0, 2);
    const reasons = [
      ...(dealbreaker ? ["a dealbreaker tripped"] : []),
      ...(lows.length ? [`${lows.map((v) => say(box, v)).join(" and ")} finished low${leanNote(lows[0])}`] : []),
      ...(awkward >= 50 ? [`awkwardness finished at ${awkward}`] : []),
    ];
    const despite = at(box, best) >= 60 ? `, and that outweighed ${say(box, best)}` : "";
    line = `A disaster: ${reasons.length ? `${reasons.join(", ")}${despite}` : `nothing landed hard enough (best was ${say(box, best)})`}.`;
  }
  return `${line} Endings read where the numbers finished, not how far they moved.`;
}

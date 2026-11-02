/**
 * More endings (David 2026-11-01, docs/date-quality.md "Round: more endings"): one-sided, a slow burn, a walk-out,
 * ghosted and rivals. Each is a kind of one of the three endings (lib/rules.ts ENDING_DETAIL_FAMILY), never a fourth, so
 * everything that keys on the ending (predictions and points, endings lately, the Reunion, seasons, MCP, analytics, the
 * sims) is unchanged; the kind is kept beside it (episodes.ending_detail) for pages, labels, notices and MCP to show.
 *
 * Where each comes from, on a date decided under engine v5 (lib/choices.ts: the two sides' own answers):
 *   - a walk-out: on a disaster, one side (walkOutSide, seeded) may walk out in the closing stretch; when its line does
 *     ("walk_out", lib/conversation.ts), the date ends there and the line is marked walked_out.
 *   - ghosted: one side said no and the other wanted to see them again (yes or maybe); on half of those (seeded,
 *     ghostSide) the one who said no never answers the morning-after texts (lib/afterglow.ts silent).
 *   - rivals: both sides spent the date competitive with each other (twice or more each, their own private feeling,
 *     lib/inner-life.ts), and they didn't both want another date.
 *   - a slow burn: friends, nobody said no, and the morning-after texts make a plan they both agree to (lib/plans.ts):
 *     decided by the texts after, the way a slow burn is. No texts (the afterglow off), no slow burn.
 *   - one-sided: one said yes and the other no (and it wasn't ghosting).
 * First match wins, in that order. Everything here is decided while the date is written, before it's ready, so the
 * prediction window (which opens once it's ready) never sees it move, and a prediction scores on the family as before.
 * Pure, no server imports.
 */
import type { Outcome } from "./engine";
import { seedFrom } from "./engine";
import type { LineInner, SeeAgain } from "./inner-life";
import { agreedPlan } from "./plans";
import { endingDetailOf, type Ending, type EndingDetail } from "./rules";

/** How often a disaster offers one side the walk-out, and a no-against-a-yes becomes ghosting: half of each. */
export const WALK_OUT_SHARE = 0.5;
export const GHOST_SHARE = 0.5;
/** How many of its own lines a side spends competitive for the date to read as rivals. */
export const RIVAL_LINES = 2;

const roll = (...parts: (string | number)[]) => seedFrom(...parts) / 4294967296;

/**
 * Which side may walk out of this date, or null: only on a disaster, on WALK_OUT_SHARE of them (seeded by the date), and
 * the side it went worse for (a dealbreaker it hit, else the one less satisfied, else the side the seed picks).
 */
export function walkOutSide(outcome: Pick<Outcome, "ending" | "seed" | "sides">): "a" | "b" | null {
  if (outcome.ending !== "disaster") return null;
  const seed = outcome.seed ?? 0;
  if (roll("walk-out", seed) >= WALK_OUT_SHARE) return null;
  const [a, b] = outcome.sides;
  if (a.dealbreaker_hit && !b.dealbreaker_hit) return "a";
  if (b.dealbreaker_hit && !a.dealbreaker_hit) return "b";
  if (a.satisfied !== b.satisfied) return a.satisfied ? "b" : "a";
  return roll("walk-out-side", seed) < 0.5 ? "a" : "b";
}

/** Who ghosts the other, or null: the side that said no against a yes or a maybe, on GHOST_SHARE of those (seeded). */
export function ghostSide(choices: { a: SeeAgain; b: SeeAgain } | null | undefined, seed: number): "a" | "b" | null {
  if (!choices) return null;
  const no = choices.a === "no" && choices.b !== "no" ? "a" : choices.b === "no" && choices.a !== "no" ? "b" : null;
  if (!no) return null;
  return roll("ghosted", seed) < GHOST_SHARE ? no : null;
}

export type DetailInput = {
  ending: Ending;
  choices?: { a: SeeAgain; b: SeeAgain } | null;
  /** The date's lines as they were written (with their inner life), or as stored (walked_out is on the line). */
  transcript: readonly { side: "a" | "b"; walked_out?: boolean; inner?: LineInner }[];
  afterglow?: readonly { side: "a" | "b"; text: string }[] | null;
  ghost?: "a" | "b" | null;
  names: readonly [string, string];
};

/** The kind of ending this date had, or null when it was the plain one. See the top for each rule. */
export function endingDetail(d: DetailInput): EndingDetail | null {
  const pick = (k: EndingDetail) => endingDetailOf(k, d.ending);
  const c = d.choices;
  if (d.transcript.some((t) => t.walked_out)) {
    const w = pick("walked_out");
    if (w) return w;
  }
  if (d.ghost && c) {
    const g = pick("ghosted");
    if (g) return g;
  }
  const competitive = (s: "a" | "b") => d.transcript.filter((t) => t.side === s && t.inner?.feeling === "competitive").length >= RIVAL_LINES;
  if (competitive("a") && competitive("b") && !(c?.a === "yes" && c?.b === "yes")) {
    const r = pick("rivals");
    if (r) return r;
  }
  if (c && c.a !== "no" && c.b !== "no" && d.afterglow?.length) {
    const texts = d.afterglow.map((t) => ({ who: t.side === "a" ? ("lo" as const) : ("hi" as const), text: t.text }));
    const bothTexted = d.afterglow.some((t) => t.side === "a") && d.afterglow.some((t) => t.side === "b");
    if (bothTexted && agreedPlan(texts, { lo: d.names[0], hi: d.names[1] })) {
      const s = pick("slow_burn");
      if (s) return s;
    }
  }
  if (c && ((c.a === "yes" && c.b === "no") || (c.a === "no" && c.b === "yes"))) return pick("one_sided");
  return null;
}

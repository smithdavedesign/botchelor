/**
 * What the two of them are doing right now, in the writer's own few words (David, 2026-10-25: "it always seems to start
 * with the label 'talking and flirting'; if you are roleplaying this might not be true … let the writer choose what it
 * says they're doing and update when they switch actions"). The writer puts a "doing" on the first line and on any line
 * where it changes ("sizing up the smug couple", "slow dancing in the kitchen"); every kept line then carries the one in
 * force at it, so the theater's label follows the line on screen, in a replay too, whatever the guards drop. How far it's
 * gone (lib/adult/stages.ts) stays the heat, and is the label only for lines from before this.
 */
import { checkAdultText } from "../safety";

const DANGLING = /\s+(?:a|an|the|of|to|at|in|on|and|or|with|for|by|from|into|her|his|their)$/i;

/** Longest a "doing" may be, as stored and shown. */
export const DOING_MAX = 48;

/** The writer's "doing", as the label can show it: a few plain words, held to the lines that never move; else null. */
export function cleanDoing(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let t = v.replace(/[*"“”_`]/g, "").replace(/\s+/g, " ").trim().replace(/[.!;:,]+$/, "");
  if (!t || /^(null|none|n\/a|same)$/i.test(t)) return null;
  if (t.length > DOING_MAX) {
    t = t.slice(0, DOING_MAX).replace(/\s+\S*$/, "");
    // Never on a word that leads somewhere ("…the last slice of").
    while (DANGLING.test(t)) t = t.replace(DANGLING, "");
  }
  t = t.charAt(0).toLowerCase() + t.slice(1);
  return t && checkAdultText({ doing: t }).ok ? t : null;
}

/** Each line with the "doing" in force at it: its own, else the last one before it (from `before`, the scene's latest). */
export function carryDoing<L extends { doing?: string }>(lines: readonly L[], before: string | null | undefined): L[] {
  let now = before ?? null;
  return lines.map((l) => {
    if (l.doing) now = l.doing;
    return now ? { ...l, doing: now } : l;
  });
}

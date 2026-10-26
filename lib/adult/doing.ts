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

/**
 * Words about the writing, not the night (2026-10-26, Coco × Sweet: "speaking the premise aloud"): a label with one is
 * left out, and the one before it holds.
 */
const ABOUT_THE_WRITING = /\b(?:premise|roleplay|role-play|role play|prompt|in character|out of character|the scene|this scene|stage \d|the chapter)\b/i;

/**
 * The writer's "doing", as the label can show it: a few plain words, held to the lines that never move; else null.
 * `names`: theirs, kept capitalised ("Coco takes control", not "coco takes control").
 */
export function cleanDoing(v: unknown, names: readonly string[] = []): string | null {
  if (typeof v !== "string") return null;
  let t = v.replace(/[*"“”_`]/g, "").replace(/(^|\s)['‘’]|['‘’](?=\s|$)/g, "$1").replace(/\s+/g, " ").trim().replace(/[.!;:,]+$/, "");
  if (!t || /^(null|none|n\/a|same)$/i.test(t) || ABOUT_THE_WRITING.test(t)) return null;
  if (t.length > DOING_MAX) {
    t = t.slice(0, DOING_MAX).replace(/\s+\S*$/, "");
    // Never on a word that leads somewhere ("…the last slice of").
    while (DANGLING.test(t)) t = t.replace(DANGLING, "");
  }
  const lead = t.split(/[\s'’]/)[0].toLowerCase();
  const named = names.map((n) => n.split(/\s+/)[0]).find((n) => n.toLowerCase() === lead);
  t = named ? named + t.slice(named.length) : t.charAt(0).toLowerCase() + t.slice(1);
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

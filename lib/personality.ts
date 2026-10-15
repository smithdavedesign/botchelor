/**
 * Personality that reacts to the date (David, 2026-10-15: "give our AI characters more room to grow and be
 * unique"). A character's tells (lib/extras.ts TELLS) are habits that slip out when it feels a certain way:
 * nervous, smitten, bored, annoyed. Handing the model all four as a list makes it recite them; handing it the
 * ONE that fits how this act is going for this character makes the personality respond to the date.
 *
 * Which one fits comes from the engine's already-decided outcome, act by act, exactly like the beat sheet
 * (lib/beats.ts): first-meeting nerves in act one; then how this side really feels about the other, which the
 * engine settled (wants another date, tripped dealbreaker, the ending). So a tell can only ever perform the
 * decided date, never change it. Pure and deterministic; prompts only, never the engine.
 */
import type { Character } from "./character";
import type { Outcome } from "./engine";
import { tellLabel, type TellId } from "./extras";

/** The tell that fits this side in this act of the decided date. */
export function tellMoment(outcome: Outcome, side: 0 | 1, act: number): TellId {
  if (act === 0) return "nervous"; // first meeting: everyone's a little nervous
  const mine = outcome.sides[side];
  if (mine.wants_another) return outcome.ending === "disaster" && act === 2 ? "nervous" : "smitten";
  if (mine.dealbreaker_hit || outcome.ending === "disaster") return "annoyed";
  return "bored";
}

/** This side's tell for this act, as the model reads it ("When you're nervous, you over-explain the menu."); null when it has none for that feeling. */
export function currentTell(c: Character, outcome: Outcome, side: 0 | 1, act: number): string | null {
  const id = tellMoment(outcome, side, act);
  const does = c.extras.tells?.[id]?.trim();
  return does ? `${secondPerson(tellLabel(id))} ${does}` : null;
}

/** "When they're nervous, they…" → "When you're nervous, you" (the actor is spoken to in the second person). */
function secondPerson(label: string): string {
  return label
    .replace(/…$/, "")
    .replace(/\bthey're\b/g, "you're")
    .replace(/\bthey\b/g, "you")
    .replace(/\bthem\b/g, "you")
    .trim();
}

/** All of a character's tells, for the director (who plans the whole date): "When they're nervous, they over-explain the menu." */
export function allTells(c: Character): string[] {
  return Object.entries(c.extras.tells ?? {})
    .filter(([, v]) => v?.trim())
    .map(([id, v]) => `${tellLabel(id).replace(/…$/, "")} ${v!.trim()}`);
}

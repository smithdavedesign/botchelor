/**
 * A finished show date narrated (lib/narration.ts): each line of the transcript gets its prose, written on the show's
 * director model once the conversation is done, before the date is saved. The lines themselves never change, and a
 * line whose prose didn't come or failed the show's checks stays a script line.
 */
import type { Character } from "./character";
import type { Turn } from "./conversation";
import { frontierConfigured, getDirectorModel, getFrontierModel, type Model, type Usage } from "./model";
import { narrate, type NarrateLine, type Narration } from "./narration";
import { shortName } from "./names";
import { venueName } from "./venues";

/** Sent with every narrator call on the frontier: prose needs no thinking, which bills (and counts) as output. */
const NO_THINKING = { reasoning: { effort: "none" } };

/**
 * The show's narrator, for a date's prose and its story: the frontier model when it's configured (as show dates are),
 * with its thinking off, else the director model. The first live date (2026-11-17) spent 649 of its 1,452 narration
 * output tokens thinking, and its story's reply was cut off by the length cap before it closed.
 */
export function showNarrator(): Model {
  return (frontierConfigured() ? getFrontierModel(NO_THINKING) : null) ?? getDirectorModel(process.env, undefined, false);
}

/** A line as the narrator reads it: its speaker's first name, what's said ("…" is nothing said) and what's done. */
export function turnToNarrate(t: Pick<Turn, "side" | "dialogue" | "action">, names: { a: string; b: string }): NarrateLine {
  const said = t.dialogue.trim();
  return { who: t.side === "a" ? names.a : names.b, dialogue: /^[.…\s]*$/.test(said) ? "" : said, action: t.action };
}

/** A character in a few words for the narrator: their traits, never anything private. */
export const aboutOf = (c: Pick<Character, "persona" | "age">): string => [c.age ? `${c.age}` : "", ...c.persona.traits.slice(0, 3)].filter(Boolean).join(", ");

/** Where a date is said to be, by name. */
function placeOf(venue: string | null | undefined): string | null {
  if (!venue) return null;
  try {
    return venueName(venue);
  } catch {
    return venue;
  }
}

export async function narrateDate(
  model: Model,
  turns: readonly Turn[],
  characters: readonly [Pick<Character, "name" | "persona" | "age">, Pick<Character, "name" | "persona" | "age">],
  venue: string | null | undefined,
  onUsage?: (u: Usage) => void,
): Promise<{ turns: Turn[]; narration: Narration }> {
  const names = { a: shortName(characters[0].name), b: shortName(characters[1].name) };
  const narration = await narrate(
    model,
    {
      rating: "pg",
      people: [
        { name: names.a, about: aboutOf(characters[0]) },
        { name: names.b, about: aboutOf(characters[1]) },
      ],
      place: placeOf(venue),
      lines: turns.map((t) => turnToNarrate(t, names)),
    },
    onUsage ? { onUsage } : {},
  );
  return { turns: turns.map((t, i) => (narration.beats[i] ? { ...t, beat: narration.beats[i]! } : t)), narration };
}

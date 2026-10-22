/**
 * Structured reflection labels (data plan Tier 2, David 2026-10-22): next to a character's reflection in its own words,
 * a few labels its creator (a person or an agent, MCP reflect_on_date) can set on a finished date: a 1–5 rating,
 * whether it would date them again, and up to three tags each for what worked and what didn't.
 *
 * Owner-only, like the wishes: stored on `episodes.reflection_labels` ({a, b}, one side each), never in the public
 * episode, a prompt or the engine. They're in the owner's export and go when the character is forgotten. Pure: no
 * server imports, so the route, the MCP schema and the tests share it.
 */
import { z } from "zod";

/** What worked or didn't on a date. Short ids, one vocabulary for both lists. */
export const REFLECTION_TAGS = [
  "conversation",
  "humour",
  "chemistry",
  "listening",
  "honesty",
  "shared_interests",
  "flirting",
  "pacing",
  "the_venue",
  "values",
  "energy",
  "respect",
] as const;
export type ReflectionTag = (typeof REFLECTION_TAGS)[number];
export const REFLECTION_TAGS_MAX = 3;

const Tags = z.array(z.enum(REFLECTION_TAGS)).max(REFLECTION_TAGS_MAX, `At most ${REFLECTION_TAGS_MAX} tags.`);

/** The labels one side can send; each optional, and a later call fills in or changes only what it sends. */
export const ReflectionLabelsInput = z
  .object({
    rating: z.number().int("A whole number from 1 to 5.").min(1).max(5).optional(),
    would_date_again: z.boolean().optional(),
    worked: Tags.optional(),
    didnt: Tags.optional(),
  })
  .refine((l) => !l.worked?.some((t) => l.didnt?.includes(t)), { message: "A tag can't be in both worked and didnt.", path: ["didnt"] });
export type ReflectionLabels = z.infer<typeof ReflectionLabelsInput>;

/** The labels actually sent (tags deduped), or null when none were. */
export function labelsOf(input: ReflectionLabels): ReflectionLabels | null {
  const out: ReflectionLabels = {};
  if (input.rating !== undefined) out.rating = input.rating;
  if (input.would_date_again !== undefined) out.would_date_again = input.would_date_again;
  if (input.worked) out.worked = [...new Set(input.worked)];
  if (input.didnt) out.didnt = [...new Set(input.didnt)];
  return Object.keys(out).length ? out : null;
}

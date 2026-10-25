/**
 * A life that moves (David, 2026-10-15: "more room to grow"). Every character has something going on THIS
 * week: a small, fresh piece of their life to bring up on a date, so a character on its tenth date isn't
 * retelling its bio. It changes every season (the Monday-to-Monday week, lib/season-cast.ts).
 *
 * Where it comes from:
 *  - its creator can write one ("Just adopted a very old cat"), which lasts for the season it was written in;
 *  - otherwise the show deals one from the pool below, by seed (character id + season), so it's stable all week
 *    and different next week. A creator can also say "nothing this week" (an empty update).
 *
 * Public (it's on the card, like a status line). Prompts only: the engine never reads it, so it changes what a
 * character might mention, never how a date ends. Pure, no database.
 */
import { seedFrom } from "./engine";
import { weekIdOf as seasonIdAt } from "./season-window";

export const THIS_WEEK_MAX = 140;

/** What's stored on characters.this_week: the creator's own update and the season it was written for. */
export type StoredThisWeek = { text: string; season: string };

/**
 * Small, harmless, adult-life news, written as a status line with no subject ("Pet-sitting a very judgemental
 * cat"), so the same words work on the card and in the character's own prompt, whatever its pronouns.
 */
export const LIFE_EVENTS: readonly string[] = [
  "A new houseplant, already named",
  "Got locked out twice this week",
  "Learning to juggle from videos",
  "Signed up for a 5k, now having second thoughts",
  "Won a pub quiz on a technicality",
  "A new upstairs neighbour who plays the tuba",
  "Finally fixed a squeaky door, and unreasonably proud of it",
  "Accidentally joined a book club",
  "Day four of giving up coffee",
  "A new haircut, still deciding about it",
  "Found a twenty in an old coat",
  "Dreamt about being a pirate and can't shake it",
  "Pet-sitting a very judgemental cat",
  "Rearranged the furniture; keeps walking into the sofa",
  "Got stuck in a lift for forty minutes",
  "Started a sourdough starter named Gerald",
  "Signed up for a pottery class on impulse",
  "Halfway through a very long novel, with opinions",
  "Lost a bet: wearing a ridiculous hat all week",
  "Phone screen cracked in a perfect star shape",
  "Learning the name of every bird in the park",
  "Just found out a word they use all the time is pronounced differently",
  "A new job title, same desk",
  "Writing the speech for a friend's wedding next month",
  "Finally finished a video game started years ago",
  "Booked a holiday and immediately started worrying about it",
  "Has viewed eleven tiny flats this week",
  "First ever karaoke night, and now can't stop",
  "Started journaling; it's mostly lists",
  "A parking ticket in a spot with no sign (allegedly)",
  "Adopted a very old, very calm dog",
  "Repainting the kitchen a colour that's already a regret",
  "Asked to judge a chilli cook-off",
  "Took up birdwatching; one pigeon so far",
  "Cooking every recipe in one cookbook",
  "Fighting a cold and denying it",
  "Bought a bicycle and relearning to ride it",
  "Deep in a feud with a vending machine",
  "Volunteered at an animal shelter; wants to adopt all of them",
  "Saying yes to everything this week",
] as const;

/** The event the show deals a character for a season: stable all week, different next week. */
export function dealtEvent(characterId: string, season: string): string {
  return LIFE_EVENTS[seedFrom(characterId, "this-week", season) % LIFE_EVENTS.length];
}

/**
 * What's new in a character's life this week, or null for "nothing this week". The creator's own update wins
 * during the season it was written for; after that (or with none) the show deals one.
 */
export function thisWeek(characterId: string, stored: StoredThisWeek | null | undefined, now: Date = new Date()): string | null {
  const season = seasonIdAt(now);
  if (stored && stored.season === season) return stored.text.trim() || null;
  return dealtEvent(characterId, season);
}

/** Whether the creator wrote this week's update themselves (vs the show dealing one). */
export function isOwnUpdate(stored: StoredThisWeek | null | undefined, now: Date = new Date()): boolean {
  return Boolean(stored && stored.season === seasonIdAt(now));
}

/** Stamps a creator's update with the current season; null (back to the show's pick) stays null. */
export function stampThisWeek(text: string | null, now: Date = new Date()): StoredThisWeek | null {
  return text === null ? null : { text: text.trim(), season: seasonIdAt(now) };
}

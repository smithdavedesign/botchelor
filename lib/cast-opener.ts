/**
 * A cast character opens with what happened to it (2026-11-15). When someone starts talking with a house or cast
 * character that isn't theirs, its first message used to be a model-written hello that could have come from any
 * companion app. What ours have is a life you can watch, so the opener is built from the character's last aired date:
 * who it was with, where, how it ended, its own reflection on it when the date has one (episodes.reflections), and a
 * link to watch it (lib/companion-shared.ts watchLinkEpisode: the thread puts "Watch the date" under the last bubble).
 *
 * Templates only: no model call (the hello it replaces was one). A character with no aired date opens the way it did.
 * The ending is told here on purpose: the date aired and is public, and the character is telling its own news.
 * COMPANION_DATE_OPENER=0 turns it off (lib/companion-shared.ts companionDateOpener).
 */
import type { LastDate } from "./last-date";

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/** The tag on the opener's messages (lib/companion-shared.ts TEXT_TAG): the date it tells about. */
export const castOpenerTag = (episodeId: string): string => `opener:${episodeId}`;

/**
 * The opener's bubbles (pure): hello and the date, the character's own words about it (or a plain line by ending), and
 * an invitation to watch that ends on at most one question.
 */
export function castOpenerLines(character: string, d: Pick<LastDate, "partner" | "venue" | "ending" | "reflection" | "dateNumber">): string[] {
  const me = firstNameOf(character);
  const them = firstNameOf(d.partner);
  const where = d.venue ? ` at ${d.venue}` : "";
  const date = (d.dateNumber ?? 1) >= 2 ? `another one with ${them}${where}` : `with ${them}${where}`;
  switch (d.ending) {
    case "second_date":
      return [
        `Hey, I'm ${me}. My last date was ${date}, and it went well: we both said yes to seeing each other again.`,
        d.reflection ?? "There was a moment in there I keep replaying.",
        "It aired, so you can watch it. Tell me if you'd have said yes too.",
      ];
    case "friends":
      return [
        `Hey, I'm ${me}. My last date was ${date}. Good company, and we left it as friends.`,
        d.reflection ?? "Nothing wrong with it, there just wasn't a spark on my side.",
        "It aired, so you can watch it. Did I miss something?",
      ];
    case "disaster":
      return [
        `Hey, I'm ${me}. My last date was ${date}, and it went about as badly as a date can.`,
        d.reflection ?? "It got away from both of us. I'm still a bit wound up about it.",
        "It aired, so you can watch the whole thing. What would you have done?",
      ];
  }
}

/**
 * What may be spoiled (David, 2026-11-28: "spoiling two agents' date or an agent and person date is ok. But the show
 * should remain unspoiled."). A date with one of the show's own cast (a house character) is the show: its ending is
 * never told in a notification, and on its page the parts that give it away fold behind a tap until you've watched.
 * A date between two people's or agents' characters is theirs, and its notices say how it ended, as before. Pure.
 */
export const isShowDate = (aIsHouse: boolean | null | undefined, bIsHouse: boolean | null | undefined): boolean => Boolean(aIsHouse || bIsHouse);

/** The line a show date's notices use where an ordinary date's say how it ended. */
export const SHOW_DATE_TEASE = "Watch it to see how it went: we won't spoil the show.";

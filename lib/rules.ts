/**
 * The show's rules and labels. Pure constants and functions with no server imports, so client
 * components can use them without pulling database code into the browser bundle.
 */

export const ENDINGS = ["second_date", "friends", "disaster"] as const;
export type Ending = (typeof ENDINGS)[number];

export const ENDING_LABELS: Record<Ending, string> = {
  second_date: "A second date",
  friends: "Just friends",
  disaster: "A disaster",
};

/** The one drama question per episode: the showrunner picks which, and answers it. */
export const DRAMA_QUESTIONS = ["leaves_first", "rejected"] as const;
export type DramaQuestion = (typeof DRAMA_QUESTIONS)[number];

/** "a" and "b" are the episode's two characters, in order. */
export const DRAMA_ANSWERS = ["a", "b", "neither"] as const;
export type DramaAnswer = (typeof DRAMA_ANSWERS)[number];

export const DRAMA_QUESTION_LABELS: Record<DramaQuestion, string> = {
  leaves_first: "Who leaves the date first?",
  rejected: "Who gets rejected?",
};

const DRAMA_NEITHER_LABELS: Record<DramaQuestion, string> = {
  leaves_first: "They leave together",
  rejected: "Nobody",
};

export function dramaAnswerLabel(question: DramaQuestion, answer: DramaAnswer, names: [string, string]): string {
  if (answer === "a") return names[0];
  if (answer === "b") return names[1];
  return DRAMA_NEITHER_LABELS[question];
}

export const POINTS_PER_CORRECT_PICK = 10;
/** The drama question is the side bet: worth half an ending pick. */
export const POINTS_PER_DRAMA_PICK = 5;

/**
 * Points are never stored: a user's score is derived from their picks on aired episodes.
 * There is no balance to edit, so no route can grant, sell or transfer points.
 */
export function pointsFor(pick: Ending, ending: Ending): number {
  return pick === ending ? POINTS_PER_CORRECT_PICK : 0;
}

export function predictionPoints(
  prediction: { pick: Ending; drama_pick: DramaAnswer | null },
  episode: { ending: Ending; drama_answer: DramaAnswer | null },
): number {
  const drama =
    prediction.drama_pick !== null && prediction.drama_pick === episode.drama_answer ? POINTS_PER_DRAMA_PICK : 0;
  return pointsFor(prediction.pick, episode.ending) + drama;
}

/**
 * Seasons (M4): a season is the leaderboard week, Monday 00:00 UTC to the next Monday. When it
 * closes, the top 3 in each league earn a badge. Badges are free, have no value and never score.
 */
export const PODIUM_SIZE = 3;
export const BADGE_LABELS: Record<1 | 2 | 3, string> = { 1: "🥇 1st", 2: "🥈 2nd", 3: "🥉 3rd" };

export function badgeLabel(place: number): string {
  return BADGE_LABELS[place as 1 | 2 | 3] ?? `#${place}`;
}

/**
 * Dates each creator can send their characters on per season, free. Episode packs add more. The first
 * date is always free (REVENUE.md); three a week lets a creator try a blind date and a house date and
 * still come back next week, and leaves "5 more dates" worth buying. It also caps free-model calls.
 */
export const FREE_EPISODES_PER_SEASON = 3;

export const REPORT_REASONS =["sexual", "minor", "real_person", "hateful", "self_harm", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  sexual: "Sexual content",
  minor: "Involves a minor",
  real_person: "About a real person",
  hateful: "Hateful or harassing",
  self_harm: "Self-harm or suicide",
  other: "Something else",
};

/** Distinct reporters it takes to pull an episode from the feed (and from everyone but its creators). */
export const REPORT_HIDE_THRESHOLD = 3;
export const HIDDEN_EPISODE_MESSAGE = "This episode was hidden after several viewers reported it.";

export const CRISIS_LINKS = [
  { label: "988 Suicide & Crisis Lifeline (call or text 988, US)", href: "https://988lifeline.org" },
  { label: "Find a free helpline in your country", href: "https://findahelpline.com" },
] as const;

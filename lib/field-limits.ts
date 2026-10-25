/**
 * How long a character's written fields may be: one place for the create page, the API, the agents' tools and the
 * chemistry test, so they never disagree. Raised 2026-10-25 from Reddit feedback ("the fields could stand to accept ten
 * to twenty more characters; I had to get really creative with commas"): traits 30 → 50, want / dealbreaker /
 * appearance 140 → 180, profile prompt answers 160 → 200 (this week, lib/life.ts THIS_WEEK_MAX: 100 → 140).
 */
export const NAME_MAX = 40;
export const BIO_MAX = 500;
export const TRAIT_MAX = 50;
export const WANT_MAX = 180;
export const DEALBREAKER_MAX = 180;
export const APPEARANCE_MAX = 180;
export const PROMPT_ANSWER_MAX = 200;

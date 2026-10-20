/**
 * The slow build (David, 2026-10-18: "they jump straight into sexual action", "at a cafe… not the right scenario"):
 * a scene moves at most one stage per step unless steered, and nothing past kissing happens in front of other people.
 */
/** The tease (David, 2026-10-18: "tease out the pacing"): unsteered, a scene stays this many lines at a stage first. */
export const MIN_LINES_PER_STAGE = 12;

/** Past this many chapters (lib/adult/scenes.ts CHAPTER_LINES each), the page suggests ending the night. */
export const SOFT_CHAPTERS = 5;

export const STAGES = ["talking and flirting", "tension and the first touches", "kissing", "undressing", "sex"] as const;

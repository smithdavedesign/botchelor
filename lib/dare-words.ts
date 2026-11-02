/**
 * The dare verdict's words (lib/dare-verdict.ts): pure and client-safe, so the dare card (app/DareVote.tsx) can say how
 * it went without pulling the server's dare code into the bundle.
 */
export const DARE_VERDICTS = ["went_through", "sort_of", "chickened_out"] as const;
/** Did the dared side do it: read from their lines (lib/dare-verdict.ts), or the engine's roll for older nights. */
export type DareVerdict = (typeof DARE_VERDICTS)[number];

/** The old roll as a verdict: the engine's note_followed for the dared side (null when it had nothing to answer). */
export const verdictFromRoll = (followed: boolean | null): DareVerdict | null => (followed === null ? null : followed ? "went_through" : "chickened_out");

/** The boolean the API always carried ("followed"): sort of is neither. */
export const followedOf = (v: DareVerdict | null): boolean | null => (v === "went_through" ? true : v === "chickened_out" ? false : null);

/** The verdict in the show's words, as the end of a sentence ("… — they went through with it."). */
export const VERDICT_WORDS: Record<DareVerdict, string> = {
  went_through: "they went through with it.",
  sort_of: "they sort of did it. Half credit, generously.",
  chickened_out: "they chickened out.",
};

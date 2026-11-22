/**
 * The reasons the content filter (lib/safety.ts) gives, and what each one tells a person, apart from its word lists: a
 * page in the browser can name a refusal without downloading the lists (2026-11-22 audit: they rode along in the code of
 * the home page, /create, /prompts and every character page). The checks themselves run on the server.
 */

/**
 * `unread`: text in another language the show's model couldn't translate for the check just now (lib/language-check.ts;
 * try again). `language`: After Dark is English-only until its checks are proven in other languages (David, 2026-10-31).
 */
export type RejectReason = "minor" | "sexual" | "real_person" | "innuendo" | "unread" | "language";

/**
 * The refusals that are about going past PG (sexual content or innuendo), and nothing else: never a minor, a real person or
 * a language the check can't read. The show's own classification of its own reasons; /create offers After Dark's door on
 * these alone (lib/adult/past-pg.ts).
 */
export function isPastPg(reason: unknown): reason is Extract<RejectReason, "sexual" | "innuendo"> {
  return reason === "sexual" || reason === "innuendo";
}

/** What a refused character sheet is told: /create's save (POST /api/characters) and the OC chemistry test say the same. */
export const CHARACTER_REJECTION_MESSAGES: Record<RejectReason, string> = {
  minor: "Characters must be adults, with nothing suggesting they are under 18.",
  sexual: "Keep the character sheet free of sexual content.",
  real_person: "Characters must be original: no real people.",
  innuendo: "Keep the character sheet PG: no innuendo or bedroom talk (the show is PG; After Dark has its own settings).",
  unread: "We couldn't check a sheet in that language just now. Try again in a minute.",
  language: "After Dark is English-only for now.",
};

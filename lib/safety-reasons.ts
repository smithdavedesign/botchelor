/**
 * The reasons the content filter (lib/safety.ts) gives, and what each one tells a person, apart from its word lists: a
 * page in the browser can name a refusal without downloading the lists (2026-11-22 audit: they rode along in the code of
 * the home page, /create, /prompts and every character page). The checks themselves run on the server.
 */

/**
 * `unread`: text in another language the show's model couldn't translate for the check just now (lib/language-check.ts;
 * try again). `language`: After Dark is English-only until its checks are proven in other languages (David, 2026-10-31).
 */
export type RejectReason = "minor" | "sexual" | "real_person" | "innuendo" | "unread" | "language" | HarmReason;

/**
 * `hate`: hate speech or an -ism (race, ethnicity, religion, sexuality, gender, gender identity, disability). `threat`:
 * telling someone to hurt or kill themselves, or a threat of real violence. `personal_info`: a phone number, email or
 * street address. They hold on every surface, After Dark included (lib/safety-harm.ts). Insults and trash talk pass.
 */
export type HarmReason = "hate" | "threat" | "personal_info";

/** What anyone is told for the three that hold everywhere, wherever the text was going. */
export const HARM_MESSAGES: Record<HarmReason, string> = {
  hate: "No hate speech: nothing attacking people for their race, ethnicity, religion, sexuality, gender, gender identity or disability. Trash talk is fine; bigotry isn't.",
  threat: "No telling anyone to hurt or kill themselves, and no threats of real violence.",
  personal_info: "No personal info: leave out phone numbers, email addresses and street addresses.",
};

export const isHarm = (reason: unknown): reason is HarmReason => reason === "hate" || reason === "threat" || reason === "personal_info";

/** A refusal's message: the harm message for those three, otherwise the surface's own wording. */
export const contentMessage = (reason: RejectReason | undefined, otherwise: string): string => (isHarm(reason) ? HARM_MESSAGES[reason] : otherwise);

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
  real_person: "Characters must be original: no real people (named or described) and no characters from other books, films, shows or games.",
  innuendo: "Keep the character sheet PG: no innuendo or bedroom talk (the show is PG; After Dark has its own settings).",
  unread: "We couldn't check a sheet in that language just now. Try again in a minute.",
  language: "After Dark is English-only for now.",
  ...HARM_MESSAGES,
};

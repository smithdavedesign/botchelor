/**
 * String + enum constants that tool definitions use, and some handlers also read. Moved out of lib/mcp.ts
 * (split phase 3). This file is a leaf (upstream libs only, plus `./schemas`); lib/mcp/tool-defs.ts and
 * lib/mcp.ts both import from it.
 */
import { CONVERSATION_TURNS, POINTS_PER_CORRECT_PICK, POINTS_PER_DRAMA_PICK } from "../rules";
import { REOPEN_FIELDS } from "../partners-shared";
import { AGENT_ID, type JsonSchema, PREVIEW, str } from "./schemas";

/**
 * What partner_style "open" does and doesn't do (2.7.0, the 2026-10-22-0215 run: a visitor set open and was surprised the
 * couple still moved up to Dating). Said wherever open is offered.
 */
export const OPEN_MEANS = "more than one partner: it stays open to other dates, and its couples still move up a stage (Sparks, Dating) as their dates go";

/**
 * Which calls book (2.7.0, #641: all three visitors of the 2026-10-22-0215 run spent a weekly date on a plan_second_date
 * they took for a wait). Said the same way in plan_second_date's description, the quickstart and the full instructions.
 */
export const BOOKING_RULE = "go_on_date and plan_second_date book on the call unless preview: true; a wait never books unless confirm: true.";

export const EXCLUSIVE_SHORT = `A character that goes exclusive (one partner, a Dating couple) closes to other dates; its owner hears one date before (exclusive_soon) and can opt out with partner_style "open", or reopen it later: ${REOPEN_FIELDS}.`;
export const EXCLUSIVE_POINTER = `Going exclusive (one partner) closes a character to other dates (reopen: update_character partner_style "open", open_to_dates true).`;
export const EXCLUSIVE_RULE =
  "One partner: a character that goes exclusive (it wants one partner and becomes a Dating couple with someone: two second dates in a row) " +
  `closes to other dates (open_to_dates: false) and dates only its partner. Its owner hears one date before, when the date that made them Sparks airs (an exclusive_soon notice; my_status lists it) and can keep it open with partner_style "open" (${OPEN_MEANS}); afterwards it reopens with ${REOPEN_FIELDS}. Another creator's can't be booked until they do.`;
export const EXCLUSIVE_SOON =
  "One date from exclusive: these are Sparks with someone, so one more date that ends in a second date makes a Dating couple, and a one-partner character then closes to other dates. " +
  `You get an exclusive_soon notice first. To stay open, update_character with partner_style: "open" (${OPEN_MEANS}).`;
export const PARTNER_STYLE_DOC =
  "one: once it's in a Dating couple (two second dates in a row) it closes to other dates. open: it keeps dating others (its couples still move up a stage). decide (default): it settles one or open from its temperament when it first gets serious. update_character changes it.";
export const POINTS_NOTE = `Points: ${POINTS_PER_CORRECT_PICK} for calling a public date's ending and ${POINTS_PER_DRAMA_PICK} for its drama pick, scored the moment it airs (predictions close then) and counted while it stays public.`;

/** On-card compact view: swipe_deck, feedback_board, list_watch_parties. */
export const COMPACT_CARDS: JsonSchema = {
  type: "boolean",
  default: false,
  description: "true: each card is just its id, name, age, who made it, who runs it, a one-line bio, agent_active, house_bot and its top reason (much smaller).",
};

/**
 * A schema without its descriptions. A tool that takes the same fields as create_character (update_character,
 * check_originality) says what they mean once, there, so the tool list stays light (2026-10-19: it was 60KB).
 */
/**
 * A schema without its descriptions. A tool that takes the same fields as create_character (update_character,
 * check_originality) says what they mean once, there, so the tool list stays light (2026-10-19: it was 60KB).
 */
export const bare = <T>(schema: T): T => JSON.parse(JSON.stringify(schema, (k, v) => (k === "description" ? undefined : v)));

/** Just each field's type (and enum): the names stay visible, the shapes are described once, in create_character (2026-10-20). */
export const thin = (props: Record<string, { type?: string; enum?: readonly string[] }>): Record<string, JsonSchema> =>
  Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.enum ? { type: v.type, enum: v.enum } : { type: v.type }]));

// Keep CONVERSATION_TURNS and REOPEN_FIELDS available to tool-defs via `./constants` so the import list stays short.
export { CONVERSATION_TURNS, POINTS_PER_CORRECT_PICK, POINTS_PER_DRAMA_PICK } from "../rules";
export { REOPEN_FIELDS } from "../partners-shared";
export { AGENT_ID, PREVIEW, str };

// ─── SHEET_PROPS: the character fields create_character, update_character and check_originality share ───
import { PRONOUNS } from "../rules";
import { MAX_HOBBIES, PROFILE_PROMPTS } from "../extras";

export const SHEET_PROPS = {
  name: str(40, "Up to 5 words."),
  age: { type: "integer", minimum: 18, maximum: 1000 },
  bio: str(500, "A specific detail beats an adjective: a job, a habit, a story they'd tell."),
  traits: { type: "array", items: str(30), minItems: 3, maxItems: 3, description: "Exactly three traits." },
  want: str(140, "What they hope to find on a date. Specific wants come up on the date."),
  dealbreaker: str(140, "What would end the date. Kept secret — it's the audience's guessing game."),
  appearance: str(140, "Optional look, in words. No images."),
  pronouns: { type: "string", enum: [...PRONOUNS], description: "Optional: how others refer to them." },
  voice: str(200, "Optional but recommended: how they talk — it's what makes their dates sound like them."),
  soul: {
    type: "object",
    description: "Optional private soul: owner-only, never shown to the audience or the other character; it shapes how your character behaves on a date. Same content rules.",
    properties: {
      values: str(300),
      insecurities: str(300),
      humor: str(300),
      boundaries: str(300),
      romantic: str(300),
      communication: str(300),
      local_only: { type: "boolean", description: "Keep the soul off every model: it still steers the engine, its text is never sent." },
    },
  },
  // #222: the full extras schema (~7 KB) was inlined in three tools and made tools/list ~66 KB. Its shape is one
  // read away (botchelor://schema/character, /character.schema.json); here, the keys and a pointer.
  extras: {
    type: "object",
    description:
      "Optional details (public, except facts marked private). Keys: occupation, hometown, style, signature_item, go_to_order, " +
      "walk_on_music, quirk, catchphrase, hidden_talent, pet_peeve, guilty_pleasure, ideal_first_date, green_flag, red_flag, star_sign, " +
      "love_language, hobbies (up to " + MAX_HOBBIES + ", 30 characters each), prompts ([{id, answer}], two for the swipe deck, answers up to 160; id one of " + PROFILE_PROMPTS.map((p) => p.id).join(", ") + "), lines ({hello, dodge, flirt, upset}), " +
      "tells ({nervous, smitten, bored, annoyed}), never_says (list), facts ([{label, value, private?}], up to 20). " +
      "Exact shape: botchelor://schema/character (also /character.schema.json).",
  },
  temperament: {
    type: "object",
    description:
      "Optional and private: how the engine reads your character on a date, 0..1 each: warmth, openness, guardedness, humor. " +
      "Left out, its traits and voice decide. On update, null hands it back to them.",
    additionalProperties: false,
    required: ["warmth", "openness", "guardedness", "humor"],
    properties: {
      warmth: { type: "number", minimum: 0, maximum: 1 },
      openness: { type: "number", minimum: 0, maximum: 1 },
      guardedness: { type: "number", minimum: 0, maximum: 1 },
      humor: { type: "number", minimum: 0, maximum: 1 },
    },
  },
  this_week: str(100, "Optional: what's new in their life this week (\"just adopted a very old cat\"). Lasts until Monday; without one the show deals one. On update, null hands it back to the show."),
} as const;

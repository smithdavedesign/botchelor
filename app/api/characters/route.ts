import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { PRONOUNS, VOICE_MAX } from "@/lib/rules";
import { ExtrasInput, extrasFields, normaliseExtras } from "@/lib/extras";
import { checkFields, type RejectReason } from "@/lib/safety";
import { assertSafeSoul, isEmptySoul, normaliseSoul, saveSoul, SoulInput } from "@/lib/souls";

const MIN_AGE = 18;
const MAX_AGE = 1000; // immortal OCs are common; anything older is a typo
const MAX_NAME_WORDS = 5;

const text = (max: number) => z.string().trim().min(1, "Required.").max(max, `At most ${max} characters.`);

const CharacterInput = z.object({
  name: text(40).refine((s) => s.split(/\s+/).length <= MAX_NAME_WORDS, `At most ${MAX_NAME_WORDS} words.`),
  age: z
    .number("Age must be a number.")
    .int("Age must be a whole number.")
    .min(MIN_AGE, "Characters must be adults (18+).")
    .max(MAX_AGE, `At most ${MAX_AGE}.`),
  bio: text(500),
  traits: z.array(text(30)).length(3, "Give exactly three traits."),
  want: text(140),
  dealbreaker: text(140),
  // Customization: an optional appearance line and an avatar hue (0 = auto). No image upload (safety).
  appearance: text(140).optional(),
  avatar_hue: z.number().int().min(0).max(360).optional(),
  // M15: how others refer to them, and how they talk. Public persona; both reach the date's models so a
  // character isn't misgendered and sounds like itself. The engine never reads them.
  pronouns: z.enum(PRONOUNS, "Pick she/her, he/him or they/them.").optional(),
  voice: text(VOICE_MAX).optional(),
  // Behavioural signals trained from a reference image, derived in the browser (lib/avatar.ts). The
  // raw image is never sent — only these four 0..1 numbers, which the engine uses to decide dates.
  image_signals: z
    .object({
      warmth: z.number().min(0).max(1),
      openness: z.number().min(0).max(1),
      guardedness: z.number().min(0).max(1),
      humor: z.number().min(0).max(1),
    })
    .optional(),
  // Optional private soul (PRD core feature 1): owner-only, drives the engine, never shown to spectators.
  soul: SoulInput.optional(),
  // Consent to be asked out by name: other creators (people or AI agents) may then pick this character as
  // their date's partner. Off by default; blind dates are unaffected.
  open_to_dates: z.boolean().optional(),
  // Optional details (lib/extras.ts): occupation, hometown, style, hobbies, quirks, profile prompts. Public.
  extras: ExtrasInput.optional(),
  attest: z.literal(true, "Confirm you are 18+ and this is your own original character."),
});

const REJECTION_MESSAGES: Record<RejectReason, string> = {
  minor: "Characters must be adults, with nothing suggesting they are under 18.",
  sexual: "Keep the character sheet free of sexual content.",
  real_person: "Characters must be original: no real people.",
};

export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(CharacterInput, await readJson(req), "invalid_character");
  const extras = normaliseExtras(input.extras);

  const verdict = checkFields({
    name: input.name,
    bio: input.bio,
    traits: input.traits,
    want: input.want,
    dealbreaker: input.dealbreaker,
    appearance: input.appearance,
    voice: input.voice,
    ...extrasFields(extras),
  });
  if (!verdict.ok) {
    return json(
      { error: "content_rejected", reason: verdict.reason, field: verdict.field, message: REJECTION_MESSAGES[verdict.reason] },
      422,
      sess,
    );
  }

  // Validate and filter the soul before writing anything, so a rejected soul stores no character.
  const soul = input.soul ? normaliseSoul(input.soul) : null;
  if (soul && !isEmptySoul(soul)) assertSafeSoul(soul);

  const db = await getDb();
  const id = crypto.randomUUID();
  const hue = input.avatar_hue && input.avatar_hue > 0 ? input.avatar_hue : null;
  await db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, appearance, avatar_hue, pronouns, voice, open_to_dates, extras)
     values ($1, $2, false, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
    [id, sess.userId, input.name, input.age, input.bio, JSON.stringify(input.traits), input.want, input.dealbreaker, input.appearance ?? null, hue, input.pronouns ?? null, input.voice ?? null, input.open_to_dates === true, JSON.stringify(extras)],
  );
  const hasSoul = Boolean(soul && !isEmptySoul(soul));
  const signals = input.image_signals ?? null;
  // Save a soul row when there is soul text OR image-trained signals (so the image can shape behaviour).
  if (hasSoul || signals) await saveSoul(db, id, soul ?? normaliseSoul({}), input.soul?.local_only ?? false, signals);

  const { attest: _attest, soul: _soul, image_signals: _sig, extras: _extras, ...character } = input;
  return json({ id, ...character, extras, house: false, has_soul: hasSoul, hue, image_trained: Boolean(signals) }, 201, sess);
});

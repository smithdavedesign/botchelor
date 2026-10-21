import { z } from "zod";
import { AUDIENCES } from "@/lib/audience";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { PRONOUNS, VOICE_MAX } from "@/lib/rules";
import { ExtrasInput, extrasFields, normaliseExtras } from "@/lib/extras";
import { gateAfterDarkLooks } from "@/lib/looks-draw";
import { stampThisWeek, thisWeek, THIS_WEEK_MAX } from "@/lib/life";
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
  // The same four numbers, set directly (the builder's temperament sliders; agents). Private, like the soul.
  temperament: z
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
  // Who may ask them out while they're open (lib/audience.ts). Default everyone.
  open_audience: z.enum(AUDIENCES).optional(),
  // Optional details (lib/extras.ts): occupation, hometown, style, hobbies, quirks, profile prompts. Public.
  extras: ExtrasInput.optional(),
  // What's new in their life this week (lib/life.ts): lasts this season; without one the show deals one.
  this_week: z.string().trim().max(THIS_WEEK_MAX, `At most ${THIS_WEEK_MAX} characters.`).optional(),
  attest: z.literal(true, "Confirm you are 18+ and this is your own original character."),
  // #519: run every check a save makes (the schema, the content filter, the soul) and save nothing.
  check_only: z.boolean().optional(),
});

const REJECTION_MESSAGES: Record<RejectReason, string> = {
  minor: "Characters must be adults, with nothing suggesting they are under 18.",
  sexual: "Keep the character sheet free of sexual content.",
  real_person: "Characters must be original: no real people.",
};

export const POST = handle(async (req) => {
  const sess = session(req);
  const raw = await readJson(req);
  // #519: a check (create_character with check_only) validates the fields it's given by the same rules as a save, and
  // may leave fields out; a save needs them all.
  const checkOnly = typeof raw === "object" && raw !== null && (raw as { check_only?: unknown }).check_only === true;
  const input = checkOnly
    ? (parseBody(CharacterInput.partial(), raw, "invalid_character") as Partial<z.infer<typeof CharacterInput>>)
    : parseBody(CharacterInput, raw, "invalid_character");
  const db = await getDb();
  const extras = await gateAfterDarkLooks(db, sess, normaliseExtras(input.extras));

  const verdict = checkFields({
    name: input.name,
    bio: input.bio,
    traits: input.traits,
    want: input.want,
    dealbreaker: input.dealbreaker,
    appearance: input.appearance,
    voice: input.voice,
    this_week: input.this_week,
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

  if (checkOnly) return json({ checked: true, saved: false }, 200, sess);
  if (!input.name || input.age === undefined || !input.bio || !input.traits || !input.want || !input.dealbreaker || input.attest !== true) {
    return json({ error: "invalid_character", message: "A save needs name, age, bio, traits, want, dealbreaker and attest." }, 400, sess);
  }

  const id = crypto.randomUUID();
  const hue = input.avatar_hue && input.avatar_hue > 0 ? input.avatar_hue : null;
  await db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, appearance, avatar_hue, pronouns, voice, open_to_dates, extras, this_week, open_audience)
     values ($1, $2, false, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16)`,
    [
      id, sess.userId, input.name, input.age, input.bio, JSON.stringify(input.traits), input.want, input.dealbreaker, input.appearance ?? null, hue,
      input.pronouns ?? null, input.voice ?? null, input.open_to_dates === true, JSON.stringify(extras),
      input.this_week?.trim() ? JSON.stringify(stampThisWeek(input.this_week)) : null, input.open_audience ?? "everyone",
    ],
  );
  const hasSoul = Boolean(soul && !isEmptySoul(soul));
  const signals = input.temperament ?? input.image_signals ?? null;
  // Save a soul row when there is soul text OR image-trained signals (so the image can shape behaviour).
  if (hasSoul || signals) await saveSoul(db, id, soul ?? normaliseSoul({}), input.soul?.local_only ?? false, signals);

  const { attest: _attest, soul: _soul, image_signals: _sig, temperament: _temp, extras: _extras, this_week: _week, ...character } = input;
  return json(
    { id, ...character, extras, this_week: thisWeek(id, input.this_week?.trim() ? stampThisWeek(input.this_week) : null), house: false, has_soul: hasSoul, hue, image_trained: Boolean(signals) },
    201,
    sess,
  );
});

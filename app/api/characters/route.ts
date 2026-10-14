import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
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
  // Optional private soul (PRD core feature 1): owner-only, drives the engine, never shown to spectators.
  soul: SoulInput.optional(),
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

  const verdict = checkFields({
    name: input.name,
    bio: input.bio,
    traits: input.traits,
    want: input.want,
    dealbreaker: input.dealbreaker,
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
  await db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker)
     values ($1, $2, false, $3, $4, $5, $6::jsonb, $7, $8)`,
    [id, sess.userId, input.name, input.age, input.bio, JSON.stringify(input.traits), input.want, input.dealbreaker],
  );
  const hasSoul = Boolean(soul && !isEmptySoul(soul));
  if (hasSoul) await saveSoul(db, id, soul!);

  const { attest: _attest, soul: _soul, ...character } = input;
  return json({ id, ...character, house: false, has_soul: hasSoul }, 201, sess);
});

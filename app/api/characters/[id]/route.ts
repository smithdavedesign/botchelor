import { z } from "zod";
import { deleteCharacter } from "@/lib/account";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { PRONOUNS, VOICE_MAX } from "@/lib/rules";
import { checkFields, type RejectReason } from "@/lib/safety";
import { assertSafeSoul, isEmptySoul, normaliseSoul, ownsCharacter, saveSoul, SoulInput } from "@/lib/souls";

type Ctx = { params: Promise<{ id: string }> };

const MIN_AGE = 18;
const MAX_AGE = 1000;
const MAX_NAME_WORDS = 5;
const text = (max: number) => z.string().trim().min(1, "Required.").max(max, `At most ${max} characters.`);

/**
 * The editable sheet. Ownership (PRD / M16): a creator may change their own character's characteristics any
 * time, so every field is optional and only the provided ones change. Identity, house status and ownership
 * are never editable here. Past episodes keep the outcome the engine already decided (it was snapshotted),
 * so an edit changes the living profile and future dates, never a settled result.
 */
const CharacterPatch = z
  .object({
    name: text(40).refine((s) => s.split(/\s+/).length <= MAX_NAME_WORDS, `At most ${MAX_NAME_WORDS} words.`).optional(),
    age: z.number().int().min(MIN_AGE, "Characters must be adults (18+).").max(MAX_AGE, `At most ${MAX_AGE}.`).optional(),
    bio: text(500).optional(),
    traits: z.array(text(30)).length(3, "Give exactly three traits.").optional(),
    want: text(140).optional(),
    dealbreaker: text(140).optional(),
    appearance: text(140).nullable().optional(),
    avatar_hue: z.number().int().min(0).max(360).optional(),
    pronouns: z.enum(PRONOUNS, "Pick she/her, he/him or they/them.").nullable().optional(),
    voice: text(VOICE_MAX).nullable().optional(),
    soul: SoulInput.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

const REJECTION_MESSAGES: Record<RejectReason, string> = {
  minor: "Characters must be adults, with nothing suggesting they are under 18.",
  sexual: "Keep the character sheet free of sexual content.",
  real_person: "Characters must be original: no real people.",
};

/** The columns a PATCH may set, in the order they appear on the body. `null` clears an optional column. */
const COLUMN: Record<string, (v: Record<string, unknown>) => unknown> = {
  name: (v) => v.name,
  age: (v) => v.age,
  bio: (v) => v.bio,
  traits: (v) => JSON.stringify(v.traits),
  want: (v) => v.want,
  dealbreaker: (v) => v.dealbreaker,
  appearance: (v) => v.appearance ?? null,
  avatar_hue: (v) => (typeof v.avatar_hue === "number" && v.avatar_hue > 0 ? v.avatar_hue : null),
  pronouns: (v) => v.pronouns ?? null,
  voice: (v) => v.voice ?? null,
};

/** Edit your own character. Owner-only; a character you don't own (or a house one) is "not found". */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);

  const input = parseBody(CharacterPatch, await readJson(req), "invalid_character") as Record<string, unknown>;
  const verdict = checkFields({
    name: input.name as string | undefined,
    bio: input.bio as string | undefined,
    traits: input.traits as string[] | undefined,
    want: input.want as string | undefined,
    dealbreaker: input.dealbreaker as string | undefined,
    appearance: (input.appearance as string | null | undefined) ?? undefined,
    voice: (input.voice as string | null | undefined) ?? undefined,
  });
  if (!verdict.ok) {
    return json({ error: "content_rejected", reason: verdict.reason, field: verdict.field, message: REJECTION_MESSAGES[verdict.reason] }, 422, sess);
  }

  const columns = Object.keys(COLUMN).filter((c) => c in input);
  if (columns.length) {
    const sets = columns.map((c, i) => `${c} = $${i + 3}${c === "traits" ? "::jsonb" : ""}`);
    await db.query(
      `update characters set ${sets.join(", ")} where id = $1 and owner_id = $2 and not is_house`,
      [id, sess.userId, ...columns.map((c) => COLUMN[c](input))],
    );
  }

  // The soul is replaced wholesale when present: a filled soul upserts, an empty one clears it.
  if (input.soul !== undefined) {
    const soul = normaliseSoul(input.soul as z.infer<typeof SoulInput>);
    if (isEmptySoul(soul)) {
      await db.query("delete from souls where character_id = $1", [id]);
    } else {
      assertSafeSoul(soul);
      await saveSoul(db, id, soul, (input.soul as { local_only?: boolean }).local_only ?? false);
    }
  }

  return json({ id, updated: columns, soul_changed: input.soul !== undefined }, 200, sess);
});

/** Delete your own character (PRD privacy). Owner-only; kept as a tombstone if it already aired in an episode. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  const result = await deleteCharacter(db, sess.userId, id);
  return json({ id, ...result }, 200, sess);
});

import { AUDIENCES } from "@/lib/audience";
import { APPEARANCE_MAX, BIO_MAX, DEALBREAKER_MAX, NAME_MAX, TRAIT_MAX, WANT_MAX } from "@/lib/field-limits";
import { nameCheck } from "@/lib/name-check";
import { z } from "zod";
import { TALK_LEVELS } from "@/lib/talk";
import { PARTNER_STYLES, takenSql } from "@/lib/partners";
import { deleteCharacter } from "@/lib/account";
import { hasJobKey } from "@/lib/connections";
import { getDb } from "@/lib/db";
import { invalidateGraph } from "@/lib/graph-cache";
import { handle, isMcpCall, json, parseBody, readJson, session } from "@/lib/http";
import { PRONOUNS, VOICE_MAX } from "@/lib/rules";
import type { RejectReason } from "@/lib/safety";
import { checkFieldsAnyLanguage } from "@/lib/language-check";
import { scheduleWelcome } from "@/lib/welcome";
import type { ImageSignals } from "@/lib/avatar";
import { gateAfterDarkLooks } from "@/lib/looks-draw";
import { ExtrasInput, extrasFields, normaliseExtras, type ExtrasInputType } from "@/lib/extras";
import { scheduleConceptEmbedding } from "@/lib/originality-concept";
import { stampThisWeek, THIS_WEEK_MAX } from "@/lib/life";
import { assertSafeSoul, clearSignals, isEmptySoul, loadSoul, normaliseSoul, ownsCharacter, saveSignals, saveSoul, SOUL_FIELDS, SoulInput, unknownSoulKeys } from "@/lib/souls";
import { WHILE_AWAY_MODES } from "@/lib/activity";

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
    name: text(NAME_MAX).refine((s) => s.split(/\s+/).length <= MAX_NAME_WORDS, `At most ${MAX_NAME_WORDS} words.`).optional(),
    age: z.number().int().min(MIN_AGE, "Characters must be adults (18+).").max(MAX_AGE, `At most ${MAX_AGE}.`).optional(),
    bio: text(BIO_MAX).optional(),
    traits: z.array(text(TRAIT_MAX)).length(3, "Give exactly three traits.").optional(),
    want: text(WANT_MAX).optional(),
    dealbreaker: text(DEALBREAKER_MAX).optional(),
    appearance: text(APPEARANCE_MAX).nullable().optional(),
    avatar_hue: z.number().int().min(0).max(360).optional(),
    pronouns: z.enum(PRONOUNS, "Pick she/her, he/him or they/them.").nullable().optional(),
    voice: text(VOICE_MAX).nullable().optional(),
    soul: SoulInput.optional(),
    // #1128: a rename onto a name already on the show is refused unless this says to keep it, as on create.
    keep_name: z.boolean().optional(),
    // Consent to be asked out by name (see POST /api/characters). Toggle any time; past dates are unaffected.
    open_to_dates: z.boolean().optional(),
    // Who may ask them out while they're open (lib/audience.ts): everyone, only people's characters, only agents'.
    open_audience: z.enum(AUDIENCES).optional(),
    // How much they talk on a date and in the texts after (lib/talk.ts). "marathon" needs the owner's own text key.
    talk: z.enum(TALK_LEVELS).nullable().optional(),
    // One partner or more (lib/partners.ts); "decide" leaves it to the character.
    partner_style: z.enum(PARTNER_STYLES).optional(),
    // What it does while its owner is away (lib/activity.ts): adopt, answer or nothing.
    while_away: z.enum(WHILE_AWAY_MODES).optional(),
    // Private: in the /characters directory by name only, not linked, and the card shows only the name to others.
    visibility: z.enum(["public", "private"]).optional(),
    // Optional details (lib/extras.ts), replaced wholesale; null or {} clears them.
    extras: ExtrasInput.nullable().optional(),
    // What's new this week (lib/life.ts): a string lasts this season ("" = nothing new this week); null hands it
    // back to the show, which deals one.
    this_week: z.string().trim().max(THIS_WEEK_MAX, `At most ${THIS_WEEK_MAX} characters.`).nullable().optional(),
    // Re-trained from a reference image in the builder (only the four numbers, never the image). Shapes future
    // dates; a learned memory drift on top of them is untouched.
    image_signals: z
      .object({
        warmth: z.number().min(0).max(1),
        openness: z.number().min(0).max(1),
        guardedness: z.number().min(0).max(1),
        humor: z.number().min(0).max(1),
      })
      .optional(),
    // The temperament sliders (or an agent): the same four numbers, set directly. null drops them, so the character
    // plays from its soul's words or its own traits and voice again (lib/temperament.ts).
    temperament: z
      .object({
        warmth: z.number().min(0).max(1),
        openness: z.number().min(0).max(1),
        guardedness: z.number().min(0).max(1),
        humor: z.number().min(0).max(1),
      })
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

const REJECTION_MESSAGES: Record<RejectReason, string> = {
  minor: "Characters must be adults, with nothing suggesting they are under 18.",
  sexual: "Keep the character sheet free of sexual content.",
  real_person: "Characters must be original: no real people.",
  innuendo: "Keep the character sheet free of innuendo.",
  unread: "We couldn't check a sheet in that language just now. Try again in a minute.",
  language: "After Dark is English-only for now.",
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
  open_to_dates: (v) => v.open_to_dates === true,
  open_audience: (v) => v.open_audience,
  talk: (v) => (v.talk === "standard" ? null : (v.talk ?? null)),
  partner_style: (v) => v.partner_style,
  while_away: (v) => v.while_away,
  visibility: (v) => v.visibility,
  extras: (v) => JSON.stringify(normaliseExtras(v.extras as ExtrasInputType | null)),
  this_week: (v) => (v.this_week === null ? null : JSON.stringify(stampThisWeek(v.this_week as string))),
};
const JSONB_COLUMNS = new Set(["traits", "extras", "this_week"]);

/** Edit your own character. Owner-only; a character you don't own (or a house one) is "not found". */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);

  const raw = await readJson(req);
  const input = parseBody(CharacterPatch, raw, "invalid_character") as Record<string, unknown>;
  // #1188: as on create, a soul of unknown keys is refused before anything is written, and the rest are named.
  const soulKeys = unknownSoulKeys((raw as { soul?: unknown } | null)?.soul);
  if (soulKeys.refusal) return json({ error: "invalid_soul", field: "soul", message: soulKeys.refusal }, 422, sess);
  if (input.extras) input.extras = await gateAfterDarkLooks(db, sess, normaliseExtras(input.extras as ExtrasInputType));
  // In any language (lib/language-check.ts): an edit in Spanish is read in English too.
  const verdict = await checkFieldsAnyLanguage({
    name: input.name as string | undefined,
    bio: input.bio as string | undefined,
    traits: input.traits as string[] | undefined,
    want: input.want as string | undefined,
    dealbreaker: input.dealbreaker as string | undefined,
    appearance: (input.appearance as string | null | undefined) ?? undefined,
    voice: (input.voice as string | null | undefined) ?? undefined,
    this_week: (input.this_week as string | null | undefined) ?? undefined,
    ...(input.extras ? extrasFields(normaliseExtras(input.extras as ExtrasInputType)) : {}),
  });
  if (!verdict.ok) {
    return json({ error: "content_rejected", reason: verdict.reason, field: verdict.field, message: REJECTION_MESSAGES[verdict.reason] }, 422, sess);
  }
  // #1128 (the 2026-10-31-1616 visitor renamed onto a taken name and nothing said so): the same test create runs.
  const keepName = input.keep_name === true;
  delete input.keep_name;
  if (typeof input.name === "string" && !keepName) {
    const { twin, freeNames } = await nameCheck(db, input.name, id);
    if (twin) {
      const free = await freeNames();
      return json(
        { error: "name_taken", message: `There's already a ${twin.name} on the show. Pick another name${free.length ? ` (free right now: ${free.join(", ")})` : ""}, or pass keep_name: true.`, free_names: free },
        409,
        sess,
      );
    }
  }

  // A one-partner character in a relationship can't reopen to dates; switching to more than one in the same edit can.
  if (input.open_to_dates === true) {
    const after = input.partner_style ?? null;
    const taken = (
      await db.query<{ taken: boolean }>(
        `select ${takenSql("c")} as taken from characters c where c.id = $1`,
        [id],
      )
    ).rows[0]?.taken;
    if (taken && after !== "open") {
      return json(
        { error: "taken", message: 'They\'re with someone and want one partner. Set them to more than one first (agents: partner_style: "open" in the same update_character call).' },
        409,
        sess,
      );
    }
  }

  if (input.talk === "marathon") {
    if (!(await hasJobKey(db, sess.userId, "text"))) {
      return json(
        { error: "needs_own_key", message: "Marathon runs on your own model key. Connect one for Dates & texts first (Account → Connections).", connect: "/account/keys#dates" },
        400,
        sess,
      );
    }
  }

  const columns = Object.keys(COLUMN).filter((c) => c in input);
  if (columns.length) {
    const sets = columns.map((c, i) => `${c} = $${i + 3}${JSONB_COLUMNS.has(c) ? "::jsonb" : ""}`);
    await db.query(
      `update characters set ${sets.join(", ")} where id = $1 and owner_id = $2 and not is_house`,
      [id, sess.userId, ...columns.map((c) => COLUMN[c](input))],
    );
    // The Constellation shows a character's name, kind and look, and hides a private one: rebuild it now (lib/graph-cache.ts).
    invalidateGraph();
  }
  // Set to one partner while already with someone: off the market now, like when they first got together.
  if (input.partner_style !== undefined) {
    await db.query(`update characters c set open_to_dates = false where c.id = $1 and c.open_to_dates and ${takenSql("c")}`, [id]);
  }

  // The soul is replaced wholesale when present: a filled soul upserts, an empty one clears its text. Its
  // image-trained signals are kept either way (saveSoul coalesces them), so clearing the words never quietly
  // changes how the character behaves; a row with neither text nor signals is removed.
  // #1188: soul_changed says whether the stored soul's words (or local_only) changed, not only that a soul was sent.
  const soulWords = async () => {
    const s = await loadSoul(db, id);
    return s ? JSON.stringify([...SOUL_FIELDS.map((f) => s[f] ?? ""), s.local_only]) : null;
  };
  const soulBefore = input.soul !== undefined ? await soulWords() : null;
  if (input.soul !== undefined) {
    const soul = normaliseSoul(input.soul as z.infer<typeof SoulInput>);
    if (isEmptySoul(soul)) {
      const hasSignals = (await db.query(`select 1 from souls where character_id = $1 and signals is not null`, [id])).rows.length > 0;
      if (hasSignals) await saveSoul(db, id, soul, false);
      else await db.query("delete from souls where character_id = $1", [id]);
    } else {
      await assertSafeSoul(soul);
      await saveSoul(db, id, soul, (input.soul as { local_only?: boolean }).local_only ?? false);
    }
  }
  if (input.image_signals) await saveSignals(db, id, input.image_signals as ImageSignals);
  if (input.temperament) await saveSignals(db, id, input.temperament as ImageSignals);
  else if (input.temperament === null) await clearSignals(db, id);
  const signalsChanged = Boolean(input.image_signals) || input.temperament !== undefined;
  // What it's like changed: refresh its concept embedding after the response (an unchanged text costs nothing).
  if (["bio", "traits", "want", "extras"].some((k) => k in input)) await scheduleConceptEmbedding(db, id);
  // A dating profile finished on an edit makes a person's character swipe-ready: the welcome experiment (lib/welcome.ts).
  if ("extras" in input && !isMcpCall(req)) await scheduleWelcome(db, id);

  return json({ id, updated: columns, soul_changed: input.soul !== undefined && (await soulWords()) !== soulBefore, signals_changed: signalsChanged, ...(soulKeys.unknown.length ? { ignored_soul_keys: soulKeys.unknown } : {}) }, 200, sess);
});

/** Delete your own character (PRD privacy). Owner-only; kept as a tombstone if it already aired in an episode. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  const result = await deleteCharacter(db, sess.userId, id);
  invalidateGraph(); // gone from the Constellation now, not in a minute
  return json({ id, ...result }, 200, sess);
});

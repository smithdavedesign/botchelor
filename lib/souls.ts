/**
 * The private soul: owner-only personal data (PRD "Soul vs. Persona" guardrail). It drives the engine
 * (via lib/engine.ts deriveSoulSignals) and is given to the model as behaviour guidance, but is never
 * returned to spectators and can be deleted by its owner. Built from the owner themselves or from an
 * OC either way; it still goes through the same content filter as a character sheet.
 */
import { z } from "zod";
import type { ImageSignals } from "./avatar";
import type { Db } from "./db";
import type { SoulProfile } from "./engine";
import { ApiError } from "./http";
import { checkFields } from "./safety";
import { REJECTION_MESSAGES } from "./people";

export const SOUL_FIELDS = ["values", "insecurities", "humor", "boundaries", "romantic", "communication"] as const;
export type SoulField = (typeof SOUL_FIELDS)[number];
const SOUL_FIELD_MAX = 300;

const soulField = (max: number) => z.string().trim().max(max);

/** Every field optional; an omitted field is stored as empty. Short, because it is guidance, not prose. */
export const SoulInput = z.object({
  values: soulField(SOUL_FIELD_MAX).optional(),
  insecurities: soulField(SOUL_FIELD_MAX).optional(),
  humor: soulField(SOUL_FIELD_MAX).optional(),
  boundaries: soulField(SOUL_FIELD_MAX).optional(),
  romantic: soulField(SOUL_FIELD_MAX).optional(),
  communication: soulField(SOUL_FIELD_MAX).optional(),
  /**
   * Keep this soul off the model entirely (ChatGPT's PRD review: the soul is the most damaging thing to
   * leak). When true it drives the deterministic engine via signals, but its text is never sent to any
   * model, even a paid one. Default false: the text is given to the model as private behaviour guidance.
   */
  local_only: z.boolean().optional(),
});
export type SoulInputType = z.infer<typeof SoulInput>;

/** A soul as stored: the content, whether it is kept off the model, and any image-trained signals. */
export type StoredSoul = SoulProfile & { local_only: boolean; signals: ImageSignals | null };

const EMPTY: SoulProfile = { values: "", insecurities: "", humor: "", boundaries: "", romantic: "", communication: "" };

/** Fills in empty strings for omitted fields, so a soul row is always complete. */
export function normaliseSoul(input: SoulInputType): SoulProfile {
  return { ...EMPTY, ...Object.fromEntries(SOUL_FIELDS.map((f) => [f, (input[f] ?? "").trim()])) };
}

/** True when nothing was written: no point storing an empty soul. */
export const isEmptySoul = (s: SoulProfile): boolean => SOUL_FIELDS.every((f) => s[f] === "");

/** Runs the soul through the character-sheet content filter; throws a 422 naming the field on a reject. */
export function assertSafeSoul(soul: SoulProfile): void {
  const verdict = checkFields(soul);
  if (!verdict.ok) {
    throw new ApiError(422, {
      error: "content_rejected",
      reason: verdict.reason,
      field: `soul.${verdict.field}`,
      message: REJECTION_MESSAGES[verdict.reason],
    });
  }
}

export async function loadSoul(db: Db, characterId: string): Promise<StoredSoul | null> {
  const { rows } = await db.query<StoredSoul>(
    `select ${SOUL_FIELDS.join(", ")}, local_only, signals from souls where character_id = $1`,
    [characterId],
  );
  return rows[0] ?? null;
}

/** The soul as one block of private guidance for the model, or null when there is no soul. */
export function soulText(soul: SoulProfile | null): string | null {
  if (!soul) return null;
  const labels: Record<SoulField, string> = {
    values: "Values",
    insecurities: "Insecurities",
    humor: "Humour",
    boundaries: "Boundaries",
    romantic: "Romantic preferences",
    communication: "Communication style",
  };
  const parts = SOUL_FIELDS.filter((f) => soul[f]).map((f) => `${labels[f]}: ${soul[f]}`);
  return parts.length ? parts.join(". ") : null;
}

/** Upserts a soul for a character the caller owns. The caller must have checked ownership and safety. */
export async function saveSoul(
  db: Db,
  characterId: string,
  soul: SoulProfile,
  localOnly = false,
  signals: ImageSignals | null = null,
): Promise<void> {
  await db.query(
    `insert into souls (character_id, ${SOUL_FIELDS.join(", ")}, local_only, signals, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
     on conflict (character_id) do update set
       values = excluded.values, insecurities = excluded.insecurities, humor = excluded.humor,
       boundaries = excluded.boundaries, romantic = excluded.romantic, communication = excluded.communication,
       local_only = excluded.local_only,
       signals = coalesce(excluded.signals, souls.signals),
       updated_at = now()`,
    [characterId, soul.values, soul.insecurities, soul.humor, soul.boundaries, soul.romantic, soul.communication, localOnly, signals ? JSON.stringify(signals) : null],
  );
}

export async function deleteSoul(db: Db, characterId: string): Promise<void> {
  await db.query("delete from souls where character_id = $1", [characterId]);
}

/** True if the user owns this non-house character. Soul reads/writes are gated on it. */
export async function ownsCharacter(db: Db, characterId: string, userId: string): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(
    "select count(*)::int as n from characters where id = $1 and owner_id = $2 and not is_house",
    [characterId, userId],
  );
  return rows[0].n > 0;
}

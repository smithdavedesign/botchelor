/**
 * The history of choices that used to be overwritten (data plan Tier 1, David 2026-10-22): a changed prediction, a
 * replaced or cleared nudge, an edited review, a consent decision. The live tables keep only the latest value (their
 * readers are unchanged); this keeps every one, append-only, so how people change their minds is data too.
 *
 * Owner data: in the account export, gone with the account (and with a character when it's forgotten). Best effort:
 * a failed append never undoes or blocks the choice itself. Never After Dark.
 */
import type { Db } from "./db";

export type ChoiceKind = "prediction" | "nudge" | "nudge_cleared" | "review" | "ml_consent";

export async function recordChoice(
  db: Db,
  c: { kind: ChoiceKind; userId: string; episodeId?: string | null; characterId?: string | null; otherId?: string | null; value: Record<string, unknown> },
): Promise<void> {
  await db
    .query(`insert into choice_history (kind, user_id, episode_id, character_id, other_id, value) values ($1, $2, $3, $4, $5, $6::jsonb)`, [
      c.kind,
      c.userId,
      c.episodeId ?? null,
      c.characterId ?? null,
      c.otherId ?? null,
      JSON.stringify(c.value),
    ])
    .catch(() => {});
}

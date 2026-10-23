/**
 * The history of choices that used to be overwritten (data plan Tier 1, David 2026-10-22): a changed prediction, a
 * replaced or cleared nudge, an edited review, a consent decision. The live tables keep only the latest value (their
 * readers are unchanged); this keeps every one, append-only, so how people change their minds is data too.
 *
 * Owner data: in the account export, gone with the account (and with a character when it's forgotten), and pruned
 * after a while (lib/retention.ts; consent decisions stay while the account does). Best effort: a failed append never
 * undoes or blocks the choice itself. Never After Dark. docs/data-plan.md.
 */
import type { Db } from "./db";

export type ChoiceKind = "prediction" | "nudge" | "nudge_cleared" | "review" | "ml_consent";

/**
 * Appends one choice. `onlyIfChanged` skips it when the same person's latest choice of this kind about the same thing
 * (episode, character, other) has the same value: a prediction sent again with the same pick is not a new mind.
 */
export async function recordChoice(
  db: Db,
  c: { kind: ChoiceKind; userId: string; episodeId?: string | null; characterId?: string | null; otherId?: string | null; value: Record<string, unknown> },
  opts: { onlyIfChanged?: boolean } = {},
): Promise<void> {
  const unchanged = opts.onlyIfChanged
    ? `where (select h.value from choice_history h
               where h.kind = $1 and h.user_id = $2 and h.episode_id is not distinct from $3
                 and h.character_id is not distinct from $4 and h.other_id is not distinct from $5
               order by h.id desc limit 1) is distinct from $6::jsonb`
    : "";
  await db
    .query(`insert into choice_history (kind, user_id, episode_id, character_id, other_id, value) select $1, $2, $3, $4, $5, $6::jsonb ${unchanged}`, [
      c.kind,
      c.userId,
      c.episodeId ?? null,
      c.characterId ?? null,
      c.otherId ?? null,
      JSON.stringify(c.value),
    ])
    .catch(() => {});
}

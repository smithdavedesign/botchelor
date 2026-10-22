/**
 * Lines that didn't make it into a date, kept as data (data plan Tier 1, David 2026-10-22): a draft the show's critic
 * sent back that its revision replaced (`critic`), an agent's line the show refused (`agent_refused`), and an agent's
 * check_only try (`agent_check`). Next to the line that did go in at the same turn, a chosen/rejected pair — the
 * preference data the roadmap's DPO step needs (ROADMAP #577).
 *
 * Text a safety filter refused is never stored (`rejected: null`, the reason only). Capped per episode and per text;
 * best effort; gone with the episode, and with a character when it's forgotten. Never After Dark.
 */
import type { Db } from "./db";

export const TURN_DRAFTS_PER_EPISODE = 60;
const TEXT_MAX = 600;
const REASON_MAX = 300;

export type DraftSource = "critic" | "agent_refused" | "agent_check";

export async function logTurnDraft(
  db: Db,
  d: { episodeId: string; turnIndex: number; side: "a" | "b"; source: DraftSource; reason: string; rejected: string | null },
): Promise<void> {
  await db
    .query(
      `insert into turn_drafts (episode_id, turn_index, side, source, reason, rejected)
       select $1, $2, $3, $4, $5, $6 where (select count(*) from turn_drafts where episode_id = $1) < $7`,
      [d.episodeId, d.turnIndex, d.side, d.source, d.reason.slice(0, REASON_MAX), d.rejected === null ? null : d.rejected.slice(0, TEXT_MAX), TURN_DRAFTS_PER_EPISODE],
    )
    .catch(() => {});
}

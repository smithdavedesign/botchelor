import { z } from "zod";
import type { Db } from "./db";
import { ApiError } from "./http";
import { checkFields, type RejectReason } from "./safety";

export const PROFILE_NAME_MAX = 30;

/** Display names (profiles) and league names go through the same content filter as character sheets. */
export const REJECTION_MESSAGES: Record<RejectReason, string> = {
  minor: "Nothing suggesting anyone is under 18, please.",
  sexual: "Keep it free of sexual content.",
  real_person: "No real people's names.",
  innuendo: "Keep it free of innuendo.",
  unread: "We couldn't check that language just now. Try again in a minute.",
  language: "That has to be in English for now.",
};

export const nameText = (max: number) =>
  z.string("Required.").trim().min(1, "Required.").max(max, `At most ${max} characters.`);

/** Throws a 422 naming the field if `value` fails the content filter. */
export function assertSafeName(value: string, field = "name"): void {
  const verdict = checkFields({ [field]: value });
  if (!verdict.ok) {
    throw new ApiError(422, {
      error: "content_rejected",
      reason: verdict.reason,
      field: verdict.field,
      message: REJECTION_MESSAGES[verdict.reason],
    });
  }
}

/** Whether another person already goes by this display name (trimmed, case-blind). */
export async function profileNameTaken(db: Db, name: string, userId: string): Promise<boolean> {
  const { rows } = await db.query(`select 1 from profiles where lower(trim(name)) = lower(trim($1)) and user_id <> $2 limit 1`, [name, userId]);
  return rows.length > 0;
}

export async function getProfileName(db: Db, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { rows } = await db.query<{ name: string }>("select name from profiles where user_id = $1", [userId]);
  return rows[0]?.name ?? null;
}

/** Leagues and identity reveals show a display name, so they need one first. */
export async function requireProfileName(db: Db, userId: string): Promise<string> {
  const name = await getProfileName(db, userId);
  if (!name) {
    throw new ApiError(422, {
      error: "name_required",
      message: "Pick a display name first (POST /api/profile).",
    });
  }
  return name;
}

/** The user ids that own the episode's characters (one for a house date, two for a blind date). */
export async function episodeCreatorIds(db: Db, episodeId: string): Promise<string[] | null> {
  const { rows } = await db.query<{ a_owner: string | null; b_owner: string | null }>(
    `select a.owner_id as a_owner, b.owner_id as b_owner
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1`,
    [episodeId],
  );
  const row = rows[0];
  if (!row) return null;
  return [row.a_owner, row.b_owner].filter((id): id is string => id !== null);
}

export type BlockEntry = { episode_id: string; share_path: string; title: string; blocked_at: string };

/**
 * The user's block list. Blocked creators stay anonymous, so each entry is the episode the block was
 * made from, never who it blocks. Blocking both creators of one blind date is one entry.
 */
export async function listBlocks(db: Db, userId: string): Promise<BlockEntry[]> {
  const { rows } = await db.query<{ episode_id: string; a_name: string; b_name: string; created_at: Date }>(
    `select e.id as episode_id, a.name as a_name, b.name as b_name, max(bl.created_at) as created_at
       from blocks bl
       join episodes e on e.id = bl.via_episode_id
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where bl.blocker_id = $1
      group by e.id, a.name, b.name
      order by max(bl.created_at) desc`,
    [userId],
  );
  return rows.map((r) => ({
    episode_id: r.episode_id,
    share_path: `/episodes/${r.episode_id}`,
    title: `${r.a_name} × ${r.b_name}`,
    blocked_at: new Date(r.created_at).toISOString(),
  }));
}

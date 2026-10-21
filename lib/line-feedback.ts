/**
 * Thumbs on lines (David, 2026-10-21: real-user signals, since the simulated raters give 8 whatever changes). A viewer marks
 * one line of a date, or an admin one line of an After Dark night, 👍 or 👎 (app/ChatThread.tsx). One vote per person per
 * line; tapping the same thumb again is the client's toggle, sent as a 0 vote, which removes it. The votes feed Real use
 * (lib/real-metrics.ts) and the preference dataset (scripts/eval/export-preferences.mjs).
 *
 * Only lines the viewer can see, and anything else reads as not found, so a ref can't be probed:
 *  - an episode that's ready (its lines are final) and that they could open: public or unlisted (anyone with the link),
 *    or private and theirs (they own a side or booked it); one hidden by reports only to the owners of its sides
 *    (the same rules as lib/game.ts getEpisodeView and GET /api/episodes/:id);
 *  - After Dark: a signed-in admin, on their own running scene or saved night (After Dark is admin-only).
 *
 * Line i is the ref's i-th line: the episode's transcript[i], the scene's or night's lines[i]. A running scene's lines are
 * cleared when its chapter is filed as a night (or Start over files it), so its votes move to that night with them
 * (moveLineFeedback, called from lib/adult/scenes.ts): a vote always stays on the line it was cast on.
 */
import { isSignedInAdmin } from "./admins";
import type { Db } from "./db";
import type { Auth } from "./http";
import { REPORT_HIDE_THRESHOLD } from "./rules";

export const LINE_FEEDBACK_KINDS = ["episode", "after_dark"] as const;
export type LineFeedbackKind = (typeof LINE_FEEDBACK_KINDS)[number];
export type LineVote = -1 | 1;

/** Votes per connection and per person: a whole After Dark chapter is 120 lines, so there's room to rate one. */
export const LINE_FEEDBACK_LIMITS = { perHour: 300, perDay: 1500 };
/** An episode, scene or night id: uuids and the house-style ids. */
export const REF_ID = /^[A-Za-z0-9_-]{1,80}$/;
/** No transcript or chapter is anywhere near this long; a bigger index is junk. */
export const MAX_LINE_INDEX = 5000;

/** How many lines the viewer can see on the ref, or null when they can't see it (or it doesn't exist). */
export async function visibleLineCount(db: Db, kind: LineFeedbackKind, refId: string, auth: Auth | null): Promise<number | null> {
  if (!REF_ID.test(refId)) return null;
  if (kind === "episode") {
    const { rows } = await db.query<{ visibility: string; status: string; lines: number; creator_id: string; a_owner: string | null; b_owner: string | null; reports: number }>(
      `select e.visibility, e.status, jsonb_array_length(coalesce(e.transcript, '[]'::jsonb)) as lines, e.creator_id,
              a.owner_id as a_owner, b.owner_id as b_owner,
              (select count(*)::int from reports r where r.episode_id = e.id) as reports
         from episodes e
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
        where e.id = $1`,
      [refId],
    );
    const e = rows[0];
    if (!e || e.status !== "ready") return null;
    const viewer = auth?.userId ?? null;
    const owner = viewer !== null && (viewer === e.a_owner || viewer === e.b_owner);
    const host = viewer !== null && viewer === e.creator_id;
    if (e.visibility === "private" && !owner && !host) return null;
    if (e.reports >= REPORT_HIDE_THRESHOLD && !owner) return null;
    return Number(e.lines);
  }
  if (!auth || !(await isSignedInAdmin(db, auth))) return null;
  const { rows } = await db.query<{ lines: number }>(
    `select jsonb_array_length(lines) as lines from adult_scenes where id = $1 and owner_id = $2
     union all
     select jsonb_array_length(lines) from adult_nights where id = $1 and owner_id = $2`,
    [refId, auth.userId],
  );
  return rows.length ? Number(rows[0].lines) : null;
}

/** The viewer's own votes on a ref, by line index. */
export async function viewerVotes(db: Db, userId: string, kind: LineFeedbackKind, refId: string): Promise<Record<number, LineVote>> {
  const { rows } = await db.query<{ line_index: number; vote: number }>(
    `select line_index, vote from line_feedback where user_id = $1 and kind = $2 and ref_id = $3 order by line_index`,
    [userId, kind, refId],
  );
  return Object.fromEntries(rows.map((r) => [r.line_index, r.vote > 0 ? 1 : -1]));
}

/** Sets one person's vote on one line (replacing theirs), or removes it with 0. */
export async function setLineVote(db: Db, v: { userId: string; kind: LineFeedbackKind; refId: string; lineIndex: number; vote: -1 | 0 | 1 }): Promise<void> {
  if (v.vote === 0) {
    await db.query(`delete from line_feedback where user_id = $1 and kind = $2 and ref_id = $3 and line_index = $4`, [v.userId, v.kind, v.refId, v.lineIndex]);
    return;
  }
  await db.query(
    `insert into line_feedback (id, user_id, kind, ref_id, line_index, vote) values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id, kind, ref_id, line_index) do update set vote = excluded.vote, updated_at = now()`,
    [crypto.randomUUID(), v.userId, v.kind, v.refId, v.lineIndex, v.vote],
  );
}

/**
 * Moves every vote on one ref to another: a running After Dark scene's votes go to the night its lines were just filed as.
 * Best effort: a failure is logged, never thrown into the scene. Returns how many moved.
 */
export async function moveLineFeedback(db: Db, fromRef: string, toRef: string, kind: LineFeedbackKind = "after_dark"): Promise<number> {
  try {
    const { rows } = await db.query<{ id: string }>(`update line_feedback set ref_id = $3 where kind = $1 and ref_id = $2 returning id`, [kind, fromRef, toRef]);
    return rows.length;
  } catch (err) {
    console.error(`[line-feedback] couldn't move votes from ${fromRef} to ${toRef}: ${err instanceof Error ? err.message : "unknown"}`);
    return 0;
  }
}

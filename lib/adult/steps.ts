/**
 * Every step of a pair's scene, for the admin's /why view (David, 2026-10-22: it "doesn't include nudges and
 * suggestions, also no errors"): what was asked (a steer and how strongly, a set-the-scene, a start over), what came of
 * it (the lines it added, the ones its guards dropped and why) or the error it ended in. A step belongs to the scene
 * while its chapter runs and moves to the saved night with the chapter's lines (fileSteps), as the lines' thumbs do.
 *
 * Admin-only, like the lines' notes. A steer refused by the two lines is never stored: only that it was refused.
 * Best-effort: a step that can't be logged never fails the scene.
 */
import type { Db } from "../db";

export type StepKind = "write" | "set_scene" | "reset";

export type StepLog = {
  kind: StepKind;
  /** The steer (write), the place (set_scene), or null. */
  direction: string | null;
  steer_mode: "nudge" | "direct" | null;
  status: "ok" | "error";
  /** The HTTP status an error ended in (422, 429, 502…). */
  http: number | null;
  message: string | null;
  /** The chapter and the lines this step wrote (indexes into that chapter's lines; null when it wrote none). */
  chapter: number;
  line_from: number | null;
  line_to: number | null;
  added: number;
  dropped: { who: string; text: string; reason: string }[];
  /** The step's counts (lib/adult/scenes.ts StepFlags), as written. */
  flags: Record<string, unknown> | null;
};

export type StepRow = StepLog & { id: string; at: string };

export async function logStep(db: Db, owner: string, pair: { a: string; b: string }, sceneId: string | null, step: StepLog): Promise<void> {
  await db
    .query(
      `insert into adult_steps (id, owner_id, character_a, character_b, scene_id, chapter, kind, direction, steer_mode, status, http, message, line_from, line_to, added, dropped, flags)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb)`,
      [
        crypto.randomUUID(),
        owner,
        pair.a,
        pair.b,
        sceneId,
        step.chapter,
        step.kind,
        step.direction?.slice(0, 400) ?? null,
        step.steer_mode,
        step.status,
        step.http,
        step.message?.slice(0, 400) ?? null,
        step.line_from,
        step.line_to,
        step.added,
        JSON.stringify(step.dropped.slice(0, 20).map((d) => ({ ...d, text: d.text.slice(0, 300) }))),
        step.flags ? JSON.stringify(step.flags) : null,
      ],
    )
    .catch(() => {});
}

/** A filed chapter's steps go to its saved night with its lines. */
export async function fileSteps(db: Db, sceneId: string, chapter: number, nightId: string): Promise<void> {
  await db
    .query(`update adult_steps set night_id = $3 where scene_id = $1 and chapter = $2 and night_id is null`, [sceneId, chapter, nightId])
    .catch(() => {});
}

/** The pair's steps, oldest first: the running chapter's (night null) and each saved night's (by its id). */
export async function stepsOf(db: Db, owner: string, a: string, b: string): Promise<{ running: StepRow[]; byNight: Map<string, StepRow[]> }> {
  const { rows } = await db
    .query<StepRow & { night_id: string | null; created_at: string | Date; scene_id: string | null }>(
      `select id, night_id, scene_id, chapter, kind, direction, steer_mode, status, http, message, line_from, line_to, added, dropped, flags, created_at
         from adult_steps where owner_id = $1 and character_a = $2 and character_b = $3 order by created_at limit 2000`,
      [owner, a, b],
    )
    .catch(() => ({ rows: [] as (StepRow & { night_id: string | null; created_at: string | Date; scene_id: string | null })[] }));
  const running: StepRow[] = [];
  const byNight = new Map<string, StepRow[]>();
  for (const r of rows) {
    const { night_id, created_at, scene_id, ...rest } = r;
    void scene_id;
    const row: StepRow = { ...rest, at: new Date(created_at).toISOString(), dropped: rest.dropped ?? [] };
    if (night_id) byNight.set(night_id, [...(byNight.get(night_id) ?? []), row]);
    else running.push(row);
  }
  return { running, byNight };
}

/** Which step wrote each line: its index in `steps`, or null for a line from before steps were logged. */
export function stepIndexOf(steps: readonly StepRow[], lineCount: number): (number | null)[] {
  const at: (number | null)[] = new Array(lineCount).fill(null);
  steps.forEach((s, k) => {
    if (s.line_from === null || s.line_to === null) return;
    for (let i = s.line_from; i <= s.line_to && i < lineCount; i++) if (i >= 0) at[i] = k;
  });
  return at;
}

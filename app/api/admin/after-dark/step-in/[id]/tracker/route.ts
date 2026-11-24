import { z } from "zod";
import { getStepInScene, getStepInTracker, saveStepInTracker, stepInViewer } from "@/lib/adult/step-in";
import { TRACKER_FIELD_MAX } from "@/lib/adult/step-in-tracker";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

// A scene whose newest reply hasn't been read yet is read first: one small call on After Dark's own model.
export const maxDuration = 60;

/** A line of the sheet, as the viewer rewrites it (the length itself is said in words by saveStepInTracker). */
const line = z.string().max(TRACKER_FIELD_MAX * 4).optional();
const Edit = z.object({ where: line, them: line, you: line, around: line }).strict();

/** Not found for anyone Step in isn't open to, exactly like After Dark's other closed pieces. */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * A scene's continuity sheet (lib/adult/step-in-tracker.ts; lib/adult/step-in.ts getStepInTracker), for the ⋯ menu's
 * "Where things stand": where the two of them are, what each has on and what's within reach, as it holds for the scene
 * as it stands. Null with nothing noted yet. Free and never counted.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const r = await getStepInTracker(db, viewer, id);
  return r.ok ? json({ tracker: r.tracker }) : hidden();
});

/**
 * The viewer corrects the sheet (saveStepInTracker): the lines sent replace those lines, an empty one clears it. Their
 * own words, read as a line of theirs is before anything is kept; a refusal keeps nothing, and comes back with the
 * scene as it stands (the self-harm protocol pauses it), like a refused move.
 */
export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Edit, await readJson(req), "invalid_request");
  const r = await saveStepInTracker(db, viewer, id, input);
  if (r.ok) return json({ tracker: r.tracker });
  if (r.status === 404) return hidden();
  const { ok: _ok, status, ...body } = r;
  const now = await getStepInScene(db, viewer, id);
  return json({ ...body, ...(now.ok ? { scene: now.view } : {}) }, status);
});

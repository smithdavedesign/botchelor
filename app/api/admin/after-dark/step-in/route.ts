import { z } from "zod";
import { ROLEPLAY_IDS } from "@/lib/adult/roleplays";
import { listStepInScenes, startStepIn, stepInCast, stepInViewer } from "@/lib/adult/step-in";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { CARD_OPENING_MAX } from "@/lib/scene-cards";

// The character's opening is a model call (two, when the first draft can't be used).
export const maxDuration = 300;

const Start = z.object({
  character_id: z.string().min(1).max(64),
  // A place's id from After Dark's scene catalog (lib/adult/step-in.ts stepInPlaces).
  place: z.string().min(1).max(120),
  // One of After Dark's roleplays and which side of it the viewer plays (0: its first role); null or left out: none.
  roleplay: z.object({ id: z.enum(ROLEPLAY_IDS), you: z.union([z.literal(0), z.literal(1)]).optional() }).nullable().optional(),
  // How it opens: one of the three, any of them, or one sentence of the viewer's own (checked before anything is kept).
  opening: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal("surprise"), z.object({ written: z.string().max(CARD_OPENING_MAX * 4) })]).optional(),
});

/** Not found for anyone Step in isn't open to (lib/adult/step-in.ts stepInViewer), exactly like After Dark's other closed pieces. */
const hidden = () => json({ error: "not_found" }, 404);

/** The viewer's Step in scenes (running, then ended) and who they may step in with. */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const [scenes, cast] = await Promise.all([listStepInScenes(db, viewer), stepInCast(db, viewer)]);
  return json({ scenes, cast });
});

/**
 * Starts a scene (lib/adult/step-in.ts startStepIn): who, where, the roleplay and the viewer's side of it, how it opens.
 * The character opens it: one scene step. A written opening that trips the self-harm check answers with the crisis
 * resources and starts nothing.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Start, await readJson(req), "invalid_request");
  const r = await startStepIn(db, viewer, input);
  if (!r.ok) {
    const { ok: _ok, status, ...body } = r;
    return json(body, status);
  }
  return json({ id: r.id, scene: r.view, ...(r.replied === false ? { replied: false, message: r.message } : {}) });
});

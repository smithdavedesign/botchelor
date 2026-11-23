import { readStepInStory, stepInViewer } from "@/lib/adult/step-in";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

// One small call on After Dark's own model.
export const maxDuration = 60;

/** Not found for anyone Step in isn't open to, exactly like After Dark's other closed pieces. */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * Reads how far a roleplay's story has got (lib/adult/step-in-story.ts; lib/adult/step-in.ts readStepInStory): asked for
 * by the scene's page once a reply has landed, at most one reading a reply. Free and never counted. The answer is the
 * story as it now stands: its goal, how many beats have played, and whether an ending is offered; null for a scene
 * with no roleplay. Nothing a person wrote is in the answer.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const r = await readStepInStory(db, viewer, id);
  return r.ok ? json({ story: r.story }) : hidden();
});

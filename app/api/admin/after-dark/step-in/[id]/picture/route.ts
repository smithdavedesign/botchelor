import { z } from "zod";
import { mediaRefusal } from "@/lib/adult/place";
import { stepInViewer } from "@/lib/adult/step-in";
import { drawStepInPicture, setStepInBeside, stepInPictureState } from "@/lib/adult/step-in-picture";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

type Ctx = { params: Promise<{ id: string }> };

// One picture from the edit and its check: 10 to 30 seconds; a nude baseline made first can add as much again, and an
// age check's second try a third time.
export const maxDuration = 120;

/** Which reply: by its id, never by words. */
const Input = z.object({ message_id: z.string().min(1).max(64) });

/** Which reply's picture stands beside the scene, by the reply's id; null puts the character's own portrait back. */
const Beside = z.object({ beside: z.string().min(1).max(64).nullable() });

/** Not found for anyone Step in isn't open to, exactly like After Dark's other closed pieces. */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * A Step in scene's pictures (lib/adult/step-in-picture.ts): what one costs this viewer and how many of the month's are
 * left, each reply's picture, and the ones being drawn (the page asks again while one is). Refused where only text is
 * allowed (lib/adult/place.ts), like every picture, video and voiced line.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const state = await stepInPictureState(db, viewer, id);
  return state ? json({ pictures: state }) : hidden();
});

/**
 * Draws a picture of the moment a reply describes, of the character alone, and keeps it with the scene. Nothing is
 * spent or counted unless a picture is kept; the answer is the picture's id and the scene's pictures as they now stand.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = await drawStepInPicture(db, viewer, id, input.message_id, requestBase(req));
  if (!r.ok) {
    if (r.status === 404) return hidden();
    // With the scene's pictures as they stand, so the page shows one that's still being drawn, or what's left.
    const now = await stepInPictureState(db, viewer, id);
    return json({ error: r.error, message: r.message, ...(now ? { pictures: now } : {}) }, r.status);
  }
  return json({ picture: { id: r.id, message_id: r.message }, pictures: r.state });
});

/**
 * Puts one of the scene's pictures in the character's place beside the scene, or their portrait back (`beside: null`).
 * Nothing is made or spent: it chooses among the pictures the scene already has. The answer is the scene's pictures
 * as they now stand.
 */
export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return hidden();
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(Beside, await readJson(req), "invalid_request");
  const r = await setStepInBeside(db, viewer, id, input.beside);
  if (!r.ok) return r.status === 404 ? hidden() : json({ error: r.error, message: r.message }, r.status);
  return json({ pictures: r.state });
});

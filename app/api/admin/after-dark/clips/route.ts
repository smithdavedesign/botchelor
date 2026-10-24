import { z } from "zod";
import { clipOffer, makeClip } from "@/lib/adult/clips";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

// Drawing, checking and queueing a clip's keyframe takes up to a minute (its video is collected by the reel poll).
export const maxDuration = 300;

const id = z.string().min(1).max(64);
/** The latest moment, an act from the menu (who leads swapped, or not), or keep going from a clip of theirs. */
const Input = z.union([
  // A moment: the latest, or the line the theater shows (`at`), of the running scene or a saved night.
  z.object({ a: id, b: id, here: z.literal(true), at: z.number().int().min(0).max(5000).optional(), night_id: id.nullable().optional() }),
  z.object({ a: id, b: id, act: z.string().min(1).max(40), swap: z.boolean().optional() }),
  z.object({ continue: id }),
]);

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/** The pair's clip menu (?a=&b=): the price, whether "Clip from here" can run, and the acts their night has reached. */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const q = new URL(req.url).searchParams;
  const offer = await clipOffer(db, viewer, q.get("a") ?? "", q.get("b") ?? "");
  return offer ? json(offer) : hidden();
});

/** Make a clip (lib/adult/clips.ts): it's a video of one shot, collected by the reel poll (GET /api/admin/after-dark/reel?id=). */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = await makeClip(db, viewer, input, requestBase(req));
  if (!r.ok) return json({ error: r.error, message: r.message, ...(r.busy ? { busy: r.busy } : {}) }, r.status);
  return json({ reel: r.reel });
});

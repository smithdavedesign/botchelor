import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { compareCharacters, compareState, listCompares, rateRender, rendererListing, startCompare } from "@/lib/live-face/compare";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run"), character_id: z.string().min(1).max(120), line: z.string().min(1).max(240), renderers: z.array(z.string().max(60)).min(1).max(12) }),
  z.object({ action: z.literal("rate"), render_id: z.string().uuid(), rating: z.number().int().min(1).max(5).nullable() }),
]);

/**
 * The renderer compare (lib/live-face/compare.ts), admins only. `GET` is the page's data (the renderers and whose key
 * each would run on, the characters with a kit, the recent compares and the averages) or, with `?id=`, one compare
 * as its renders finish. `POST {action: "run"}` voices a line and starts the renders; `{action: "rate"}` keeps a 1–5.
 */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const auth = authFromRequest(req);
  if (!auth?.authenticated || !(await isSignedInAdmin(db, auth))) return json({ error: "not_found" }, 404);
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (id) {
    const state = await compareState(db, id);
    return state ? json(state) : json({ error: "not_found" }, 404);
  }
  const [renderers, characters, recent] = await Promise.all([rendererListing(db, auth.userId), compareCharacters(db), listCompares(db)]);
  return json({ renderers, characters, ...recent });
});

export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const auth = authFromRequest(req);
  if (!auth?.authenticated || !(await isSignedInAdmin(db, auth))) return json({ error: "not_found" }, 404);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (input.action === "rate") return json({ rated: await rateRender(db, input.render_id, input.rating) });
  const r = await startCompare(db, { userId: auth.userId }, { characterId: input.character_id, line: input.line, renderers: input.renderers }, requestBase(req));
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
  return json({ id: r.id, renders: r.renders }, 202);
});

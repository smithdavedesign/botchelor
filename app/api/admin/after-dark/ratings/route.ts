import { z } from "zod";
import { rateItem } from "@/lib/adult/library";
import { signedInAdmin } from "@/lib/adult/mode";
import { lockedForRequest } from "@/lib/adult/privacy";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";

const Input = z.object({ id: z.string().min(1).max(64), stars: z.number().int().min(1).max(5).nullable() });

/**
 * A viewer's stars on a library item (lib/adult/library.ts): 1–5, or null to take them back. The library is a
 * moderator's page, so a signed-in admin on an unlocked device only; a 404 to everyone else.
 */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const admin = await signedInAdmin(db, authFromRequest(req));
  if (!admin || (await lockedForRequest(db, admin, req))) return json({ error: "not_found" }, 404);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = await rateItem(db, admin, input.id, input.stars);
  if (!r.ok) return json({ error: "not_rated", message: r.message }, r.status);
  return json({ rating: r.rating });
});

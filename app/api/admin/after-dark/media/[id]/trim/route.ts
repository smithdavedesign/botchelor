import { isAdmin } from "@/lib/admins";
import { adultViewer } from "@/lib/adult/mode";
import { cleanTrim, setTrim } from "@/lib/adult/trim";
import { getDb } from "@/lib/db";
import { handle, json, readJson } from "@/lib/http";

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/**
 * Trim one of their videos (lib/adult/trim.ts): `{ start, end, cuts }` in seconds, or `{ clear: true }` for the whole
 * clip again. Nothing is re-encoded: the players honour it. Not found for anyone but its owner (or an admin).
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const body = (await readJson(req)) as { clear?: unknown } | null;
  let trim = null;
  if (body?.clear !== true) {
    const r = cleanTrim(body);
    if (!r.ok) return json({ error: "invalid_trim", message: r.message }, 422);
    trim = r.trim;
  }
  const ok = await setTrim(db, viewer, await isAdmin(db, viewer), (await ctx.params).id, trim);
  return ok ? json({ trim }) : hidden();
});

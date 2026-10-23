import { getDb } from "@/lib/db";
import { handle, json, session } from "@/lib/http";
import { nameCheck } from "@/lib/name-check";

export const dynamic = "force-dynamic";

/**
 * Whether a name is already on the show (lib/name-check.ts), for the /create form: GET ?name=<name>[&except=<id>] →
 * { taken, free_names }. `except` is the character being edited, so its own name isn't "taken". Names are public on
 * the show, so this tells nobody more than the directory does; it returns no ids.
 */
export const GET = handle(async (req) => {
  const sess = session(req);
  const params = new URL(req.url).searchParams;
  const name = (params.get("name") ?? "").trim().slice(0, 40);
  if (!name) return json({ error: "invalid_request", message: "Give a name." }, 400, sess);
  const except = params.get("except")?.trim().slice(0, 64) || null;
  const { twin, freeNames } = await nameCheck(await getDb(), name, except);
  return json({ name, taken: twin !== null, free_names: twin ? await freeNames() : [] }, 200, sess);
});

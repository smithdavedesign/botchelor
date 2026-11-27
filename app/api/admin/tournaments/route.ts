import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";
import { autoSeeds, cancelTournament, createTournament, listTournaments, NewTournament } from "@/lib/tournaments";

export const dynamic = "force-dynamic";

/** The admin password (x-frontier-key, like the other admin tools) or an admin account (lib/admins.ts). */
async function authorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isSignedInAdmin(await getDb(), authFromRequest(req));
}
const NOT_AUTHORIZED = { error: "not_authorized", message: "Needs the admin password or an admin account." };

/** GET: every tournament, and who the show would seed into an 8-character bracket now. */
export const GET = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  const db = await getDb();
  return json({ tournaments: await listTournaments(db), suggested_seeds: await autoSeeds(db, 8) });
});

const Input = z.discriminatedUnion("action", [
  NewTournament.extend({ action: z.literal("create") }),
  z.object({ action: z.literal("cancel"), id: z.string().min(1).max(40) }),
]);

/** POST: start a bracket (seeded by hand, or by the show from the record), or call one off. */
export const POST = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  if (input.action === "cancel") {
    return (await cancelTournament(db, input.id)) ? json({ ok: true }) : json({ error: "not_found", message: "No such tournament, or it's already called off." }, 404);
  }
  const { action: _action, ...t } = input;
  const r = await createTournament(db, t, authFromRequest(req)?.userId ?? "admin");
  return r.ok ? json({ ok: true, id: r.id }) : json({ error: "invalid_request", message: r.reason }, 400);
});

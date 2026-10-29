import { z } from "zod";
import { adminAuthorized, adminOwnerOf, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { loopBatch } from "@/lib/showcase-loops";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";
// A batch of living portraits (lib/showcase-loops.ts): a few clips of a minute or so, made together, then checked.
export const maxDuration = 300;

/** `agents`: the public agent-made characters' portraits too. `owner`: whose, with the admin password only (an admin's). */
const Input = z.object({ agents: z.boolean().default(false), owner: z.string().min(1).max(64).optional() });

/** Admin only: the next few living portraits of their safe pictures (and the agent-made characters'). */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  const owner = await adminOwnerOf(db, req, input.owner);
  if (!owner) return json({ error: "not_found", message: "Whose? An admin's own, or an admin's id with the admin password." }, 404);
  return json(await loopBatch(db, owner, requestBase(req), { agents: input.agents }));
});

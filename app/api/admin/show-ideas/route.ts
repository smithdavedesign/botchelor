import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";
import { loadOurIds } from "@/lib/our-traffic";
import { adminShowIdeas, decideShowIdea, showIdeasOn, showProposalsOn } from "@/lib/show-ideas";

export const dynamic = "force-dynamic";

/** The admin password (x-frontier-key) or an admin account, as the other admin tools. */
async function authorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isSignedInAdmin(await getDb(), authFromRequest(req));
}
const NOT_AUTHORIZED = { error: "not_authorized", message: "Needs the admin password or an admin account." };

/** Every show idea (lib/show-ideas.ts): proposals waiting first, then the list, then the declined; counts leave our own accounts out. */
export const GET = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  const db = await getDb();
  const ours = await loadOurIds(db).catch(() => [] as string[]);
  return json({ switched_on: showIdeasOn(), proposals_open: showProposalsOn(), ideas: await adminShowIdeas(db, ours) });
});

const Input = z.object({ id: z.string().min(1).max(64), action: z.enum(["list", "decline", "hold"]) });

/** List a proposal on /shows, decline it, or put it back to waiting. */
export const POST = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const result = await decideShowIdea(await getDb(), input.id, input.action);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status);
  return json({ id: result.id, status: result.status });
});

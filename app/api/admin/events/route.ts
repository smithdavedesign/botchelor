import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { addShowEvent, cancelShowEvent, NewShowEvent, showCalendar } from "@/lib/events-calendar";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";

export const dynamic = "force-dynamic";

/** The admin password (x-frontier-key, like the other admin tools) or an admin account (lib/admins.ts). */
async function authorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isSignedInAdmin(await getDb(), authFromRequest(req));
}
const NOT_AUTHORIZED = { error: "not_authorized", message: "Needs the admin password or an admin account." };

/** GET: the calendar as the public sees it, ten weeks ahead. */
export const GET = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  return json(await showCalendar(await getDb(), new Date(), 70));
});

const Input = z.discriminatedUnion("action", [
  NewShowEvent.extend({ action: z.literal("add") }),
  z.object({ action: z.literal("cancel"), id: z.string().min(1).max(40) }),
]);

/** POST: put a one-off night on the calendar (a themed party, a special), or call one off. */
export const POST = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  if (input.action === "cancel") {
    return (await cancelShowEvent(db, input.id)) ? json({ ok: true }) : json({ error: "not_found", message: "No such event, or it's already called off." }, 404);
  }
  const { action: _action, ...event } = input;
  const r = await addShowEvent(db, event, authFromRequest(req)?.userId ?? "admin");
  return r.ok ? json({ ok: true, id: r.id }) : json({ error: "invalid_request", message: r.reason }, 400);
});

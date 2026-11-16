import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { track } from "@/lib/analytics";
import { castingInvitesOn, listInvites, makeInvites, MAX_INVITE_DAYS, MAX_INVITES_AT_ONCE } from "@/lib/casting-invites";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";

export const dynamic = "force-dynamic";

/** The admin password (x-frontier-key, like the other admin tools) or an admin account (lib/admins.ts), as /api/admin/season. */
async function authorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isSignedInAdmin(await getDb(), authFromRequest(req));
}
const NOT_AUTHORIZED = { error: "not_authorized", message: "Needs the admin password or an admin account." };

/** Every creator invite, newest first: open, used (by which character) or expired (lib/casting-invites.ts). */
export const GET = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  return json({ switched_on: castingInvitesOn(), invites: await listInvites(await getDb()) });
});

const MakeInput = z.object({
  count: z.number().int().min(1).max(MAX_INVITES_AT_ONCE),
  // Who they're for, the admin's own note: never shown on the invite page.
  note: z.string().trim().max(200).nullable().optional(),
  days: z.number().int().min(1).max(MAX_INVITE_DAYS).nullable().optional(),
});

/** Makes `count` codes: [{ code, url }] with url https://botchelor.com/casting/invite/<code>, each single use. */
export const POST = handle(async (req: Request) => {
  if (!(await authorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(MakeInput, await readJson(req), "invalid_request");
  const invites = await makeInvites(await getDb(), { count: input.count, note: input.note ?? null, days: input.days ?? null });
  track("casting_invites_made", { count: invites.length });
  return json({ switched_on: castingInvitesOn(), invites }, 201);
});

import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { isAdmin } from "@/lib/admins";
import { BAN_KINDS, banTarget, liftBan, listBans, resolveTarget } from "@/lib/bans";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Admin only: the bans and suspensions (lib/bans.ts), live ones first, then those that ended in the last 30 days. */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  return json({ bans: await listBans(await getDb()) });
});

const Ban = z.object({
  kind: z.enum(BAN_KINDS),
  target: z.string().trim().min(1).max(200),
  // How many days a suspension lasts; none for a ban with no end.
  days: z.number().int().min(1).max(3650).nullish(),
  reason: z.string().trim().max(500).optional(),
});

/** Admin only: ban (no days) or suspend (days) an account (@handle or id), an agent (id) or an address (IP or key). */
export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Ban, await readJson(req), "invalid_ban");
  const db = await getDb();
  const found = await resolveTarget(db, input.kind, input.target);
  if ("error" in found) return json({ error: "unknown_target", message: found.error }, 422);
  if (input.kind !== "address" && (await isAdmin(db, found.target))) {
    return json({ error: "is_admin", message: "That's an admin's account. Take away their admin first if it has to be stopped." }, 422);
  }
  const until = input.days ? new Date(Date.now() + input.days * 24 * 60 * 60 * 1000) : null;
  await banTarget(db, { kind: input.kind, target: found.target, until, reason: input.reason || null, by: authFromRequest(req)?.userId ?? "admin-password" });
  return json({ kind: input.kind, target: found.target, label: found.label, until: until?.toISOString() ?? null }, 201);
});

const Lift = z.object({ kind: z.enum(BAN_KINDS), target: z.string().trim().min(1).max(200) });

/** Admin only: lift a ban or suspension (the target as the list shows it). */
export const DELETE = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Lift, await readJson(req), "invalid_lift");
  const lifted = await liftBan(await getDb(), input.kind, input.target);
  return lifted ? json({ lifted: true }) : json({ error: "not_found", message: "Nothing like that is banned." }, 404);
});

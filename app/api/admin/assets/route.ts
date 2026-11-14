import { z } from "zod";
import { isSignedInAdmin } from "@/lib/admins";
import { ASSET_REVIEW_STATUSES, reviewAsset } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";

export const dynamic = "force-dynamic";

/** The admin password (x-frontier-key, like the other admin tools) or an admin account (lib/admins.ts). */
async function authorized(req: Request): Promise<boolean> {
  if (frontierAuthorized(req)) return true;
  return isSignedInAdmin(await getDb(), authFromRequest(req));
}

const Review = z.object({
  id: z.string().uuid(),
  status: z.enum(ASSET_REVIEW_STATUSES.filter((s) => s !== "pending") as ["approved", "rejected"]),
  note: z.string().trim().max(200).optional(),
});

/**
 * Admin only: a human's second look at one character asset (lib/assets.ts reviewAsset). Rejecting a portrait takes it
 * off every page at once: the character shows their next approved PG portrait, or their initials. Made for the
 * 2026-11-13 design review, which found an approved "PG portrait" that was a blurred picture.
 */
export const POST = handle(async (req: Request) => {
  if (!(await authorized(req))) return json({ error: "not_authorized", message: "Needs the admin password or an admin account." }, 403);
  const input = parseBody(Review, await readJson(req), "invalid_request");
  const db = await getDb();
  const { rows } = await db.query<{ id: string; character_id: string | null; kind: string; review_status: string }>(
    "select id, character_id, kind, review_status from character_assets where id = $1",
    [input.id],
  );
  const asset = rows[0];
  if (!asset) return json({ error: "not_found", message: "No asset with that id." }, 404);
  await reviewAsset(db, input.id, input.status, input.note);
  return json({ ok: true, asset: { id: asset.id, character_id: asset.character_id, kind: asset.kind, was: asset.review_status, now: input.status } });
});

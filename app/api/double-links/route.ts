import { z } from "zod";
import { getDb } from "@/lib/db";
import { doubleLinkPath, ensureDoubleLink, revokeDoubleLink } from "@/lib/double-links";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { siteUrl } from "@/lib/site";

const id = z.string().min(1).max(64);
const Input = z.object({ character_id: id, partner_id: id, revoke: z.boolean().optional() });

/**
 * A couple's "bring a friend" double-date link (lib/double-links.ts), made the first time it's asked for; or
 * `revoke: true` to turn it off. For the owner of character_id; partner_id is its date.
 */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  if (input.revoke) {
    const off = await revokeDoubleLink(db, sess.userId, input.character_id, input.partner_id);
    return json({ revoked: off }, off ? 200 : 404, sess);
  }
  const link = await ensureDoubleLink(db, sess.userId, input.character_id, input.partner_id);
  if (!link.ok) return json({ error: link.error, message: link.message }, link.status, sess);
  // The link as shared carries ?ref=double (app/funnel.ts BEACON_REFS), so its visitors count as "double_link".
  return json({ code: link.code, url: `${siteUrl()}${doubleLinkPath(link.code)}?ref=double`, expires_at: link.expires_at }, link.made ? 201 : 200, sess);
});

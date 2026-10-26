import { z } from "zod";
import { getDb } from "@/lib/db";
import { dateLinkPath, ensureDateLink, revokeDateLink } from "@/lib/date-invites";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { siteUrl } from "@/lib/site";

const Input = z.object({ character_id: z.string().min(1).max(64), revoke: z.boolean().optional() });

/** Your character's "date my OC" link (made the first time), or `revoke: true` to turn it off. Owner only. */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  if (input.revoke) {
    const off = await revokeDateLink(db, sess.userId, input.character_id);
    return json({ revoked: off }, off ? 200 : 404, sess);
  }
  const link = await ensureDateLink(db, sess.userId, input.character_id);
  if (!link.ok) return json({ error: link.error, message: link.message }, link.status, sess);
  return json({ code: link.code, url: `${siteUrl()}${dateLinkPath(link.code)}`, accepted: link.accepted }, 200, sess);
});

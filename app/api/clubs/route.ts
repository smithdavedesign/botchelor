import { z } from "zod";
import { track } from "@/lib/analytics";
import { clubView, foundClub, joinClub, leaveClub, listClubs } from "@/lib/clubs";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";

/** GET: every open club with its season standing, or ?id= one club with its members. */
export const GET = handle(async (req) => {
  const sess = session(req);
  const db = await getDb();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return json({ clubs: await listClubs(db) }, 200, sess);
  const club = await clubView(db, id, sess.isNew ? null : sess.userId);
  return club ? json(club, 200, sess) : json({ error: "not_found", message: "No such club." }, 404, sess);
});

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("found"), character_id: z.string().min(1).max(80), name: z.string().max(80), motto: z.string().max(240).optional(), emoji: z.string().max(8).optional() }),
  z.object({ action: z.literal("join"), club_id: z.string().min(1).max(40), character_id: z.string().min(1).max(80) }),
  z.object({ action: z.literal("leave"), club_id: z.string().min(1).max(40), character_id: z.string().min(1).max(80) }),
]);

/** POST: found a club with one of your characters, bring one into a club, or take one out. */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  const r =
    input.action === "found"
      ? await foundClub(db, sess.userId, input)
      : input.action === "join"
        ? await joinClub(db, sess.userId, input.club_id, input.character_id)
        : await leaveClub(db, sess.userId, input.club_id, input.character_id);
  if (!r.ok) return json({ error: r.code, message: r.error }, r.code === "not_found" ? 404 : 400, sess);
  track("club_action", { action: input.action });
  return json(r, input.action === "found" ? 201 : 200, sess);
});

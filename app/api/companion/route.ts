import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { COMPANION_GUEST_OPEN_IP_LIMITS, COMPANION_OPEN_LIMITS, guestOpening, listCompanions, openThread } from "@/lib/companion";
import { companionAllowance } from "@/lib/companion-plan";
import { companionRefusal } from "./access";

/** Your companion threads, and who else you could talk with (lib/companion.ts listCompanions). */
export const GET = handle(async (req: Request) => {
  const sess = session(req);
  const db = await getDb();
  const refused = await companionRefusal(db, req, sess);
  if (refused) return refused;
  const guest = !sess.authenticated;
  return json({ ...(await listCompanions(db, sess.userId)), allowance: await companionAllowance(db, sess.userId, new Date(), process.env, { guest }) }, 200, sess);
});

const Open = z.object({ character_id: z.string().min(1).max(64) });

/** Starts a thread with a character (or finds the one you have): its id, to open its page. */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const db = await getDb();
  const refused = await companionRefusal(db, req, sess);
  if (refused) return refused;
  const input = parseBody(Open, await readJson(req), "invalid_request");
  if (await overLimit(db, "companion_open", sess.userId, COMPANION_OPEN_LIMITS)) {
    return json({ error: "rate_limited", message: "That's a lot of new conversations for now. Come back in a bit." }, 429, sess);
  }
  // A guest (no account, ./access.ts): a few conversations at most, never once their free replies are gone, and not
  // many new ones from one address (a new cookie costs nothing). Going back to one they have is always fine.
  if (!sess.authenticated) {
    const allowance = await companionAllowance(db, sess.userId, new Date(), process.env, { guest: true });
    const opening = await guestOpening(db, sess.userId, input.character_id, allowance.left ?? 0);
    if (opening.block) return json({ error: "sign_in", message: opening.block, allowance }, 401, sess);
    const visitor = opening.fresh ? visitorKey(req.headers) : null;
    if (visitor && (await overLimit(db, "companion_guest_open", visitor, COMPANION_GUEST_OPEN_IP_LIMITS))) {
      return json({ error: "rate_limited", message: "That's a lot of new conversations from here. A free account lifts the limit." }, 429, sess);
    }
  }
  const r = await openThread(db, sess.userId, input.character_id);
  if (!r.ok) {
    const { ok: _ok, status, ...body } = r;
    return json(body, status, sess);
  }
  return json({ thread_id: r.thread_id, resumed: r.resumed }, r.resumed ? 200 : 201, sess);
});

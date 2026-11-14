import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { COMPANION_GUEST_OPEN_IP_LIMITS, COMPANION_OPEN_LIMITS, guestOpening } from "@/lib/companion";
import { companionAllowance } from "@/lib/companion-plan";
import { afterDateCharacter, sendAfterDateText } from "@/lib/after-date-text";
import { companionRefusal } from "../access";

const Body = z.object({ episode_id: z.string().min(1).max(64) });

/**
 * "Hear from {first}" on the verdict card (app/episodes/[id]/VerdictCard.tsx): your own character texts you about the
 * date it just had, in its companion thread (lib/after-date-text.ts). Who may: whoever may talk with a companion
 * (../access.ts: signed in, or a guest on a signed session, past the 18+ gate), under the same limits as opening a
 * conversation (app/api/companion/route.ts). The tap is the opt-in for later texts from that character
 * (docs/companions.md, "Texts from your own character"): the thread's muted_proactive goes off. 201 when the text went
 * in, 200 when it was already there; either way `href` is the thread.
 */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const db = await getDb();
  const refused = await companionRefusal(db, req, sess);
  if (refused) return refused;
  const input = parseBody(Body, await readJson(req), "invalid_request");
  if (await overLimit(db, "companion_open", sess.userId, COMPANION_OPEN_LIMITS)) {
    return json({ error: "rate_limited", message: "That's a lot of new conversations for now. Come back in a bit." }, 429, sess);
  }
  const who = await afterDateCharacter(db, { userId: sess.userId, episodeId: input.episode_id });
  if (!who.ok) {
    const { ok: _ok, status, ...body } = who;
    return json(body, status, sess);
  }
  // A guest (no account, ../access.ts): a few conversations at most, never once their free replies are gone, and not
  // many new ones from one address. Going back to a thread they have is always fine.
  if (!sess.authenticated) {
    const allowance = await companionAllowance(db, sess.userId, new Date(), process.env, { guest: true });
    const opening = await guestOpening(db, sess.userId, who.character_id, allowance.left ?? 0);
    if (opening.block) return json({ error: "sign_in", message: opening.block, allowance }, 401, sess);
    const visitor = opening.fresh ? visitorKey(req.headers) : null;
    if (visitor && (await overLimit(db, "companion_guest_open", visitor, COMPANION_GUEST_OPEN_IP_LIMITS))) {
      return json({ error: "rate_limited", message: "That's a lot of new conversations from here. A free account lifts the limit." }, 429, sess);
    }
  }
  const r = await sendAfterDateText(db, { userId: sess.userId, episodeId: input.episode_id, now: new Date() });
  if (!r.ok) {
    const { ok: _ok, status, ...body } = r;
    return json(body, status, sess);
  }
  await db.query(`update companion_threads set muted_proactive = false where id = $1 and user_id = $2`, [r.thread_id, sess.userId]);
  return json({ thread_id: r.thread_id, href: `/companion/${r.thread_id}`, sent: r.sent }, r.sent ? 201 : 200, sess);
});

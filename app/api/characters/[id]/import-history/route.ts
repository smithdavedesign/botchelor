import { z } from "zod";
import { COMPANION_GUEST_OPEN_IP_LIMITS, COMPANION_OPEN_LIMITS, guestOpening, threadIdFor } from "@/lib/companion";
import { FACT_MAX } from "@/lib/companion-memory";
import { companionMemoryHref } from "@/lib/companion-shared";
import { companionAllowance } from "@/lib/companion-plan";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { HISTORY_ITEMS_MAX, importMemoriesOn } from "@/lib/import-history";
import { drawImportOpener, rememberImported, screenUsLines } from "@/lib/import-history-server";
import { overLimit, visitorKey } from "@/lib/limits";
import { inBackground } from "@/lib/sets";
import { ownsCharacter } from "@/lib/souls";
import { companionRefusal } from "../../../companion/access";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ us: z.array(z.string().max(FACT_MAX * 2)).min(1).max(HISTORY_ITEMS_MAX) });

/** Why the lines wait in the person's browser instead: said on the page, never an error (the character exists either way). */
type Held = "sign_in" | "age_gate" | "closed" | "limit" | "guest";
const HELD_LINES: Record<Held, string> = {
  sign_in: "They're kept in this browser until you can text them: that needs a free account here.",
  age_gate: "They're kept in this browser until you've confirmed you're 18 or over.",
  closed: "They're kept in this browser until you can text them.",
  limit: "They're kept in this browser for now: that's a lot of new conversations in a short time.",
  guest: "They're kept in this browser until you can text them: without an account that's a few characters, and a free account opens everyone.",
};

/**
 * "Bring their history" (lib/import-history.ts), after Create: the "two of you" lines the person kept on /import go into
 * the companion memory of their thread with the character they just made (`{ us: string[] }`, at most eight). The owner
 * only, and only someone who may talk with a companion (app/api/companion/access.ts), under the limits opening a
 * conversation has (app/api/companion/route.ts): the thread is started the way a character's own first text starts it
 * (the AI notice, no model call), the lines are written with the memory editor's own function and checks
 * (lib/import-history-server.ts), and then the character's hello is drawn in the background, so its first words can
 * use them.
 *
 * 200 `{ kept, dropped, thread_id, href }` when they went in (`href` is the memory page, where each is theirs to edit).
 * 200 `{ held: true, why, message }` when the memory can't be written yet: the page keeps the lines in this browser and
 * the memory page offers them once the thread exists. 404 for anyone but the owner, and when IMPORT_MEMORIES=0.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  if (!importMemoriesOn()) return json({ error: "not_found", message: "Not found." }, 404, sess);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  const input = parseBody(Body, await readJson(req), "invalid_request");
  const held = (why: Held) => json({ held: true, why, message: HELD_LINES[why] }, 200, sess);

  // Checked before anything is opened: a paste that leaves nothing to remember starts no conversation.
  const screened = screenUsLines(input.us);
  if (!screened.ok.length) return json({ kept: 0, dropped: screened.dropped, thread_id: null, href: null }, 200, sess);

  const refused = await companionRefusal(db, req, sess);
  if (refused) return held(refused.status === 401 ? "sign_in" : refused.status === 403 ? "age_gate" : "closed");
  // A thread they already have takes the lines as the memory page would; a new one counts as opening a conversation.
  const fresh = (await threadIdFor(db, sess.userId, id)) === null;
  if (fresh) {
    if (await overLimit(db, "companion_open", sess.userId, COMPANION_OPEN_LIMITS)) return held("limit");
    if (!sess.authenticated) {
      const allowance = await companionAllowance(db, sess.userId, new Date(), process.env, { guest: true });
      if ((await guestOpening(db, sess.userId, id, allowance.left ?? 0)).block) return held("guest");
      const visitor = visitorKey(req.headers);
      if (visitor && (await overLimit(db, "companion_guest_open", visitor, COMPANION_GUEST_OPEN_IP_LIMITS))) return held("limit");
    }
  }

  const r = await rememberImported(db, sess.userId, id, screened.ok);
  if (!r.ok) return held("closed");
  if (r.fresh) inBackground(() => drawImportOpener(db, sess.userId, r.threadId));
  return json({ kept: r.kept, dropped: screened.dropped + r.dropped, thread_id: r.threadId, href: companionMemoryHref(r.threadId) }, 200, sess);
});

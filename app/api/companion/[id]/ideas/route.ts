import { z } from "zod";
import { companionIdeas } from "@/lib/companion-ideas";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { companionRefusal } from "../../access";

// Drawn per request (one small call to the companion's writer when none are kept yet), never cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** `again`: draw other ideas for the same reply (while any draws are left). */
const Input = z.object({ again: z.boolean().optional() });

/**
 * Ideas for what to say (lib/companion-ideas.ts): up to three lines under the character's newest reply that the person
 * could send next, each with its tone, each already held to the checks their own message gets. The page asks once the
 * reply has landed, so a reply never waits on this. Open to the same people as sending (../../access.ts: signed in, or
 * a guest trying it), and not found for someone else's thread. A paused thread is refused as a message is. It costs no
 * reply: the draw cap bounds it. Nothing to suggest is an empty list, never an error the page would have to show.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  const refused = await companionRefusal(db, req, sess);
  if (refused) return refused;
  const input = parseBody(Input, await readJson(req).catch(() => ({})), "invalid_request");
  const r = await companionIdeas(db, sess.userId, id, { again: input.again === true, guest: !sess.authenticated });
  if (!r.ok) {
    const { ok: _ok, status, ...body } = r;
    return json(body, status, sess);
  }
  return json({ for: r.for, ideas: r.ideas, more: r.more }, 200, sess);
});

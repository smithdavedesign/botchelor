import { z } from "zod";
import { stepInViewer } from "@/lib/adult/step-in";
import { stepInIdeas } from "@/lib/adult/step-in-ideas";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

// One small model call when the ideas aren't kept yet.
export const maxDuration = 60;

/** `again`: draw other ideas for the same reply (while any draws are left). */
const Input = z.object({ again: z.boolean().optional() });

/**
 * What the viewer could write next in a Step in scene (lib/adult/step-in-ideas.ts): up to three lines under the
 * character's newest reply, each with its tone, each already held to the checks a written line gets. The page asks
 * after a reply has landed, so a reply never waits on this. Not found for anyone Step in isn't open to. A scene that
 * can't be written, or a viewer at the month's cap, has no ideas: the answer is an empty list, never an error the page
 * would have to show (nothing here is something they asked for).
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const viewer = await stepInViewer(db, req);
  if (!viewer) return json({ error: "not_found" }, 404);
  const input = parseBody(Input, await readJson(req).catch(() => ({})), "invalid_request");
  const r = await stepInIdeas(db, viewer, id, { again: input.again === true });
  if (!r.ok) return r.status === 404 ? json({ error: "not_found" }, 404) : json({ for: null, ideas: [], more: false });
  return json({ for: r.for, ideas: r.ideas, more: r.more });
});

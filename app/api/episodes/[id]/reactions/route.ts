import { z } from "zod";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson, session } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { MAX_LINE_INDEX, REF_ID, visibleLineCount } from "@/lib/line-feedback";
import { LINE_REACTION_LIMITS, REACTION_KINDS, addReaction, lineTallies } from "@/lib/line-reactions";

export const dynamic = "force-dynamic";

const NOT_FOUND = { error: "not_found", message: "There's no such date to react to here." } as const;

/**
 * The crowd's taps on a date's lines (lib/line-reactions.ts): GET gives { lines: { [line index]: { swoon, cringe, dead } } }
 * for a date the viewer can see (the same rule as the thumbs, lib/line-feedback.ts visibleLineCount), else not found.
 */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const sess = session(req);
  if (!REF_ID.test(id)) return json(NOT_FOUND, 404, sess);
  const db = await getDb();
  const lines = await visibleLineCount(db, "episode", id, sess);
  if (lines === null) return json(NOT_FOUND, 404, sess);
  return json({ lines: await lineTallies(db, id) }, 200, sess);
});

const Input = z.object({ line_index: z.number().int().min(0).max(MAX_LINE_INDEX), kind: z.enum(REACTION_KINDS) });

/** One tap: { line_index, kind }. Needs a session (an anonymous one is fine), rate limited per connection and per session. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const auth = authFromRequest(req);
  if (!auth) return json({ error: "no_session", message: "Open the date first, then react." }, 401);
  if (!REF_ID.test(id)) return json(NOT_FOUND, 404);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  const visitor = visitorKey(req.headers);
  const limited =
    (visitor !== null && (await overLimit(db, "line_reaction", visitor, LINE_REACTION_LIMITS))) || (await overLimit(db, "line_reaction_user", auth.userId, LINE_REACTION_LIMITS));
  if (limited) return json({ error: "too_many_reactions", message: "That's a lot of reactions. Take a breath and try again in a while." }, 429);
  const lines = await visibleLineCount(db, "episode", id, auth);
  if (lines === null) return json(NOT_FOUND, 404);
  if (input.line_index >= lines) return json({ error: "no_such_line" }, 422);
  const count = await addReaction(db, id, input.line_index, input.kind);
  return json({ line_index: input.line_index, kind: input.kind, count });
});

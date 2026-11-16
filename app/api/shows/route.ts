import { z } from "zod";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { listShowIdeas, SHOW_VOTE_LIMITS, showIdeasOn, showProposalsOn, voteShowIdea, voterKind } from "@/lib/show-ideas";

export const dynamic = "force-dynamic";

const CLOSED = { error: "not_available", message: "Show ideas aren't open right now." };

/** The list of show ideas (lib/show-ideas.ts) as this viewer sees it: counts for people and for agents, and their own answers. */
export const GET = handle(async (req) => {
  if (!showIdeasOn()) return json(CLOSED, 404);
  const sess = session(req);
  const ideas = await listShowIdeas(await getDb(), sess.isNew ? null : sess.userId);
  return json({ ideas, proposals_open: showProposalsOn() }, 200, sess);
});

const VoteInput = z.object({
  idea_id: z.string().min(1).max(64),
  watch: z.boolean().optional(),
  enter: z.boolean().optional(),
  produce: z.boolean().optional(),
});

/** One viewer's answers on one idea: the three switches as they should now stand (all off takes the answer back). */
export const POST = handle(async (req) => {
  if (!showIdeasOn()) return json(CLOSED, 404);
  const sess = session(req);
  const input = parseBody(VoteInput, await readJson(req), "invalid_vote");
  const db = await getDb();
  const visitor = visitorKey(req.headers);
  if (visitor !== null && (await overLimit(db, "show_idea_vote", visitor, SHOW_VOTE_LIMITS))) {
    return json({ error: "rate_limited", message: "That's a lot of taps. Try again in a while." }, 429, sess);
  }
  const kind = voterKind(req);
  const picks = { watch: input.watch === true, enter: input.enter === true, produce: input.produce === true };
  const result = await voteShowIdea(db, sess.userId, kind, input.idea_id, picks);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status, sess);
  track("show_idea_vote", { idea: result.idea_id, kind, ...picks });
  return json({ idea_id: result.idea_id, mine: result.mine }, 201, sess);
});

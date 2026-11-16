import { z } from "zod";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { PITCH_MAX, proposeShowIdea, SHOW_PROPOSE_LIMITS, showIdeasOn, TITLE_MAX, voterKind } from "@/lib/show-ideas";

export const dynamic = "force-dynamic";

// Generous here; lib/show-ideas.ts gives the real limits in words a person can act on.
const Input = z.object({ title: z.string().max(TITLE_MAX * 4), pitch: z.string().max(PITCH_MAX * 4) });

/**
 * A show idea, proposed (lib/show-ideas.ts): held for an admin, so nobody else sees it until it's listed. It needs an
 * account signed in (an idea is someone's words on a public page: we need to be able to say whose, and to take it down
 * with the account). Agents propose over MCP (propose_show_idea), which carries their own identity.
 */
export const POST = handle(async (req) => {
  if (!showIdeasOn()) return json({ error: "not_available", message: "Show ideas aren't open right now." }, 404);
  const sess = session(req);
  if (!sess.authenticated) return json({ error: "sign_in", message: "Sign in to propose a show. Voting needs no account." }, 401, sess);
  const input = parseBody(Input, await readJson(req), "invalid_idea");
  const db = await getDb();
  const visitor = visitorKey(req.headers);
  if (visitor !== null && (await overLimit(db, "show_idea_propose", visitor, SHOW_PROPOSE_LIMITS))) {
    return json({ error: "rate_limited", message: "That's a few ideas already. Try again in an hour." }, 429, sess);
  }
  const kind = voterKind(req);
  const result = await proposeShowIdea(db, sess.userId, kind, input);
  if (!result.ok) return json({ error: result.error, message: result.message, ...(result.field ? { field: result.field } : {}) }, result.status, sess);
  track("show_idea_proposed", { kind });
  return json({ id: result.id, status: result.status, title: result.title, pitch: result.pitch }, 201, sess);
});

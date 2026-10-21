import { z } from "zod";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson, session } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";
import { LINE_FEEDBACK_KINDS, LINE_FEEDBACK_LIMITS, MAX_LINE_INDEX, REF_ID, setLineVote, viewerVotes, visibleLineCount, type LineFeedbackKind } from "@/lib/line-feedback";

export const dynamic = "force-dynamic";

const NOT_FOUND = { error: "not_found", message: "There's no such date or night to rate here." } as const;

/**
 * The viewer's own votes on one ref's lines (lib/line-feedback.ts): GET ?kind=episode|after_dark&ref=<id>, as
 * { votes: { [line index]: 1 | -1 }, lines }. Not found for a ref they can't see. A first-time visitor gets their
 * anonymous id here (like the other public reads), so the thumbs work on their first tap.
 */
export const GET = handle(async (req) => {
  const sess = session(req);
  const params = new URL(req.url).searchParams;
  const kind = params.get("kind") ?? "";
  const ref = params.get("ref") ?? "";
  if (!(LINE_FEEDBACK_KINDS as readonly string[]).includes(kind) || !REF_ID.test(ref)) return json({ error: "invalid_request", kinds: LINE_FEEDBACK_KINDS }, 400, sess);
  const db = await getDb();
  const lines = await visibleLineCount(db, kind as LineFeedbackKind, ref, sess);
  if (lines === null) return json(NOT_FOUND, 404, sess);
  return json({ kind, ref_id: ref, lines, votes: await viewerVotes(db, sess.userId, kind as LineFeedbackKind, ref) }, 200, sess);
});

const Input = z.object({
  kind: z.enum(LINE_FEEDBACK_KINDS),
  ref_id: z.string().regex(REF_ID, "Not a date or night id."),
  line_index: z.number().int().min(0).max(MAX_LINE_INDEX),
  vote: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

/**
 * Sets the viewer's vote on one line: { kind, ref_id, line_index, vote: 1 | -1 }, or vote 0 to take it back. Needs a
 * session (an anonymous one is fine: it has an id), is rate limited per connection and per person, and only takes lines
 * the viewer can see.
 */
export const POST = handle(async (req) => {
  const auth = authFromRequest(req);
  if (!auth) return json({ error: "no_session", message: "Open the page first, then vote: a vote needs your session." }, 401);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  const visitor = visitorKey(req.headers);
  const limited =
    (visitor !== null && (await overLimit(db, "line_feedback", visitor, LINE_FEEDBACK_LIMITS))) ||
    (await overLimit(db, "line_feedback_user", auth.userId, LINE_FEEDBACK_LIMITS));
  if (limited) return json({ error: "too_many_votes", message: "That's a lot of votes in a short time. Try again in a while." }, 429);
  const lines = await visibleLineCount(db, input.kind, input.ref_id, auth);
  if (lines === null) return json(NOT_FOUND, 404);
  if (input.line_index >= lines) return json({ error: "no_such_line", message: `That one has ${lines} line${lines === 1 ? "" : "s"}.` }, 422);
  await setLineVote(db, { userId: auth.userId, kind: input.kind, refId: input.ref_id, lineIndex: input.line_index, vote: input.vote });
  return json({ kind: input.kind, ref_id: input.ref_id, line_index: input.line_index, vote: input.vote });
});

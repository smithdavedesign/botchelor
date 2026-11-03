import { z } from "zod";
import { track } from "@/lib/analytics";
import { castingBoard, voteAudition } from "@/lib/auditions";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { overLimit, visitorKey } from "@/lib/limits";

const VoteInput = z.object({ character_id: z.string().min(1).max(80) });

/** Enough to change your mind a few times, not enough to stuff the ballot from fresh cookies on one connection. */
const VOTE_LIMITS = { perHour: 10, perDay: 30 };

/** Next month's auditions, most votes first, and this viewer's vote (lib/auditions.ts). */
export const GET = handle(async (req: Request) => {
  const sess = session(req);
  return json(await castingBoard(await getDb(), sess.isNew ? null : sess.userId), 200, sess);
});

/** A vote for one audition: one a viewer a season, moved by voting again. */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const input = parseBody(VoteInput, await readJson(req), "invalid_vote");
  const db = await getDb();
  const visitor = visitorKey(req.headers);
  if (visitor && (await overLimit(db, "audition_vote", visitor, VOTE_LIMITS))) {
    return json({ error: "too_many_votes", message: "That's a lot of votes from one connection. Try again within the hour." }, 429, sess);
  }
  const r = await voteAudition(db, sess.userId, input.character_id);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  track("audition_vote", {});
  return json({ my_vote: r.character_id }, 201, sess);
});

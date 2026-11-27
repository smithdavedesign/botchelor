import { z } from "zod";
import { track } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { TOO_MANY_VOTES, voteLimited } from "@/lib/limits";
import { currentTournament, tournamentView, voteTournament } from "@/lib/tournaments";

/** GET ?id=: a tournament's bracket as this viewer sees it (no id: the current one). */
export const GET = handle(async (req) => {
  const sess = session(req);
  const db = await getDb();
  const id = new URL(req.url).searchParams.get("id") ?? (await currentTournament(db))?.id ?? null;
  const view = id ? await tournamentView(db, id, sess.isNew ? null : sess.userId) : null;
  if (!view) return json({ error: "not_found", message: "No tournament is on." }, 404, sess);
  return json(view, 200, sess);
});

const VoteInput = z.object({ tournament_id: z.string().min(1).max(40), match: z.number().int().min(1).max(16), pick: z.string().min(1).max(80) });

/** POST: a vote (or a changed one) in an open match. */
export const POST = handle(async (req) => {
  const sess = session(req);
  const input = parseBody(VoteInput, await readJson(req), "invalid_vote");
  const db = await getDb();
  if (await voteLimited(db, "tournament_vote", req.headers)) return json(TOO_MANY_VOTES, 429, sess);
  const r = await voteTournament(db, sess.userId, input.tournament_id, input.match, input.pick);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  track("tournament_vote", { round: r.round, match: r.match });
  return json(r, 201, sess);
});

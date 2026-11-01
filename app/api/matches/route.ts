import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { unmatch } from "@/lib/unmatch";

const UnmatchInput = z.object({ character_id: z.string().min(1).max(64), with: z.string().min(1).max(64) });

/**
 * Unmatches one of your characters from a match, from their thread (lib/unmatch.ts; David, 2026-10-31: a match isn't
 * undone from the deck). For good: they don't text, date, meet in the deck or match again. Not once they've dated.
 */
export const DELETE = handle(async (req: Request) => {
  const sess = session(req);
  const input = parseBody(UnmatchInput, await readJson(req), "invalid_request");
  const db = await getDb();
  const r = await unmatch(db, sess.userId, input.character_id, input.with);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  return json({ unmatched: r.with }, 200, sess);
});

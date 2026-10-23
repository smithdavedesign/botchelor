import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { logShownCard } from "@/lib/swipes";

const Input = z.object({
  character_id: z.string().min(1).max(64),
  card_id: z.string().min(1).max(64),
  serve_id: z.string().min(1).max(64),
  rank: z.number().int().min(1).max(1000),
});

/**
 * The swipe deck's impression (lib/swipes.ts logShownCard): the page reports the card on top when it's shown, once
 * per card per deck session, with its rank in what this person has seen (`rank`). That's what the preference data
 * records for the web, not the hand that was dealt (GET /api/swipes logs nothing). Your own characters only; a card
 * outside that character's deck is refused, and a repeat is a no-op (`logged: false`).
 */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = await logShownCard(await getDb(), sess.userId, input.character_id, input.card_id, input.serve_id, input.rank);
  if (!r.ok) return json({ error: r.error, message: r.message }, r.status, sess);
  return json({ logged: r.logged }, 200, sess);
});

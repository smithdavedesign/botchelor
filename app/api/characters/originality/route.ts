import { z } from "zod";
import { getDb } from "@/lib/db";
import { ExtrasInput, normaliseExtras } from "@/lib/extras";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { ORIGINALITY_CHECK_LIMITS, overLimit, visitorKey } from "@/lib/limits";
import { originalityWithConcepts } from "@/lib/originality-concept";
import { VOICE_MAX } from "@/lib/rules";
import { ownsCharacter } from "@/lib/souls";

const Draft = z.object({
  name: z.string().trim().max(40).optional(),
  bio: z.string().trim().max(500).optional(),
  traits: z.array(z.string().trim().max(30)).max(3).optional(),
  want: z.string().trim().max(140).optional(),
  dealbreaker: z.string().trim().max(140).optional(),
  voice: z.string().trim().max(VOICE_MAX).nullable().optional(),
  extras: ExtrasInput.nullable().optional(),
  /** Editing: the character being edited, so it isn't compared with itself. Must be yours. */
  character_id: z.string().trim().max(64).optional(),
});

/**
 * The originality check for a draft character (lib/originality.ts): the stock phrases it leans on, characters on
 * the show it reads almost the same as, and what would make it stand out. A nudge only — nothing is stored and
 * nothing is blocked. Reads only public sheet fields of other characters, and returns just their names.
 *
 * Each distinct bio can cost one embedding call (lib/originality-concept.ts), so it's limited per connection and per
 * session (lib/limits.ts ORIGINALITY_CHECK_LIMITS); the embedding calls also have a daily cap of their own. In-process
 * calls (MCP check_originality) carry no IP, so only the session limit and the daily cap apply to them.
 */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const draft = parseBody(Draft, await readJson(req), "invalid_character");
  const db = await getDb();
  const visitor = visitorKey(req.headers);
  const limited =
    (visitor !== null && (await overLimit(db, "originality", visitor, ORIGINALITY_CHECK_LIMITS))) ||
    (await overLimit(db, "originality_user", sess.userId, ORIGINALITY_CHECK_LIMITS));
  if (limited) {
    return json({ error: "too_many_checks", message: "That's a lot of originality checks in a short time. Try again in a while." }, 429, sess);
  }
  const exclude = draft.character_id && (await ownsCharacter(db, draft.character_id, sess.userId)) ? draft.character_id : null;
  const report = await originalityWithConcepts(db, { ...draft, extras: draft.extras ? normaliseExtras(draft.extras) : null }, exclude);
  return json(report, 200, sess);
});

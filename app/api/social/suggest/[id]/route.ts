import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { ownsCharacter } from "@/lib/souls";
import { dismissSuggestion, logShown, settleSuggestions, suggestTies } from "@/lib/social/suggest";
import { socialTiesOn } from "@/lib/social/switch";

type Ctx = { params: Promise<{ id: string }> };

const Dismiss = z.object({ dismiss: z.string().trim().min(1).max(64) });

/**
 * "Might know" (docs/PRDs/social-network.md section 6.3; lib/social/suggest.ts): who your character might know and has
 * no tie with yet, each with why. Owner only. What's shown is logged (social_suggestion_log), so what comes of it is
 * the network's link-prediction ground truth; a suggestion is never a tie.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  if (!socialTiesOn()) return json({ character_id: id, suggestions: [] }, 200, sess);
  // What came of the last ones first, so a tie made since isn't suggested again and counts as a hit.
  await settleSuggestions(db, { characterId: id }).catch(() => null);
  const suggestions = await suggestTies(db, id, { viewer: sess.userId });
  await logShown(db, sess.userId, id, suggestions);
  return json(
    { character_id: id, suggestions: suggestions.map((s) => ({ id: s.id, name: s.name, portrait: s.portrait, hue: s.hue, mine: s.mine, reason: s.reason, words: s.words, score: s.score })) },
    200,
    sess,
  );
});

/** "Not now": `{ dismiss: <their character id> }`. It stays away 90 days. Owner only. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const { dismiss } = parseBody(Dismiss, await readJson(req), "invalid_dismiss");
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  if (!socialTiesOn() || !(await dismissSuggestion(db, sess.userId, id, dismiss))) return json({ error: "not_found" }, 404, sess);
  return json({ character_id: id, dismissed: dismiss }, 200, sess);
});

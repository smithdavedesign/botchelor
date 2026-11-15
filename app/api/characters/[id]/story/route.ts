import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { ownsCharacter } from "@/lib/souls";
import { forgetStory, rememberStory, STORY_FORGET_KINDS, storyStateOn, storyView } from "@/lib/story-state";

type Ctx = { params: Promise<{ id: string }> };

const ForgetInput = z.object({ kind: z.enum(STORY_FORGET_KINDS), item: z.string().trim().min(1).max(64) });

/**
 * What your character thinks of people, what it has heard and from whom, and what it wants this week (lib/story-state.ts).
 * Owner only: its opinions are its private words, like the memory view's feelings about the people it dated.
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  return json({ character_id: id, story: await storyView(db, id) }, 200, sess);
});

/**
 * Tell your character to forget what it thinks of someone (kind opinion, item: their character id) or one thing it
 * heard (kind heard, item: its id). It's gone from every future date and text, and the same date or scene never brings
 * it back; a later date with that person forms a fresh opinion. Owner only.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const { kind, item } = parseBody(ForgetInput, await readJson(req), "invalid_forget");
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  if (!storyStateOn() || !(await forgetStory(db, id, kind, item))) {
    return json({ error: "not_remembered", message: "Your character doesn't hold that (or has already forgotten it)." }, 404, sess);
  }
  return json({ character_id: id, forgotten: { kind, item }, story: await storyView(db, id) }, 200, sess);
});

/** Remember it again: undo a forget. Owner only. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const { kind, item } = parseBody(ForgetInput, await readJson(req), "invalid_forget");
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  if (!storyStateOn() || !(await rememberStory(db, id, kind, item))) return json({ error: "not_forgotten", message: "That wasn't forgotten." }, 404, sess);
  return json({ character_id: id, remembered: { kind, item }, story: await storyView(db, id) }, 200, sess);
});

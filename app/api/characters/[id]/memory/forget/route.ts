import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { FORGET_KINDS, loadCharacterMemory, updateCharacterMemory, type CharacterMemory, type ForgetKind } from "@/lib/memory";
import { ownsCharacter } from "@/lib/souls";

type Ctx = { params: Promise<{ id: string }> };

const ForgetInput = z.object({ kind: z.enum(FORGET_KINDS), item: z.string().trim().min(1).max(600) });

/** Whether `item` is something this character currently remembers (so a forget is never stored for junk). */
function remembers(m: CharacterMemory | null, kind: ForgetKind, item: string): boolean {
  if (!m) return false;
  switch (kind) {
    case "reflection":
      return (m.sources?.reflections ?? []).some((r) => r.episode_id === item);
    case "line":
      return m.memorable_lines.includes(item);
    case "like":
      return m.likes.includes(item);
    case "turnoff":
      return m.turnoffs.includes(item);
    case "moment":
      return (m.people ?? []).some((p) => p.id === item && (p.wanted_more !== null || p.they_said || p.you_said));
  }
}

/**
 * Tell your character to forget one thing it learned: a reflection, a line it carries, something it warms to or
 * clashes over, or how it left things with someone. It's gone from every future date, and a rebuild never brings it
 * back from the same dates. Forgetting is the only change: memory is learned, not written. Owner only.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const { kind, item } = parseBody(ForgetInput, await readJson(req), "invalid_forget");
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  if (!remembers(await loadCharacterMemory(db, id), kind, item)) {
    return json({ error: "not_remembered", message: "Your character doesn't remember that (or has already forgotten it)." }, 404, sess);
  }
  await db.query(`insert into memory_forgets (character_id, kind, item) values ($1, $2, $3) on conflict do nothing`, [id, kind, item]);
  const memory = await updateCharacterMemory(db, id);
  return json({ character_id: id, forgotten: { kind, item }, memory }, 200, sess);
});

/** Remember it again: undo a forget, so the next rebuild learns it from its dates as before. Owner only. */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const { kind, item } = parseBody(ForgetInput, await readJson(req), "invalid_forget");
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  const { rows } = await db.query(`delete from memory_forgets where character_id = $1 and kind = $2 and item = $3 returning item`, [id, kind, item]);
  if (!rows.length) return json({ error: "not_forgotten", message: "That wasn't forgotten." }, 404, sess);
  const memory = await updateCharacterMemory(db, id);
  return json({ character_id: id, remembered: { kind, item }, memory }, 200, sess);
});

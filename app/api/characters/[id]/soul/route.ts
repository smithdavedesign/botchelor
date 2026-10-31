import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session, userIdFromRequest } from "@/lib/http";
import { assertSafeSoul, deleteSoul, isEmptySoul, loadSoul, normaliseSoul, ownsCharacter, saveSoul, SoulInput } from "@/lib/souls";

type Ctx = { params: Promise<{ id: string }> };

/** The owner reads their character's private soul (to edit it). Nobody else can. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const userId = userIdFromRequest(req);
  const db = await getDb();
  if (!userId || !(await ownsCharacter(db, id, userId))) return json({ error: "character_not_found" }, 404);
  return json({ character_id: id, soul: await loadSoul(db, id) });
});

/** The owner writes (upserts) the private soul. Empty clears it. Content-filtered like a sheet. */
export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);

  const input = parseBody(SoulInput, await readJson(req), "invalid_soul");
  const soul = normaliseSoul(input);
  if (isEmptySoul(soul)) {
    await deleteSoul(db, id);
    return json({ character_id: id, has_soul: false }, 200, sess);
  }
  await assertSafeSoul(soul);
  await saveSoul(db, id, soul, input.local_only ?? false);
  return json({ character_id: id, has_soul: true, local_only: input.local_only ?? false }, 200, sess);
});

/** The owner deletes the soul (PRD guardrail: a soul built from the owner is personal data they can delete). */
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const db = await getDb();
  if (!(await ownsCharacter(db, id, sess.userId))) return json({ error: "character_not_found" }, 404, sess);
  await deleteSoul(db, id);
  return json({ character_id: id, has_soul: false }, 200, sess);
});
